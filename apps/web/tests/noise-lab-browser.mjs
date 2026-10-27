/* global console, process, setTimeout, clearTimeout, WebSocket */
// Run against the isolated Vite server. No browser profile or real mic is used.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import { syntheticFixture } from './noise-lab-fixture.ts';
import { wav } from '../src/features/voice/audio/noiseLabMetrics.ts';

const origin = process.env.LAB_ORIGIN || 'http://127.0.0.1:5198';
const chrome = process.env.LAB_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const scratch = await mkdtemp(path.join(tmpdir(), 'goida-noise-lab-'));
const fixturePath = path.join(scratch, 'synthetic.wav');
await writeFile(fixturePath, new Uint8Array(await wav(syntheticFixture()).arrayBuffer()));
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${scratch}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-first-run',
    '--no-default-browser-check',
    `--use-file-for-fake-audio-capture=${fixturePath}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
const endpoint = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chrome startup timeout')), 20000);
  browser.on('error', reject);
  browser.stderr.on('data', (chunk) => {
    const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
});
const ws = new WebSocket(endpoint);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data));
  const item = pending.get(message.id);
  if (item) {
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
let session;
const report = { comparisons: [], captures: [], stability: [] };
async function cpuSnapshot() {
  return (await send('SystemInfo.getProcessInfo')).processInfo;
}
function cpuPercent(before, after, elapsedMs) {
  let seconds = 0;
  for (const item of after) {
    const old = before.find((value) => value.id === item.id);
    if (old) seconds += Math.max(0, item.cpuTime - old.cpuTime);
  }
  return (seconds / (elapsedMs / 1000)) * 100;
}
async function evaluate(expression) {
  const response = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    session,
  );
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description || response.exceptionDetails.text,
    );
  return response.result.value;
}
try {
  const { targetId } = await send('Target.createTarget', { url: `${origin}/tests/noise-lab.html` });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable', {}, session);
  await send('Page.enable', {}, session);
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    ready = await evaluate('!!document.querySelector("h1")');
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'lab renders');
  await evaluate(`(async () => {
    window.lab = await import('/src/features/voice/audio/noiseLabRunner.ts');
    window.adapters = await import('/src/features/voice/audio/noiseLabAdapters.ts');
    const {syntheticFixture}=await import('/tests/noise-lab-fixture.ts');
    const pcm=syntheticFixture();
    const {wav}=await import('/src/features/voice/audio/noiseLabMetrics.ts');
    window.fixture=await lab.decodeFixture(new File([wav(pcm)],'deterministic-harmonics.wav'),'synthetic');
    window.summaries=[];
  })()`);
  // Genuine processing of the identical fixture, then full init/process/close cycles.
  for (const modeId of ['raw', 'rnnoise', 'speex', 'experimental']) {
    const before = await cpuSnapshot();
    const started = performance.now();
    const result = await evaluate(`(async () => {
      const mode=adapters.MODES.find(m=>m.id===${JSON.stringify(modeId)});
      const result=await lab.runAndRelease(mode,{type:'file',fixture},new AbortController().signal);
      return {mode:mode.id, metrics:result.metrics, peak:result.peakResources, after:result.afterResources};
    })()`);
    assert.equal(result.metrics.outputSilent, false, `${modeId} outputs audio`);
    assert.deepEqual(Object.values(result.after), [0, 0, 0, 0]);
    result.browserProcessCpuPercentOneCore = cpuPercent(
      before,
      await cpuSnapshot(),
      performance.now() - started,
    );
    report.comparisons.push(result);
    console.log(JSON.stringify({ comparison: result }));
    const stressModes = (process.env.LAB_STRESS_MODES || 'raw,rnnoise,speex,experimental').split(
      ',',
    );
    const cycles = stressModes.includes(modeId) ? Number(process.env.LAB_CYCLES || 100) : 0;
    for (let offset = 0; offset < cycles; offset += 10) {
      const count = Math.min(10, cycles - offset);
      const summary = await evaluate(`(async () => {
        const mode=adapters.MODES.find(m=>m.id===${JSON.stringify(modeId)});
        for(let i=0;i<${count};i++) {
          const result=await lab.runAndRelease(mode,{type:'file',fixture},new AbortController().signal);
          if(result.metrics.outputSilent) throw new Error('Unexpected silence');
          if(Object.values(result.afterResources).some(Boolean)) throw new Error('Resource leak');
        }
        return {mode:mode.id, completed:${offset + count}, after:{...adapters.resources}};
      })()`);
      console.log(JSON.stringify(summary));
      if (offset + count === cycles) report.stability.push(summary);
    }
  }
  for (const modeId of ['raw', 'browser-ns', 'browser-agc', 'browser-aec', 'rnnoise-aec']) {
    const before = await cpuSnapshot();
    const started = performance.now();
    const capture = await evaluate(`(async () => {
      const mode=adapters.MODES.find(m=>m.id===${JSON.stringify(modeId)});
      const result=await lab.runAndRelease(mode,{type:'microphone',deviceId:'',seconds:1},new AbortController().signal);
      return {mode:mode.id, settings:result.settings, metrics:result.metrics, after:result.afterResources};
    })()`);
    assert.deepEqual(Object.values(capture.after), [0, 0, 0, 0]);
    capture.browserProcessCpuPercentOneCore = cpuPercent(
      before,
      await cpuSnapshot(),
      performance.now() - started,
    );
    report.captures.push(capture);
    console.log(JSON.stringify({ capture }));
  }
  const cancellation = await evaluate(`(async () => {
    const controller=new AbortController();
    setTimeout(()=>controller.abort(),700);
    try { await lab.runAndRelease(adapters.MODES[4],{type:'file',fixture},controller.signal); throw new Error('Abort ignored'); }
    catch(error) { if(error.name!=='AbortError') throw error; }
    return {...adapters.resources};
  })()`);
  assert.deepEqual(Object.values(cancellation), [0, 0, 0, 0]);
  // Browser processing on a decoded file must fail instead of a fake passthrough.
  assert.equal(
    await evaluate(
      `(async()=>{try{await lab.runAndRelease(adapters.MODES[1],{type:'file',fixture},new AbortController().signal);return false}catch{return true}})()`,
    ),
    true,
  );
  const failure = await evaluate(`(async()=>{
    const original=AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule=()=>Promise.reject(new Error('Injected worklet load failure'));
    try{await lab.runAndRelease(adapters.MODES[6],{type:'file',fixture},new AbortController().signal); throw new Error('Failure ignored');}
    catch(error){if(!error.message.includes('Injected'))throw error;}
    finally{AudioWorklet.prototype.addModule=original;}
    return {...adapters.resources};
  })()`);
  assert.deepEqual(Object.values(failure), [0, 0, 0, 0]);
  const permission = await evaluate(`(async()=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Denied','NotAllowedError'));
    try{await lab.runAndRelease(adapters.MODES[0],{type:'microphone',deviceId:'',seconds:1},new AbortController().signal);throw new Error('Denied ignored');}
    catch(error){if(error.name!=='NotAllowedError')throw error;}
    finally{navigator.mediaDevices.getUserMedia=original;}
    return {...adapters.resources};
  })()`);
  assert.deepEqual(Object.values(permission), [0, 0, 0, 0]);
  await evaluate(`(async()=>{
    const {wav}=await import('/src/features/voice/audio/noiseLabMetrics.ts');
    const transfer=new DataTransfer();
    transfer.items.add(new File([wav(fixture.pcm)], 'identical-fixture.wav', {type:'audio/wav'}));
    const input=document.querySelector('input[type=file]');
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  for (let i = 0; i < 50; i++) {
    if (await evaluate(`document.querySelector('ul')?.textContent.includes('identical-fixture')`))
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Сравнить все на файлах').click()`,
  );
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`document.querySelectorAll('article').length===8`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate(`document.querySelectorAll('article').length`), 8);
  assert.equal(await evaluate(`document.querySelectorAll('audio').length`), 8);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Выбранный режим').click()`,
  );
  for (let i = 0; i < 80; i++) {
    if (await evaluate(`document.querySelectorAll('article').length===9`)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await evaluate(`document.querySelectorAll('article').length`),
    9,
    'retain previous comparisons',
  );
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    session,
  );
  const layout = await evaluate(
    '({width:innerWidth, scrollWidth:document.documentElement.scrollWidth, mainWidth:document.querySelector("main").clientWidth, mainScrollWidth:document.querySelector("main").scrollWidth, mainScroll:document.querySelector("main").scrollHeight, mainHeight:document.querySelector("main").clientHeight})',
  );
  assert.ok(layout.scrollWidth <= layout.width + 1, 'no mobile horizontal overflow');
  assert.ok(layout.mainScrollWidth <= layout.mainWidth + 1, 'lab content fits mobile viewport');
  assert.ok(layout.mainScroll > layout.mainHeight, 'page scroll is available');
  const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
  await writeFile(path.join(scratch, 'lab-mobile.png'), Buffer.from(shot.data, 'base64'));
  await writeFile(
    path.join(scratch, 'report.json'),
    JSON.stringify(
      {
        ...report,
        version: await send('Browser.getVersion'),
        fixturePath,
        cancellation,
        failure,
        permission,
        cpuMethod:
          'Sum of CPU seconds for surviving processes of this isolated Chrome / wall time; percent of one core, includes setup, recording and analysis, not DSP-only; no baseline subtraction',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ report: path.join(scratch, 'report.json') }));
  console.log(
    JSON.stringify({
      status: 'passed',
      screenshot: path.join(scratch, 'lab-mobile.png'),
      cancellation,
      layout,
    }),
  );
} finally {
  await send('Browser.close').catch(() => undefined);
  ws.close();
  browser.kill();
}

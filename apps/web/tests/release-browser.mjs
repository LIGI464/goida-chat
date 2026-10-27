/* global process, console, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const origin = process.env.RELEASE_WEB_ORIGIN ?? 'http://localhost:5173';
const scratch = await mkdtemp(join(tmpdir(), 'goida-release-browser-'));
const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
const browser = spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen', '--allow-http-screen-capture',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${scratch}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let ws; let sequence = 0;
const pending = new Map(); const errors = []; const pages = [];
const manifest = { suffix, users: [], chats: [], checks: [], limitations: ['Synthetic microphone/camera. Physical speech, keyboard, hardware and native display picker require a human.'] };
const pass = (name) => { manifest.checks.push(name); console.log(`PASS ${name}`); };
async function send(method, params = {}, sessionId) {
  return new Promise((resolveResult, reject) => {
    const id = ++sequence; pending.set(id, { resolve: resolveResult, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(page, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function wait(page, expression, label, ms = 20000) {
  const until = Date.now() + ms;
  do { if (await evaluate(page, expression)) return; await new Promise((done) => setTimeout(done, 200)); } while (Date.now() < until);
  throw new Error(`Timed out: ${label}`);
}
async function click(page, text) {
  await evaluate(page, `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b)throw new Error('Button not found');b.click(); })()`);
}
async function input(page, selector, value) {
  await evaluate(page, `(() => { const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Input missing'); const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function navigate(page, path) {
  await send('Page.navigate', { url: `${origin}${path}` }, page);
  await wait(page, 'document.querySelector("#root")?.textContent.length>20', 'page renders');
}
async function api(page, method, path, body) {
  return evaluate(page, `(async()=>{const {apiUrl}=await import('/src/lib/api.ts');const r=await fetch(apiUrl+${JSON.stringify(path)},{method:${JSON.stringify(method)},credentials:'include',headers:{'Content-Type':'application/json'},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}});if(!r.ok)throw new Error('API returned '+r.status);return r.json()})()`);
}
async function page() {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  pages.push(sessionId);
  await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  return sessionId;
}
async function register(page, label) {
  await navigate(page, '/register');
  await wait(page, '!!document.querySelector("input[placeholder=Ник]")', 'registration form');
  const username = `qa_${label}_${suffix}`;
  await input(page, 'input[type=email]', `${username}@example.test`);
  await input(page, 'input[placeholder="Ник"]', username);
  await input(page, 'input[placeholder="Пароль"]', `Release!${suffix}Password`);
  await input(page, 'input[placeholder="Повтори пароль"]', `Release!${suffix}Password`);
  await click(page, 'Зарегистрироваться');
  await wait(page, 'location.pathname==="/app" && !!document.querySelector("aside")', 'registration enters app');
  const principal = await api(page, 'GET', '/auth/me');
  manifest.users.push({ id: principal.user.id, username });
}
async function hookRoom(page) {
  await evaluate(page, `(async()=>{const {Room}=await import('/tests/release-network-fixture.ts');if(Room.prototype.__qaHook)return;Room.prototype.__qaHook=true;const original=Room.prototype.on;Room.prototype.on=function(...args){if(this.localParticipant)globalThis.__qaRoom=this;return original.apply(this,args)};})()`);
}
try {
  const endpoint = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timeout')), 20000);
    browser.once('error', reject);
    browser.stderr.on('data', (chunk) => { const match=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);done(match[1]);} });
  });
  ws = new WebSocket(endpoint); await new Promise((done) => ws.addEventListener('open', done, { once: true }));
  ws.addEventListener('message', ({ data }) => {
    const message=JSON.parse(String(data)); const item=pending.get(message.id);
    if(item){pending.delete(message.id);if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const a = await page(), b = await page(), g = await page();
  await register(a, 'owner'); await register(b, 'peer');
  pass('browser registration and cookie-backed sessions');
  await input(a, 'input[aria-label="Название групповой комнаты"]', `Release browser ${suffix}`);
  await evaluate(a, `document.querySelector('button[aria-label="Создать групповую комнату"]').click()`);
  await wait(a, `document.body.textContent.includes(${JSON.stringify(`Release browser ${suffix}`)})`, 'group creation completes');
  const chat = (await api(a, 'GET', '/chats')).chats.find((chat) => chat.title === `Release browser ${suffix}`);
  assert.ok(chat); manifest.chats.push(chat.id);
  const invite = await api(a, 'POST', `/chats/${chat.id}/invites`, { maxUses: 5 });
  await navigate(b, `/invite/${invite.token}`);
  await wait(b, `location.pathname==="/app" && !!document.querySelector('input[placeholder="Написать сообщение..."]')`, 'invite auto-joins');
  await navigate(g, `/invite/${invite.token}`);
  await wait(g, 'document.body.textContent.includes("Продолжить как гость")', 'guest entry choice');
  await click(g, 'Продолжить как гость');
  await wait(g, `location.pathname==="/app" && !!document.querySelector('input[placeholder="Написать сообщение..."]')`, 'guest enters invited room');
  pass('group composer and invite-to-member/guest browser flows');
  await new Promise((done) => setTimeout(done, 2500));
  await input(a, 'input[placeholder="Написать сообщение..."]', `Browser realtime ${suffix}`);
  await evaluate(a, `document.querySelector('input[placeholder="Написать сообщение..."]').closest('form').requestSubmit()`);
  await wait(b, `document.body.textContent.includes(${JSON.stringify(`Browser realtime ${suffix}`)})`, 'remote realtime message');
  await wait(g, `document.body.textContent.includes(${JSON.stringify(`Browser realtime ${suffix}`)})`, 'guest receives realtime');
  pass('composer sends and two other clients receive realtime');
  await evaluate(a, `document.querySelector('button[aria-label="Свернуть панель навигации"]').click()`);
  await wait(a, `!!document.querySelector('aside[aria-label="Свернутая панель навигации"]')`, 'rail collapse');
  await navigate(a, `/app?chat=${chat.id}`);
  await wait(a, `!!document.querySelector('aside[aria-label="Свернутая панель навигации"]')`, 'rail persisted');
  await evaluate(a, `document.querySelector('button[aria-label="Развернуть панель навигации"]').click()`);
  await hookRoom(a); await hookRoom(b);
  await wait(a, 'document.body.textContent.includes("Голосовой канал")', 'voice panel owner');
  await click(a, 'Войти в звонок');
  await wait(b, 'document.body.textContent.includes("Голосовой канал")', 'voice panel peer');
  await wait(b, '[...document.querySelectorAll("button")].some((button)=>["Войти в звонок","Перейти в звонок"].includes(button.textContent.trim()))', 'voice join button peer');
  await evaluate(b, `(() => { const button=[...document.querySelectorAll('button')].find((item)=>['Войти в звонок','Перейти в звонок'].includes(item.textContent.trim())); if(!button) throw new Error('Voice join button not found'); button.click(); })()`);
  try {
    for (const p of [a,b]) await wait(p, 'globalThis.__qaRoom?.state==="connected" && __qaRoom.remoteParticipants.size===1', 'two real LiveKit clients', 45000);
  } catch (caught) {
    const diagnostics = await Promise.all([a, b].map(async (p) => evaluate(p, '({state:globalThis.__qaRoom?.state ?? null, connection:globalThis.__qaRoomState ?? null, disconnect:globalThis.__qaDisconnectReason ?? null, media:globalThis.__qaMediaError ?? null, voiceError:[...document.querySelectorAll("*")].map((node)=>node.textContent).find((text)=>text?.includes("ошиб")) ?? null, buttons:[...document.querySelectorAll("button")].map((button)=>button.textContent.trim()).filter(Boolean), resources:performance.getEntriesByType("resource").map((entry)=>entry.name).filter((name)=>name.includes("livekit")), tail:document.body.innerText.slice(-1200)})')));
    console.error(`LiveKit diagnostics: ${JSON.stringify(diagnostics)}`);
    throw caught;
  }
  await wait(b, '[...__qaRoom.remoteParticipants.values()].some(p=>[...p.audioTrackPublications.values()].some(t=>t.isSubscribed && t.track))', 'remote audio subscription');
  await new Promise((done) => setTimeout(done, 2500));
  const stats = await evaluate(b, `(async()=>{const t=[...__qaRoom.remoteParticipants.values()][0].audioTrackPublications.values().next().value.track;const report=await t.getRTCStatsReport();return [...report.values()].filter(s=>s.type==='inbound-rtp').map(s=>({bytes:s.bytesReceived,packets:s.packetsReceived}))})()`);
  assert.ok(stats.some((s) => s.bytes > 0 && s.packets > 0));
  pass('real LiveKit signalling, ICE and RTP between two Chromium clients with synthetic microphones');
  await new Promise((done) => setTimeout(done, 2000));
  await click(a, 'Микрофон вкл'); await wait(a, '!__qaRoom.localParticipant.isMicrophoneEnabled', 'mute');
  await click(a, 'Микрофон выкл'); await wait(a, '__qaRoom.localParticipant.isMicrophoneEnabled', 'unmute');
  await wait(a, '[...document.querySelectorAll("button")].some((button)=>["Камера вкл","Камера выкл"].includes(button.textContent.trim()))', 'camera toggle');
  await evaluate(a, `(() => { const button=[...document.querySelectorAll('button')].find((item)=>['Камера вкл','Камера выкл'].includes(item.textContent.trim())); if(!button) throw new Error('Camera toggle not found'); button.click(); })()`);
  let syntheticCamera = false;
  try { await wait(a, '__qaRoom.localParticipant.isCameraEnabled', 'camera', 12000); }
  catch {
    syntheticCamera = true;
    manifest.limitations.push('The headless fake camera was automatically muted after publication. Camera source transport used a canvas; native camera capture/UI remains unverified.');
    await evaluate(a, `(async()=>{const {Track,LocalVideoTrack}=await import('/tests/release-network-fixture.ts');const existing=__qaRoom.localParticipant.getTrackPublication(Track.Source.Camera)?.track;if(existing)await __qaRoom.localParticipant.unpublishTrack(existing,true);const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.getContext('2d').fillStyle='#234';canvas.getContext('2d').fillRect(0,0,1280,720);globalThis.__qaCamera=new LocalVideoTrack(canvas.captureStream(30).getVideoTracks()[0]);await __qaRoom.localParticipant.publishTrack(__qaCamera,{source:Track.Source.Camera});})()`);
    await wait(a, '__qaRoom.localParticipant.isCameraEnabled', 'synthetic camera');
  }
  await wait(b, '[...__qaRoom.remoteParticipants.values()].some(p=>p.isCameraEnabled)', 'remote camera');
  pass(`mute/unmute and ${syntheticCamera ? 'synthetic ' : ''}camera publication over the real network`);
  await evaluate(a, `(async()=>{const {Track,LocalVideoTrack}=await import('/tests/release-network-fixture.ts');const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.getContext('2d').fillRect(0,0,1920,1080);globalThis.__qaScreen=new LocalVideoTrack(canvas.captureStream(30).getVideoTracks()[0]);await __qaRoom.localParticipant.publishTrack(__qaScreen,{source:Track.Source.ScreenShare});})()`);
  await wait(b, 'document.body.textContent.includes("Демонстрация экрана")', 'separate remote screen tile');
  assert.equal(await evaluate(a, '__qaRoom.localParticipant.isCameraEnabled && __qaRoom.localParticipant.isMicrophoneEnabled'), true);
  await evaluate(b, `document.querySelector('button[aria-label="Открыть на весь экран"]').click()`);
  await wait(b, '!!document.fullscreenElement', 'fullscreen entered');
  await evaluate(b, 'document.exitFullscreen()');
  await wait(b, '!document.fullscreenElement', 'fullscreen exited');
  await evaluate(a, '__qaRoom.localParticipant.unpublishTrack(__qaScreen,true)');
  await wait(b, '!document.body.textContent.includes("Демонстрация экрана")', 'screen removed');
  assert.equal(await evaluate(a, '__qaRoom.localParticipant.isCameraEnabled && __qaRoom.localParticipant.isMicrophoneEnabled'), true);
  pass('separate camera/synthetic-screen sources, remote tile, fullscreen and independent screen stop');
  await click(a, 'Звук вкл');
  await wait(a, 'document.querySelectorAll("audio").length===0 && __qaRoom.state==="connected"', 'deafen removes playback without disconnect');
  await click(a, 'Звук выкл');
  await wait(a, 'document.querySelectorAll("audio").length>0', 'undeafen restores playback');
  const other = await api(a, 'POST', '/chats/group', { title: `Other browser ${suffix}`, memberUsernames: [] });
  manifest.chats.push(other.chat.id);
  await wait(a, `document.body.textContent.includes(${JSON.stringify(`Other browser ${suffix}`)})`, 'second chat in sidebar');
  await evaluate(a, `(() => {const button=[...document.querySelectorAll('aside button')].find((item)=>item.textContent.includes(${JSON.stringify(`Other browser ${suffix}`)}));if(!button)throw new Error('Second chat missing');button.click()})()`);
  await wait(a, '__qaRoom.state==="connected" && __qaRoom.remoteParticipants.size===1', 'call survives chat switch');
  await evaluate(a, `(() => {const button=[...document.querySelectorAll('aside button')].find((item)=>item.textContent.includes(${JSON.stringify(`Release browser ${suffix}`)}));if(!button)throw new Error('Original chat missing');button.click()})()`);
  await send('Network.enable', {}, a);
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, a);
  await new Promise((done) => setTimeout(done, 3500));
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, a);
  await wait(a, '__qaRoom.state==="connected" && __qaRoom.remoteParticipants.size===1', 'call recovers after temporary offline', 45000);
  pass('deafen, chat switch during call and recovery after temporary offline');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, a);
  assert.equal(await evaluate(a, 'document.documentElement.scrollWidth<=390'), true);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, a);
  await writeFile(join(scratch, 'mobile-call.png'), Buffer.from(shot.data, 'base64'));
  await wait(a, `!!document.querySelector('button[aria-label="Выйти из звонка"]')`, 'call leave control after chat switch');
  await evaluate(a, `document.querySelector('button[aria-label="Выйти из звонка"]').click()`);
  await wait(b, '__qaRoom.state==="connected" && __qaRoom.remoteParticipants.size===0', 'one client leaves, peer stays');
  pass('mobile chat/call containment and one participant leaving preserves the other call');
  await evaluate(b, `document.querySelector('button[aria-label="Выйти из звонка"]').click()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, a);
  await navigate(g, `/app?chat=${chat.id}`);
  await wait(g, 'document.body.textContent.includes("Гостевой доступ")', 'guest reload persists');
  assert.deepEqual((await api(g, 'GET', '/chats')).chats.map((chat) => chat.id), [chat.id]);
  assert.equal(errors.length, 0, 'uncaught browser exceptions');
  pass('guest reload remains scoped; no uncaught browser exceptions');
  manifest.screenshot = join(scratch, 'mobile-call.png');
  console.log(`Browser report: ${join(scratch, 'report.json')}`);
} finally {
  await writeFile(join(scratch, 'report.json'), JSON.stringify(manifest, null, 2));
  if(ws?.readyState===1) { await send('Browser.close').catch(()=>undefined); ws.close(); }
  browser.kill();
}

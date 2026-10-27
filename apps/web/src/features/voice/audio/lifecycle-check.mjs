// Run from the repository root: node apps/web/src/features/voice/audio/lifecycle-check.mjs
/* global WebSocket, setTimeout, clearTimeout */
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import console from 'node:console';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executable = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
].find((path) => path && existsSync(path));
if (!executable)
  throw new Error('Set CHROME_PATH to a Chrome/Edge executable for this browser check.');

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    fs: { allow: [root, fileURLToPath(new URL('../../../', import.meta.resolve('vite')))] },
  },
});
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), 'goida-audio-lifecycle-'));
const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `${origin}/`,
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let socket;
try {
  const debuggerUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 30_000);
    let output = '';
    browser.stderr.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    browser.once('error', reject);
    browser.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited: ${code}`));
    });
  });
  socket = new WebSocket(debuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolveResult, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve: resolveResult, reject });
      socket.send(
        JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
    });
  }
  const { targetId } = await send('Target.createTarget', { url: `${origin}/` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send(
    'Page.navigate',
    { url: `${origin}/src/features/voice/audio/lifecycle.browser-check.ts` },
    sessionId,
  );
  console.log(
    'Running real Chromium / LiveKit / RNNoise lifecycle checks (100 cycles per scenario)...',
  );
  const result = await send(
    'Runtime.evaluate',
    {
      expression: `import(${JSON.stringify(`${origin}/src/features/voice/audio/lifecycle.browser-check.ts`)}).then(m => m.runLifecycleChecks())`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails),
    );
  console.log(JSON.stringify(result.result.value, null, 2));
  await send('Browser.close');
} finally {
  socket?.close();
  browser.kill();
  await server.close();
}

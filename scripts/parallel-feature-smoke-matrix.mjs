#!/usr/bin/env node
/* global console, process */

/**
 * QA smoke-matrix catalog for the parallel feature release.
 *
 * The command is intentionally dependency-free so it can be run before the
 * web stack is deployed. It validates that every requested manual scenario
 * has the fields needed to record reproducible evidence, and can print a
 * compact run sheet for a QA session.
 */

const scenarios = [
  {
    id: 'VOICE-01',
    title: 'Two browsers in one voice room',
    browser: 'Chrome + Firefox (latest stable)',
    steps:
      'Sign in as two users; open the same chat and join its voice room in each browser; speak in both directions; leave user A.',
    expected:
      'Both users hear each other; presence lists both users; removing A does not disconnect B.',
  },
  {
    id: 'VOICE-02',
    title: 'Several tabs for one user',
    browser: 'Chrome (latest stable), 3 tabs',
    steps:
      'Sign in once; open the same chat in three tabs; join and leave the voice room in different tabs; close one tab.',
    expected:
      'Presence is deduplicated by user; one tab leaving does not remove the user while another tab remains connected; final close removes presence.',
  },
  {
    id: 'VOICE-03',
    title: 'Camera and screen share at the same time',
    browser: 'Chrome (latest stable)',
    steps:
      'Join a room; enable camera; start screen share; have a second participant observe; stop each track separately.',
    expected:
      'Camera tile and screen-share tile are both visible and usable; stopping one track leaves the other active; remote participant receives both.',
  },
  {
    id: 'VOICE-04',
    title: 'Cancel the screen-share picker',
    browser: 'Chrome + Firefox (latest stable)',
    steps:
      'Join a room; select Share screen; dismiss the native picker with Cancel/Escape; repeat twice.',
    expected:
      'No screen-share track is published; camera/microphone and room connection remain unchanged; no uncaught error is shown.',
  },
  {
    id: 'VOICE-05',
    title: 'Fullscreen screen share',
    browser: 'Chrome + Firefox (latest stable)',
    steps:
      'Receive a screen share; choose the fullscreen control; verify orientation and controls; exit fullscreen with the control and Escape.',
    expected:
      'The shared content fills the viewport without distortion; fullscreen state and accessible label update; exiting returns to the room layout.',
  },
  {
    id: 'AUDIO-01',
    title: '50–100 noise-suppression start/stop cycles',
    browser: 'Chrome (latest stable, desktop)',
    steps:
      'In one room, toggle noise suppression on/off for 50 cycles (extend to 100 for soak); speak before, during, and after the loop; watch console and CPU/memory.',
    expected:
      'Each cycle creates one healthy capture path; audio remains intelligible; no leaked worklets/tracks, escalating CPU, reconnect, or UI freeze.',
  },
  {
    id: 'AUDIO-02',
    title: 'Raw, browser, RNNoise, and Speex modes',
    browser: 'Chrome and Firefox (latest stable)',
    steps:
      'Run a short voice call in each mode (raw, browser, RNNoise, Speex); reload between modes; record permission prompts, latency, and fallback behavior.',
    expected:
      'Selected mode is reflected in settings; audio works or presents a clear unsupported/fallback notice; switching modes does not duplicate tracks or disconnect the room.',
  },
  {
    id: 'INVITE-01',
    title: 'Invite create, join, revoke, and expire',
    browser: 'Chrome (owner) + Firefox (invite user)',
    steps:
      'Create a group-chat invite; join with a second account twice; revoke it using the owner flow; try the old token with a fresh non-member; create a separate short-TTL invite, wait beyond its server expiry, then try with another non-member.',
    expected:
      'Create returns a usable link; join adds membership once; revoked or expired tokens cannot join and show a safe not-found/expired message.',
  },
  {
    id: 'INVITE-02',
    title: 'Guest entry by invite',
    browser: 'Chrome (incognito, signed out)',
    steps:
      'Open a valid invite in a clean private window; choose guest entry without registering; send a message and join voice; reload; attempt access to an unrelated chat; log out. In fresh private sessions try revoked and expired invites.',
    expected:
      'A guest session opens the invited chat without a permanent account, survives reload, and permits chat/voice only within its authorized scope. Logout invalidates the session; revoked and expired invites cannot create a new guest session.',
  },
  {
    id: 'FILE-01',
    title: 'Attachment exactly 100 MiB',
    browser: 'Chrome (latest stable)',
    steps:
      'Select a deterministic file whose byte size is exactly 104,857,600; upload/send it; reload and download it from the message.',
    expected:
      'Upload is accepted at the inclusive limit; progress completes; downloaded bytes and name match; no truncation or duplicate message occurs.',
  },
  {
    id: 'FILE-02',
    title: 'Attachment larger than 100 MiB',
    browser: 'Chrome (latest stable)',
    steps:
      'Select a deterministic file of 104,857,601 bytes or larger; attempt upload/send; repeat after a page reload.',
    expected:
      'Client and server reject the file with a clear size-limit message; no partial object/message remains and the chat stays usable.',
  },
  {
    id: 'FILE-03',
    title: 'Expired attachment',
    browser: 'Chrome (latest stable)',
    steps:
      'Send an attachment; use a test clock or fixture to move past its expiry; refresh the message and request download/preview.',
    expected:
      'Expired content is unavailable with a clear message; non-expired messages remain readable; no stale signed URL is served.',
  },
  {
    id: 'LAYOUT-01',
    title: 'Mobile sidebar',
    browser: 'Chrome DevTools mobile emulation (390×844) and Safari iOS',
    steps:
      'Open the app at mobile width; open/close the sidebar, search, create-chat controls, and an active voice panel; rotate once if available.',
    expected:
      'Sidebar overlays without horizontal scroll; controls remain reachable and keyboard accessible; closing returns focus to the main content.',
  },
  {
    id: 'NETWORK-01',
    title: 'Offline and online transitions',
    browser: 'Chrome (latest stable)',
    steps:
      'Join a chat/voice room; toggle network offline for 15 seconds; attempt a message and media action; restore network and wait for reconnect.',
    expected:
      'Offline state is visible; failed actions explain the failure and do not duplicate; socket/API reconnects online and fresh messages/presence converge.',
  },
].map((scenario) => ({
  ...scenario,
  status: 'NOT_RUN',
  actual: 'Не запускался',
  bugs: '—',
  severity: '—',
}));

const requiredFields = [
  'id',
  'title',
  'browser',
  'steps',
  'expected',
  'status',
  'actual',
  'bugs',
  'severity',
];

function validateCatalog() {
  const ids = new Set();
  const errors = [];
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    for (const field of requiredFields) {
      if (typeof scenario[field] !== 'string' || scenario[field].trim() === '') {
        errors.push(`${scenario.id}: missing ${field}`);
      }
    }
  }
  return errors;
}

function markdown() {
  const header =
    '| ID | Сценарий | Шаги | Ожидаемый результат | Фактический результат | Браузер | Найденные ошибки | Severity |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = scenarios.map((scenario) => {
    const cell = (value) => value.replaceAll('|', '\\|').replaceAll('\n', '<br>');
    return `| ${scenario.id} | ${cell(scenario.title)} | ${cell(scenario.steps)} | ${cell(scenario.expected)} | ${cell(scenario.actual)} | ${cell(scenario.browser)} | ${cell(scenario.bugs)} | ${cell(scenario.severity)} |`;
  });
  return [
    '# Parallel feature smoke matrix',
    '',
    'Сгенерировано из `scripts/parallel-feature-smoke-matrix.mjs`. Заполните поля «Фактический результат», «Найденные ошибки» и «Severity» после ручного прогона.',
    '',
    header,
    ...rows,
    '',
  ].join('\n');
}

const errors = validateCatalog();
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  const args = new Set(process.argv.slice(2));
  if (args.has('--json')) {
    console.log(JSON.stringify(scenarios, null, 2));
  } else if (args.has('--markdown')) {
    console.log(markdown());
  } else {
    console.log(`Parallel feature smoke matrix: ${scenarios.length} scenarios`);
    for (const scenario of scenarios) console.log(`${scenario.id}\t${scenario.title}`);
    console.log('Catalog validation: passed');
    console.log('Use --markdown for a fillable run sheet or --json for automation tooling.');
  }
}

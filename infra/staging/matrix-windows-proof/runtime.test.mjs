import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from './runtime.mjs';
const { runHarness } = runtime;
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const inventory = ids => ({ stdout: JSON.stringify({ WindowsSandboxEnvironments: ids.map(Id => ({ Id })) }) });
function guest() {
  return { schema: 'g1-install-v1', runId: ID, status: 'PASS', stage: 'QUIT',
    environment: 'Windows Sandbox', architecture: 'x64', developmentToolsAbsent: true,
    installerSha256: runtime.FIXED?.sha256, configSha256: runtime.configHash?.(),
    installExitCode: 0, productVersion: '1.12.30.0', displayVersion: '1.12.30',
    finalProductVersion: '1.12.30', finalDisplayVersion: '1.12.30',
    defaultProfileSeeded: true, controlledProfileSeeded: true, earlyProcessesGone: true,
    controlledLaunch: true, welcomeObserved: true, ownedWindow: true, screenshot: 'welcome.png',
    screenshotSha256: 'a'.repeat(64), controls: ['Welcome to Element', 'Sign in', 'Create account'],
    quitAction: 'File/Quit', mainExitCode: 0, ownedProcessesGone: true,
    stages: { ENVIRONMENT: 'PASS', INSTALL: 'PASS', WELCOME: 'PASS', QUIT: 'PASS' } };
}
function fixture(overrides = {}) {
  const calls = [];
  let clock = 0;
  let lists = 0;
  let final;
  const deps = {
    now: () => clock, uuid: () => ID,
    acquire: async () => { calls.push('acquire'); return { release: async () => { calls.push('release'); } }; },
    verify: async () => { calls.push('verify'); return { sha256: runtime.FIXED?.sha256 }; },
    inspectHost: async () => { calls.push('host'); },
    prepare: async () => { calls.push('prepare'); return { outputDirectory: 'fixture', configuration: '<Configuration/>', input: {} }; },
    inputsUnchanged: async () => { calls.push('inputs'); },
    execute: async (args, options) => {
      calls.push(args.join(' '));
      assert.ok(options.timeout > 0 && options.timeout <= 15000);
      if (args[0] === 'list') return inventory(++lists === 1 ? [FOREIGN] : lists === 2 ? [FOREIGN, ID] : [FOREIGN]);
      if (args[0] === 'start') return { stdout: JSON.stringify({ Id: ID }) };
      if (args[0] === 'exec') return { stdout: JSON.stringify({ ExitCode: 0 }) };
      return { stdout: '' };
    },
    connect: async () => { calls.push('connect'); return { check() {}, close: async () => { calls.push('disconnect'); } }; },
    readGuest: async () => guest(),
    wait: async ms => { clock += ms; },
    writeFinal: async (_prepared, result) => { calls.push('final'); final = structuredClone(result); },
    ...overrides,
  };
  return { deps, calls, advance: ms => { clock += ms; }, final: () => final };
}

test('occupied shared admission fails immediately without verification or CLI', async () => {
  const calls = [];
  const result = await runHarness('run', {
    acquire: async () => { throw Object.assign(new Error('BUSY'), { category: 'BUSY' }); },
    verify: async () => { calls.push('verify'); },
    execute: async () => { calls.push('cli'); },
  });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.stage, 'ADMISSION');
  assert.equal(result.category, 'BUSY');
  assert.equal(result.cleanup.status, 'NOT_OWNED');
  assert.deepEqual(calls, []);
});

test('successful ownership, real guest evidence, cleanup, release then final evidence', async () => {
  const f = fixture();
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'PASS');
  assert.equal(result.cleanup.status, 'PASS');
  assert.equal(result.admissionCleanup.status, 'PASS');
  assert.ok(f.calls.indexOf('acquire') < f.calls.indexOf('verify'));
  assert.ok(f.calls.indexOf('verify') < f.calls.indexOf('prepare'));
  assert.ok(f.calls.indexOf('release') < f.calls.indexOf('final'));
  assert.ok(f.calls.some(x => x === `stop --id ${ID} --raw`));
  assert.ok(!f.calls.some(x => x.includes(`--id ${FOREIGN}`)));
  assert.equal(f.final().status, 'PASS');
});

test('preflight remains read only and releases admission', async () => {
  const f = fixture();
  assert.equal((await runHarness('preflight', f.deps)).status, 'PASS');
  assert.deepEqual(f.calls, ['acquire', 'verify', 'host', 'release']);
});

for (const fault of ['throw-after-create', 'malformed', 'wrong-id', 'confirmation-error', 'confirmation-timeout', 'confirmation-cancel', 'confirmation-missing']) {
  test(`unconfirmed creation ${fault} is UNKNOWN with zero subsequent VM operations`, async () => {
    const f = fixture();
    const original = f.deps.execute;
    let created = false;
    const controller = new AbortController();
    f.deps.signal = controller.signal;
    f.deps.execute = async (args, options) => {
      if (args[0] === 'start') {
        created = true;
        if (fault === 'throw-after-create') throw Object.assign(new Error('created but CLI failed token=secret'), { code: 42 });
        if (fault === 'malformed') return { stdout: '{bad' };
        if (fault === 'wrong-id') return { stdout: JSON.stringify({ Id: FOREIGN }) };
      }
      if (args[0] === 'list' && created) {
        if (fault === 'confirmation-error') throw Object.assign(new Error('query failed'), { code: 17 });
        if (fault === 'confirmation-timeout') f.advance(15001);
        if (fault === 'confirmation-cancel') controller.abort();
        if (fault === 'confirmation-missing') return inventory([FOREIGN]);
      }
      return original(args, options);
    };
    const result = await runHarness('run', f.deps);
    assert.equal(created, true);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.cleanup.status, 'UNKNOWN');
    assert.ok(!f.calls.some(x => /^(connect|exec|stop)/.test(x)));
    if (fault === 'throw-after-create') {
      assert.equal(result.exitCode, 42);
      assert.ok(!JSON.stringify(result).includes('token=secret'));
    }
  });
}

test('baseline collision prevents start and leaves VM NOT_OWNED', async () => {
  const f = fixture({ execute: async args => { assert.equal(args[0], 'list'); return inventory([ID]); } });
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.cleanup.status, 'NOT_OWNED');
});

for (const change of [
  { productVersion: '1.12.31' }, { displayVersion: '1.12.29' }, { finalProductVersion: '1.12.31' },
  { welcomeObserved: false }, { controls: [] }, { screenshotSha256: null }, { mainExitCode: null },
  { mainExitCode: 1 }, { quitAction: 'CloseMainWindow' }, { ownedProcessesGone: false },
  { earlyProcessesGone: false }, { configSha256: 'b'.repeat(64) }, { runId: FOREIGN },
]) {
  test(`guest rejection ${JSON.stringify(change)} still stops only owned VM`, async () => {
    const f = fixture({ readGuest: async () => ({ ...guest(), ...change }) });
    const result = await runHarness('run', f.deps);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.cleanup.status, 'PASS');
    assert.ok(f.calls.includes(`stop --id ${ID} --raw`));
  });
}

test('guest stage failure retains completed stages and sanitized original error', async () => {
  const f = fixture({ readGuest: async () => ({ ...guest(), status: 'FAIL', stage: 'WELCOME', category: 'UIA_UNSUPPORTED',
    error: 'password=hidden', stages: { ENVIRONMENT: 'PASS', INSTALL: 'PASS', WELCOME: 'FAIL', QUIT: 'NOT_RUN' } }) });
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.guest.stages.INSTALL, 'PASS');
  assert.equal(result.guest.category, 'UIA_UNSUPPORTED');
  assert.ok(!JSON.stringify(result).includes('hidden'));
});

for (const stage of ['VERIFY', 'HOST', 'PREPARE', 'CONNECT', 'EXEC', 'GUEST', 'INPUTS']) {
  test(`${stage} obeys cancellation and reserved absolute deadline`, async () => {
    const key = { VERIFY: 'verify', HOST: 'inspectHost', PREPARE: 'prepare', CONNECT: 'connect', EXEC: 'execute', GUEST: 'readGuest', INPUTS: 'inputsUnchanged' }[stage];
    const f = fixture();
    const original = f.deps[key];
    let inputChecks = 0;
    f.deps[key] = async (...args) => {
      if (stage === 'INPUTS') { if (++inputChecks === 3) f.advance(330001); }
      else if (stage !== 'EXEC' || args[0][0] === 'exec') f.advance(330001);
      return original(...args);
    };
    const result = await runHarness('run', f.deps);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.category, 'TIMEOUT');
    if (['CONNECT', 'EXEC', 'GUEST', 'INPUTS'].includes(stage)) assert.ok(f.calls.includes(`stop --id ${ID} --raw`));
  });
}

test('missing guest result times out without resetting deadline', async () => {
  const f = fixture({ readGuest: async () => null });
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.category, 'TIMEOUT');
  assert.equal(result.cleanup.status, 'PASS');
});

for (const [phase, cap] of Object.entries({ ENVIRONMENT: 15000, INSTALL: 120000, WELCOME: 60000, QUIT: 15000 })) {
  test(`guest ${phase} stage enforces ${cap} ms cap and keeps completed evidence`, async () => {
    const f = fixture();
    f.deps.readGuest = async () => {
      f.advance(1000);
      return { status: 'PENDING', phase, elapsedMs: 0, stages: { ENVIRONMENT: 'PASS', [phase]: 'RUNNING' } };
    };
    const result = await runHarness('run', f.deps);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.category, 'TIMEOUT');
    assert.equal(result.guestProgress.phase, phase);
    assert.equal(result.cleanup.status, 'PASS');
  });
}

test('late successful operation still respects total deadline and releases admission', async () => {
  const f = fixture();
  let released = false;
  f.deps.acquire = async () => ({ release: async () => { released = true; } });
  f.deps.verify = async () => { f.advance(360001); return {}; };
  const result = await runHarness('preflight', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(released, true);
});

test('aborted pending PREPARE drains and closes registered handles before release or return', async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const prepared = { outputDirectory: 'fixture', outputExists: true, sealed: [{ handle: { close: async () => f.calls.push('handle-close') } }] };
  f.deps.prepare = async (_id, options) => {
    f.calls.push('prepare-start');
    options.registerPrepared?.(prepared);
    entered();
    await gate;
    options.check();
    f.calls.push('late-effect');
    return prepared;
  };
  let returned = false;
  const running = runHarness('run', f.deps).then(value => { returned = true; f.calls.push('returned'); return value; });
  await started;
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  const releasedWhilePending = f.calls.includes('release');
  const returnedWhilePending = returned;
  finish();
  const result = await running;
  assert.equal(releasedWhilePending, false);
  assert.equal(returnedWhilePending, false);
  assert.equal(result.category, 'CANCELLED');
  assert.ok(!f.calls.includes('late-effect'));
  assert.ok(f.calls.indexOf('handle-close') < f.calls.indexOf('release'));
  assert.ok(f.calls.indexOf('release') < f.calls.indexOf('returned'));
  assert.equal(f.final().status, 'FAIL');
});

test('pending CONNECT is registered and terminated before admission release', async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const connection = { check() {}, close: async () => { f.calls.push('connector-close'); } };
  f.deps.connect = async (_id, options) => {
    options.registerConnection?.(connection);
    entered();
    await gate;
    options.check();
    f.calls.push('late-connect');
    return connection;
  };
  const running = runHarness('run', f.deps);
  await started; controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  const releasedWhilePending = f.calls.includes('release');
  finish();
  const result = await running;
  assert.equal(releasedWhilePending, false);
  assert.equal(result.category, 'CANCELLED');
  assert.ok(!f.calls.includes('late-connect'));
  assert.ok(f.calls.indexOf('connector-close') >= 0 && f.calls.indexOf('connector-close') < f.calls.indexOf('release'));
});

test('undrainable preparation terminates a real process while holding admission, with no late effect', { timeout: 10000 }, async t => {
  const directory = await tinyFixture(t);
  const script = path.join(directory, 'terminal-fixture.mjs');
  const moduleUrl = new URL('./runtime.mjs', import.meta.url).href;
  await writeFile(script, `import { runHarness } from ${JSON.stringify(moduleUrl)};
import { writeFile } from 'node:fs/promises';
const controller=new AbortController(); let clock=0;
await runHarness('run',{
 now:()=>clock, signal:controller.signal,
 verify:async()=>({}),inspectHost:async()=>{},
 prepare:async(_id,options)=>{
  options.registerPrepared({outputDirectory:process.cwd(),outputExists:true,ready:false,sealed:[]});
  setTimeout(()=>{clock=359990;controller.abort();},0);
  await new Promise(resolve=>setTimeout(resolve,200));
  await writeFile('late-effect.txt','forbidden late effect');
  return {};
 },
 writeFinal:async(_prepared,result)=>{await writeFile('terminal-evidence.json',JSON.stringify(result),{flag:'wx'});process.stdout.write(JSON.stringify(result)+'\\n');}
});
await writeFile('returned.txt','forbidden normal return');
`);
  const item = childFixture(script, directory, 'terminal');
  t.after(async () => { if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill(); await item.ended; });
  const proof = await item.ready;
  assert.equal((await item.ended).code, 1);
  assert.equal(proof.status, 'FAIL'); assert.equal(proof.category, 'CANCELLED');
  assert.equal(proof.operationCleanup.status, 'FAIL');
  assert.equal(proof.admissionCleanup.category, 'HELD_UNTIL_PROCESS_EXIT');
  await assert.rejects(readFile(path.join(directory, 'late-effect.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(directory, 'returned.txt')), { code: 'ENOENT' });
  const lease = await runtime.acquireAdmission();
  await lease.release(); // OS released the endpoint on the child's nonzero exit.
});

for (const resource of ['handle', 'connector', 'admission']) {
  test(`exhausted total budget tracks pending ${resource} close and terminates without release/return`, { timeout: 10000 }, async t => {
    const directory = await tinyFixture(t);
    const script = path.join(directory, 'exhausted-close-fixture.mjs');
    const moduleUrl = new URL('./runtime.mjs', import.meta.url).href;
    await writeFile(script, `import { runHarness, acquireAdmission } from ${JSON.stringify(moduleUrl)};
import { appendFileSync } from 'node:fs';
const resource=process.argv[2]; let clock=0, lists=0, inputChecks=0;
const event=name=>appendFileSync('events.txt',name+'\\n');
const gated=async name=>{event(name+'-started');await new Promise(resolve=>setTimeout(resolve,200));event(name+'-completed');};
const original=()=>Object.assign(new Error('original failure'),{code:77});
const result=await runHarness(resource==='admission'?'preflight':'run',{
 now:()=>clock,uuid:()=>${JSON.stringify(ID)},
 acquire:async()=>{const lease=await acquireAdmission();return {release:async()=>{event('admission-release-started');if(resource==='admission')await gated('admission-close');await lease.release();event('admission-released');}};},
 verify:async()=>{if(resource==='admission'){clock=360001;throw original();}return {};},inspectHost:async()=>{},
 prepare:async()=>({outputDirectory:process.cwd(),ready:true,outputExists:true,configuration:'<Configuration/>',sealed:resource==='handle'?[{handle:{close:()=>gated('handle-close')}}]:[]}),
 inputsUnchanged:async()=>{if(resource==='handle'&&++inputChecks===3)clock=360001;},
 execute:async args=>({stdout:args[0]==='list'?JSON.stringify({WindowsSandboxEnvironments:(++lists===2?[{Id:${JSON.stringify(ID)}}]:[])}):args[0]==='start'?JSON.stringify({Id:${JSON.stringify(ID)}}):args[0]==='exec'?'{"ExitCode":0}':''}),
 connect:async()=>({check(){},close:async()=>{if(resource==='connector'){clock=360001;await gated('connector-close');}}}),
 readGuest:async()=>{throw original();},writeFinal:async()=>{}
});
event('harness-returned');process.stdout.write(JSON.stringify(result)+'\\n');
`);
    const child = spawn(process.execPath, [script, resource], { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes; });
    const ended = new Promise(resolve => child.once('exit', resolve));
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await ended; });
    assert.equal(await ended, 1, 'Pending cleanup must use terminal FAILURE, never normal return');
    const result = JSON.parse(stderr.trim());
    assert.equal(result.status, 'FAIL'); assert.equal(result.exitCode, 77);
    assert.equal(result.operationCleanup.status, 'FAIL');
    const events = (await readFile(path.join(directory, 'events.txt'), 'utf8')).trim().split('\n');
    assert.ok(events.includes(`${resource}-close-started`));
    assert.ok(!events.includes(`${resource}-close-completed`));
    assert.ok(!events.includes('harness-returned'));
    assert.ok(!events.includes('admission-released'));
    if (resource !== 'admission') assert.ok(!events.includes('admission-release-started'));
    const lease = await runtime.acquireAdmission(); await lease.release();
  });
}

test('guest JSON publication exposes no final pathname while bytes are still being written', { timeout: 10000 }, async t => {
  const directory = await tinyFixture(t);
  const source = await readFile(fileURLToPath(new URL('./guest.ps1', import.meta.url)), 'utf8');
  const start = source.indexOf('function Write-JsonNew(');
  const end = source.indexOf('\nfunction Check-Time', start);
  let writer = source.slice(start, end).replaceAll('C:\\G1Output', directory.replace(/'/g, "''"));
  assert.ok(writer.includes('$file.Write($bytes, 0, $bytes.Length)'));
  writer = writer.replace('$file.Write($bytes, 0, $bytes.Length)', `$half=[int]($bytes.Length/2); $file.Write($bytes,0,$half); Write-Output '{"status":"WRITING"}'; [void][Console]::ReadLine(); $file.Write($bytes,$half,$bytes.Length-$half)`);
  const code = `$ErrorActionPreference='Stop'; ${writer}\nWrite-JsonNew 'proof.json' @{message='complete';runId='${ID}'}`;
  const child = spawn(runtime.FIXED.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '', stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', bytes => { text += bytes; if (text.includes('WRITING')) resolve(); });
    child.once('error', reject);
    child.once('exit', exitCode => { if (!text.includes('WRITING')) reject(new Error(`PowerShell writer exit ${exitCode}: ${stderr}`)); });
  });
  const ended = new Promise(resolve => child.once('exit', code => resolve(code)));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await ended; });
  await ready;
  let premature;
  try { await readFile(path.join(directory, 'proof.json')); premature = true; }
  catch (error) { premature = error.code !== 'ENOENT'; }
  child.stdin.write('continue\n');
  assert.equal(await ended, 0, stderr);
  assert.equal(premature, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'proof.json'), 'utf8')), { message: 'complete', runId: ID });
  const originalWriter = source.slice(start, end).replaceAll('C:\\G1Output', directory.replace(/'/g, "''"));
  const duplicate = spawn(runtime.FIXED.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; ${originalWriter}\nWrite-JsonNew 'proof.json' @{message='replacement'}`], { cwd: directory, windowsHide: true, stdio: 'ignore' });
  const duplicateEnded = new Promise(resolve => duplicate.once('exit', resolve));
  t.after(async () => { if (duplicate.exitCode === null && duplicate.signalCode === null) duplicate.kill(); await duplicateEnded; });
  assert.equal(await duplicateEnded, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'proof.json'), 'utf8')), { message: 'complete', runId: ID });
  const retained = (await readdir(directory)).filter(name => name.startsWith('staging-') && name.endsWith('.json'));
  assert.equal(retained.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, retained[0]), 'utf8')), { message: 'replacement' });
});

test('guarded exclusive copy cancels before the next write and never overwrites', async t => {
  const directory = await tinyFixture(t);
  const source = path.join(directory, 'source.bin');
  const destination = path.join(directory, 'copy.bin');
  await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 7));
  let checks = 0;
  await assert.rejects(runtime.copyExclusive(source, destination, { check() { if (++checks === 5) throw new Error('CANCELLED'); } }), /CANCELLED/);
  const bytes = await readFile(destination);
  assert.equal(bytes.length, 0, 'Cancellation before the first write preserves a closed partial copy without later writes');
  await assert.rejects(runtime.copyExclusive(source, destination, { check() {} }), { code: 'EEXIST' });
  assert.equal((await readFile(destination)).length, 0);
});

test('connection error is observed while awaiting guest evidence', async () => {
  const f = fixture({ connect: async () => ({ check() { throw new Error('connection lost'); }, close: async () => {} }) });
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.cleanup.status, 'PASS');
});

test('release failure prevents PASS in final evidence', async () => {
  const f = fixture({ acquire: async () => ({ release: async () => { throw new Error('release failed'); } }) });
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.admissionCleanup.status, 'FAIL');
  assert.equal(f.final().status, 'FAIL');
});

test('cleanup failure preserves the original application error', async () => {
  const f = fixture({ readGuest: async () => { throw Object.assign(new Error('guest invalid'), { code: 77 }); } });
  const original = f.deps.execute;
  f.deps.execute = async (args, options) => { if (args[0] === 'stop') throw new Error('stop failed'); return original(args, options); };
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 77);
  assert.equal(result.cleanup.status, 'FAIL');
});

test('post-stop inventory must show disappearance and preserve foreign IDs', async () => {
  const f = fixture();
  const original = f.deps.execute;
  let stopped = false;
  f.deps.execute = async (args, options) => {
    if (args[0] === 'stop') stopped = true;
    if (stopped && args[0] === 'list') return inventory([ID]);
    return original(args, options);
  };
  const result = await runHarness('run', f.deps);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.cleanup.status, 'FAIL');
});

test('final evidence write failure cannot return PASS', async () => {
  const f = fixture({ writeFinal: async () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); } });
  assert.equal((await runHarness('run', f.deps)).status, 'FAIL');
});

test('fixed config and XML expose exactly the two constrained mappings', () => {
  assert.deepEqual(runtime.CONFIG, {
    update_base_url: '', default_server_config: { 'm.homeserver': { base_url: 'http://127.0.0.1:18008' } },
    disable_custom_urls: true, disable_guests: true, enable_client_well_known_lookups: false,
    integrations_ui_url: null, integrations_rest_url: null, integrations_widgets_urls: null,
    room_directory: { servers: [] }, bug_report_endpoint_url: 'local', sentry: {}, posthog: {},
  });
  const xml = runtime.renderWSB('D:\\owned&input', 'D:\\owned-output');
  for (const key of ['Networking', 'AudioInput', 'VideoInput', 'ClipboardRedirection', 'PrinterRedirection', 'vGPU']) assert.ok(xml.includes(`<${key}>Disable</${key}>`));
  assert.ok(xml.includes('<ProtectedClient>Enable</ProtectedClient>'));
  assert.equal((xml.match(/<MappedFolder>/g) ?? []).length, 2);
  assert.ok(xml.includes('owned&amp;input'));
  assert.ok(xml.includes('<SandboxFolder>C:\\G1Input</SandboxFolder><ReadOnly>true</ReadOnly>'));
  assert.ok(xml.includes('<SandboxFolder>C:\\G1Output</SandboxFolder><ReadOnly>false</ReadOnly>'));
  assert.ok(!xml.includes('AudioOutput'));
});

test('exec verifies native guest exit code independently from host exit success', async () => {
  for (const stdout of ['{}', '{"ExitCode":4}', '0', '{"ExitCode":"0"}']) {
    const f = fixture();
    const original = f.deps.execute;
    f.deps.execute = (args, options) => args[0] === 'exec' ? { stdout } : original(args, options);
    const result = await runHarness('run', f.deps);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.stage, 'EXEC');
    assert.equal(result.cleanup.status, 'PASS');
  }
});

for (const stage of ['VERIFY', 'HOST', 'PREPARE', 'CONNECT', 'EXEC', 'GUEST', 'INPUTS']) {
  test(`cancellation during ${stage} cannot be converted to PASS`, async () => {
    const controller = new AbortController();
    const f = fixture({ signal: controller.signal });
    const key = { VERIFY: 'verify', HOST: 'inspectHost', PREPARE: 'prepare', CONNECT: 'connect', EXEC: 'execute', GUEST: 'readGuest', INPUTS: 'inputsUnchanged' }[stage];
    const original = f.deps[key];
    let inputs = 0;
    f.deps[key] = async (...args) => {
      const value = await original(...args);
      if (stage === 'INPUTS') { if (++inputs === 3) controller.abort(); }
      else if (stage !== 'EXEC' || args[0][0] === 'exec') controller.abort();
      return value;
    };
    const result = await runHarness('run', f.deps);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.category, 'CANCELLED');
    assert.equal(result.admissionCleanup.status, 'PASS');
    if (['CONNECT', 'EXEC', 'GUEST', 'INPUTS'].includes(stage)) assert.equal(result.cleanup.status, 'PASS');
  });
}

test('invalid inventory and ambiguous create IDs fail closed', () => {
  for (const value of [{}, [], { WindowsSandboxEnvironments: [{ Id: 'bad' }] }, { WindowsSandboxEnvironments: [{ Id: ID }, { Id: ID }] }]) {
    assert.throws(() => runtime.parseInventory({ stdout: JSON.stringify(value) }));
  }
  for (const value of [{ id: ID }, { SandboxId: ID }, null, { Id: FOREIGN }]) {
    assert.throws(() => runtime.parseCreated({ stdout: JSON.stringify(value) }, ID));
  }
  runtime.parseCreated({ stdout: JSON.stringify(ID) }, ID);
});

test('fixed official Sandbox APPEXECLINK is allowed; other tags and targets fail', () => {
  const alias = { tag: '8000001b', entries: [
    'Microsoft.Windows.WindowsSandbox_cw5n1h2txyewy', 'Microsoft.Windows.WindowsSandbox_cw5n1h2txyewy!AppCli',
    'C:\\Program Files\\WindowsApps\\Microsoft.Windows.WindowsSandbox_0.8.107.0_x64__cw5n1h2txyewy\\wsb.exe',
  ] };
  runtime.validateCliAlias(alias);
  for (const changed of [{ ...alias, tag: 'a000000c' }, { ...alias, entries: ['other-package', ...alias.entries.slice(1)] },
    { ...alias, entries: [...alias.entries.slice(0, 2), 'C:\\untrusted\\wsb.exe'] }, { ...alias, entries: [...alias.entries, 'extra'] }]) {
    assert.throws(() => runtime.validateCliAlias(changed), /CLI_ALIAS/);
  }
});

async function tinyFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'babacom-g1-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('babacom-g1-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('full copied input seal rejects altered bytes and native reparse evidence', async t => {
  const directory = await tinyFixture(t);
  const file = path.join(directory, 'input.txt');
  await writeFile(file, 'small-owned-fixture');
  const expected = { size: 19, sha256: createHash('sha256').update('small-owned-fixture').digest('hex') };
  const sealed = await runtime.sealInput(file, expected);
  try {
    await runtime.checkSealed(sealed);
    await writeFile(file, 'other-owned-fixture');
    await assert.rejects(runtime.checkSealed(sealed), /INPUT_CHANGED|INPUT_HASH/);
  } finally { await sealed.handle.close(); }
  await assert.rejects(runtime.sealInput(file, { ...expected, size: 19, sha256: '0'.repeat(64) }), /INPUT_HASH/);
  await assert.rejects(runtime.sealInput(file, expected, { attributes: async () => { throw new Error('native reparse'); } }), /native reparse/);
});

test('junction/symlink ancestor is rejected before reading file content', async t => {
  const directory = await tinyFixture(t);
  const real = path.join(directory, 'real');
  const link = path.join(directory, 'junction');
  await mkdir(real);
  await writeFile(path.join(real, 'tiny.txt'), 'x');
  await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runtime.inspectPath(path.join(link, 'tiny.txt')), /regular non-reparse/);
});

function childFixture(script, cwd, mode) {
  const child = spawn(process.execPath, [script, mode], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture timeout: ${stderr}`)), 10000);
    child.stdout.on('data', bytes => {
      stdout += bytes;
      if (stdout.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(stdout.split('\n')[0])); } catch (error) { reject(error); } }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { if (!stdout.includes('\n')) { clearTimeout(timer); reject(new Error(`fixture exit ${code}: ${stderr}`)); } });
  });
  const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, ready, ended };
}

test('real distinct-workspace processes share old endpoint, normal release and abnormal-exit recovery', { timeout: 30000 }, async t => {
  assert.equal(process.platform, 'win32', 'This contract requires real Windows named-pipe semantics');
  const directory = await tinyFixture(t);
  const firstCwd = path.join(directory, 'owner');
  const secondCwd = path.join(directory, 'contender');
  await mkdir(firstCwd); await mkdir(secondCwd);
  const script = path.join(directory, 'fixture.mjs');
  const moduleUrl = new URL('./runtime.mjs', import.meta.url).href;
  await writeFile(script, `import { createServer } from 'node:net';
import { acquireAdmission, runHarness, FIXED } from ${JSON.stringify(moduleUrl)};
const mode=process.argv[2];
const emit = value => process.stdout.write(JSON.stringify({...value,pid:process.pid,cwd:process.cwd()})+'\\n');
let lease;
try {
 if(mode==='old-holder') {
  const server=createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:FIXED.endpoint},resolve);});
  lease={release:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
 } else if(mode==='new-holder') lease=await acquireAdmission();
 else {
  let calls=0;
  const result=await runHarness('preflight',{verify:async()=>{calls++;return {};},inspectHost:async()=>{calls++;}});
  emit({...result,calls}); process.exit(result.status==='PASS'?0:2);
 }
 emit({status:'HELD'});
 process.stdin.once('data',async()=>{await lease.release();process.exit(0);});
} catch(error) { emit({status:'BUSY',code:error.code,category:error.category});process.exit(3); }
`);
  const children = [];
  t.after(async () => {
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill();
    await Promise.all(children.map(item => item.ended));
  });
  const launch = (mode, cwd) => { const item = childFixture(script, cwd, mode); children.push(item); return item; };
  for (const ownerKind of ['old-holder', 'new-holder']) {
    const owner = launch(ownerKind, firstCwd);
    assert.equal((await owner.ready).status, 'HELD', 'Shared endpoint genuinely occupied externally: report BUSY, never break its owner');
    const contender = launch('contender', secondCwd);
    const busy = await contender.ready;
    assert.equal(busy.status, 'FAIL'); assert.equal(busy.category, 'BUSY');
    assert.equal(busy.stage, 'ADMISSION'); assert.equal(busy.cleanup.status, 'NOT_OWNED'); assert.equal(busy.calls, 0);
    assert.notEqual(busy.pid, owner.child.pid); assert.notEqual(busy.cwd, firstCwd);
    await contender.ended;
    if (ownerKind === 'old-holder') { owner.child.stdin.write('release'); assert.equal((await owner.ended).code, 0); }
    else { owner.child.kill(); await owner.ended; }
    const reacquire = launch('contender', secondCwd);
    const success = await reacquire.ready;
    assert.equal(success.status, 'PASS'); assert.equal(success.calls, 2); assert.equal(success.admissionCleanup.status, 'PASS');
    assert.equal((await reacquire.ended).code, 0);
  }
});

test('guest source is ASCII, fixed-path UIA/Quit evidence with no forbidden shutdown bypass', async () => {
  const bytes = await readFile(fileURLToPath(new URL('./guest.ps1', import.meta.url)));
  assert.ok(bytes.every(byte => byte < 128));
  const source = bytes.toString('ascii');
  for (const forbidden of ['--no-sandbox', '--disable-web-security', '--remote-debugging', 'CloseMainWindow', 'Stop-Process', 'Alt+F4']) assert.ok(!source.includes(forbidden));
  assert.ok(source.includes("'--no-update','--profile-dir','C:\\G1Profile','--config',$config"));
  assert.ok(source.includes('$env:ELEMENT_DESKTOP_CONFIG_JSON=$config'));
  assert.ok(source.includes('Quit-ThroughMenu $app $quitLimit'));
  assert.ok(source.includes('$process.ExitCode -ne 0'));
  assert.ok(source.includes("$records[0].DisplayVersion -ne '1.12.30'"));
});

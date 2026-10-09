import { _electron as electron, expect, test } from '@playwright/test';
import { SignalResponse } from '@livekit/protocol';
import Ajv from 'ajv';
import { mediaSessionSchema } from '@babacom/contracts';
import type { ElectronApplication, Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import * as desktopRunner from '../../apps/desktop/scripts/dev.mjs';
import { desktop } from '../../apps/desktop/scripts/build.mjs';
import { createStartupCleanup, startRenderer, startStartupPipe, startTestService, startMediaService, startRealMediaService } from '../../apps/desktop/scripts/dev.mjs';
import type { StartupConfiguration, MediaStartup, AdmissionSuccess, MediaRuntimeCommand } from '@babacom/contracts';
import { MediaSession } from '../../apps/desktop/src/main/media-session';
import { createAudioReceiver } from '../../apps/desktop/src/features/audio/playback';

test('A1 startup concurrently serves the complete renderer import graph', async () => {
  const renderer = await startRenderer();
  const seen = new Set<string>();
  const pending = new Set<Promise<void>>();
  const failures: string[] = [];
  const schedule = (url: URL) => {
    if (url.origin !== new URL(renderer.url).origin || seen.has(url.href)) return;
    seen.add(url.href);
    if (seen.size > 100) throw new Error('Renderer import graph exceeded its bounded module count');
    const task = (async () => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        expect(response.status).toBe(200);
        const text = await response.text();
        for (const match of text.matchAll(/(?:from\s*|import\s*)["']([/.][^"']+)["']/g)) schedule(new URL(match[1], url));
      } catch { failures.push(url.pathname.includes('/.vite/deps/') ? 'DEPENDENCY' : 'APPLICATION'); }
    })();
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  try {
    schedule(new URL('/src/renderer.tsx', renderer.url));
    while (pending.size) await Promise.all([...pending]);
    expect(failures).toEqual([]);
  } finally { await renderer.close(); }
});

test('A1 startup renderer reports an abnormal owned process exit during release', async () => {
  const renderer = await startRenderer();
  try {
    process.kill(renderer.pid!, 'SIGKILL');
    await expect.poll(() => {
      try { process.kill(renderer.pid!, 0); return true; } catch { return false; }
    }, { timeout: 5_000 }).toBe(false);
    const closing = renderer.close();
    await expect(closing).rejects.toMatchObject({ stage: 'RELEASE', category: 'RELEASE_FAILED', cleanup: 'FAILED' });
    await expect(renderer.close()).rejects.toMatchObject({ category: 'RELEASE_FAILED' });
  } finally {
    await renderer.close().catch((error: unknown) => {
      expect(error).toMatchObject({ category: 'RELEASE_FAILED' });
    });
  }
});

test('A1 startup development driver reaches a real window without a packaged fallback', async () => {
  const directory = await mkdtemp(join(desktop, 'build/a1-entry-'));
  const entry = join(directory, 'main.cjs');
  await writeFile(entry, "const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { globalThis.window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); window.loadURL('data:text/html,<p>A1 startup</p>'); });\n", { flag: 'wx' });
  const owner = createStartupCleanup();
  const renderer = await startRenderer();
  await owner.own('RENDERER', renderer.close);
  try {
    const application = await electron.launch({ args: [entry], timeout: 10_000 });
    await owner.own('DRIVER', () => application.close());
    const page = await application.firstWindow({ timeout: 5_000 });
    await expect(page.getByText('A1 startup', { exact: true })).toBeVisible();
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(false);
  } finally {
    await owner.close();
    await unlink(entry);
    await rmdir(directory);
  }
});

test('A1 startup renderer serves the application entry and its React dependency', async () => {
  const renderer = await startRenderer();
  try {
    const html = await fetch(renderer.url, { signal: AbortSignal.timeout(5_000) });
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('/src/renderer.tsx');
    const entry = await fetch(new URL('/src/renderer.tsx', renderer.url), { signal: AbortSignal.timeout(5_000) });
    expect(entry.status).toBe(200);
    const source = await entry.text();
    const dependency = /from\s*["']([^"']+react[^"']*)["']/.exec(source)?.[1];
    expect(dependency).toBeTruthy();
    const react = await fetch(new URL(dependency!, renderer.url), { signal: AbortSignal.timeout(5_000) });
    expect(react.status).toBe(200);
    expect(await react.text()).toContain('react');
    for (const path of ['/src/shell/AdmissionPage.tsx', '/src/features/voice/VoicePanel.tsx', '/src/features/audio/AudioControls.tsx']) {
      const module = await fetch(new URL(path, renderer.url), { signal: AbortSignal.timeout(5_000) });
      expect(module.status, path).toBe(200);
      for (const match of (await module.text()).matchAll(/from\s*["'](\/[^"']+)["']/g)) {
        let dependency: Response;
        try { dependency = await fetch(new URL(match[1], renderer.url), { signal: AbortSignal.timeout(5_000) }); }
        catch { throw new Error(match[1].includes('/packages/ui/') ? 'SHARED_UI_IMPORT_TIMEOUT'
          : match[1].includes('/.vite/deps/') ? 'OPTIMIZED_IMPORT_TIMEOUT' : 'APPLICATION_IMPORT_TIMEOUT'); }
        expect(dependency.status, path + ' dependency').toBe(200);
        await dependency.arrayBuffer();
      }
    }
  } finally { await renderer.close(); }
});

test('A1 startup cleanup continues in reverse order after a release fails', async () => {
  const owner = desktopRunner.createStartupCleanup();
  const released: string[] = [];
  await owner.own('API', async () => { released.push('API'); });
  await owner.own('RENDERER', async () => { released.push('RENDERER'); throw new Error('private-session-sentinel'); });
  await owner.own('PIPE', async () => { released.push('PIPE'); });
  const closing = owner.close();
  await expect(closing).rejects.toMatchObject({ stage: 'RELEASE', category: 'RELEASE_FAILED', failedStages: ['RENDERER'] });
  expect(released).toEqual(['PIPE', 'RENDERER', 'API']);
  await expect(owner.close()).rejects.toMatchObject({ category: 'RELEASE_FAILED' });
  expect(released).toEqual(['PIPE', 'RENDERER', 'API']);
  await expect(closing).rejects.not.toThrow('private-session-sentinel');
});

test('A1 startup cleanup preserves the primary stage and numeric exit code', async () => {
  for (const envelope of [{ code: 47 }, { exitCode: 47 }]) {
    const owner = desktopRunner.createStartupCleanup();
    await owner.own('API', async () => { throw new Error('private-session-sentinel'); });
    const failure = owner.fail('WINDOW', Object.assign(new Error('private-session-sentinel'), envelope));
    await expect(failure).rejects.toMatchObject({ stage: 'WINDOW', category: 'START_FAILED', exitCode: 47, cleanup: 'FAILED' });
    await expect(failure).rejects.not.toThrow('private-session-sentinel');
  }
});

for (const [label, start] of [['API', startTestService], ['MEDIA', startMediaService]] as const) {
  test('A1 startup preserves the real ' + label + ' process exit code before readiness', async () => {
    const owner = createStartupCleanup();
    const failure = start('a1-invalid-scenario').catch((error: unknown) => owner.fail('API', error));
    await expect(failure).rejects.toMatchObject({ stage: 'API', category: 'START_FAILED', exitCode: 2, cleanup: 'RELEASED' });
  });
}

test('A1 startup preserves the real broker process exit code before readiness', async () => {
  test.skip(process.platform !== 'win32', 'The broker requires Windows named pipes');
  await desktopRunner.ensureWindowsProcessOwner();
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const previousPath = process.env[pathKey];
  const owner = createStartupCleanup();
  try {
    // PowerShell remains available; the real broker fails to resolve whoami.exe.
    process.env[pathKey] = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0');
    const failure = startStartupPipe({}).catch((error: unknown) => owner.fail('PIPE', error));
    await expect(failure).rejects.toMatchObject({ stage: 'PIPE', category: 'START_FAILED', exitCode: 1, cleanup: 'RELEASED' });
  } finally {
    if (previousPath === undefined) delete process.env[pathKey]; else process.env[pathKey] = previousPath;
  }
});

test('A1 startup cleanup releases late resources after cancellation only once', async () => {
  const owner = desktopRunner.createStartupCleanup();
  let released = 0;
  await owner.close();
  await expect(owner.own('RENDERER', async () => { released++; })).rejects.toMatchObject({ category: 'OWNER_CLOSED' });
  await owner.close();
  expect(released).toBe(1);
});

test('A1 startup cleanup retains a failed release reported by the allocating helper', async () => {
  const owner = createStartupCleanup();
  let released = false;
  await owner.own('API', async () => { released = true; });
  await expect(owner.fail('RENDERER', Object.assign(new Error('private-session-sentinel'), {
    name: 'TimeoutError', code: 47, cleanup: 'FAILED',
  }))).rejects.toMatchObject({ stage: 'RENDERER', category: 'START_TIMEOUT', exitCode: 47, cleanup: 'FAILED' });
  expect(released).toBe(true);
});

test('A1 startup renderer is released when its owning worker is killed', async () => {
  const directory = await mkdtemp(join(desktop, 'build/a1-worker-'));
  const entry = join(directory, 'worker.mjs');
  const sentinelEntry = join(directory, 'sentinel.cjs');
  await writeFile(entry, `import { startRenderer } from ${JSON.stringify(pathToFileURL(join(desktop, 'scripts/dev.mjs')).href)}; const renderer = await startRenderer(); process.stdout.write(JSON.stringify({ pid: renderer.pid }) + '\\n'); process.stdin.resume();\n`, { flag: 'wx' });
  await writeFile(sentinelEntry, 'process.stdin.resume();\n', { flag: 'wx' });
  const sentinel = spawn(process.execPath, [sentinelEntry], { stdio: 'pipe', windowsHide: true });
  const worker = spawn(process.execPath, [entry], { stdio: 'pipe', windowsHide: true });
  worker.stderr.resume();
  try {
    const pid = await new Promise<number>((resolvePromise, reject) => {
      const reader = createInterface({ input: worker.stdout });
      const timeout = setTimeout(() => { reader.close(); reject(new Error('A1 worker startup timed out')); }, 10_000);
      worker.once('error', () => { clearTimeout(timeout); reader.close(); reject(new Error('A1 worker unavailable')); });
      worker.once('exit', () => { clearTimeout(timeout); reader.close(); reject(new Error('A1 worker stopped before readiness')); });
      reader.once('line', (line) => {
        clearTimeout(timeout); reader.close();
        try {
          const result = JSON.parse(line);
          if (!Number.isInteger(result.pid) || result.pid <= 0) throw new Error();
          resolvePromise(result.pid);
        } catch { reject(new Error('Invalid A1 worker readiness')); }
      });
    });
    const exited = new Promise<void>((resolvePromise) => worker.once('exit', () => resolvePromise()));
    worker.kill('SIGKILL');
    await exited;
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }, { timeout: 7_000 }).toBe(false);
    expect(sentinel.exitCode, 'Only the owning worker and its renderer may be released').toBeNull();
  } finally {
    for (const child of [worker, sentinel]) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await expect.poll(() => [worker, sentinel].every((child) => child.exitCode !== null || child.signalCode !== null),
      { timeout: 5_000 }).toBe(true);
    await unlink(entry);
    await unlink(sentinelEntry);
    await rmdir(directory);
  }
});

for (const termination of ['forced worker exit', 'normal worker exit', 'ownership helper exit'] as const) {
test('A1 startup ' + termination + ' releases the real product process tree', async () => {
  type ProcessIdentity = { ProcessId: number; ParentProcessId: number; CreationDate: string | null };
  const inventory = async (): Promise<ProcessIdentity[]> => {
    try {
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'],
      { windowsHide: true, timeout: 5_000, encoding: 'utf8' });
      const rows: ProcessIdentity[] = JSON.parse(stdout);
      if (!Array.isArray(rows) || rows.some((row) => !Number.isInteger(row.ProcessId) || !Number.isInteger(row.ParentProcessId))) throw new Error();
      return rows;
    } catch { throw new Error('A1 process ownership inventory unavailable'); }
  };
  const directory = await mkdtemp(join(desktop, 'build/a1-worker-'));
  const entry = join(directory, 'worker.mjs');
  const sentinelEntry = join(directory, 'sentinel.cjs');
  const packaged = test.info().project.name === 'packaged';
  await writeFile(entry, `import { _electron as electron } from '@playwright/test';
import { join } from 'node:path';
import { ensureWindowsProcessOwner, startRenderer, startTestService, startStartupPipe } from ${JSON.stringify(pathToFileURL(join(desktop, 'scripts/dev.mjs')).href)};
const service = await startTestService();
const renderer = ${packaged} ? null : await startRenderer();
const startup = await startStartupPipe(service.configuration);
const environment = { ...process.env };
delete environment.BABACOM_RENDERER_URL;
if (renderer) environment.BABACOM_RENDERER_URL = renderer.url;
if (${packaged}) {
  environment.PATH = join(process.env.SystemRoot || 'C:/Windows', 'System32');
  delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.ELECTRON_RUN_AS_NODE;
}
const application = await electron.launch({ executablePath: ${packaged ? JSON.stringify(join(desktop, 'build/windows/win-unpacked/BabaCom.exe')) : 'undefined'},
  args: [...${JSON.stringify(packaged ? [] : [join(desktop, 'dist/main/main.cjs')])}, '--babacom-startup-pipe=' + startup.path], env: environment, timeout: 10000 });
const page = await application.firstWindow({ timeout: 5000 });
await page.getByText('\\u672c\\u5730\\u6d4b\\u8bd5\\u73af\\u5883', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
process.stdout.write(JSON.stringify({ event: 'READY', ownerPid: await ensureWindowsProcessOwner() }) + '\\n');
process.stdin.once('end', async () => {
  await application.close(); await startup.close();
  if (renderer) await renderer.close(); await service.close();
});
process.stdin.resume();
`, { flag: 'wx' });
  await writeFile(sentinelEntry, 'process.stdin.resume();\n', { flag: 'wx' });
  const sentinel = spawn(process.execPath, [sentinelEntry], { stdio: 'pipe', windowsHide: true });
  const worker = spawn(process.execPath, [entry], { stdio: 'pipe', windowsHide: true });
  sentinel.stderr.resume(); worker.stderr.resume();
  let owned: ProcessIdentity[] = [];
  const capture = async () => {
    const rows = await inventory();
    const ids = new Set([worker.pid]);
    for (let depth = 0; depth < rows.length; depth++) {
      const previous = ids.size;
      for (const row of rows) if (ids.has(row.ParentProcessId)) ids.add(row.ProcessId);
      if (ids.size === previous) break;
    }
    owned = rows.filter((row) => ids.has(row.ProcessId));
    if (!owned.length || owned.some((row) => typeof row.CreationDate !== 'string')) throw new Error('A1 process ownership could not be verified');
  };
  const remaining = async () => {
    const rows = await inventory();
    return owned.filter((item) => rows.some((row) => row.ProcessId === item.ProcessId && row.CreationDate === item.CreationDate));
  };
  try {
    const ownerPid = await new Promise<number>((resolvePromise, reject) => {
      const reader = createInterface({ input: worker.stdout });
      const finish = (error?: Error, pid?: number) => { clearTimeout(timeout); reader.close(); if (error) reject(error); else resolvePromise(pid!); };
      const timeout = setTimeout(() => finish(new Error('A1 product worker startup timed out')), 10_000);
      worker.once('error', () => finish(new Error('A1 product worker unavailable')));
      worker.once('exit', () => finish(new Error('A1 product worker stopped before readiness')));
      reader.once('line', (line) => {
        try {
          const ready = JSON.parse(line);
          if (ready.event !== 'READY' || !Number.isInteger(ready.ownerPid) || ready.ownerPid <= 0) throw new Error();
          finish(undefined, ready.ownerPid);
        } catch { finish(new Error('Invalid A1 product readiness')); }
      });
    });
    await capture();
    expect(owned.length).toBeGreaterThan(1);
    const exited = new Promise<void>((resolvePromise) => worker.once('exit', () => resolvePromise()));
    if (termination === 'normal worker exit') worker.stdin.end();
    else if (termination === 'ownership helper exit') {
      const helper = (await remaining()).find((item) => item.ProcessId === ownerPid && item.ParentProcessId === worker.pid);
      expect(helper, 'Only the verified ownership helper may be terminated').toBeDefined();
      process.kill(helper!.ProcessId, 'SIGKILL');
    } else worker.kill('SIGKILL');
    await expect.poll(() => worker.exitCode !== null || worker.signalCode !== null,
      { timeout: 7_000, message: 'The owned worker must exit within the release budget' }).toBe(true);
    await exited;
    expect(sentinel.exitCode, 'An unrelated process must survive worker termination').toBeNull();
    await expect.poll(async () => (await remaining()).length,
      { timeout: 7_000, message: 'WORKER_EXIT: every owned process must exit, including descendants of the Windows shell wrapper' }).toBe(0);
    if (termination === 'normal worker exit') expect(worker.exitCode).toBe(0);
    expect(sentinel.exitCode, 'An unrelated process must survive the entire owned-tree release').toBeNull();
  } finally {
    let released = false;
    try {
      if (!owned.length && worker.exitCode === null && worker.signalCode === null) await capture();
      for (const item of (await remaining()).reverse()) {
        try { process.kill(item.ProcessId, 'SIGKILL'); } catch { /* Already exited. */ }
      }
      await expect.poll(async () => (await remaining()).length, { timeout: 5_000 }).toBe(0);
      released = true;
    } catch { expect.soft(false, 'RELEASE_FAILED: diagnostic process tree could not be reclaimed').toBe(true); }
    for (const child of [worker, sentinel]) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await expect.configure({ soft: true }).poll(() => [worker, sentinel].every((child) => child.exitCode !== null || child.signalCode !== null),
      { timeout: 5_000 }).toBe(true);
    if (released) {
      try { await unlink(entry); await unlink(sentinelEntry); await rmdir(directory); }
      catch { expect.soft(false, 'RELEASE_FAILED: diagnostic files could not be reclaimed').toBe(true); }
    }
  }
});
}

test('Sandbox runner native connection advances after the CLI exits while the desktop stays open', async () => {
  test.skip(process.env.BABACOM_SANDBOX_NATIVE_TEST !== '1', 'Explicit opt-in for a real Windows Sandbox instance');
  test.setTimeout(180_000);
  const runDirectory = await mkdtemp(join(desktop, 'build/sandbox-connect-probe-'));
  const input = join(runDirectory, 'input');
  const outputDirectory = join(runDirectory, 'output');
  await mkdir(input);
  await mkdir(outputDirectory);
  const guest = String.raw`$ErrorActionPreference = 'Stop'
$proof = @{ stage = 'ENVIRONMENT'; interactiveUser = ([Diagnostics.Process]::GetCurrentProcess().SessionId -gt 0); probeComplete = $true }
[IO.File]::WriteAllText('C:\T1Output\guest-complete.json', ($proof | ConvertTo-Json))
[IO.File]::WriteAllText('C:\T1Output\result.json', '{"status":"FAIL","stage":"ENVIRONMENT"}')
`;
  await writeFile(join(input, 'probe.ps1'), guest, { encoding: 'ascii', flag: 'wx' });
  const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const configuration = '<Configuration><vGPU>Disable</vGPU><Networking>Disable</Networking>'
    + '<AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection>'
    + '<PrinterRedirection>Disable</PrinterRedirection><MappedFolders>'
    + '<MappedFolder><HostFolder>' + xml(input) + '</HostFolder><SandboxFolder>C:\\T1Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>'
    + '<MappedFolder><HostFolder>' + xml(outputDirectory) + '</HostFolder><SandboxFolder>C:\\T1Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>'
    + '</MappedFolders><LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\T1Input\\probe.ps1</Command></LogonCommand></Configuration>';
  // A deliberate guest failure tests progress to RESULT without manufacturing T1 PASS evidence.
  const result = await desktopRunner.runSandboxInstance({ outputDirectory, configuration, appSha256: 'a'.repeat(64) });
  expect(JSON.parse(await readFile(join(outputDirectory, 'guest-complete.json'), 'utf8'))).toMatchObject({ interactiveUser: true, probeComplete: true });
  expect(result).toMatchObject({ status: 'FAIL', stage: 'RESULT', category: 'GUEST_ASSERTION_FAILED', cleanup: { status: 'RELEASED', unrelatedPreserved: true } });
});

test('Sandbox runner reports the real CLI exit code without exposing its diagnostics', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-test-'));
  const result = Promise.resolve().then(() => desktopRunner.runSandboxInstance({
    outputDirectory, configuration: '<Configuration/>', appSha256: 'a'.repeat(64),
    execute: async () => { throw Object.assign(new Error('private-session-sentinel'), { code: 17, stderr: 'private-session-sentinel' }); },
  }));
  await expect(result).resolves.toMatchObject({ status: 'FAIL', stage: 'INVENTORY', exitCode: 17 });
  expect(JSON.stringify(await result)).not.toContain('private-session-sentinel');
});

test('Sandbox runner refuses malformed CLI inventory without publishing its body', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-test-'));
  const result = Promise.resolve().then(() => desktopRunner.runSandboxInstance({
    outputDirectory, configuration: '<Configuration/>', appSha256: 'a'.repeat(64),
    execute: async () => ({ stdout: '{private-session-sentinel' }),
  }));
  await expect(result).resolves.toMatchObject({ status: 'FAIL', stage: 'INVENTORY', category: 'INVALID_RESPONSE' });
  expect(JSON.stringify(await result)).not.toContain('private-session-sentinel');
  expect(await readFile(join(outputDirectory, 'host-summary.json'), 'utf8')).not.toContain('private-session-sentinel');
});

test('Sandbox runner never connects to or stops an unrelated returned instance', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-test-'));
  const unrelated = '2c4eaad5-2c98-486d-b515-00e3d555c8ad';
  const calls: string[][] = [];
  const result = await desktopRunner.runSandboxInstance({
    outputDirectory, configuration: '<Configuration/>', appSha256: 'a'.repeat(64),
    execute: async (args: string[]) => {
      calls.push(args);
      return { stdout: JSON.stringify(args[0] === 'list'
        ? { WindowsSandboxEnvironments: [{ Id: unrelated }] } : { Id: unrelated }) };
    },
  });
  expect(result).toMatchObject({ status: 'FAIL', stage: 'CREATE', category: 'OWNERSHIP_UNVERIFIED' });
  expect(calls.map((args) => args[0])).toEqual(['list', 'start']);
  expect(calls[1]).toContain('--config');
  expect(calls[1][calls[1].indexOf('--id') + 1]).not.toBe(unrelated);
});

async function sandboxScenario(guest: Record<string, unknown> | null, interactiveUser = true) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-test-'));
  const unrelated = '2c4eaad5-2c98-486d-b515-00e3d555c8ad';
  const calls: string[][] = [];
  let instanceId = '';
  let active = false;
  const execute = async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(15_000);
    expect(options.windowsHide).toBe(true);
    calls.push(args);
    if (args[0] === 'list') {
      return { stdout: JSON.stringify({ WindowsSandboxEnvironments: [{ Id: unrelated }, ...(active ? [{ Id: instanceId }] : [])] }) };
    }
    if (args[0] === 'start') {
      instanceId = args[args.indexOf('--id') + 1];
      active = true;
      return { stdout: JSON.stringify({ Id: instanceId }) };
    }
    expect(args[args.indexOf('--id') + 1]).toBe(instanceId);
    if (args[0] === 'connect' && guest) {
      for (const [filename, stage] of [['guest-started.json', 'ENVIRONMENT'], ['fixture-ready.json', 'API'], ['client-started.json', 'CLIENT']]) {
        await writeFile(join(outputDirectory, filename), JSON.stringify({ stage, interactiveUser }), { flag: 'wx' });
      }
      await writeFile(join(outputDirectory, 'result.json'), JSON.stringify(guest), { flag: 'wx' });
    }
    if (args[0] === 'stop') active = false;
    return { stdout: '{}' };
  };
  return { outputDirectory, execute, calls, unrelated, isActive: () => active };
}

const sandboxPass = {
  status: 'PASS', environment: 'Windows Sandbox', os: 'Microsoft Windows NT 10.0.26200.0',
  nodeAbsent: true, npmAbsent: true, typescriptAbsent: true, viteAbsent: true,
  actualWindow: true, admissionControlsVisible: true, apiRequestsDuringStartup: 0, clientExitCode: 0,
  appSha256: 'a'.repeat(64),
};

test('Sandbox runner accepts guest proof only after releasing its owned instance', async () => {
  const scenario = await sandboxScenario(sandboxPass);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256 });
  expect(result).toMatchObject({ status: 'PASS', cleanup: { status: 'RELEASED', unrelatedPreserved: true }, guest: sandboxPass });
  expect(scenario.isActive()).toBe(false);
  expect(scenario.calls.filter((args) => args[0] === 'connect' || args[0] === 'stop')).toHaveLength(2);
});

for (const [name, guest, category] of [
  ['missing window proof', { ...sandboxPass, actualWindow: false, reason: 'private-session-sentinel' }, 'INVALID_RESULT'],
  ['different artifact', { ...sandboxPass, appSha256: 'b'.repeat(64) }, 'ARTIFACT_MISMATCH'],
] as const) {
  test(`Sandbox runner rejects ${name} and still releases only its instance`, async () => {
    const scenario = await sandboxScenario(guest);
    const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256 });
    expect(result).toMatchObject({ status: 'FAIL', stage: 'RESULT', category, cleanup: { status: 'RELEASED' } });
    expect(scenario.isActive()).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-session-sentinel');
  });
}

test('Sandbox runner bounds missing guest evidence and reports NOT_RUN with owned cleanup', async () => {
  test.setTimeout(1_000);
  const scenario = await sandboxScenario(null);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>',
    appSha256: sandboxPass.appSha256, guestTimeoutMs: 40 });
  expect(result).toMatchObject({ status: 'NOT_RUN', stage: 'GUEST', category: 'MISSING_RESULT', cleanup: { status: 'RELEASED' } });
});

test('Sandbox runner cancels an owned instance without accepting already-written PASS', async () => {
  const scenario = await sandboxScenario(sandboxPass);
  const controller = new AbortController();
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    signal: controller.signal, execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      const response = await scenario.execute(args, options);
      if (args[0] === 'connect') controller.abort();
      return response;
    },
  });
  expect(result).toMatchObject({ status: 'NOT_RUN', category: 'CANCELLED', cleanup: { status: 'RELEASED' } });
  expect(scenario.isActive()).toBe(false);
});

test('Sandbox runner cancellation before inventory creates no instance', async () => {
  const scenario = await sandboxScenario(null);
  const controller = new AbortController();
  controller.abort();
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256, signal: controller.signal });
  expect(result).toMatchObject({ status: 'NOT_RUN', category: 'CANCELLED', cleanup: { status: 'NOT_OWNED' } });
  expect(scenario.calls).toHaveLength(0);
});

test('Sandbox runner times out a stuck connection and releases the confirmed instance', async () => {
  test.setTimeout(1_000);
  const scenario = await sandboxScenario(null);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    cliTimeoutMs: 40, execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      if (args[0] === 'connect') return new Promise(() => {});
      return scenario.execute(args, options);
    },
  });
  expect(result).toMatchObject({ status: 'FAIL', stage: 'USER_SESSION', category: 'TIMEOUT', cleanup: { status: 'RELEASED' } });
});

test('Sandbox runner cleanup failure cannot be covered by guest PASS or leak CLI diagnostics', async () => {
  const scenario = await sandboxScenario(sandboxPass);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      if (args[0] === 'stop') throw Object.assign(new Error('private-session-sentinel'), { code: 23, stderr: 'private-session-sentinel' });
      return scenario.execute(args, options);
    },
  });
  expect(result).toMatchObject({ status: 'FAIL', cleanup: { status: 'NOT_RELEASED', category: 'CLI_FAILED', exitCode: 23 } });
  expect(scenario.isActive()).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-session-sentinel');
});

test('Sandbox runner refuses System-session guest proof even with window fields', async () => {
  const scenario = await sandboxScenario(sandboxPass, false);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256 });
  expect(result).toMatchObject({ status: 'FAIL', category: 'INVALID_RESULT', cleanup: { status: 'RELEASED' } });
});

test('Sandbox runner cleanup timeout cannot become PASS', async () => {
  test.setTimeout(1_000);
  const scenario = await sandboxScenario(sandboxPass);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    cliTimeoutMs: 40, execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      if (args[0] === 'stop') return new Promise(() => {});
      return scenario.execute(args, options);
    },
  });
  expect(result).toMatchObject({ status: 'FAIL', cleanup: { status: 'NOT_RELEASED', category: 'TIMEOUT' } });
});

test('Sandbox runner refuses PASS when the stop command leaves its instance listed', async () => {
  const scenario = await sandboxScenario(sandboxPass);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => args[0] === 'stop' ? { stdout: '{}' } : scenario.execute(args, options),
  });
  expect(result).toMatchObject({ status: 'FAIL', cleanup: { status: 'NOT_RELEASED' } });
});

for (const command of ['start', 'connect']) {
  test(`Sandbox runner ${command} failure retains the CLI exit code and sanitizes evidence`, async () => {
    const scenario = await sandboxScenario(null);
    const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
      execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
        if (args[0] === command) throw Object.assign(new Error('private-session-sentinel'), { code: 29, stdout: 'private-session-sentinel' });
        return scenario.execute(args, options);
      },
    });
    expect(result).toMatchObject({ status: 'FAIL', stage: command === 'start' ? 'CREATE' : 'USER_SESSION', exitCode: 29 });
    expect(result.cleanup.status).toBe(command === 'start' ? 'NOT_OWNED' : 'RELEASED');
    expect(JSON.stringify(result)).not.toContain('private-session-sentinel');
  });
}

test('Sandbox runner treats malformed guest JSON as failure and releases its instance', async () => {
  const scenario = await sandboxScenario(null);
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      const response = await scenario.execute(args, options);
      if (args[0] === 'connect') await writeFile(join(scenario.outputDirectory, 'result.json'), '{private-session-sentinel', { flag: 'wx' });
      return response;
    },
  });
  expect(result).toMatchObject({ status: 'FAIL', stage: 'RESULT', category: 'INVALID_RESULT', cleanup: { status: 'RELEASED' } });
  expect(JSON.stringify(result)).not.toContain('private-session-sentinel');
});

test('Sandbox runner cancellation while waiting releases the owned instance', async () => {
  const scenario = await sandboxScenario(null);
  const controller = new AbortController();
  const resultPromise = desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    signal: controller.signal, execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      const response = await scenario.execute(args, options);
      if (args[0] === 'connect') setTimeout(() => controller.abort(), 20);
      return response;
    },
  });
  await expect(resultPromise).resolves.toMatchObject({ status: 'NOT_RUN', stage: 'GUEST', category: 'CANCELLED', cleanup: { status: 'RELEASED' } });
  expect(scenario.isActive()).toBe(false);
});

test('Sandbox runner reserves cleanup inside the overall deadline instead of using the whole guest wait', async () => {
  const scenario = await sandboxScenario(null);
  const started = Date.now();
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    deadline: started + 15_080 });
  expect(result).toMatchObject({ status: 'NOT_RUN', category: 'MISSING_RESULT', cleanup: { status: 'RELEASED' } });
  expect(Date.now() - started).toBeLessThan(1_000);
});

test('Sandbox runner guest assertion failure reports only a fixed category and cleans up', async () => {
  const scenario = await sandboxScenario({ status: 'FAIL', stage: 'WINDOW', category: 'private-session-sentinel' });
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256 });
  expect(result).toMatchObject({ status: 'FAIL', stage: 'RESULT', category: 'GUEST_ASSERTION_FAILED', guestStage: 'WINDOW', cleanup: { status: 'RELEASED' } });
  expect(await readFile(join(scenario.outputDirectory, 'host-summary.json'), 'utf8')).not.toContain('private-session-sentinel');
});

test('Sandbox runner cancellation during release prevents a late PASS', async () => {
  const scenario = await sandboxScenario(sandboxPass);
  const controller = new AbortController();
  const result = await desktopRunner.runSandboxInstance({ ...scenario, configuration: '<Configuration/>', appSha256: sandboxPass.appSha256,
    signal: controller.signal, execute: async (args: string[], options: { timeout: number; windowsHide: boolean }) => {
      if (args[0] === 'stop') controller.abort();
      return scenario.execute(args, options);
    },
  });
  expect(result).toMatchObject({ status: 'NOT_RUN', category: 'CANCELLED', cleanup: { status: 'RELEASED' } });
});

test('Sandbox runner input copying preserves source bytes and copies nested files with the native deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-copy-'));
  const source = join(directory, 'source');
  const target = join(directory, 'target');
  await mkdir(join(source, 'nested'), { recursive: true });
  await writeFile(join(source, 'nested', 'sample.txt'), 'sandbox-copy-proof', { flag: 'wx' });
  await desktopRunner.copySandboxInput(source, target, { recursive: true, deadline: Date.now() + 15_000 });
  expect(await readFile(join(target, 'nested', 'sample.txt'), 'utf8')).toBe('sandbox-copy-proof');
  expect(await readFile(join(source, 'nested', 'sample.txt'), 'utf8')).toBe('sandbox-copy-proof');
});

test('Sandbox runner refuses an expired copy budget before invoking any native copy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'babacom-sandbox-copy-'));
  const result = Promise.resolve().then(() => desktopRunner.copySandboxInput(join(directory, 'source'), join(directory, 'target'),
    { deadline: Date.now() - 1 }));
  await expect(result).rejects.toThrow('Sandbox preparation timed out');
  await expect(result).rejects.toMatchObject({ category: 'TIMEOUT' });
});

async function simulateCapture(running: Awaited<ReturnType<typeof launch>>, scenario: 'ready' | 'denied' | 'no-device' | 'late' = 'ready', consent = true) {
  await running.application.evaluate(({ dialog }, consent) => {
    Reflect.set(globalThis, '__consentPrompts', 0);
    Reflect.set(dialog, 'showMessageBox', async () => {
      Reflect.set(globalThis, '__consentPrompts', Number(Reflect.get(globalThis, '__consentPrompts')) + 1);
      return { response: consent ? 0 : 1, checkboxChecked: false };
    });
  }, consent);
  await running.application.evaluate(async ({ BrowserWindow }, scenario) => {
    const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))?.webContents;
    if (!contents) throw new Error('Missing media context');
    await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
      (() => {
        const scenario = ${JSON.stringify(scenario)};
        const probe = globalThis.__captureProbe = { calls: 0, active: 0, stopped: 0, constraints: null, pending: false };
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          probe.calls++; probe.constraints = constraints;
          if (scenario === 'denied') throw new DOMException('Test permission refusal', 'NotAllowedError');
          if (scenario === 'no-device') throw new DOMException('Test device unavailable', 'NotFoundError');
          if (scenario === 'late') await new Promise((resolve) => { probe.pending = true; globalThis.__releaseCapture = resolve; });
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.frequency.value = 440; oscillator.connect(destination); oscillator.start();
          const track = destination.stream.getAudioTracks()[0];
          probe.active++;
          const stop = track.stop.bind(track);
          let stopped = false;
          track.stop = () => {
            if (stopped) return;
            stopped = true; stop(); probe.active--; probe.stopped++;
            oscillator.stop(); void context.close();
          };
          return destination.stream;
        };
      })()
    ` }]);
  }, scenario);
}

async function captureProbe(running: Awaited<ReturnType<typeof launch>>) {
  return running.application.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))?.webContents;
    if (!contents) throw new Error('Missing media context');
    return JSON.parse(await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'JSON.stringify(globalThis.__captureProbe)' }]));
  });
}

async function joinAudio(running: Awaited<ReturnType<typeof launch>>) {
  await prepare(running);
  await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
  await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
    { timeout: 30_000 }).toBe('connected');
}

test('T2-03 joined desktop offers independent playback and consent-gated microphone controls', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await prepare(running);
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status).toBe('connected');
      await expect(running.page.getByRole('button', { name: '开启麦克风', exact: true })).toBeVisible();
      await expect(running.page.getByRole('button', { name: '启用声音', exact: true })).toBeVisible();
      expect((await service.command('inspect')).participants[0].tracks).toBe(0);
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off', playback: 'off' });
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 real Room publishes synthetic capture once, mutes, resumes and destroys capture on leave', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await joinAudio(running);
      await simulateCapture(running);
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('on');
      expect(await captureProbe(running)).toMatchObject({ calls: 1, active: 1,
        constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false } });
      await expect.poll(async () => (await service.command('inspect')).participants[0].tracks).toBe(1);
      await running.page.getByRole('button', { name: '静音麦克风', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('muted');
      expect(await captureProbe(running)).toMatchObject({ calls: 1, active: 1, stopped: 0 });
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('on');
      expect(await captureProbe(running)).toMatchObject({ calls: 1, active: 1 });
      expect(await running.application.evaluate(() => Reflect.get(globalThis, '__consentPrompts'))).toBe(1);
      const mediaPage = running.application.windows().find((page) => page !== running.page)!;
      await running.page.getByRole('button', { name: '离开语音房间' }).click();
      await expect(running.page.getByLabel('展示昵称')).toBeVisible();
      expect(mediaPage.isClosed()).toBe(true);
      await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
      await joinAudio(running);
      await simulateCapture(running, 'ready', false);
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect(running.page.getByRole('region', { name: '音频控制' })).toContainText('未允许使用麦克风');
      expect(await captureProbe(running)).toMatchObject({ calls: 0, active: 0 });
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off', playback: 'off' });
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const scenario of ['denied', 'no-device'] as const) {
  test('T2-03 capture ' + scenario + ' keeps actual SFU membership without a local publication', async () => {
    const service = await startRealMediaService();
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await joinAudio(running);
        await simulateCapture(running, scenario);
        await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).audioCode)
          .toBe(scenario === 'denied' ? 'MICROPHONE_DENIED' : 'MICROPHONE_FAILED');
        expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'connected', microphone: 'off' });
        expect((await service.command('inspect')).participants[0].tracks).toBe(0);
        expect(await captureProbe(running)).toMatchObject({ calls: 1, active: 0 });
        await expect(running.page.getByRole('button', { name: '启用声音', exact: true })).toBeVisible();
        expect(running.browserCredentialLeak()).toBe(false);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('T2-03 canceled real SDK capture discards a late synthetic track and allows a fresh consented operation', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await joinAudio(running);
      await simulateCapture(running, 'late');
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await captureProbe(running)).pending).toBe(true);
      await running.page.getByRole('button', { name: '取消开麦', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('off');
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      expect((await captureProbe(running)).calls).toBe(1);
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.__releaseCapture()' }]);
      });
      await expect.poll(async () => (await captureProbe(running)).stopped).toBe(1);
      expect((await service.command('inspect')).participants[0].tracks).toBe(0);
      await simulateCapture(running);
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('on');
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 UI playback transfers activation to the real isolated Room and owns one player per remote track', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media, service.peer);
    try {
      await joinAudio(running);
      const mediaPage = running.application.windows().find((page) => page !== running.page)!;
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).audioReceiving).toBe(true);
      await expect(mediaPage.locator('audio')).toHaveCount(0);
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
          const original = globalThis.babacomEnableAudio;
          globalThis.__playbackActivations = [];
          globalThis.babacomEnableAudio = (command) => {
            globalThis.__playbackActivations.push(navigator.userActivation.isActive);
            original(command);
          };
          void 0;
        ` }]);
      });
      await running.page.getByRole('button', { name: '启用声音', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).playback).toBe('on');
      await expect(mediaPage.locator('audio')).toHaveCount(1);
      expect(await mediaPage.locator('audio').evaluate((element: HTMLAudioElement) => ({ paused: element.paused, muted: element.muted, stream: Boolean(element.srcObject) })))
        .toEqual({ paused: false, muted: false, stream: true });
      expect(await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        return contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'JSON.stringify(globalThis.__playbackActivations)' }]);
      })).toBe('[true]');
      const id = (await running.page.evaluate(() => window.media.getSnapshot())).sessionId!;
      await running.page.evaluate((id) => window.media.enableAudio(id), id);
      await expect(mediaPage.locator('audio')).toHaveCount(1);
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off' });
      await running.page.getByRole('button', { name: '离开语音房间' }).click();
      await expect(running.page.getByLabel('展示昵称')).toBeVisible();
      expect(mediaPage.isClosed()).toBe(true);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 duplicate and old remote tracks cannot remove replacements or revive playback', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await joinAudio(running);
      const result = await running.application.evaluate(async ({ BrowserWindow }, source) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        return contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
          (async () => {
            const make = ${source};
            const events = [];
            const receiver = make((value) => events.push(value));
            const track = () => {
              let element;
              return { sid: 'duplicate-track',
                attach() { element = document.createElement('audio'); return element; },
                detach() { return element ? [element] : []; },
                getReceiverStats: async () => ({ bytesReceived: 1 }),
                get element() { return element; },
              };
            };
            const old = track(); const replacement = track();
            receiver.add(old); receiver.add(old);
            const beforeEnable = document.querySelectorAll('audio').length;
            await receiver.enable(async () => {}, () => true);
            receiver.add(old);
            const afterDuplicate = document.querySelectorAll('audio').length;
            receiver.add(replacement); receiver.add(replacement); receiver.remove(old);
            const replacementPreserved = replacement.element.isConnected && !old.element.isConnected;
            const afterOldUnsubscribe = document.querySelectorAll('audio').length;
            receiver.clear();
            const cleaned = [old, replacement].every((value) => !value.element.isConnected && value.element.paused && value.element.srcObject === null);
            let releaseStats; let started;
            const inspecting = new Promise((resolve) => { started = resolve; });
            const late = track();
            late.getReceiverStats = () => { started(); return new Promise((resolve) => { releaseStats = resolve; }); };
            receiver.add(late);
            await inspecting;
            receiver.clear();
            releaseStats({ bytesReceived: 1 });
            await new Promise((resolve) => setTimeout(resolve, 0));
            let releaseStart;
            receiver.add(track());
            const pending = receiver.enable(() => new Promise((resolve) => { releaseStart = resolve; }), () => true);
            receiver.clear(); releaseStart();
            const lateEnable = await pending;
            return { beforeEnable, afterDuplicate, replacementPreserved, afterOldUnsubscribe, cleaned,
              lateReceiving: events.includes(true), lateEnable, players: document.querySelectorAll('audio').length };
          })()
        ` }]);
      }, createAudioReceiver.toString());
      expect(result).toEqual({ beforeEnable: 0, afterDuplicate: 1, replacementPreserved: true,
        afterOldUnsubscribe: 1, cleaned: true, lateReceiving: false, lateEnable: false, players: 0 });
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off', playback: 'off' });
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 native permission checks and requests allow repeated audio checks only within the approved capture transaction', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await running.application.evaluate(({ session }) => {
        const prototype = Object.getPrototypeOf(session.defaultSession);
        const handlers = new Map();
        Reflect.set(globalThis, '__permissionHandlers', handlers);
        for (const name of ['setPermissionCheckHandler', 'setPermissionRequestHandler']) {
          const original = Reflect.get(prototype, name);
          Reflect.set(prototype, name, function (this: unknown, callback: unknown) {
            const entry = handlers.get(this) ?? {};
            entry[name] = callback; handlers.set(this, entry);
            return Reflect.apply(original, this, [callback]);
          });
        }
      });
      await joinAudio(running);
      await simulateCapture(running, 'late');
      const permissions = () => running.application.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        const ui = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().endsWith('/media.html'))!.webContents;
        const handlers = Reflect.get(globalThis, '__permissionHandlers').get(contents.session);
        const check = handlers.setPermissionCheckHandler;
        const request = handlers.setPermissionRequestHandler;
        const details = { isMainFrame: true, requestingUrl: contents.getURL(), mediaType: 'audio' };
        const requestDetails = { isMainFrame: true, requestingUrl: contents.getURL(), mediaTypes: ['audio'] };
        const query = (owner = contents, permission = 'media', value = details) => check(owner, permission, 'file://', value);
        const ask = (value = requestDetails) => {
          let result: boolean | null = null;
          request(contents, 'media', (allowed: boolean) => { result = allowed; }, value);
          return result;
        };
        return {
          audio: [query(), query(), ask(), ask()],
          denied: [query(ui), query(contents, 'display-capture'), query(contents, 'unknown'),
            query(contents, 'media', { ...details, isMainFrame: false }),
            query(contents, 'media', { ...details, requestingUrl: 'about:blank' }),
            query(contents, 'media', { ...details, mediaType: 'video' }),
            query(contents, 'media', { ...details, mediaType: 'unknown' }),
            ask({ ...requestDetails, mediaTypes: ['audio', 'video'] }),
            ask({ ...requestDetails, mediaTypes: [] })],
        };
      });
      expect((await permissions()).audio).toEqual([false, false, false, false]);
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await captureProbe(running)).pending).toBe(true);
      expect(await permissions()).toEqual({ audio: [true, true, true, true], denied: Array(9).fill(false) });
      expect(await running.page.evaluate(async () => {
        try { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'allowed'; }
        catch { return 'denied'; }
      })).toBe('denied');
      await running.page.getByRole('button', { name: '取消开麦', exact: true }).click();
      expect((await permissions()).audio).toEqual([false, false, false, false]);
      expect((await service.command('inspect')).participants[0].tracks).toBe(0);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 the real 30-second capture deadline stops a late SDK track without a publication', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await joinAudio(running);
      await simulateCapture(running, 'late');
      await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
      await expect.poll(async () => (await captureProbe(running)).pending).toBe(true);
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone,
        { timeout: 32_000, intervals: [250] }).toBe('off');
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.__releaseCapture()' }]);
      });
      await expect.poll(async () => (await captureProbe(running)).stopped).toBe(1);
      expect(await captureProbe(running)).toMatchObject({ active: 0 });
      expect((await service.command('inspect')).participants[0].tracks).toBe(0);
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'connected', microphone: 'off' });
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('T2-03 blocked playback leaves microphone off and a later explicit click recovers with one player', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media, service.peer);
    try {
      await joinAudio(running);
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).audioReceiving).toBe(true);
      const mediaPage = running.application.windows().find((page) => page !== running.page)!;
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
          globalThis.__originalAudioPlay = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('Test playback blocked', 'NotAllowedError'));
          void 0;
        ` }]);
      });
      await running.page.getByRole('button', { name: '启用声音', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).playback).toBe('blocked');
      await expect(mediaPage.locator('audio')).toHaveCount(0);
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off' });
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))!.webContents;
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'HTMLMediaElement.prototype.play = globalThis.__originalAudioPlay; void 0;' }]);
      });
      await running.page.getByRole('button', { name: '启用声音', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).playback).toBe('on');
      await expect(mediaPage.locator('audio')).toHaveCount(1);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const operation of ['remove', 'stop-sfu', 'window-close'] as const) {
  test('T2-03 live capture terminates and destroys its context after ' + operation, async () => {
    const service = await startRealMediaService();
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await joinAudio(running);
        await simulateCapture(running);
        await running.page.getByRole('button', { name: '开启麦克风', exact: true }).click();
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).microphone).toBe('on');
        const mediaPage = running.application.windows().find((page) => page !== running.page)!;
        if (operation === 'window-close') await running.application.close();
        else {
          await service.command(operation);
          await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
            { timeout: 10_000 }).toBe('failed');
          expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ microphone: 'off', playback: 'off' });
        }
        expect(mediaPage.isClosed()).toBe(true);
        if (operation !== 'stop-sfu') await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
        expect(running.browserCredentialLeak()).toBe(false);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('real finite session enters and leaves SFU muted, preserves identity after rename, and refuses reissue after revocation', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      let identity: string | undefined;
      for (const name of ['真实准入玩家', '更改显示昵称']) {
        await prepare(running, name);
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        const region = running.page.getByRole('region', { name: '语音房间' });
        await expect(region.getByRole('status')).toContainText('已进入语音房间', { timeout: 30_000 });
        const snapshot = await running.page.evaluate(() => window.media.getSnapshot());
        const local = snapshot.members.find((member) => member.isLocal);
        expect(local?.displayName).toBe(name);
        expect(snapshot.microphone).toBe('off');
        expect(snapshot.playback).toBe('off');
        if (identity) expect(local?.identity).toBe(identity);
        else identity = local?.identity;
        expect(identity).toBeTruthy();
        expect((await service.command('inspect')).participants).toEqual([{ identity, tracks: 0 }]);
        expect((await service.command('inspect-room-b')).participants).toEqual([]);
        await running.page.getByRole('button', { name: '离开语音房间' }).click();
        await expect(running.page.getByLabel('展示昵称')).toBeVisible();
        await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
      }
      await service.command('revoke-subject');
      await running.page.getByLabel('展示昵称').fill('撤销后玩家');
      await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
      await expect(running.page.getByRole('status')).toContainText('会话无效');
      expect(await running.page.evaluate(() => window.media.join())).toMatchObject({ code: 'NOT_PREPARED' });
      expect(running.application.windows()).toHaveLength(1);
      expect((await service.command('inspect')).participants).toEqual([]);
      expect(service.responses()).toEqual([200, 200, 401]);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test.describe.configure({ timeout: 90_000 });

for (const scenario of ['expired-session', 'revoked-session', 'unauthorized-room', 'missing-action']) {
  test('real finite admission refuses ' + scenario + ' before creating a media context', async () => {
    const service = await startRealMediaService(scenario);
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await running.page.getByLabel('展示昵称').fill('真实拒绝用例');
        await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
        const unauthenticated = scenario === 'expired-session' || scenario === 'revoked-session';
        await expect(running.page.getByRole('status')).toContainText(unauthenticated ? '会话无效' : '没有进入这个房间的权限');
        expect(service.responses()).toEqual([unauthenticated ? 401 : 403]);
        expect(await running.page.evaluate(() => window.media.join())).toMatchObject({ code: 'NOT_PREPARED' });
        expect(running.application.windows()).toHaveLength(1);
        expect((await service.command('inspect')).participants).toEqual([]);
        expect((await service.command('inspect-room-b')).participants).toEqual([]);
        expect(running.browserCredentialLeak()).toBe(false);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('real finite admission UI preserves six room tickets per rolling minute', async () => {
  const service = await startRealMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      for (let index = 0; index < 6; index++) {
        await prepare(running, '额度玩家' + index);
        await running.page.getByRole('button', { name: '取消准备', exact: true }).click();
        await expect(running.page.getByRole('status')).not.toContainText('准备完成');
      }
      await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
      await expect(running.page.getByRole('status')).toContainText('请求过快');
      expect(service.responses()).toEqual([200, 200, 200, 200, 200, 200, 429]);
      expect(await running.page.evaluate(() => window.media.join())).toMatchObject({ code: 'NOT_PREPARED' });
      expect(running.application.windows()).toHaveLength(1);
      expect((await service.command('inspect')).participants).toEqual([]);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const scenario of ['valid', 'bad-signature', 'expired', 'tampered-room-b']) {
  test('real admission HTTP ticket at actual SFU: ' + scenario, async () => {
    const service = await startRealMediaService(scenario === 'expired' ? 'expired-ticket' : 'ready');
    let application: ElectronApplication | null = null;
    let pipe: Awaited<ReturnType<typeof startStartupPipe>> | null = null;
    try {
      const ticket = await service.command('ticket');
      expect(ticket.status).toBe(200);
      const credentials: AdmissionSuccess = { ...ticket.credentials };
      const segments = credentials.accessToken.split('.');
      const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
      expect(claims.video.room).toBe('t1-room');
      expect(claims.exp - claims.nbf).toBe(120);
      expect(claims.sub).toBe(credentials.participantIdentity);
      if (scenario === 'bad-signature') {
        credentials.accessToken = segments[0] + '.' + segments[1] + '.'
          + (segments[2][0] === 'A' ? 'B' : 'A') + segments[2].slice(1);
      } else if (scenario === 'tampered-room-b') {
        // This is a real attempt to change the authorized room, retaining A's signature.
        claims.video.room = 't2-ungranted-room';
        credentials.roomName = 't2-ungranted-room';
        credentials.accessToken = segments[0] + '.'
          + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.' + segments[2];
      }
      pipe = await startStartupPipe(credentials);
      application = await electron.launch({ args: [
        join(desktop, '../../tests/voice/sfu-peer.cjs'), '--peer-pipe=' + pipe.path, '--peer-header-auth',
      ] });
      const page = await application.firstWindow();
      let leaked = false;
      const inspect = (text: string) => { leaked ||= /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text); };
      page.on('console', (message) => inspect(message.text()));
      page.on('pageerror', (error) => inspect(error.message));
      const protocol = await page.context().newCDPSession(page);
      protocol.on('Log.entryAdded', ({ entry }: { entry: { text: string } }) => inspect(entry.text));
      protocol.on('Network.webSocketCreated', ({ url }: { url: string }) => inspect(url));
      await protocol.send('Log.enable');
      await protocol.send('Network.enable');
      await expect(page.locator('#status')).toHaveText(scenario === 'valid' ? 'connected' : 'failed',
        { timeout: 30_000 });
      if (scenario === 'valid') {
        expect((await service.command('inspect')).participants).toEqual([
          { identity: credentials.participantIdentity, tracks: 0 },
        ]);
      } else {
        expect((await service.command('inspect')).participants).toEqual([]);
      }
      expect((await service.command('inspect-room-b')).participants).toEqual([]);
      expect(leaked, 'SFU refusal diagnostics and URLs must contain no real JWT').toBe(false);
      expect(service.responses()).toEqual([200]);
    } finally {
      await application?.close();
      await pipe?.close();
      await service.close();
    }
  });
}


async function launch(configuration: StartupConfiguration, mediaConfiguration: MediaStartup | null = null, peerConfiguration: AdmissionSuccess | null = null) {
  const packaged = test.info().project.name === 'packaged';
  const owner = createStartupCleanup();
  let renderer: Awaited<ReturnType<typeof startRenderer>> | null = null;
  let stage = 'RENDERER';
  const own = async (application: ElectronApplication) => {
    const item = { application, closed: false };
    application.on('close', () => { item.closed = true; });
    await owner.own('DRIVER', async () => { if (!item.closed) await application.close(); });
  };
  let diagnostics = '';
  const close = () => owner.close();
  try {
    renderer = packaged ? null : await startRenderer();
    if (renderer) await owner.own('RENDERER', () => renderer!.close());
    stage = 'PIPE';
    const startup = await startStartupPipe(configuration);
    await owner.own('PIPE', () => startup.close());
    const mediaStartup = mediaConfiguration ? await startStartupPipe(mediaConfiguration) : null;
    if (mediaStartup) await owner.own('PIPE', () => mediaStartup.close());
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) environment[key] = value;
    delete environment.BABACOM_RENDERER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    if (renderer) environment.BABACOM_RENDERER_URL = renderer.url;
    if (packaged) {
      environment.PATH = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
      delete environment.NODE_OPTIONS;
      delete environment.NODE_PATH;
    }
    stage = 'DRIVER';
    const application = await electron.launch({
      executablePath: packaged ? join(desktop, 'build/windows/win-unpacked/BabaCom.exe') : undefined,
      args: [...(packaged ? [] : [join(desktop, 'dist/main/main.cjs')]), '--babacom-startup-pipe=' + startup.path,
        ...(mediaStartup ? ['--babacom-media-pipe=' + mediaStartup.path] : [])],
      env: environment,
    });
    await own(application);
    application.process().stdout?.on('data', (chunk) => { diagnostics += String(chunk); });
    application.process().stderr?.on('data', (chunk) => { diagnostics += String(chunk); });
    stage = 'WINDOW';
    const page = await application.firstWindow();
    stage = 'UI';
    let browserCredentialLeak = false;
    const inspectDiagnostic = (text: string) => {
      browserCredentialLeak ||= text.includes(configuration.applicationSession)
        || /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text);
    };
    let diagnosticProbeFailed = false;
    const observeDiagnostics = async (page: Page) => {
      page.on('console', (message) => inspectDiagnostic(message.text()));
      page.on('pageerror', (error) => inspectDiagnostic(error.message));
      const protocol = await page.context().newCDPSession(page);
      protocol.on('Log.entryAdded', ({ entry }: { entry: { text: string } }) => inspectDiagnostic(entry.text));
      protocol.on('Network.webSocketCreated', ({ url }: { url: string }) => inspectDiagnostic(url));
      await protocol.send('Log.enable');
      await protocol.send('Network.enable');
    };
    application.on('window', (page) => {
      void observeDiagnostics(page).catch(() => { if (!page.isClosed()) diagnosticProbeFailed = true; });
    });
    await observeDiagnostics(page);
    if (packaged) {
      expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true);
      expect(new URL(page.url()).protocol).toBe('file:');
    }
    let peer: ElectronApplication | null = null;
    if (peerConfiguration) {
      stage = 'PIPE';
      const pipe = await startStartupPipe(peerConfiguration);
      await owner.own('PIPE', () => pipe.close());
      stage = 'DRIVER';
      peer = await electron.launch({ args: [join(desktop, '../../tests/voice/sfu-peer.cjs'), '--peer-pipe=' + pipe.path] });
      await own(peer);
      stage = 'WINDOW';
      const peerPage = await peer.firstWindow();
      stage = 'UI';
      await expect(peerPage.locator('#status')).toHaveText('connected', { timeout: 15_000 });
      await peerPage.getByRole('button', { name: 'Start synthetic audio' }).click();
      await expect(peerPage.locator('#status')).toHaveText('publishing', { timeout: 10_000 });
    }
    return { application, page, peer, diagnostics: () => diagnostics, browserCredentialLeak: () => {
      if (diagnosticProbeFailed) throw new Error('Native browser diagnostic probe failed');
      return browserCredentialLeak;
    }, close };
  } catch (error) { return owner.fail(stage, error); }
}


async function observeMediaCalls(application: ElectronApplication, targetId?: number) {
  const id = targetId ?? await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.id);
  await application.evaluate(async ({ BrowserWindow }, id) => {
    const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents;
    if (!contents) throw new Error('Missing observed context');
    await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
      (() => {
        const calls = { enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 };
        for (const name of Object.keys(calls)) {
          const original = navigator.mediaDevices[name].bind(navigator.mediaDevices);
          navigator.mediaDevices[name] = (...args) => { calls[name]++; return original(...args); };
        }
        globalThis.__mediaTestCalls = calls;
      })()
    ` }]);
  }, id);
  return () => application.evaluate(async ({ BrowserWindow }, id) => {
    const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents;
    if (!contents) throw new Error('Observed context has been destroyed');
    return contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'JSON.stringify(globalThis.__mediaTestCalls)' }]);
  }, id);
}

async function prepare(running: Awaited<ReturnType<typeof launch>>, name = '测试玩家') {
  await running.page.getByLabel('展示昵称').fill(name);
  await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
  await expect(running.page.getByRole('status')).toContainText('准备完成');
}

test('isolated media context connects without granting UI native SFU authentication', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      const uiCalls = await observeMediaCalls(running.application);
      await prepare(running);
      expect(JSON.parse(await uiCalls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
      expect(running.application.windows()).toHaveLength(1);
      expect((await service.command('inspect')).participants).toEqual([]);
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      const region = running.page.getByRole('region', { name: '语音房间' });
      await expect(region.getByRole('status')).toContainText('已进入语音房间', { timeout: 30_000 });
      expect(await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.webContents.id))).toHaveLength(2);
      await expect(region.getByRole('list', { name: '房间成员' })).toBeVisible();
      await expect(region.getByRole('listitem')).toHaveCount(1);
      const preferences = await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => {
          const read = Reflect.get(window.webContents, 'getLastWebPreferences');
          if (typeof read !== 'function') throw new Error('Missing native preferences');
          const value = Reflect.apply(read, window.webContents, []);
          if (!value || typeof value !== 'object') throw new Error('Invalid native preferences');
          return { isolation: Reflect.get(value, 'contextIsolation'), sandbox: Reflect.get(value, 'sandbox'),
            node: Reflect.get(value, 'nodeIntegration'), security: Reflect.get(value, 'webSecurity'),
            hidden: !window.isVisible(), media: window.webContents.getURL().endsWith('/media.html'),
            independentSession: BrowserWindow.getAllWindows().every((other) =>
              other === window || other.webContents.session !== window.webContents.session),
            stored: Boolean(window.webContents.session.getStoragePath()) };
        }));
      expect(preferences).toHaveLength(2);
      for (const value of preferences) expect(value).toMatchObject({
        isolation: true, sandbox: true, node: false, security: true, stored: false, independentSession: true,
      });
      expect(preferences.find((value) => value.media)).toMatchObject({ hidden: true });
      const unauthorized = await running.page.evaluate(async (base) =>
        (await fetch(new URL('/rtc/validate', base))).status,
      service.media.sfuBase.replace(/^ws:/, 'http:')).catch(() => 'blocked');
      expect([401, 'blocked']).toContain(unauthorized);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('real SFU refresh followed by failure never exposes JWT in media URLs or Chromium logs', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await prepare(running);
      const created = running.application.waitForEvent('window');
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      const mediaPage = await created;
      let refreshed = false;
      let credentialLeak = false;
      const inspect = (text: string) => { credentialLeak ||= /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text); };
      mediaPage.on('console', (message) => inspect(message.text()));
      mediaPage.on('pageerror', (error) => inspect(error.message));
      const protocol = await mediaPage.context().newCDPSession(mediaPage);
      protocol.on('Log.entryAdded', ({ entry }: { entry: { text: string } }) => inspect(entry.text));
      protocol.on('Network.webSocketCreated', ({ url }: { url: string }) => inspect(url));
      protocol.on('Network.webSocketFrameReceived', ({ response }: { response: { opcode: number; payloadData: string } }) => {
        if (response.opcode !== 2) return;
        try {
          const message = SignalResponse.fromBinary(Buffer.from(response.payloadData, 'base64')).message;
          if (message.case === 'refreshToken') {
            const token = message.value;
            const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
            refreshed = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(token)
              && claims.sub.startsWith('member-') && claims.video.room === service.configuration.roomName;
          }
        } catch { /* A non-signal frame is not refresh evidence. */ }
      });
      await protocol.send('Log.enable');
      await protocol.send('Network.enable');
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
        { timeout: 30_000 }).toBe('connected');
      await service.command('refresh');
      await expect.poll(() => refreshed, { timeout: 15_000 }).toBe(true);
      await service.command('stop-sfu');
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
        { timeout: 15_000 }).toBe('failed');
      expect(mediaPage.isClosed()).toBe(true);
      expect(credentialLeak, 'Real SFU refresh then failure must leave all native diagnostics free of JWT').toBe(false);
      expect(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(running.diagnostics())).toBe(false);
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const failure of ['crash', 'paused-runtime']) {
  test('isolated media ' + failure + ' destroys owned context within the cleanup budget', async () => {
    const service = await startMediaService();
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await prepare(running);
        const created = running.application.waitForEvent('window');
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        const mediaPage = await created;
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 30_000 }).toBe('connected');
        const id = await running.application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))?.webContents.id);
        if (!id) throw new Error('Missing isolated context');
        const protocol = await mediaPage.context().newCDPSession(mediaPage);
        if (failure === 'paused-runtime') {
          await protocol.send('Debugger.enable');
          await protocol.send('Debugger.pause');
        }
        const started = Date.now();
        if (failure === 'crash') {
          await running.application.evaluate(({ BrowserWindow }, id) => {
            BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents.forcefullyCrashRenderer();
          }, id);
        } else {
          const leaving = await running.page.evaluate(async () => {
            const snapshot = await window.media.getSnapshot();
            if (!snapshot.sessionId) throw new Error('Missing session');
            return window.media.leave(snapshot.sessionId);
          });
          expect(leaving.status).toBe('leaving');
        }
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 5_000, intervals: [25, 50] }).toBe(failure === 'crash' ? 'failed' : 'idle');
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(mediaPage.isClosed()).toBe(true);
        expect(running.page.isClosed()).toBe(false);
        // Abrupt renderer death cannot send an SDK leave; the SFU reclaims its
        // participant after transport failure detection. The local 5s assertion above
        // remains independent of this server-owned record.
        await expect.poll(async () => (await service.command('inspect')).participants.length,
          { timeout: failure === 'crash' ? 25_000 : 5_000 }).toBe(0);
        expect(service.requests()).toBe(1);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

for (const attempt of ['ordinary', 'child']) {
test('native media authentication is confined to the current approved frame and GET routes: ' + attempt, async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await running.application.evaluate(({ app, ipcMain }, base) => {
        // Delay only the genuine SDK acknowledgement, keeping initial main-owned
        // authorization live while negative requests exercise the native guard.
        const listeners = ipcMain.listeners('media:runtime');
        let held: unknown[] | null = null;
        ipcMain.removeAllListeners('media:runtime');
        const forward = (...args: unknown[]) => {
          if (Reflect.get(Object(args[1]), 'type') === 'connected') { held = args; return; }
          for (const listener of listeners) Reflect.apply(listener, ipcMain, args);
        };
        ipcMain.on('media:runtime', forward);
        Reflect.set(globalThis, '__releaseConnected', () => {
          ipcMain.removeListener('media:runtime', forward);
          for (const listener of listeners) ipcMain.on('media:runtime', (...args) => Reflect.apply(listener, ipcMain, args));
          if (!held) throw new Error('Missing real SDK acknowledgement');
          for (const listener of listeners) Reflect.apply(listener, ipcMain, held);
        });
        Reflect.set(globalThis, '__hasConnected', () => Boolean(held));
        const requests: { method: string; path: string; owner: number | undefined; authorized: boolean }[] = [];
        Reflect.set(globalThis, '__nativeMediaRequests', requests);
        app.on('web-contents-created', (_event, contents) => {
          contents.session.webRequest.onSendHeaders((details) => {
            const url = new URL(details.url);
            if (url.host !== new URL(base).host) return;
            requests.push({ method: details.method, path: url.pathname, owner: details.webContentsId,
              authorized: Object.entries(details.requestHeaders).some(([key, value]) => key.toLowerCase() === 'authorization' && Boolean(value)) });
          });
        });
      }, service.media.sfuBase);
      await prepare(running);
      const created = running.application.waitForEvent('window');
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      const mediaPage = await created;
      await expect.poll(() => running.application.evaluate(() => Reflect.get(globalThis, '__hasConnected')()),
        { timeout: 15_000 }).toBe(true);
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'connecting' });
      expect(await mediaPage.evaluate(async (base) => (await fetch(new URL('/rtc/validate', base))).status,
        service.media.sfuBase.replace(/^ws:/, 'http:'))).toBe(200);
      expect(await running.page.evaluate(async (base) => {
        try { return (await fetch(new URL('/rtc/validate', base))).status; } catch { return 'blocked'; }
      }, service.media.sfuBase.replace(/^ws:/, 'http:'))).toBe('blocked');
      const owned = await running.application.browserWindow(mediaPage).then((window) => window.evaluate((window) => window.webContents.id));
      const requests = await running.application.evaluate(() => Reflect.get(globalThis, '__nativeMediaRequests'));
      expect(requests.some((request: { authorized: boolean }) => request.authorized)).toBe(true);
      expect(requests.filter((request: { authorized: boolean }) => request.authorized).every(
        (request: { method: string; path: string; owner: number }) => request.owner === owned && request.method === 'GET'
          && ['/rtc', '/rtc/v1', '/rtc/validate', '/rtc/v1/validate'].includes(request.path))).toBe(true);
      for (const operation of ['unknown-path', 'post']) {
        const outcome = await mediaPage.evaluate(async ({ base, operation }) => {
          try {
            const response = await fetch(new URL(operation === 'unknown-path' ? '/unapproved' : '/rtc/validate', base),
              { method: operation === 'post' ? 'POST' : 'GET' });
            return response.status;
          } catch { return 'blocked'; }
        }, { base: service.media.sfuBase.replace(/^ws:/, 'http:'), operation });
        expect(outcome).toBe('blocked');
      }
      const foreignCreated = running.application.waitForEvent('window');
      await running.application.evaluate(async ({ BrowserWindow }, id) => {
        const owner = BrowserWindow.getAllWindows().find((window) => window.webContents.id === id);
        if (!owner) throw new Error('Missing media owner');
        const foreign = new BrowserWindow({ show: false, webPreferences: {
          session: owner.webContents.session, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
        } });
        await foreign.loadURL(owner.webContents.getURL());
      }, owned);
      const foreign = await foreignCreated;
      expect(await foreign.evaluate(async (base) => {
        try { return (await fetch(new URL('/rtc/validate', base))).status; } catch { return 'blocked'; }
      }, service.media.sfuBase.replace(/^ws:/, 'http:'))).toBe('blocked');
      await running.application.browserWindow(foreign).then((window) => window.evaluate((window) => window.destroy()));
      if (attempt === 'child') {
        const authorizedBefore = await running.application.evaluate(() =>
          Reflect.get(globalThis, '__nativeMediaRequests').filter((request: { authorized: boolean }) => request.authorized).length);
        await mediaPage.evaluate(() => {
          const frame = document.createElement('iframe');
          frame.name = 'native-frame-probe';
          document.body.append(frame);
        }).catch((error) => { if (!mediaPage.isClosed()) throw error; });
        const child = mediaPage.frame({ name: 'native-frame-probe' });
        if (child && !mediaPage.isClosed()) {
          expect(child.url()).toBe('about:blank');
          const outcome = await child.evaluate(async (base) => {
            try { return (await fetch(new URL('/rtc/validate', base))).status; }
            catch { return 'blocked'; }
          }, service.media.sfuBase.replace(/^ws:/, 'http:')).catch((error) => {
            if (mediaPage.isClosed() || child.isDetached()) return 'closed';
            throw error;
          });
          expect(['blocked', 'closed']).toContain(outcome);
        }
        await expect.poll(() => mediaPage.isClosed(), { timeout: 5_000 }).toBe(true);
        expect(await running.page.evaluate(() => window.media.getSnapshot()))
          .toMatchObject({ status: 'failed', code: 'CONNECT_FAILED', sessionId: null });
        const authorizedAfter = await running.application.evaluate(() =>
          Reflect.get(globalThis, '__nativeMediaRequests').filter((request: { authorized: boolean }) => request.authorized).length);
        expect(authorizedAfter).toBe(authorizedBefore);
        // A genuine late acknowledgement from the destroyed domain cannot restore it.
        await running.application.evaluate(() => Reflect.get(globalThis, '__releaseConnected')());
        expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'failed', sessionId: null });
        await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
        expect(running.application.windows()).toHaveLength(1);
        expect(running.browserCredentialLeak()).toBe(false);
        return;
      }
      await running.application.evaluate(() => Reflect.get(globalThis, '__releaseConnected')());
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status).toBe('connected');
      expect(await mediaPage.evaluate(async (base) => {
        try { return (await fetch(new URL('/rtc/validate', base))).status; } catch { return 'blocked'; }
      }, service.media.sfuBase.replace(/^ws:/, 'http:'))).toBe(401);
      expect(await mediaPage.evaluate(() => {
        const entries = [localStorage, sessionStorage].flatMap((storage) =>
          Object.keys(storage).map((key) => key + '=' + storage.getItem(key)));
        return entries.some((value) => /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(value));
      })).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});
}

test('real ICE candidate pairs and received media use the approved loopback SFU', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media, service.peer);
    try {
      await prepare(running);
      const created = running.application.waitForEvent('window');
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      const mediaPage = await created;
      const protocol = await mediaPage.context().newCDPSession(mediaPage);
      const contexts: number[] = [];
      protocol.on('Runtime.executionContextCreated', ({ context }: { context: { id: number } }) => contexts.push(context.id));
      await protocol.send('Runtime.enable');
      await expect(running.page.getByText('已收到远端音频数据（尚未播放）', { exact: true })).toBeVisible({ timeout: 30_000 });
      const stats: { selected: { address: string; port: number; bytesReceived: number }[];
        remote: { address: string; port: number }[] } = { selected: [], remote: [] };
      for (const contextId of contexts) {
        const prototype = await protocol.send('Runtime.evaluate', { expression: 'RTCPeerConnection.prototype', contextId });
        if (!prototype.result.objectId) continue;
        const peers = await protocol.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId });
        const result = await protocol.send('Runtime.callFunctionOn', { objectId: peers.objects.objectId,
          awaitPromise: true, returnByValue: true, functionDeclaration: `async function () {
            const selected = [];
            const remote = [];
            for (const peer of this) {
              const report = await peer.getStats();
              report.forEach((stat) => {
                if (stat.type === 'remote-candidate') remote.push({ address: stat.address, port: stat.port, protocol: stat.protocol });
                if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
                  const candidate = report.get(stat.remoteCandidateId);
                  selected.push({ address: candidate.address, port: candidate.port,
                    protocol: candidate.protocol, bytesReceived: stat.bytesReceived });
                }
              });
            }
            return { selected, remote };
          }` });
        if (result.exceptionDetails) throw new Error('Cannot observe native RTC statistics');
        stats.selected.push(...result.result.value.selected);
        stats.remote.push(...result.result.value.remote);
      }
      expect(stats.remote.length).toBeGreaterThan(0);
      expect(stats.selected.length).toBeGreaterThan(0);
      expect(stats.remote.every((candidate: { address: string; port: number }) =>
        candidate.address === '127.0.0.1' && candidate.port > 0)).toBe(true);
      expect(stats.selected.every((candidate: { address: string }) => candidate.address === '127.0.0.1')).toBe(true);
      expect(stats.selected.some((candidate: { bytesReceived: number }) => candidate.bytesReceived > 0)).toBe(true);
      console.log('Observed media destinations:', JSON.stringify(stats));
      expect(running.browserCredentialLeak()).toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const fault of ['fallback', 'redirect', 'timeout']) {
  test('real SDK validate handles forced ' + fault + ' without broadening native authentication', async () => {
    const service = await startMediaService();
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await running.application.evaluate(({ app }, { base, fault }) => {
          const observation = { validateRequested: false, fallbackAuthorized: false, redirectSent: false, probeFailed: false };
          Reflect.set(globalThis, '__networkFaultObservation', observation);
          app.on('web-contents-created', (_event, contents) => {
            contents.session.webRequest.onSendHeaders((details) => {
              const url = new URL(details.url);
              if (url.host !== new URL(base).host) return;
              const authorized = Object.keys(details.requestHeaders).some((key) => key.toLowerCase() === 'authorization');
              if (url.pathname === '/rtc' && authorized) observation.fallbackAuthorized = true;
              if (url.searchParams.has('controlled-redirect')) observation.redirectSent = true;
            });
            contents.debugger.attach('1.3');
            contents.debugger.on('message', (_event, method, params) => {
              if (method === 'Runtime.executionContextCreated' && params.context.name === 'Electron Isolated Context') {
                // Close the real browser transport during CONNECTING. The unmodified
                // SDK must issue its own validate request and protocol fallback.
                void contents.debugger.sendCommand('Runtime.evaluate', { contextId: params.context.id, expression: `
                  (() => {
                    const Native = WebSocket;
                    globalThis.WebSocket = new Proxy(Native, {
                      construct(target, args) {
                        const socket = Reflect.construct(target, args);
                        if (new URL(args[0]).pathname === '/rtc/v1') socket.close();
                        return socket;
                      },
                    });
                  })()
                ` }).catch(() => { if (!contents.isDestroyed()) observation.probeFailed = true; });
                return;
              }
              if (method !== 'Fetch.requestPaused') return;
              observation.validateRequested = true;
              if (fault === 'timeout') return; // Keep the SDK's real HTTP request pending until the main deadline.
              void contents.debugger.sendCommand('Fetch.fulfillRequest', {
                requestId: params.requestId,
                responseCode: fault === 'fallback' ? 404 : 302,
                responseHeaders: [
                  { name: 'Access-Control-Allow-Origin', value: '*' },
                  { name: 'Content-Type', value: 'text/plain' },
                  ...(fault === 'redirect' ? [{ name: 'Location',
                    value: base.replace(/^ws:/, 'http:') + '/rtc/validate?controlled-redirect=1' }] : []),
                ],
                body: Buffer.from('Controlled network fault').toString('base64'),
              }).catch(() => { if (!contents.isDestroyed()) observation.probeFailed = true; });
            });
            void (async () => {
              await contents.debugger.sendCommand('Network.enable');
              await contents.debugger.sendCommand('Runtime.enable');
              await contents.debugger.sendCommand('Fetch.enable', { patterns: [{
                urlPattern: base.replace(/^ws:/, 'http:') + '/rtc/v1/validate*', requestStage: 'Request',
              }] });
            })().catch(() => { if (!contents.isDestroyed()) observation.probeFailed = true; });
          });
        }, { base: service.media.sfuBase.replace(/\/$/, ''), fault });
        await prepare(running);
        const created = running.application.waitForEvent('window');
        const startedAt = Date.now();
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        const mediaPage = await created;
        await expect.poll(() => running.application.evaluate(() => Reflect.get(globalThis, '__networkFaultObservation').validateRequested),
          { timeout: 15_000 }).toBe(true);
        const expected = fault === 'fallback' ? 'connected' : 'failed';
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 36_000, intervals: [100] }).toBe(expected);
        const observation = await running.application.evaluate(() => Reflect.get(globalThis, '__networkFaultObservation'));
        expect(observation.probeFailed).toBe(false);
        expect(observation.redirectSent).toBe(false);
        if (fault === 'fallback') {
          expect(observation.fallbackAuthorized).toBe(true);
          expect((await service.command('inspect')).participants).toHaveLength(1);
        } else {
          expect(mediaPage.isClosed()).toBe(true);
          expect((await service.command('inspect')).participants).toHaveLength(0);
          expect(await running.page.evaluate(() => window.media.getSnapshot()))
            .toMatchObject({ code: fault === 'timeout' ? 'CONNECT_TIMEOUT' : 'CONNECT_FAILED', sessionId: null });
          if (fault === 'timeout') {
            expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30_000);
            expect(Date.now() - startedAt).toBeLessThan(35_000);
          }
        }
        expect(service.requests()).toBe(1);
        expect(running.browserCredentialLeak()).toBe(false);
        expect(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(running.diagnostics())).toBe(false);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('private media commands reject legacy JWT handoff and undeclared fields', () => {
  const validate = new Ajv({ strict: true }).compile({ ...mediaSessionSchema, $ref: '#/$defs/runtimeCommand' });
  const start = { type: 'start', sessionId: '00000000-0000-4000-8000-000000000000',
    livekitUrl: 'ws://127.0.0.1:7880', roomName: 't1-room', participantIdentity: 'member-test' };
  expect(validate(start)).toBe(true);
  expect(validate({ ...start, accessToken: 'legacy-private-token' })).toBe(false);
  expect(validate({ ...start, applicationSession: 'undeclared-session' })).toBe(false);
  expect(validate({ ...start, type: 'publish' })).toBe(false);
  expect(validate({ type: 'stop', sessionId: start.sessionId, tracks: [] })).toBe(false);
});

test('prepared desktop offers an explicit muted media join', async () => {
  const service = await startTestService();
  try {
    const running = await launch(service.configuration);
    try {
      await prepare(running);
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      await expect(running.page.getByRole('region', { name: '语音房间' }).getByRole('status')).toContainText('未提供受控媒体配置');
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'failed', code: 'NOT_CONFIGURED' });
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('sandboxed SDK probe constructs the locked Room without capture', async () => {
  const application = await electron.launch({ args: [join(desktop, '../../tests/voice/sfu-peer.cjs')] });
  try {
    const page = await application.firstWindow();
    await expect(page.locator('#status')).toHaveText('disconnected');
    expect(await application.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const inspect = Reflect.get(contents, 'getLastWebPreferences');
      if (typeof inspect !== 'function') throw new Error('Missing runtime preferences');
      const preferences = Reflect.apply(inspect, contents, []);
      if (!preferences || typeof preferences !== 'object') throw new Error('Invalid runtime preferences');
      return ['contextIsolation', 'sandbox', 'nodeIntegration', 'webSecurity'].map((key) => Reflect.get(preferences, key));
    })).toEqual([true, true, false, true]);
  } finally { await application.close(); }
});

test('isolated locked Room passively enumerates on device change without capture', async () => {
  const application = await electron.launch({ args: [join(desktop, '../../tests/voice/sfu-peer.cjs')] });
  try {
    const page = await application.firstWindow();
    await expect(page.locator('#status')).toHaveText('disconnected');
    const calls = await observeMediaCalls(application);
    await application.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.executeJavaScriptInIsolatedWorld(999,
        [{ code: "navigator.mediaDevices.dispatchEvent(new Event('devicechange'))" }]);
    });
    await expect.poll(async () => JSON.parse(await calls())).toEqual({ enumerateDevices: 1, getUserMedia: 0, getDisplayMedia: 0 });
  } finally { await application.close(); }
});

for (const scenario of ['valid', 'bad-signature', 'expired', 'missing-header', 'ui-validate', 'other-window']) {
  test('native header-auth candidate: ' + scenario, async () => {
    const service = await startMediaService(scenario === 'expired' ? 'expired-peer' : 'ready');
    let application: ElectronApplication | null = null;
    let pipe: Awaited<ReturnType<typeof startStartupPipe>> | null = null;
    try {
      const credentials = { ...service.peer };
      if (scenario === 'bad-signature') {
        const signatureStart = credentials.accessToken.lastIndexOf('.') + 1;
        credentials.accessToken = credentials.accessToken.slice(0, signatureStart)
          + (credentials.accessToken[signatureStart] === 'A' ? 'B' : 'A')
          + credentials.accessToken.slice(signatureStart + 1);
      }
      if (scenario === 'missing-header') credentials.accessToken = 'babacom-no-url-credential';
      pipe = await startStartupPipe(credentials);
      application = await electron.launch({ args: [
        join(desktop, '../../tests/voice/sfu-peer.cjs'), '--peer-pipe=' + pipe.path,
        ...(scenario === 'missing-header' ? [] : ['--peer-header-auth']),
      ] });
      const page = await application.firstWindow();
      let credentialLeak = false;
      const inspect = (text: string) => { credentialLeak ||= /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text); };
      page.on('console', (message) => inspect(message.text()));
      page.on('pageerror', (error) => inspect(error.message));
      const protocol = await page.context().newCDPSession(page);
      protocol.on('Log.entryAdded', ({ entry }: { entry: { text: string } }) => inspect(entry.text));
      await protocol.send('Log.enable');
      const authorized = scenario === 'valid' || scenario === 'ui-validate' || scenario === 'other-window';
      await expect(page.locator('#status')).toHaveText(authorized ? 'connected' : 'failed',
        { timeout: 30_000 });
      if (scenario === 'ui-validate' || scenario === 'other-window') {
        const created = application.waitForEvent('window');
        await application.evaluate(async ({ BrowserWindow }, pageUrl) => {
          const ui = new BrowserWindow({ show: false, webPreferences: {
            contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
          } });
          await ui.loadURL(pageUrl);
        }, page.url());
        const ui = await created;
        const status = await ui.evaluate(async (base) => (await fetch(new URL('/rtc/validate', base))).status,
          credentials.livekitUrl.replace(/^ws:/, 'http:'));
        expect(status, 'A different window cannot use the media context authentication').toBe(401);
      }
      if (authorized) {
        await page.getByRole('button', { name: 'Start synthetic audio' }).click();
        await expect(page.locator('#status')).toHaveText('publishing');
        const observed = await service.command('inspect');
        expect(observed.participants).toEqual([{ identity: credentials.participantIdentity, tracks: 1 }]);
      } else expect((await service.command('inspect')).participants).toEqual([]);
      expect(credentialLeak, 'Native logs and browser console contain no JWT').toBe(false);
    } finally {
      await application?.close();
      await pipe?.close();
      await service.close();
    }
  });
}

test('real SFU membership and synthetic audio survive handoff then leave and rejoin muted', async () => {
  test.setTimeout(210_000);
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media, service.peer);
    try {
      const calls = await observeMediaCalls(running.application);
      await prepare(running);
      expect(JSON.parse(await calls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      const region = running.page.getByRole('region', { name: '语音房间' });
      await expect(region.getByRole('status')).toContainText('已进入语音房间', { timeout: 30_000 });
      await expect(region.getByText('合成参与者', { exact: true })).toBeVisible();
      await expect(region.getByText('麦克风关闭', { exact: true })).toBeVisible();
      await expect(region.getByText('已收到远端音频数据（尚未播放）', { exact: true })).toBeVisible({ timeout: 15_000 });
      const initial = await running.page.evaluate(() => window.media.getSnapshot());
      expect(initial.members).toHaveLength(2);
      expect(initial.microphone).toBe('off');
      expect(initial.playback).toBe('off');
      // The admission component really unmounted. Its cancellation cannot own this room.
      await running.page.evaluate(() => window.admission.cancel());
      expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'connected', sessionId: initial.sessionId });
      const observed = await service.command('inspect');
      expect(observed.participants).toHaveLength(2);
      expect(observed.participants.find((p: { identity: string; tracks: number }) => p.identity === initial.members.find((p) => p.isLocal)?.identity)?.tracks).toBe(0);
      expect(service.requests()).toBe(1);
      const text = await running.page.locator('body').innerText() + running.diagnostics() + service.diagnostics();
      expect(text.includes(service.configuration.applicationSession)).toBe(false);
      expect(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text)).toBe(false);
      expect(await running.page.evaluate(() => Object.keys(window.media).sort())).toEqual([
        'cancelJoin', 'enableAudio', 'getSnapshot', 'join', 'leave', 'setMicrophoneEnabled', 'subscribe',
      ]);
      await running.page.screenshot({ path: join(desktop, 'build/' + test.info().project.name + '-voice-connected.png') });
      // Real wall time exceeds the unchanged 120-second initial ticket lifetime.
      await running.page.waitForTimeout(121_000);
      expect(await running.page.evaluate(() => window.media.getSnapshot()))
        .toMatchObject({ status: 'connected', sessionId: initial.sessionId, audioReceiving: true });
      expect((await service.command('inspect')).participants).toHaveLength(2);
      expect(service.requests()).toBe(1);
      await running.page.getByRole('button', { name: '离开语音房间' }).click();
      await expect(running.page.getByLabel('展示昵称')).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(1);
      await prepare(running, '重入玩家');
      await running.page.getByRole('button', { name: '加入语音房间' }).click();
      await expect(region.getByRole('status')).toContainText('已进入语音房间', { timeout: 30_000 });
      const current = await running.page.evaluate(() => window.media.getSnapshot());
      expect(current.sessionId).not.toBe(initial.sessionId);
      expect(current.members.find((p) => p.isLocal)?.identity).toBe(initial.members.find((p) => p.isLocal)?.identity);
      expect(current.microphone).toBe('off');
      expect(service.requests()).toBe(2);
      expect(JSON.parse(await calls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
      await running.page.getByRole('button', { name: '离开语音房间' }).click();
      await expect(running.page.getByLabel('展示昵称')).toBeVisible();
    } finally { await running.close(); }
  } finally { await service.close(); }
});
test('bad-signature bridge join keeps browser diagnostics credential-free', async () => {
  const service = await startMediaService('bad-signature');
  try {
    const running = await launch(service.configuration, service.media);
    try {
      expect(await running.page.evaluate(() => window.admission.prepare({
        roomName: window.admission.roomName, displayName: '测试玩家',
      }))).toMatchObject({ status: 'ready' });
      await running.page.evaluate(() => window.media.join());
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
        { timeout: 35_000 }).toBe('failed');
      expect(running.browserCredentialLeak(), 'No credential in browser console or page errors').toBe(false);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const scenario of ['url-mismatch', 'bad-signature']) {
  test('rejects ' + scenario + ' without keeping credentials or an SFU member', async () => {
    const service = await startMediaService(scenario);
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await prepare(running);
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 35_000 }).toBe('failed');
        expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({
          code: scenario === 'url-mismatch' ? 'UNAPPROVED_SFU' : 'CONNECT_FAILED', microphone: 'off',
        });
        expect((await service.command('inspect')).participants).toEqual([]);
        expect(await running.page.evaluate(() => window.media.join())).toMatchObject({ code: 'NOT_PREPARED' });
        expect(service.requests()).toBe(1);
        const visible = await running.page.locator('body').innerText() + running.diagnostics() + service.diagnostics();
        expect(visible.includes(service.configuration.applicationSession)).toBe(false);
        expect(running.browserCredentialLeak(), 'No credential in browser console or page errors').toBe(false);
        expect(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(visible)).toBe(false);
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('deduplicates joins, cancels in-flight connection, and ignores an old leave after reentry', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await prepare(running);
      const cancelled = await running.page.evaluate(async () => {
        const snapshots = await Promise.all([window.media.join(), window.media.join(), window.media.join()]);
        const id = snapshots[0].sessionId;
        if (!id) throw new Error('Missing media session');
        await window.media.cancelJoin(id);
        return { snapshots, id };
      });
      expect(new Set(cancelled.snapshots.map((snapshot) => snapshot.sessionId)).size).toBe(1);
      expect(service.requests()).toBe(1);
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status).toBe('idle');
      await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
      await running.application.evaluate(() => { Reflect.set(globalThis, '__previousMediaSession', null); });
      for (let attempt = 0; attempt < 3; attempt++) {
        await prepare(running, '重入玩家' + attempt);
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 30_000 }).toBe('connected');
        const freshPartition = await running.application.evaluate(({ BrowserWindow }) => {
          const owner = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'));
          if (!owner) throw new Error('Missing current media owner');
          const fresh = Reflect.get(globalThis, '__previousMediaSession') !== owner.webContents.session;
          Reflect.set(globalThis, '__previousMediaSession', owner.webContents.session);
          return fresh;
        });
        expect(freshPartition).toBe(true);
        const joined = await running.page.evaluate(() => window.media.getSnapshot());
        expect(joined.sessionId).not.toBe(cancelled.id);
        expect(await running.page.evaluate((id) => window.media.leave(id), cancelled.id))
          .toMatchObject({ status: 'connected', sessionId: joined.sessionId });
        expect((await service.command('inspect')).participants).toHaveLength(1);
        expect(joined.members).toHaveLength(1);
        expect(joined.microphone).toBe('off');
        await running.page.getByRole('button', { name: '离开语音房间' }).click();
        await expect(running.page.getByLabel('展示昵称')).toBeVisible();
        await expect.poll(async () => (await service.command('inspect')).participants.length).toBe(0);
      }
      expect(service.requests()).toBe(4);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

for (const operation of ['remove', 'stop-sfu']) {
  test('ends after SFU ' + operation + ' without automatic recovery', async () => {
    const service = await startMediaService();
    try {
      const running = await launch(service.configuration, service.media);
      try {
        await prepare(running);
        await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 30_000 }).toBe('connected');
        await service.command(operation);
        await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
          { timeout: 35_000 }).toBe('failed');
        expect(await running.page.evaluate(() => window.media.getSnapshot()))
          .toMatchObject({ code: 'CONNECT_FAILED', sessionId: null, members: [], microphone: 'off' });
        await running.page.waitForTimeout(2_000);
        expect(await running.page.evaluate(() => window.media.getSnapshot())).toMatchObject({ status: 'failed' });
        if (operation === 'remove') expect((await service.command('inspect')).participants).toEqual([]);
        expect(service.requests()).toBe(1);
        expect(await running.page.evaluate(() => window.media.join())).toMatchObject({ code: 'NOT_PREPARED' });
      } finally { await running.close(); }
    } finally { await service.close(); }
  });
}

test('restricts the public media bridge, renderer network, and device permissions', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      expect(await running.page.evaluate(() => Reflect.get(window, 'ipcRenderer'))).toBeUndefined();
      expect(await running.page.evaluate(async () => {
        try { await Reflect.apply(window.media.join, window.media, [{ accessToken: 'unexpected' }]); return 'accepted'; }
        catch { return 'rejected'; }
      })).toBe('rejected');
      expect(await running.page.evaluate(async () => Reflect.apply(window.media.leave, window.media,
        [{ sessionId: '00000000-0000-4000-8000-000000000000' }]))).toMatchObject({ code: 'INVALID_COMMAND' });
      expect(await running.page.evaluate(async (base) => {
        try { await fetch(base.replace('ws:', 'http:') + '/unapproved'); return 'allowed'; }
        catch { return 'blocked'; }
      }, service.media.sfuBase)).toBe('blocked');
      expect(await running.page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
          return 'allowed';
        } catch { return 'denied'; }
      })).toBe('denied');
      expect(service.requests()).toBe(0);
      expect((await service.command('inspect')).participants).toEqual([]);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('quarantines a room whose runtime never acknowledges cleanup', async () => {
  const service = await startMediaService();
  const sent: MediaRuntimeCommand[] = [];
  const session = new MediaSession((command) => sent.push(command), () => undefined);
  try {
    const started = session.join(service.peer);
    if (!started.sessionId) throw new Error('Missing media session');
    session.receive({ type: 'connected', sessionId: started.sessionId, members: [] });
    session.stop(started.sessionId);
    await expect.poll(() => session.snapshot.status, { timeout: 7_000 }).toBe('cleanup-failed');
    session.receive({ type: 'ended', sessionId: started.sessionId });
    session.destroyed(started.sessionId);
    expect(session.join(service.peer)).toMatchObject({ status: 'cleanup-failed', code: 'CLEANUP_FAILED' });
    expect(sent.filter((command) => command.type === 'start')).toHaveLength(1);
  } finally { session.close(); await service.close(); }
});

test('applies the 30-second total connect deadline and rejects late events', async () => {
  const service = await startMediaService();
  const sent: MediaRuntimeCommand[] = [];
  const session = new MediaSession((command) => sent.push(command), () => undefined);
  try {
    const started = session.join(service.peer);
    if (!started.sessionId) throw new Error('Missing media session');
    await expect.poll(() => session.snapshot.status, { timeout: 32_000, intervals: [250] }).toBe('leaving');
    expect(sent.map((command) => command.type)).toEqual(['start', 'stop']);
    session.receive({ type: 'connected', sessionId: started.sessionId, members: [] });
    expect(session.snapshot.status).toBe('leaving');
    session.receive({ type: 'ended', sessionId: started.sessionId });
    expect(session.snapshot.status, 'An SDK cleanup message is not context destruction').toBe('leaving');
    session.destroyed(started.sessionId);
    expect(session.snapshot).toMatchObject({ status: 'failed', code: 'CONNECT_TIMEOUT', sessionId: null });
    session.receive({ type: 'members', sessionId: started.sessionId, members: [] });
    expect(session.snapshot.status).toBe('failed');
  } finally { session.close(); await service.close(); }
});

test('window closure removes the owned SFU member', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      await prepare(running);
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
        { timeout: 30_000 }).toBe('connected');
      expect((await service.command('inspect')).participants).toHaveLength(1);
      await running.application.close();
      await expect.poll(async () => (await service.command('inspect')).participants.length,
        { timeout: 10_000 }).toBe(0);
    } finally { await running.close(); }
  } finally { await service.close(); }
});

test('device change remains passive only in the live isolated context and leave destroys that context', async () => {
  const service = await startMediaService();
  try {
    const running = await launch(service.configuration, service.media);
    try {
      const calls = await observeMediaCalls(running.application);
      await prepare(running);
      await running.page.getByRole('button', { name: '加入语音房间', exact: true }).click();
      await expect.poll(async () => (await running.page.evaluate(() => window.media.getSnapshot())).status,
        { timeout: 30_000 }).toBe('connected');
      expect(JSON.parse(await calls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
      await running.application.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().endsWith('/media.html'))?.webContents;
        if (!contents) throw new Error('Missing UI context');
        await contents.executeJavaScriptInIsolatedWorld(999,
          [{ code: "navigator.mediaDevices.dispatchEvent(new Event('devicechange'))" }]);
      });
      expect(JSON.parse(await calls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
      const mediaWindow = running.application.windows().find((page) => page !== running.page);
      if (!mediaWindow) throw new Error('Missing isolated media context');
      const mediaId = await running.application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/media.html'))?.webContents.id);
      if (!mediaId) throw new Error('Missing media webContents');
      await running.application.evaluate(async ({ BrowserWindow }, id) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents;
        if (!contents) throw new Error('Missing media webContents');
        await contents.executeJavaScriptInIsolatedWorld(999, [{ code: `
          const calls = { enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 };
          for (const name of Object.keys(calls)) {
            const original = navigator.mediaDevices[name].bind(navigator.mediaDevices);
            navigator.mediaDevices[name] = (...args) => { calls[name]++; return original(...args); };
          }
          globalThis.__mediaTestCalls = calls;
          navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
        ` }]);
      }, mediaId);
      const mediaCalls = () => running.application.evaluate(async ({ BrowserWindow }, id) => {
        const contents = BrowserWindow.getAllWindows().find((window) => window.webContents.id === id)?.webContents;
        if (!contents) throw new Error('Missing media webContents');
        return contents.executeJavaScriptInIsolatedWorld(999, [{ code: 'JSON.stringify(globalThis.__mediaTestCalls)' }]);
      }, mediaId);
      await expect.poll(async () => JSON.parse(await mediaCalls())).toEqual({
        enumerateDevices: 1, getUserMedia: 0, getDisplayMedia: 0,
      });
      await running.page.getByRole('button', { name: '离开语音房间' }).click();
      await expect(running.page.getByLabel('展示昵称')).toBeVisible();
      expect(mediaWindow.isClosed()).toBe(true);
      expect(await running.application.evaluate(({ BrowserWindow }, id) =>
        BrowserWindow.getAllWindows().some((window) => window.webContents.id === id), mediaId)).toBe(false);
      await running.application.evaluate(async ({ BrowserWindow }) => {
        await BrowserWindow.getAllWindows()[0].webContents.executeJavaScriptInIsolatedWorld(999,
          [{ code: "navigator.mediaDevices.dispatchEvent(new Event('devicechange'))" }]);
      });
      expect(JSON.parse(await calls())).toEqual({ enumerateDevices: 0, getUserMedia: 0, getDisplayMedia: 0 });
    } finally { await running.close(); }
  } finally { await service.close(); }
});

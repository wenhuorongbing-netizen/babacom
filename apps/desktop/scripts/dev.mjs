import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildDesktop, desktop, root } from './build.mjs';

let processOwner;
export async function ensureWindowsProcessOwner() {
  if (process.platform !== 'win32') return;
  // One native owner per worker, established before the first resource allocation.
  // Keep its handle outside the worker so forced exit cannot bypass tree cleanup.
  return processOwner ??= new Promise((resolvePromise, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(desktop, 'scripts/windows-process-owner.ps1'),
        '-OwnerProcessId', String(process.pid)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stderr.resume();
    const reader = createInterface({ input: child.stdout });
    const failure = (code) => Object.assign(new Error('Windows process ownership unavailable'), {
      stage: 'OWNERSHIP', category: 'START_FAILED', ...(Number.isInteger(code) ? { exitCode: code } : {}),
    });
    const timeout = setTimeout(() => { reader.close(); child.kill(); reject(failure()); }, 5_000);
    child.once('error', () => { clearTimeout(timeout); reader.close(); reject(failure()); });
    child.once('exit', (code) => { clearTimeout(timeout); reader.close(); reject(failure(code)); });
    reader.once('line', (line) => {
      clearTimeout(timeout); reader.close();
      if (line !== 'BABACOM_PROCESS_OWNER_READY') { child.kill(); reject(failure()); return; }
      // The watchdog must not keep a normally finished worker alive.
      child.unref(); child.stdout.unref(); child.stderr.unref();
      resolvePromise(child.pid);
    });
  });
}

/** @returns {Promise<{ url: string, pid: number | undefined, close: () => Promise<void> }>} */
export async function startRenderer() {
  await ensureWindowsProcessOwner();
  // Keep Vite's startup and file watching outside the Electron driver's event loop.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--renderer-only'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stderr.resume();
  let spawnFailed = false;
  child.once('error', () => { spawnFailed = true; });
  child.stdin.on('error', () => { /* The exit/error listeners report pipe closure. */ });
  const reader = createInterface({ input: child.stdout });
  let closing;
  const releaseFailure = () => Object.assign(new Error('Renderer release failed'), {
    stage: 'RELEASE', category: 'RELEASE_FAILED', cleanup: 'FAILED',
    ...(Number.isInteger(child.exitCode) ? { exitCode: child.exitCode } : {}),
  });
  const close = () => closing ??= new Promise((resolvePromise, reject) => {
    reader.close();
    if (spawnFailed) { resolvePromise(); return; }
    const finished = () => child.exitCode === 0 ? resolvePromise() : reject(releaseFailure());
    if (child.exitCode !== null || child.signalCode !== null) { finished(); return; }
    const timeout = setTimeout(() => { child.kill(); reject(releaseFailure()); }, 5_000);
    child.once('exit', () => { clearTimeout(timeout); finished(); });
    child.once('error', () => { clearTimeout(timeout); reject(releaseFailure()); });
    child.stdin.end();
  });
  try {
    const url = await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(Object.assign(new Error('Renderer startup timed out'), { name: 'TimeoutError' })), 10_000);
      const finish = (error, value) => {
        clearTimeout(timeout);
        if (error) reject(error); else resolvePromise(value);
      };
      child.once('error', () => finish(new Error('Renderer could not start')));
      child.once('exit', (code) => finish(Object.assign(new Error('Renderer stopped before startup'),
        Number.isInteger(code) ? { code } : {})));
      reader.on('line', (line) => {
        if (!line.startsWith('BABACOM_RENDERER_READY ')) return;
        try {
          const address = new URL(line.slice('BABACOM_RENDERER_READY '.length));
          if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port || address.port === '0'
            || address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new Error();
          finish(null, address.href);
        } catch { finish(new Error('Invalid renderer handshake')); }
      });
    });
    return { url, pid: child.pid, close };
  } catch (error) {
    try { await close(); } catch { error.cleanup = 'FAILED'; }
    throw error;
  }
}

async function rendererProcess() {
  let server;
  let starting;
  let closing;
  let released = false;
  let failed = false;
  const close = () => closing ??= (async () => {
    released = true;
    const timeout = setTimeout(() => process.exit(1), 5_000);
    try {
      const ownedServer = server ?? await starting;
      await ownedServer?.close();
      process.exitCode = failed ? 1 : 0;
    }
    catch { process.exitCode = 1; }
    finally { clearTimeout(timeout); process.stdin.pause(); }
  })();
  process.stdin.once('end', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  process.stdin.resume();
  try {
    // Build and test outputs can contain tens of thousands of files. Watching them
    // synchronously starts Windows watchers while application imports are loading.
    const generated = join(desktop, 'build').replaceAll('\\', '/');
    starting = createServer({ root: desktop, configFile: join(desktop, 'vite.config.ts'),
      server: { watch: { ignored: [generated, generated + '/**'] } } });
    server = await starting;
    if (released) { await close(); return; }
    await server.listen();
    if (released) { await close(); return; }
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Renderer server did not bind');
    process.stdout.write('BABACOM_RENDERER_READY http://127.0.0.1:' + address.port + '/\n');
  } catch { failed = true; process.exitCode = 1; await close(); }
}

export function createStartupCleanup(releaseBudgetMs = 5_500) {
  if (!Number.isInteger(releaseBudgetMs) || releaseBudgetMs <= 0 || releaseBudgetMs > 5_500) throw new Error('Invalid startup release budget');
  const stages = new Set(['API', 'RENDERER', 'PIPE', 'DRIVER', 'WINDOW', 'UI']);
  const entries = [];
  let closing;
  const release = async (entry) => {
    let timeout;
    try {
      await Promise.race([Promise.resolve().then(entry.close), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Startup release timed out')), releaseBudgetMs);
      })]);
    } finally { clearTimeout(timeout); }
  };
  const close = () => closing ??= Promise.resolve().then(async () => {
    const failedStages = [];
    for (const entry of [...entries].reverse()) {
      try { await release(entry); } catch { failedStages.push(entry.stage); }
    }
    if (failedStages.length) throw Object.assign(new Error('Controlled startup cleanup failed'), {
      stage: 'RELEASE', category: 'RELEASE_FAILED', cleanup: 'FAILED', failedStages,
    });
  });
  return {
    own: async (stage, releaseResource) => {
      if (!stages.has(stage) || typeof releaseResource !== 'function') throw new Error('Invalid startup ownership');
      const entry = { stage, close: releaseResource };
      if (closing) {
        try { await release(entry); }
        catch { throw Object.assign(new Error('Late startup resource release failed'), { stage: 'RELEASE', category: 'RELEASE_FAILED', cleanup: 'FAILED' }); }
        throw Object.assign(new Error('Startup owner is closed'), { stage, category: 'OWNER_CLOSED' });
      }
      entries.push(entry);
    },
    close,
    fail: async (stage, error) => {
      let cleanup = error?.cleanup === 'FAILED' ? 'FAILED' : 'RELEASED';
      try { await close(); } catch { cleanup = 'FAILED'; }
      const category = error?.name === 'TimeoutError' ? 'START_TIMEOUT' : 'START_FAILED';
      const exitCode = Number.isInteger(error?.code) ? error.code : error?.exitCode;
      throw Object.assign(new Error('Controlled startup failed at ' + (stages.has(stage) ? stage : 'UNKNOWN')), {
        stage: stages.has(stage) ? stage : 'UNKNOWN', category, cleanup,
        ...(Number.isInteger(exitCode) ? { exitCode } : {}),
      });
    },
  };
}

export async function startStartupPipe(configuration) {
  await ensureWindowsProcessOwner();
  const name = 'babacom-' + randomUUID();
  const path = '\\\\.\\pipe\\' + name;
  // Windows' default pipe DACL grants Everyone read access. This test/dev broker
  // uses the current logon SID, blocking other users and remote logon sessions.
  // The script is ASCII and receives the credential solely through its stdin.
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
    '$pipe = $null',
    '$writer = $null',
    '$stage = "INPUT"',
    'try {',
    '  $envelope = [Console]::In.ReadLine() | ConvertFrom-Json',
    '  $stage = "IDENTITY"',
    '  $logonText = & whoami.exe /logonid',
    '  $sidMatch = [regex]::Match(($logonText -join " "), "S-1-5-5-[0-9]+-[0-9]+")',
    '  if (-not $sidMatch.Success) { throw "Missing logon identity" }',
    '  $logon = [Security.Principal.SecurityIdentifier]::new($sidMatch.Value)',
    '  $stage = "ACL"',
    '  $acl = [IO.Pipes.PipeSecurity]::new()',
    '  $acl.SetAccessRuleProtection($true, $false)',
    '  $acl.AddAccessRule([IO.Pipes.PipeAccessRule]::new($logon, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))',
    '  $stage = "PIPE"',
    '  $pipe = [IO.Pipes.NamedPipeServerStream]::new($envelope.name, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::None, 4096, 4096, $acl)',
    '  [Console]::Out.WriteLine("ready")',
    '  $pipe.WaitForConnection()',
    '  $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false))',
    '  $writer.WriteLine($envelope.configuration)',
    '  $writer.Flush()',
    '} catch {',
    '  [Console]::Error.WriteLine("Startup broker failure: " + $stage)',
    '  exit 1',
    '} finally {',
    '  if ($null -ne $writer) { $writer.Dispose() }',
    '  if ($null -ne $pipe) { $pipe.Dispose() }',
    '  $envelope = $null',
    '}',
  ].join('\n');
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let failureStage = 'UNKNOWN';
  child.stderr.on('data', (chunk) => {
    const stage = /Startup broker failure: (INPUT|IDENTITY|ACL|PIPE)/.exec(String(chunk));
    if (stage) failureStage = stage[1];
  });
  await new Promise((resolvePromise, reject) => {
    const reader = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Startup broker timed out')); }, 10_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Startup broker could not start')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Startup broker stopped: ' + failureStage)); });
    reader.once('line', (line) => {
      clearTimeout(timeout);
      reader.close();
      if (line === 'ready') resolvePromise();
      else { child.kill(); reject(new Error('Invalid startup broker handshake')); }
    });
    child.stdin.end(JSON.stringify({ name, configuration: JSON.stringify(configuration) }) + '\n');
  });
  return {
    path,
    close: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
      child.kill();
      await exited;
    },
  };
}


export async function startRealMediaService(scenario = 'ready') {
  return startMediaService(scenario, 'registry');
}

export async function startMediaService(scenario = 'ready', provider = 'fixture') {
  await ensureWindowsProcessOwner();
  const child = spawn('uv', ['run', '--frozen', '--directory', join(root, 'apps/api'),
    'python', '../../tests/voice/local_media_service.py', '--scenario', scenario, '--provider', provider], {
    cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'apps/api') },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let errors = '';
  let requests = 0;
  const responses = [];
  child.stderr.on('data', (chunk) => { errors += String(chunk); });
  const reader = createInterface({ input: child.stdout });
  const waiting = new Map();
  const handshake = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Media fixture startup timed out')); }, 20_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Media fixture unavailable')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Media fixture stopped: ' + errors)); });
    reader.once('line', (line) => {
      clearTimeout(timeout);
      try {
        if (line.length > 4096) throw new Error('Invalid private media handshake');
        resolvePromise(JSON.parse(line));
      } catch { child.kill(); reject(new Error('Invalid private media handshake')); }
    });
  });
  reader.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (event.event === 'request') requests = event.count;
      if (event.event === 'response' && Number.isInteger(event.status)) responses.push(event.status);
      waiting.get(event.requestId)?.(event);
    } catch { /* private fixture events only */ }
  });
  const command = (name) => new Promise((resolvePromise, reject) => {
    const requestId = randomUUID();
    const timeout = setTimeout(() => { waiting.delete(requestId); reject(new Error('Media fixture command timed out')); }, 7_000);
    waiting.set(requestId, (event) => { clearTimeout(timeout); waiting.delete(requestId); resolvePromise(event); });
    child.stdin.write(JSON.stringify({ command: name, requestId }) + '\n');
  });
  return {
    ...handshake, requests: () => requests, responses: () => [...responses], command,
    diagnostics: () => errors,
    close: async () => {
      if (child.exitCode !== null) { reader.close(); return; }
      const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 15_000);
      await exited;
      clearTimeout(timeout);
      reader.close();
    },
  };
}

export async function startTestService(scenario = 'ready') {
  await ensureWindowsProcessOwner();
  const child = spawn('uv', ['run', '--frozen', '--directory', join(root, 'apps/api'),
    'python', '../../tests/tokens/local_service.py', '--scenario', scenario], {
    cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'apps/api') },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  // This private handshake contains a fresh test session. Never print it.
  let output = '';
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const traffic = [];
  const reader = createInterface({ input: child.stdout });
  const acknowledgements = new Map();
  const configuration = await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Test service startup timed out')); }, 15_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Test service could not start')); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test service stopped before startup')); });
    reader.once('line', (line) => {
      clearTimeout(timeout);
      try {
        if (line.length > 4096) throw new Error('Invalid handshake');
        resolvePromise(JSON.parse(line));
      } catch {
        child.kill();
        reject(new Error('Invalid test service handshake'));
      }
    });
  });
  reader.on('line', (line) => {
    try {
      if (line.length > 128) return;
      const event = JSON.parse(line);
      if (['request', 'response', 'finished'].includes(event.event) && Number.isInteger(event.id)) {
        if (event.event === 'response' && !Number.isInteger(event.status)) return;
        traffic.push({ event: event.event, id: event.id, ...(event.event === 'response' ? { status: event.status } : {}) });
      }
      acknowledgements.get(event.event)?.();
    } catch { /* Test diagnostics contain only recognized, non-sensitive events. */ }
  });
  const control = (command, acknowledgement) => new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      acknowledgements.delete(acknowledgement);
      reject(new Error('Test environment control timed out'));
    }, 5_000);
    acknowledgements.set(acknowledgement, () => {
      clearTimeout(timeout); acknowledgements.delete(acknowledgement); resolvePromise();
    });
    child.stdin.write(command + '\n');
  });
  return {
    configuration,
    responses: () => traffic.filter((event) => event.event === 'response').map((event) => event.status),
    traffic: () => traffic.map((event) => ({ ...event })),
    diagnostics: () => output,
    recover: () => control('recover', 'recovered'),
    release: () => control('release', 'released'),
    close: async () => {
      reader.close();
      if (child.exitCode !== null) return;
      const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise));
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 5_000);
      await exited;
      clearTimeout(timeout);
    },
  };
}


const sandboxGuestScript = String.raw`$ErrorActionPreference = 'Stop'
$stage = 'ENVIRONMENT'
$api = $null
$client = $null
$pipe = $null
$writer = $null
$result = [ordered]@{ status = 'FAIL'; stage = $stage }
function Write-GuestEvidence([string]$filename, $evidence) {
  $destination = 'C:\T1Output\' + $filename
  $stream = [IO.File]::Open(($destination + '.pending'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  $evidenceWriter = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
  try { $evidenceWriter.Write(($evidence | ConvertTo-Json)) } finally { $evidenceWriter.Dispose() }
  [IO.File]::Move(($destination + '.pending'), $destination)
}
try {
  $interactiveUser = [Diagnostics.Process]::GetCurrentProcess().SessionId -gt 0
  Write-GuestEvidence 'guest-started.json' ([ordered]@{ stage = $stage; interactiveUser = $interactiveUser })
  if (-not $interactiveUser) { throw 'No interactive user session' }
  $tools = @(Get-Command node.exe,npm.cmd,npx.cmd,tsc.cmd,vite.cmd -ErrorAction SilentlyContinue)
  if ($tools.Count -ne 0) { throw 'Development tools are present' }
  $stage = 'API'
  $apiInfo = [Diagnostics.ProcessStartInfo]::new()
  $apiInfo.FileName = 'C:\T1Input\python\python.exe'
  $apiInfo.Arguments = '"C:\T1Input\root\tests\tokens\local_service.py" --scenario ready'
  $apiInfo.UseShellExecute = $false
  $apiInfo.CreateNoWindow = $true
  $apiInfo.RedirectStandardInput = $true
  $apiInfo.RedirectStandardOutput = $true
  $apiInfo.RedirectStandardError = $true
  $apiInfo.EnvironmentVariables['PYTHONPATH'] = 'C:\T1Input\root\apps\api;C:\T1Input\site-packages'
  $apiInfo.EnvironmentVariables['PYTHONDONTWRITEBYTECODE'] = '1'
  $api = [Diagnostics.Process]::Start($apiInfo)
  $apiErrors = $api.StandardError.ReadToEndAsync()
  $handshake = $api.StandardOutput.ReadLineAsync()
  if (-not $handshake.Wait(20000)) { throw 'API startup timed out' }
  $configurationText = $handshake.Result
  $configuration = $configurationText | ConvertFrom-Json
  if ($configuration.apiBase -notmatch '^http://127[.]0[.]0[.]1:[0-9]+$') { throw 'Invalid API handshake' }
  Write-GuestEvidence 'fixture-ready.json' ([ordered]@{ stage = $stage; interactiveUser = $interactiveUser })
  $apiOutput = $api.StandardOutput.ReadToEndAsync()
  $stage = 'BROKER'
  $name = 'babacom-' + [Guid]::NewGuid().ToString()
  $logonText = & whoami.exe /logonid
  $sidMatch = [regex]::Match(($logonText -join ' '), 'S-1-5-5-[0-9]+-[0-9]+')
  if (-not $sidMatch.Success) { throw 'Missing logon identity' }
  $logon = [Security.Principal.SecurityIdentifier]::new($sidMatch.Value)
  $acl = [IO.Pipes.PipeSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([IO.Pipes.PipeAccessRule]::new($logon, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  $pipe = [IO.Pipes.NamedPipeServerStream]::new($name, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous, 4096, 4096, $acl)
  $connected = $pipe.BeginWaitForConnection($null, $null)
  $stage = 'CLIENT'
  $clientInfo = [Diagnostics.ProcessStartInfo]::new()
  $clientInfo.FileName = 'C:\T1Input\client\BabaCom.exe'
  $clientInfo.Arguments = '--force-renderer-accessibility --babacom-startup-pipe=\\.\pipe\' + $name
  $clientInfo.UseShellExecute = $false
  $clientInfo.RedirectStandardOutput = $true
  $clientInfo.RedirectStandardError = $true
  $client = [Diagnostics.Process]::Start($clientInfo)
  Write-GuestEvidence 'client-started.json' ([ordered]@{ stage = $stage; interactiveUser = ($client.SessionId -gt 0) })
  $clientOutput = $client.StandardOutput.ReadToEndAsync()
  $clientErrors = $client.StandardError.ReadToEndAsync()
  if (-not $connected.AsyncWaitHandle.WaitOne(15000)) { throw 'Client startup timed out' }
  $pipe.EndWaitForConnection($connected)
  $writer = [IO.StreamWriter]::new($pipe, [Text.UTF8Encoding]::new($false))
  $writer.WriteLine($configurationText)
  $writer.Flush()
  $writer.Dispose()
  $writer = $null
  $pipe.Dispose()
  $pipe = $null
  $stage = 'WINDOW'
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $client.Refresh()
    if ($client.HasExited) { throw 'Client exited before its window' }
    if ($client.MainWindowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($client.MainWindowHandle -eq [IntPtr]::Zero) { throw 'No actual client window' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $window = [Windows.Automation.AutomationElement]::FromHandle($client.MainWindowHandle)
  $editCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
  $prepareName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5YeG5aSH5YWl5oi/'))
  $buttonCondition = [Windows.Automation.AndCondition]::new(
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button),
    [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $prepareName))
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $edit = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $editCondition)
    $button = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    if ($null -ne $edit -and $null -ne $button) { break }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($null -eq $edit -or $null -eq $button) { throw 'Admission controls unavailable' }
  # Issue 7 checks actual startup here; test:e2e covers full admission journeys.
  $names = @($window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name })
  $visibleText = $names -join ' '
  if ($visibleText.Contains($configuration.applicationSession) -or $visibleText -match 'eyJ[\w-]+[.]eyJ[\w-]+[.][\w-]+') { throw 'Secret in visible UI' }
  $stage = 'CLOSE'
  if (-not $client.CloseMainWindow() -or -not $client.WaitForExit(15000) -or $client.ExitCode -ne 0) { throw 'Client did not close cleanly' }
  $api.StandardInput.Close()
  if (-not $api.WaitForExit(15000) -or $api.ExitCode -ne 0) { throw 'API did not close cleanly' }
  $stage = 'DIAGNOSTICS'
  if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($clientOutput, $clientErrors, $apiErrors, $apiOutput), 5000)) { throw 'Diagnostics did not close' }
  $diagnostics = $clientOutput.Result + $clientErrors.Result + $apiErrors.Result
  if ($diagnostics.Contains($configuration.applicationSession) -or $diagnostics -match 'eyJ[\w-]+[.]eyJ[\w-]+[.][\w-]+') { throw 'Secret in diagnostics' }
  $events = @($apiOutput.Result -split '\r?\n' | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
  if ($events.Count -ne 0) { throw 'Startup performed an unexpected admission request' }
  $result = [ordered]@{
    status = 'PASS'
    environment = 'Windows Sandbox'
    os = [Environment]::OSVersion.VersionString
    nodeAbsent = $true
    npmAbsent = $true
    typescriptAbsent = $true
    viteAbsent = $true
    actualWindow = $true
    admissionControlsVisible = $true
    apiRequestsDuringStartup = 0
    clientExitCode = $client.ExitCode
    appSha256 = (Get-FileHash 'C:\T1Input\client\resources\app.asar' -Algorithm SHA256).Hash.ToLowerInvariant()
  }
} catch {
  $result = [ordered]@{ status = 'FAIL'; stage = $stage; category = $_.Exception.GetType().Name }
} finally {
  if ($null -ne $writer) { $writer.Dispose() }
  if ($null -ne $pipe) { $pipe.Dispose() }
  if ($null -ne $client -and -not $client.HasExited) { $client.Kill() }
  if ($null -ne $api -and -not $api.HasExited) { $api.Kill() }
  $configuration = $null
  $configurationText = $null
  Write-GuestEvidence 'result.json' $result
}
`;

async function withinSandboxDeadline(operation, timeout, signal) {
  const error = (category) => Object.assign(new Error(category), { category });
  if (signal?.aborted) throw error('CANCELLED');
  if (timeout <= 0) throw error('TIMEOUT');
  const controller = new AbortController();
  let timer;
  let cancel;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(error('TIMEOUT')); controller.abort(); }, timeout);
    cancel = () => { reject(error('CANCELLED')); controller.abort(); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([operation({ timeout, windowsHide: true, signal: controller.signal }), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * @param {string[]} args
 * @param {{timeout: number, windowsHide: boolean, signal: AbortSignal}} options
 * @returns {Promise<{stdout: string}>}
 */
async function executeSandboxCommand(args, options) {
  if (args[0] !== 'connect') return promisify(execFile)('wsb.exe', args, { ...options, encoding: 'utf8' });
  // The desktop process inherits piped output and can keep execFile pending after wsb exits.
  return new Promise((resolvePromise, reject) => {
    const child = spawn('wsb.exe', args, { ...options, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise({ stdout: '' });
      else reject(Object.assign(new Error('CLI_FAILED'), { code }));
    });
  });
}

/**
 * @param {{outputDirectory: string, configuration: string, appSha256: string, signal?: AbortSignal,
 * cliTimeoutMs?: number, guestTimeoutMs?: number, deadline?: number,
 * execute?: (args: string[], options: {timeout: number, windowsHide: boolean, signal: AbortSignal}) => Promise<{stdout: string}>}} options
 */
export async function runSandboxInstance({ outputDirectory, configuration, appSha256,
  signal, cliTimeoutMs = 15_000, guestTimeoutMs = 120_000, deadline = Date.now() + 180_000,
  execute = executeSandboxCommand }) {
  const requestedId = randomUUID();
  const runnerError = (category) => Object.assign(new Error(category), { category });
  const record = async (filename, value, final = false) => {
    try {
      await withinSandboxDeadline(({ signal: writeSignal }) => writeFile(join(outputDirectory, filename), JSON.stringify(value),
        { flag: 'wx', signal: writeSignal }), Math.min(15_000, deadline - (final ? 0 : 15_000) - Date.now()), final ? undefined : signal);
    }
    catch (error) {
      if (error.category === 'TIMEOUT' || error.category === 'CANCELLED') throw error;
      throw runnerError('EVIDENCE_IO');
    }
  };
  const checkCancelled = () => { if (signal?.aborted) throw runnerError('CANCELLED'); };
  const invoke = async (args, cleanupDeadline) => {
    const timeout = Math.min(15_000, cliTimeoutMs, (cleanupDeadline ?? deadline - 15_000) - Date.now());
    return withinSandboxDeadline((options) => execute(args, options), timeout, cleanupDeadline ? undefined : signal);
  };
  const parseInventory = (response) => {
    const inventory = JSON.parse(response.stdout.trim());
    if (!Array.isArray(inventory.WindowsSandboxEnvironments)
      || inventory.WindowsSandboxEnvironments.some((item) => !item || typeof item.Id !== 'string'
        || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.Id))) {
      throw new SyntaxError('Invalid inventory');
    }
    return inventory.WindowsSandboxEnvironments.map((item) => item.Id.toLowerCase());
  };
  const failure = (error) => ({ status: error.category === 'CANCELLED' ? 'NOT_RUN' : 'FAIL', stage,
    category: ['CANCELLED', 'TIMEOUT', 'EVIDENCE_IO', 'OWNERSHIP_UNVERIFIED'].includes(error.category) ? error.category
      : error.killed ? 'TIMEOUT' : error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'CLI_FAILED',
    exitCode: Number.isInteger(error.code) ? error.code : null });
  let stage = 'INVENTORY';
  let baseline = [];
  let owned = false;
  let result;
  /** @type {{status: string, unrelatedPreserved?: boolean, category?: string, exitCode?: number | null}} */
  let cleanup = { status: 'NOT_OWNED' };
  try {
    baseline = parseInventory(await invoke(['list', '--raw']));
    await record('host-inventory.json', { stage, requestedId, existingIds: baseline });
    stage = 'CREATE';
    if (baseline.includes(requestedId)) throw runnerError('OWNERSHIP_UNVERIFIED');
    const created = JSON.parse((await invoke(['start', '--id', requestedId, '--config', configuration, '--raw'])).stdout.trim());
    const returnedId = typeof created === 'string' ? created : created?.Id;
    if (typeof returnedId !== 'string' || returnedId.toLowerCase() !== requestedId
      || !parseInventory(await invoke(['list', '--raw'])).includes(requestedId)) {
      result = { status: 'FAIL', stage, category: 'OWNERSHIP_UNVERIFIED' };
    } else {
      owned = true;
      await record('host-created.json', { stage, instanceId: requestedId });
      stage = 'USER_SESSION';
      await invoke(['connect', '--id', requestedId, '--raw']);
      await record('host-session.json', { stage, status: 'CONNECTED' });
      checkCancelled();
      stage = 'GUEST';
      const guestDeadline = Math.min(Date.now() + Math.min(120_000, guestTimeoutMs), deadline - 15_000);
      result = { status: 'NOT_RUN', stage, category: 'MISSING_RESULT' };
      while (Date.now() < guestDeadline) {
        checkCancelled();
        try {
          const readGuest = (filename) => withinSandboxDeadline(({ signal: readSignal }) => readFile(join(outputDirectory, filename),
            { encoding: 'utf8', signal: readSignal }), Math.min(15_000, guestDeadline - Date.now()), signal);
          const guest = JSON.parse(await readGuest('result.json'));
          stage = 'RESULT';
          const fields = ['nodeAbsent', 'npmAbsent', 'typescriptAbsent', 'viteAbsent', 'actualWindow', 'admissionControlsVisible'];
          if (guest.status === 'FAIL') {
            result = { status: 'FAIL', stage, category: 'GUEST_ASSERTION_FAILED',
              guestStage: ['ENVIRONMENT', 'API', 'BROKER', 'CLIENT', 'WINDOW', 'CLOSE', 'DIAGNOSTICS'].includes(guest.stage) ? guest.stage : 'UNKNOWN' };
          } else if (guest.status !== 'PASS' || guest.environment !== 'Windows Sandbox'
            || fields.some((field) => guest[field] !== true) || guest.apiRequestsDuringStartup !== 0 || guest.clientExitCode !== 0
            || !/^Microsoft Windows NT [0-9.]+$/.test(guest.os) || !/^[a-f0-9]{64}$/.test(guest.appSha256)) {
            result = { status: 'FAIL', stage, category: 'INVALID_RESULT' };
          } else if (guest.appSha256 !== appSha256) {
            result = { status: 'FAIL', stage, category: 'ARTIFACT_MISMATCH' };
          } else {
            for (const [filename, expectedStage] of [['guest-started.json', 'ENVIRONMENT'], ['fixture-ready.json', 'API'], ['client-started.json', 'CLIENT']]) {
              const proof = JSON.parse(await readGuest(filename).catch((error) => {
                if (error.category === 'TIMEOUT' || error.category === 'CANCELLED') throw error;
                return 'null';
              }));
              if (proof?.stage !== expectedStage || proof.interactiveUser !== true) throw new SyntaxError('Invalid guest phase');
            }
            checkCancelled();
            result = { status: 'PASS', stage, guest: Object.fromEntries(['status', 'environment', 'os', ...fields,
              'apiRequestsDuringStartup', 'clientExitCode', 'appSha256'].map((field) => [field, guest[field]])) };
          }
          break;
        } catch (error) {
          if (error.category === 'CANCELLED' || error.category === 'TIMEOUT') throw error;
          if (error.code !== 'ENOENT') {
            result = { status: 'FAIL', stage: 'RESULT', category: 'INVALID_RESULT' };
            break;
          }
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(0, Math.min(250, guestDeadline - Date.now()))));
      }
    }
  } catch (error) {
    result = failure(error);
  } finally {
    if (owned) {
      try {
        const cleanupDeadline = Math.min(Date.now() + 15_000, deadline);
        // Cancellation stops the test, but must not cancel release of its confirmed instance.
        await invoke(['stop', '--id', requestedId, '--raw'], cleanupDeadline);
        const remaining = parseInventory(await invoke(['list', '--raw'], cleanupDeadline));
        cleanup = { status: remaining.includes(requestedId) ? 'NOT_RELEASED' : 'RELEASED',
          unrelatedPreserved: baseline.every((id) => remaining.includes(id)) };
        if (cleanup.status !== 'RELEASED' || !cleanup.unrelatedPreserved) result.status = 'FAIL';
      } catch (error) {
        result.status = 'FAIL';
        cleanup = { status: 'NOT_RELEASED', category: failure(error).category, exitCode: Number.isInteger(error.code) ? error.code : null };
      }
    }
  }
  if (signal?.aborted && result.status === 'PASS') result = { status: 'NOT_RUN', stage: 'RESULT', category: 'CANCELLED' };
  const summary = { ...result, cleanup };
  try { await record('host-summary.json', summary, true); }
  catch { return { ...summary, status: 'FAIL', stage: 'EVIDENCE', category: 'EVIDENCE_IO' }; }
  return summary;
}

// Native copying can be terminated in the middle of a file; fs.cp's filter cannot.
/**
 * @param {string} source
 * @param {string} target
 * @param {{recursive?: boolean, deadline?: number, signal?: AbortSignal}} options
 */
export async function copySandboxInput(source, target, { recursive = false, deadline = Date.now() + 15_000, signal } = {}) {
  const timeout = Math.min(15_000, deadline - Date.now());
  if (timeout <= 0) throw Object.assign(new Error('Sandbox preparation timed out'), { category: 'TIMEOUT' });
  if (!recursive && basename(source) !== basename(target)) throw new Error('Invalid Sandbox copy target');
  try {
    await withinSandboxDeadline((options) => promisify(execFile)('robocopy.exe', [recursive ? source : dirname(source), recursive ? target : dirname(target),
      recursive ? '/E' : basename(source), '/R:0', '/W:0', '/NJH', '/NJS', '/NFL', '/NDL', '/NP'],
    { ...options, encoding: 'utf8' }), timeout, signal);
  } catch (error) {
    // Robocopy reports successful copies with exit codes 1..7.
    if (!Number.isInteger(error.code) || error.code < 0 || error.code > 7 || error.killed || signal?.aborted) throw error;
  }
}

export async function runSandboxAcceptance() {
  const deadline = Date.now() + 180_000;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const copy = (source, target, options = {}) => copySandboxInput(source, target,
    { ...options, deadline: deadline - 15_000, signal: controller.signal });
  const prepare = (operation) => withinSandboxDeadline(operation, Math.min(15_000, deadline - 15_000 - Date.now()), controller.signal);
  try {
    const execute = promisify(execFile);
    const runtime = JSON.parse((await prepare((options) => execute('uv', ['run', '--frozen', '--directory', join(root, 'apps/api'),
      'python', '-c', 'import json,sys,platform; print(json.dumps({"base":sys.base_prefix,"version":platform.python_version()}))'],
    { ...options, cwd: root, encoding: 'utf8' }))).stdout);
    const runDirectory = await prepare(() => mkdtemp(join(desktop, 'build/sandbox-')));
    const input = join(runDirectory, 'input');
    const output = join(runDirectory, 'output');
    await prepare(() => mkdir(output, { recursive: true }));
    await copy(join(desktop, 'build/windows/win-unpacked'), join(input, 'client'), { recursive: true });
    await copy(runtime.base, join(input, 'python'), { recursive: true });
    await copy(join(root, 'apps/api/.venv/Lib/site-packages'), join(input, 'site-packages'), { recursive: true });
    await copy(join(root, 'apps/api/app'), join(input, 'root/apps/api/app'), { recursive: true });
    await prepare(() => mkdir(join(input, 'root/packages/contracts'), { recursive: true }));
    for (const filename of ['admission.schema.json', 'token-claims.schema.json', 'permissions.schema.json']) {
      await copy(join(root, 'packages/contracts', filename), join(input, 'root/packages/contracts', filename));
    }
    await prepare(() => mkdir(join(input, 'root/tests/tokens'), { recursive: true }));
    await copy(join(root, 'tests/tokens/local_service.py'), join(input, 'root/tests/tokens/local_service.py'));
    await prepare(({ signal }) => writeFile(join(input, 'guest.ps1'), sandboxGuestScript, { encoding: 'ascii', flag: 'wx', signal }));
    const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const configuration = '<Configuration><vGPU>Disable</vGPU><Networking>Disable</Networking>'
      + '<AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection>'
      + '<PrinterRedirection>Disable</PrinterRedirection><MappedFolders>'
      + '<MappedFolder><HostFolder>' + xml(input) + '</HostFolder><SandboxFolder>C:\\T1Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>'
      + '<MappedFolder><HostFolder>' + xml(output) + '</HostFolder><SandboxFolder>C:\\T1Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>'
      + '</MappedFolders><LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\T1Input\\guest.ps1</Command></LogonCommand></Configuration>';
    await prepare(({ signal }) => writeFile(join(runDirectory, 'acceptance.wsb'), configuration, { flag: 'wx', signal }));
    const appSha256 = createHash('sha256').update(await prepare(({ signal }) => readFile(join(input, 'client/resources/app.asar'), { signal }))).digest('hex');
    const uvLockSha256 = createHash('sha256').update(await prepare(({ signal }) => readFile(join(root, 'apps/api/uv.lock'), { signal }))).digest('hex');
    const result = await runSandboxInstance({ outputDirectory: output, configuration, appSha256, deadline, signal: controller.signal });
    console.log(JSON.stringify({ ...result, pythonFixtureVersion: runtime.version, uvLockSha256, runDirectory }));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

async function main() {
  if (process.argv.includes('--sandbox-acceptance')) {
    try { await runSandboxAcceptance(); }
    catch (error) {
      console.error(JSON.stringify({ status: error.category === 'CANCELLED' ? 'NOT_RUN' : 'FAIL', stage: 'PREPARATION',
        category: ['TIMEOUT', 'CANCELLED'].includes(error.category) ? error.category : error.killed ? 'TIMEOUT' : 'SETUP_FAILED',
        exitCode: Number.isInteger(error.code) ? error.code : null }));
      process.exitCode = 1;
    }
    return;
  }
  const realProviders = process.argv.includes('--local-real');
  if (!process.argv.includes('--local-test') && !realProviders) {
    console.error('Supply a controlled provider configuration, or explicitly use --local-test / --local-real.');
    process.exitCode = 1;
    return;
  }
  let service;
  let renderer;
  let startup;
  let mediaStartup;
  try {
    await buildDesktop({ renderer: false });
    service = realProviders ? await startRealMediaService() : await startTestService();
    renderer = await startRenderer();
    startup = await startStartupPipe(service.configuration);
    if (realProviders) mediaStartup = await startStartupPipe(service.media);
    const electron = createRequire(import.meta.url)('electron');
    const child = spawn(electron, [join(desktop, 'dist/main/main.cjs'), '--babacom-startup-pipe=' + startup.path,
      ...(mediaStartup ? ['--babacom-media-pipe=' + mediaStartup.path] : [])], {
      env: { ...process.env, BABACOM_RENDERER_URL: renderer.url },
      stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
    });
    const code = await new Promise((resolvePromise, reject) => {
      child.once('exit', resolvePromise);
      child.once('error', reject);
    });
    process.exitCode = code ?? 1;
  } finally {
    await Promise.allSettled([renderer?.close(), startup?.close(), mediaStartup?.close(), service?.close()]);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  (process.argv.includes('--renderer-only') ? rendererProcess() : main()).catch(() => {
    console.error('Controlled desktop startup failed.');
    process.exitCode = 1;
  });
}

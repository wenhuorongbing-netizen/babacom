import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildDesktop, desktop, root } from './build.mjs';

export async function startRenderer() {
  const server = await createServer({ root: desktop, configFile: join(desktop, 'vite.config.ts') });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Renderer server did not bind');
  return { url: 'http://127.0.0.1:' + address.port + '/', close: () => server.close() };
}

export async function startStartupPipe(configuration) {
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
try {
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
  [IO.File]::WriteAllText('C:\T1Output\result.json', ($result | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Stop-Computer -Force
}
`;

export async function runSandboxAcceptance() {
  const execute = promisify(execFile);
  const occupied = await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '@(Get-Process | Where-Object ProcessName -In WindowsSandbox,WindowsSandboxClient).Count'], { windowsHide: true });
  if (Number(occupied.stdout.trim()) !== 0) throw new Error('Existing Windows Sandbox is not owned by this test');
  const runtime = JSON.parse((await execute('uv', ['run', '--frozen', '--directory', join(root, 'apps/api'),
    'python', '-c', 'import json,sys,platform; print(json.dumps({"base":sys.base_prefix,"version":platform.python_version()}))'],
  { cwd: root, windowsHide: true })).stdout);
  const runDirectory = await mkdtemp(join(desktop, 'build/sandbox-'));
  const input = join(runDirectory, 'input');
  const output = join(runDirectory, 'output');
  await mkdir(output, { recursive: true });
  await cp(join(desktop, 'build/windows/win-unpacked'), join(input, 'client'), { recursive: true });
  await cp(runtime.base, join(input, 'python'), { recursive: true, dereference: true });
  await cp(join(root, 'apps/api/.venv/Lib/site-packages'), join(input, 'site-packages'), { recursive: true, dereference: true });
  await cp(join(root, 'apps/api/app'), join(input, 'root/apps/api/app'), { recursive: true });
  await mkdir(join(input, 'root/packages/contracts'), { recursive: true });
  for (const filename of ['admission.schema.json', 'token-claims.schema.json', 'permissions.schema.json']) {
    await cp(join(root, 'packages/contracts', filename), join(input, 'root/packages/contracts', filename));
  }
  await mkdir(join(input, 'root/tests/tokens'), { recursive: true });
  await cp(join(root, 'tests/tokens/local_service.py'), join(input, 'root/tests/tokens/local_service.py'));
  await writeFile(join(input, 'guest.ps1'), sandboxGuestScript, 'ascii');
  const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const configuration = '<Configuration><vGPU>Disable</vGPU><Networking>Disable</Networking>'
    + '<AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection>'
    + '<PrinterRedirection>Disable</PrinterRedirection><MappedFolders>'
    + '<MappedFolder><HostFolder>' + xml(input) + '</HostFolder><SandboxFolder>C:\\T1Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>'
    + '<MappedFolder><HostFolder>' + xml(output) + '</HostFolder><SandboxFolder>C:\\T1Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>'
    + '</MappedFolders><LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\T1Input\\guest.ps1</Command></LogonCommand></Configuration>';
  const configurationPath = join(runDirectory, 'acceptance.wsb');
  await writeFile(configurationPath, configuration);
  const child = spawn(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsSandbox.exe'),
    [configurationPath], { stdio: 'ignore', windowsHide: true });
  let launchFailed = false;
  child.once('error', () => { launchFailed = true; });
  const deadline = Date.now() + 120_000;
  let result = { status: 'NOT_RUN', reason: 'Windows Sandbox did not return an actual guest result' };
  try {
    while (!launchFailed && Date.now() < deadline) {
      try {
        result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    const appSha256 = createHash('sha256').update(await readFile(join(input, 'client/resources/app.asar'))).digest('hex');
    if (result.status === 'PASS' && result.appSha256 !== appSha256) throw new Error('Sandbox tested a different application artifact');
    console.log(JSON.stringify({ ...result, pythonFixtureVersion: runtime.version,
      uvLockSha256: createHash('sha256').update(await readFile(join(root, 'apps/api/uv.lock'))).digest('hex'), runDirectory }));
    process.exitCode = result.status === 'PASS' ? 0 : 1;
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function main() {
  if (process.argv.includes('--sandbox-acceptance')) {
    try { await runSandboxAcceptance(); }
    catch (error) {
      console.error('Windows Sandbox setup failed (' + (error.code ?? 'UNKNOWN') + '; ' + (error.syscall ?? 'UNKNOWN') + ').');
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
  main().catch(() => {
    console.error('Controlled desktop startup failed.');
    process.exitCode = 1;
  });
}

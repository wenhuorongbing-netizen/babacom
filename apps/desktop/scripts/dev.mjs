import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
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

export async function startTestService(scenario = 'ready') {
  const child = spawn('uv', ['run', '--frozen', '--directory', join(root, 'apps/api'),
    'python', '../../tests/tokens/local_service.py', '--scenario', scenario], {
    cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'apps/api') },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  // This private handshake contains a fresh test session. Never print it.
  let output = '';
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const responses = [];
  const reader = createInterface({ input: child.stdout });
  let recovered;
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
      if (event.event === 'response' && Number.isInteger(event.status)) responses.push(event.status);
      if (event.event === 'recovered') recovered?.();
    } catch { /* Test diagnostics contain only recognized, non-sensitive events. */ }
  });
  return {
    configuration,
    responses: () => [...responses],
    diagnostics: () => output,
    recover: () => new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => { recovered = undefined; reject(new Error('Test provider recovery timed out')); }, 5_000);
      recovered = () => { clearTimeout(timeout); recovered = undefined; resolvePromise(); };
      child.stdin.write('recover\n');
    }),
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

async function main() {
  if (!process.argv.includes('--local-test')) {
    console.error('Supply a controlled provider configuration, or explicitly use --local-test.');
    process.exitCode = 1;
    return;
  }
  let service;
  let renderer;
  let startup;
  try {
    await buildDesktop({ renderer: false });
    service = await startTestService();
    renderer = await startRenderer();
    startup = await startStartupPipe(service.configuration);
    const electron = createRequire(import.meta.url)('electron');
    const child = spawn(electron, [join(desktop, 'dist/main/main.cjs'), '--babacom-startup-pipe=' + startup.path], {
      env: { ...process.env, BABACOM_RENDERER_URL: renderer.url },
      stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
    });
    const code = await new Promise((resolvePromise, reject) => {
      child.once('exit', resolvePromise);
      child.once('error', reject);
    });
    process.exitCode = code ?? 1;
  } finally {
    await Promise.allSettled([renderer?.close(), startup?.close(), service?.close()]);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Controlled desktop startup failed.');
    process.exitCode = 1;
  });
}

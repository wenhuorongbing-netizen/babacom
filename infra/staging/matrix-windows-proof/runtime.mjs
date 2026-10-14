import { createServer } from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { open, lstat, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE, verifyArtifact, readWindowsSignature } from './artifact.mjs';

export const FIXED = Object.freeze({ ...BASELINE,
  endpoint: '\\\\.\\pipe\\babacom-sandbox-admission-v1',
  cli: 'C:/Users/Jack/AppData/Local/Microsoft/WindowsApps/wsb.exe',
  powershell: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  root: 'D:/Code/babacom/.matrix-runtime/g1/windows-install',
  version: '0.8.107.0', totalMs: 360000, cleanupMs: 30000,
});
export const CONFIG = Object.freeze({ update_base_url: '',
  default_server_config: { 'm.homeserver': { base_url: 'http://127.0.0.1:18008' } },
  disable_custom_urls: true, disable_guests: true, enable_client_well_known_lookups: false,
  integrations_ui_url: null, integrations_rest_url: null, integrations_widgets_urls: null,
  room_directory: { servers: [] }, bug_report_endpoint_url: 'local', sentry: {}, posthog: {},
});
const CONFIG_TEXT = `${JSON.stringify(CONFIG, null, 2)}\n`;
const GUEST = fileURLToPath(new URL('./guest.ps1', import.meta.url));
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const configHash = () => sha(CONFIG_TEXT);
const failure = (category, message = category) => Object.assign(new Error(message), { category });
export function safeError(value) {
  return String(value).replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]').slice(0, 8192);
}
function errorRecord(error) {
  return { category: error.category ?? (error.killed ? 'TIMEOUT' : error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'OPERATION_FAILED'),
    exitCode: Number.isInteger(error.code) ? error.code : null, error: safeError(error.message) };
}
function sanitized(value) {
  if (typeof value === 'string') return safeError(value);
  if (Array.isArray(value)) return value.map(sanitized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitized(item)]));
  return value;
}

// Node's Windows pipe server uses FILE_FLAG_FIRST_PIPE_INSTANCE, as does the old runner.
// Never connect to, wait on, or remove an existing admission endpoint.
export async function acquireAdmission({ signal } = {}) {
  const server = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    const abort = () => reject(failure('CANCELLED'));
    signal?.addEventListener('abort', abort, { once: true });
    server.once('error', error => reject(failure(error.code === 'EADDRINUSE' ? 'BUSY' : 'ADMISSION_FAILED', error.message)));
    server.listen({ path: FIXED.endpoint, signal }, () => { signal?.removeEventListener('abort', abort); resolve(); });
  });
  return { release: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

export function parseInventory(response) {
  const value = JSON.parse(response.stdout.replace(/^\uFEFF/, '').trim());
  const entries = value?.WindowsSandboxEnvironments;
  if (!Array.isArray(entries) || entries.some(item => !item || !UUID.test(item.Id ?? ''))) throw failure('INVALID_RESPONSE', 'Invalid Sandbox inventory');
  const ids = entries.map(item => item.Id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw failure('INVALID_RESPONSE', 'Duplicate Sandbox IDs');
  return ids;
}
export function parseCreated(response, id) {
  const value = JSON.parse(response.stdout.replace(/^\uFEFF/, '').trim());
  // Accept only the old runner's unambiguous string/Id shapes. Unknown shapes fail closed.
  const returned = typeof value === 'string' ? value : value?.Id;
  if (typeof returned !== 'string' || !UUID.test(returned) || returned.toLowerCase() !== id) throw failure('OWNERSHIP_UNVERIFIED');
}
export function validateExec(response) {
  const value = JSON.parse(response.stdout.replace(/^\uFEFF/, '').trim());
  if (!Number.isInteger(value?.ExitCode) || value.ExitCode !== 0) throw Object.assign(failure('GUEST_DISPATCH_FAILED'), { code: value?.ExitCode });
}
export function validateCliAlias(alias) {
  const entries = ['MicrosoftWindows.WindowsSandbox_cw5n1h2txyewy',
    'MicrosoftWindows.WindowsSandbox_cw5n1h2txyewy!AppCli',
    'C:\\Program Files\\WindowsApps\\MicrosoftWindows.WindowsSandbox_0.8.107.0_x64__cw5n1h2txyewy\\wsb.exe', '0'];
  if (alias?.tag !== '8000001b' || !Array.isArray(alias.entries) || alias.entries.length !== 4 ||
    entries.some((entry, index) => alias.entries[index] !== entry)) throw failure('CLI_ALIAS');
}
const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderWSB(input, output) {
  return `<Configuration><Networking>Disable</Networking><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><vGPU>Disable</vGPU><ProtectedClient>Enable</ProtectedClient><MappedFolders><MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>C:\\G1Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\G1Output</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders></Configuration>`;
}

export async function inspectPath(file, kind = 'file') {
  const result = [];
  let current = path.resolve(file);
  while (true) {
    const stat = await lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || (result.length === 0 && kind === 'file' ? !stat.isFile() : !stat.isDirectory())) throw failure('PATH_UNSAFE', 'Expected regular non-reparse path');
    result.push({ path: current, stat });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}
function sameSnapshot(before, after) {
  if (before.length !== after.length) throw failure('INPUT_CHANGED');
  before.forEach((item, index) => {
    const fields = index === 0 && item.stat.isFile() ? ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'] : ['dev', 'ino', 'mode'];
    if (item.path !== after[index].path || fields.some(key => item.stat[key] !== after[index].stat[key])) throw failure('INPUT_CHANGED');
  });
}
async function hashHandle(handle, expected, check) {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size !== BigInt(expected.size)) throw failure('INPUT_HASH', 'Input size mismatch');
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  while (true) {
    check();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    if (position > expected.size) throw failure('INPUT_HASH');
    digest.update(buffer.subarray(0, bytesRead));
  }
  const after = await handle.stat({ bigint: true });
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key]) || position !== expected.size || digest.digest('hex') !== expected.sha256) throw failure('INPUT_HASH');
}
const execFileAsync = promisify(execFile);
const CLI_ALIAS_COMMAND = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class G1Alias {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern IntPtr CreateFile(string p,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll", SetLastError=true)]
 public static extern bool DeviceIoControl(IntPtr h,uint code,IntPtr input,uint inputSize,byte[] output,uint outputSize,out uint returned,IntPtr overlap);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
$handle=[G1Alias]::CreateFile('C:\Users\Jack\AppData\Local\Microsoft\WindowsApps\wsb.exe',0,7,[IntPtr]::Zero,3,0x00200000,[IntPtr]::Zero)
if($handle -eq [IntPtr]::new(-1)){throw 'CLI_ALIAS/open'}
try {
 $bytes=[byte[]]::new(16384)
 $returned=[uint32]0
 if(-not [G1Alias]::DeviceIoControl($handle,0x000900a8,[IntPtr]::Zero,0,$bytes,$bytes.Length,[ref]$returned,[IntPtr]::Zero)){throw 'CLI_ALIAS/read'}
 if($returned -lt 12){throw 'CLI_ALIAS/short'}
 $tag=[BitConverter]::ToUInt32($bytes,0).ToString('x8')
 $length=[BitConverter]::ToUInt16($bytes,4)
 if($length + 8 -ne $returned -or $length -lt 4){throw 'CLI_ALIAS/length'}
 $entries=@([Text.Encoding]::Unicode.GetString($bytes,12,$length-4).Split([char]0) | Where-Object { $_ -ne '' })
 @{tag=$tag;entries=$entries} | ConvertTo-Json -Compress
} finally { [void][G1Alias]::CloseHandle($handle) }
`;
async function inspectCliAlias(options) {
  await checkedPath(path.dirname(FIXED.cli), 'directory', options);
  const response = await execFileAsync(FIXED.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CLI_ALIAS_COMMAND],
    { ...options, timeout: Math.min(15000, options.timeout), windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 65536 });
  validateCliAlias(JSON.parse(response.stdout.replace(/^\uFEFF/, '')));
}
async function nativePaths(files, options) {
  options.check?.();
  const quoted = files.map(file => `'${file.replace(/'/g, "''")}'`).join(',');
  const command = `$ErrorActionPreference='Stop'; foreach($p in @(${quoted})){ $i=Get-Item -LiteralPath $p -Force; if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse point'} }`;
  await execFileAsync(FIXED.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { ...options, timeout: Math.min(15000, options.timeout), windowsHide: true, shell: false, maxBuffer: 65536 });
  options.check?.();
}
async function checkedPath(file, kind, options) {
  const entries = await inspectPath(file, kind);
  await nativePaths(entries.map(item => item.path), options);
  sameSnapshot(entries, await inspectPath(file, kind));
  return entries;
}

// Fixture-capable file boundary, unavailable from the product CLI.
export async function sealInput(file, expected, { check = () => {}, attributes = async () => {} } = {}) {
  check();
  const snapshot = await inspectPath(file);
  await attributes(snapshot.map(item => item.path));
  check();
  const handle = await open(file, 'r');
  try {
    const held = await handle.stat({ bigint: true });
    if (held.dev !== snapshot[0].stat.dev || held.ino !== snapshot[0].stat.ino) throw failure('INPUT_CHANGED');
    await hashHandle(handle, expected, check);
    sameSnapshot(snapshot, await inspectPath(file));
    return { file, expected, snapshot, handle };
  } catch (error) { await handle.close(); throw error; }
}
export async function checkSealed(sealed, { check = () => {}, attributes = async () => {} } = {}) {
  await attributes(sealed.snapshot.map(item => item.path));
  sameSnapshot(sealed.snapshot, await inspectPath(sealed.file));
  await hashHandle(sealed.handle, sealed.expected, check);
  const reopened = await open(sealed.file, 'r');
  try {
    const stat = await reopened.stat({ bigint: true });
    if (stat.dev !== sealed.snapshot[0].stat.dev || stat.ino !== sealed.snapshot[0].stat.ino) throw failure('INPUT_CHANGED');
    await hashHandle(reopened, sealed.expected, check);
  } finally { await reopened.close(); }
  sameSnapshot(sealed.snapshot, await inspectPath(sealed.file));
}

async function inspectHost(options) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw failure('HOST_UNSUPPORTED');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw failure('HOST_UNSUPPORTED', 'Node >=22.12 required');
  await inspectCliAlias(options);
  await checkedPath(path.dirname(FIXED.root), 'directory', options);
  try { await checkedPath(FIXED.root, 'directory', options); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { stdout } = await execute(['--version'], options);
  if (!new RegExp(`^(?:Windows Sandbox(?: CLI)?\\s+)?v?${FIXED.version.replace(/\./g, '\\.')}\\s*$`, 'i').test(stdout.trim())) throw failure('CLI_VERSION', safeError(stdout));
}
async function prepare(id, options) {
  const guard = async action => { options.check(); const value = await action(); options.check(); return value; };
  await checkedPath(path.dirname(FIXED.root), 'directory', options);
  try { await guard(() => mkdir(FIXED.root)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await checkedPath(FIXED.root, 'directory', options);
  const directory = path.join(FIXED.root, id);
  const inputDirectory = path.join(directory, 'input');
  const outputDirectory = path.join(directory, 'output');
  const sealed = [];
  const prepared = { outputDirectory, inputDirectory, sealed, outputExists: false, ready: false,
    configuration: renderWSB(inputDirectory, outputDirectory) };
  options.registerPrepared(prepared);
  await guard(() => mkdir(directory));
  await guard(() => mkdir(inputDirectory));
  options.check();
  await mkdir(outputDirectory);
  prepared.outputExists = true;
  options.check();
  try {
    const attributes = files => nativePaths(files, options);
    sealed.push(await sealInput(BASELINE.path, BASELINE, { attributes, check: options.check }));
    const guestBytes = await guard(() => readFile(GUEST, { signal: options.signal }));
    sealed.push(await sealInput(GUEST, { size: guestBytes.length, sha256: sha(guestBytes) }, { attributes, check: options.check }));
    await copyExclusive(BASELINE.path, path.join(inputDirectory, 'Element Setup 1.12.30.exe'), options);
    await copyExclusive(GUEST, path.join(inputDirectory, 'guest.ps1'), options);
    await guard(() => writeFile(path.join(inputDirectory, 'element-config.json'), CONFIG_TEXT, { flag: 'wx', signal: options.signal }));
    for (const [name, expected] of [
      ['Element Setup 1.12.30.exe', BASELINE], ['guest.ps1', { size: guestBytes.length, sha256: sha(guestBytes) }],
      ['element-config.json', { size: Buffer.byteLength(CONFIG_TEXT), sha256: configHash() }],
    ]) sealed.push(await sealInput(path.join(inputDirectory, name), expected, { attributes, check: options.check }));
    if ((await readdir(inputDirectory)).sort().join('|') !== ['Element Setup 1.12.30.exe', 'element-config.json', 'guest.ps1'].sort().join('|') || (await readdir(outputDirectory)).length) throw failure('MAPPING_CONTENT');
    prepared.inputSnapshot = await checkedPath(inputDirectory, 'directory', options);
    prepared.outputSnapshot = await checkedPath(outputDirectory, 'directory', options);
    prepared.ready = true;
    options.check();
    return prepared;
  } catch (error) {
    await Promise.allSettled(sealed.map(item => item.handle.close()));
    throw error;
  }
}
export async function copyExclusive(source, destination, options) {
  let input, output;
  try {
    options.check(); input = await open(source, 'r');
    options.check(); output = await open(destination, 'wx');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) {
      options.check();
      const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
      options.check();
      if (!bytesRead) break;
      let written = 0;
      while (written < bytesRead) {
        options.check();
        const { bytesWritten } = await output.write(buffer, written, bytesRead - written, position + written);
        options.check();
        if (!bytesWritten) throw failure('INPUT_COPY', 'Zero-byte write');
        written += bytesWritten;
      }
      position += bytesRead;
    }
  } finally { await output?.close(); await input?.close(); }
}
async function inputsUnchanged(prepared, options) {
  sameSnapshot(prepared.inputSnapshot, await checkedPath(prepared.inputDirectory, 'directory', options));
  sameSnapshot(prepared.outputSnapshot, await checkedPath(prepared.outputDirectory, 'directory', options));
  const names = (await readdir(prepared.inputDirectory)).sort();
  if (names.join('|') !== ['Element Setup 1.12.30.exe', 'element-config.json', 'guest.ps1'].sort().join('|')) throw failure('INPUT_CHANGED');
  for (const sealed of prepared.sealed) await checkSealed(sealed, { attributes: files => nativePaths(files, options), check: options.check });
}
async function execute(args, options) {
  return execFileAsync(FIXED.cli, args, { ...options, encoding: 'utf8', windowsHide: true, shell: false, maxBuffer: 1024 * 1024 });
}
// The optional process factory is an internal fixture seam, never a CLI/environment input.
export async function connect(id, options, spawnChild = spawn) {
  options.check();
  const child = spawnChild(FIXED.cli, ['connect', '--id', id], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const byteLimit = 8192;
  let captureStopped = false;
  const captures = ['stdout', 'stderr'].map(name => {
    const capture = { name, chunks: [], bytes: 0, truncated: false };
    child[name]?.on('data', chunk => {
      if (captureStopped) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const retained = Math.min(bytes.length, byteLimit - capture.bytes);
      if (retained) { capture.chunks.push(Buffer.from(bytes.subarray(0, retained))); capture.bytes += retained; }
      if (retained < bytes.length) capture.truncated = true;
      // Keep consuming excess bytes so a full diagnostic buffer cannot block the client.
    });
    child[name]?.on('error', error => { if (!captureStopped) capture.error = errorRecord(error); });
    return capture;
  });
  const stopCapture = () => {
    captureStopped = true;
    for (const capture of captures) {
      try { child[capture.name]?.destroy(); } catch (error) { capture.error = errorRecord(error); }
    }
  };
  let problem;
  let exited = false;
  let closing = false;
  let closePromise;
  child.on('error', error => { problem = error; if (!child.pid) exited = true; stopCapture(); });
  child.on('exit', code => { exited = true; if (!closing) problem = Object.assign(failure('CONNECTION_LOST'), { code }); stopCapture(); });
  const connection = {
    check() { if (problem) throw problem; },
    diagnostics() { return Object.fromEntries(captures.map(capture => [capture.name, {
      text: safeError(Buffer.concat(capture.chunks, capture.bytes).toString('utf8')), capturedBytes: capture.bytes,
      byteLimit, truncated: capture.truncated, potentiallyIncomplete: true, ...(capture.error ? { captureError: { ...capture.error } } : {}),
    }])); },
    beginCleanup() { closing = true; },
    async close() {
      closing = true;
      stopCapture();
      if (exited) return;
      closePromise ??= new Promise((resolve, reject) => {
        child.once('exit', resolve); child.once('error', reject);
        if (!child.kill()) reject(failure('CONNECTION_CLEANUP'));
      });
      await closePromise;
    },
  };
  options.registerConnection(connection);
  const abort = () => { connection.close().catch(() => {}); };
  options.signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve); child.once('error', reject);
      options.signal.addEventListener('abort', () => reject(failure('CANCELLED')), { once: true });
      if (options.signal.aborted) reject(failure('CANCELLED'));
    });
    options.check();
    return connection;
  } finally { options.signal.removeEventListener('abort', abort); }
}
function guestCommand(id) {
  const body = `$ErrorActionPreference='Stop'; Start-Process -FilePath 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','C:\\G1Input\\guest.ps1','-RunId','${id}') -WindowStyle Hidden -ErrorAction Stop | Out-Null`;
  return `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(body, 'utf16le').toString('base64')}`;
}
const LOGIN_PROBE = `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from('exit 0', 'utf16le').toString('base64')}`;

export function validateGuest(value, id) {
  if (!value || value.schema !== 'g1-install-v1' || value.runId !== id) throw failure('INVALID_GUEST_RESULT');
  if (value.status === 'FAIL') throw Object.assign(failure('GUEST_FAILED', value.error ?? value.category ?? 'Guest failed'), { guest: value });
  const flags = ['developmentToolsAbsent', 'defaultProfileSeeded', 'controlledProfileSeeded', 'earlyProcessesGone',
    'controlledLaunch', 'welcomeObserved', 'ownedWindow', 'ownedProcessesGone'];
  const version = item => typeof item === 'string' && /^(1\.12\.30)(\.0)?$/.test(item);
  if (value.status !== 'PASS' || value.environment !== 'Windows Sandbox' || value.architecture !== 'x64' ||
      flags.some(key => value[key] !== true) || value.installExitCode !== 0 || value.mainExitCode !== 0 ||
      !version(value.productVersion) || !version(value.finalProductVersion) || value.displayVersion !== '1.12.30' || value.finalDisplayVersion !== '1.12.30' ||
      value.installerSha256 !== FIXED.sha256 || value.configSha256 !== configHash() ||
      !['File/Quit', 'File/Exit'].includes(value.quitAction) || value.screenshot !== 'welcome.png' ||
      !/^[0-9a-f]{64}$/.test(value.screenshotSha256 ?? '') || !Array.isArray(value.controls) ||
      !value.controls.some(item => /^Welcome to Element$/i.test(item)) ||
      !value.controls.some(item => /^Sign in$/i.test(item)) || !value.controls.some(item => /^Create account$/i.test(item)) ||
      ['ENVIRONMENT', 'INSTALL', 'WELCOME', 'QUIT'].some(key => value.stages?.[key] !== 'PASS')) throw failure('INVALID_GUEST_RESULT');
  return value;
}
async function readGuest(prepared, id, options) {
  const file = path.join(prepared.outputDirectory, `guest-${id}.json`);
  let bytes;
  try {
    await checkedPath(file, 'file', options);
    const stat = await lstat(file);
    if (stat.size > 65536) throw failure('INVALID_GUEST_RESULT');
    bytes = await readFile(file, { signal: options.signal });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const progress = {};
    let phase = 'ENVIRONMENT';
    let elapsedMs = 0;
    for (const name of ['ENVIRONMENT', 'INSTALL', 'WELCOME', 'QUIT']) {
      for (const suffix of ['started', 'passed']) {
        const markerFile = path.join(prepared.outputDirectory, `stage-${name}-${suffix}.json`);
        try {
          const stat = await lstat(markerFile);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw failure('INVALID_GUEST_PROGRESS');
          const marker = JSON.parse(await readFile(markerFile, { encoding: 'utf8', signal: options.signal }));
          if (marker.runId !== id || marker.stage !== name || !Number.isSafeInteger(marker.elapsedMs) || marker.elapsedMs < 0) throw failure('INVALID_GUEST_PROGRESS');
          if (suffix === 'started') { phase = name; elapsedMs = marker.elapsedMs; progress[name] = 'RUNNING'; }
          else { if (marker.status !== 'PASS') throw failure('INVALID_GUEST_PROGRESS'); progress[name] = 'PASS'; }
        } catch (markerError) { if (markerError.code !== 'ENOENT') throw markerError; }
      }
    }
    return { status: 'PENDING', phase, elapsedMs, stages: progress };
  }
  const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (value.status === 'PASS') {
    const pngPath = path.join(prepared.outputDirectory, 'welcome.png');
    await checkedPath(pngPath, 'file', options);
    const stat = await lstat(pngPath);
    if (stat.size < 1024 || stat.size > 32 * 1024 * 1024) throw failure('SCREENSHOT_INVALID');
    const png = await readFile(pngPath, { signal: options.signal });
    if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || sha(png) !== value.screenshotSha256) throw failure('SCREENSHOT_INVALID');
  }
  return value;
}

// Internal fixture seams are never exposed by CLI flags or environment variables.
export async function runHarness(mode, injected = {}) {
  if (!['preflight', 'run'].includes(mode)) throw failure('USAGE', 'Usage: node runtime.mjs preflight|run');
  const deps = { now: Date.now, uuid: randomUUID, acquire: acquireAdmission,
    verify: options => verifyArtifact(BASELINE.path, BASELINE, {
      now: () => { options.check(); return Date.now(); },
      readSignature: signatureOptions => readWindowsSignature({ ...signatureOptions,
        signal: AbortSignal.any([signatureOptions.signal, options.signal]), timeout: Math.min(30000, signatureOptions.timeout, options.timeout) }),
    }),
    inspectHost, prepare, inputsUnchanged, execute, connect, readGuest,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    writeFinal: (prepared, result, options) => writeFile(path.join(prepared.outputDirectory, 'host-final.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', signal: options.signal }),
    terminate: result => { console.error(JSON.stringify(result)); process.exit(1); }, ...injected };
  const deadline = deps.now() + FIXED.totalMs;
  const workDeadline = deadline - FIXED.cleanupMs;
  let stage = 'ADMISSION';
  let admission, prepared, connection;
  let requested = false, owned = false;
  let baseline = [];
  const pending = new Map();
  const track = (operation, controller = null) => {
    pending.set(operation, controller);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  const result = { schema: 'g1-host-v1', mode, status: 'FAIL', stage,
    stages: Object.fromEntries(['ADMISSION', 'VERIFY', 'HOST', 'PREPARE', 'INVENTORY', 'INPUTS_BEFORE', 'CREATE', 'INPUTS_MAPPED', 'CONNECT', 'EXEC', 'GUEST', 'INPUTS_AFTER'].map(name => [name, 'NOT_RUN'])),
    cleanup: { status: 'NOT_OWNED' }, admissionCleanup: { status: 'NOT_OWNED' } };
  function check(limit = workDeadline, signal = deps.signal) {
    if (signal?.aborted) throw failure('CANCELLED');
    if (deps.now() >= limit) throw failure('TIMEOUT');
  }
  async function bounded(fn, cap = 15000, cleanup = false) {
    const limit = Math.min(deps.now() + cap, cleanup ? deadline : workDeadline);
    check(limit, cleanup ? null : deps.signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const external = cleanup ? null : deps.signal;
    external?.addEventListener('abort', cancel, { once: true });
    let timer;
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('TIMEOUT')); }, Math.max(1, limit - deps.now()));
      controller.signal.addEventListener('abort', () => reject(failure(external?.aborted ? 'CANCELLED' : 'TIMEOUT')), { once: true });
    });
    const operation = Promise.resolve().then(() => {
      check(limit, controller.signal);
      return fn({ signal: controller.signal, timeout: Math.max(1, limit - deps.now()),
        check: () => check(limit, controller.signal), registerPrepared: value => { prepared = value; }, registerConnection: value => { connection = value; } });
    });
    track(operation, controller);
    try {
      const value = await Promise.race([operation, expiry]);
      check(limit, external);
      return value;
    } finally { clearTimeout(timer); external?.removeEventListener('abort', cancel); }
  }
  const step = async (name, action, cap = 15000) => { stage = name; result.stage = name; const value = await bounded(action, cap); result.stages[name] = 'PASS'; return value; };
  const closeOwned = action => {
    // Register the returned close promise immediately, before checking the remaining budget. An exhausted
    // deadline cannot make a resource close disappear from the final drain/termination path.
    const closing = track(Promise.resolve(action()));
    return bounded(() => closing, 15000, true);
  };
  try {
    await step('ADMISSION', async options => { admission = await deps.acquire(options); });
    result.artifact = await step('VERIFY', options => deps.verify(options), 60000);
    await step('HOST', options => deps.inspectHost(options));
    if (mode === 'run') {
      const id = deps.uuid().toLowerCase();
      if (!UUID.test(id)) throw failure('INVALID_ID');
      result.runId = id;
      await step('PREPARE', async options => { prepared = await deps.prepare(id, options); }, 60000);
      baseline = parseInventory(await step('INVENTORY', options => deps.execute(['list', '--raw'], options)));
      result.existingIds = baseline;
      if (baseline.includes(id)) throw failure('ID_CONFLICT');
      await step('INPUTS_BEFORE', options => deps.inputsUnchanged(prepared, options), 60000);
      stage = 'CREATE'; result.stage = stage;
      const created = await bounded(options => { requested = true; return deps.execute(['start', '--id', id, '--config', prepared.configuration, '--raw'], options); });
      result.createResponse = safeError(created.stdout);
      parseCreated(created, id);
      const after = parseInventory(await bounded(options => deps.execute(['list', '--raw'], options)));
      if (!after.includes(id)) throw failure('OWNERSHIP_UNVERIFIED');
      owned = true;
      result.observedForeignIds = [...new Set([...baseline, ...after.filter(item => item !== id)])];
      result.stages.CREATE = 'PASS';
      await step('INPUTS_MAPPED', options => deps.inputsUnchanged(prepared, options), 60000);
      await step('CONNECT', async options => {
        connection = await deps.connect(id, options);
        // Host process spawn does not prove that RDP has established an active login.
        // Readiness probes share this step's deadline; the guest payload is never retried.
        result.loginReadiness = { attempts: 0 };
        while (true) {
          options.check(); connection.check();
          result.loginReadiness.attempts++;
          let response;
          try { response = await deps.execute(['exec', '--id', id, '--run-as', 'ExistingLogin', '--command', LOGIN_PROBE, '--raw'], options); }
          catch (error) {
            if (error.code !== 2147943712) throw error;
            result.loginReadiness.lastNativeError = errorRecord(error);
            connection.check(); options.check();
            await deps.wait(250);
            options.check();
            continue;
          }
          connection.check(); options.check();
          validateExec(response);
          break;
        }
      });
      const guestDispatchedAt = deps.now();
      await step('EXEC', async options => { connection.check(); validateExec(await deps.execute(['exec', '--id', id, '--run-as', 'ExistingLogin', '--command', guestCommand(id), '--raw'], options)); });
      stage = 'GUEST'; result.stage = stage;
      while (true) {
        check(); connection.check();
        const value = await bounded(options => deps.readGuest(prepared, id, options));
        if (value?.status === 'PENDING') {
          result.guestProgress = value;
          const cap = { ENVIRONMENT: 15000, INSTALL: 120000, WELCOME: 60000, QUIT: 15000 }[value.phase];
          if (!cap || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > deps.now() - guestDispatchedAt) throw failure('INVALID_GUEST_PROGRESS');
          check(Math.min(workDeadline, guestDispatchedAt + value.elapsedMs + cap));
        } else if (value !== null) { result.guest = sanitized(validateGuest(value, id)); break; }
        await bounded(() => deps.wait(Math.min(250, workDeadline - deps.now())));
      }
      result.stages.GUEST = 'PASS';
      await step('INPUTS_AFTER', options => deps.inputsUnchanged(prepared, options), 60000);
      connection.check();
    }
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL'; result.stage = stage; result.stages[stage] = 'FAIL';
    Object.assign(result, errorRecord(error));
    if (error.guest) result.guest = sanitized(error.guest);
  } finally {
    let drainFailed = false;
    // Abort pending work, terminate any registered connector, then drain its continuations
    // before closing file handles or releasing admission. No detached preparation survives return.
    for (const controller of pending.values()) controller?.abort();
    let connectionClosing;
    if (connection) { connection.beginCleanup?.(); connectionClosing = track(Promise.resolve().then(() => connection.close())); }
    if (pending.size) {
      const draining = Promise.allSettled([...pending.keys()]);
      try { await bounded(() => draining, Math.min(15000, Math.max(1, (deadline - deps.now()) / 2)), true); result.operationCleanup = { status: 'PASS' }; }
      catch (error) { drainFailed = true; result.status = 'FAIL'; result.operationCleanup = { status: 'FAIL', ...errorRecord(error) }; }
    }
    connection?.beginCleanup?.();
    if (requested && !owned) result.cleanup = { status: 'UNKNOWN' };
    if (owned) {
      try {
        await bounded(options => deps.execute(['stop', '--id', result.runId, '--raw'], options), 15000, true);
        while (true) {
          const remaining = parseInventory(await bounded(options => deps.execute(['list', '--raw'], options), 15000, true));
          if (!remaining.includes(result.runId)) {
            if (result.observedForeignIds.some(id => !remaining.includes(id))) throw failure('FOREIGN_INSTANCE_MISSING');
            break;
          }
          if (deadline - deps.now() <= 5000) throw failure('CLEANUP_TIMEOUT');
          await bounded(() => deps.wait(250), 15000, true);
        }
        result.cleanup = { status: 'PASS', unrelatedPreserved: true };
      } catch (error) { result.cleanup = { status: 'FAIL', ...errorRecord(error) }; result.status = 'FAIL'; }
    }
    if (connection) {
      try { await closeOwned(() => connectionClosing ?? connection.close()); result.connectionCleanup = { status: 'PASS' }; }
      catch (error) { result.connectionCleanup = { status: 'FAIL', ...errorRecord(error) }; result.status = 'FAIL'; }
      if (connection.diagnostics) {
        try { result.connectionDiagnostics = sanitized(connection.diagnostics()); }
        catch (error) { result.connectionDiagnostics = { captureError: errorRecord(error) }; }
      }
    }
    if (prepared && prepared.ready !== false && !drainFailed) {
      try { await bounded(options => deps.inputsUnchanged(prepared, options), 15000, true); result.inputIntegrity = { status: 'PASS' }; }
      catch (error) { result.inputIntegrity = { status: 'FAIL', ...errorRecord(error) }; result.status = 'FAIL'; }
    }
    if (prepared?.sealed) {
      try { await Promise.all(prepared.sealed.map(async item => closeOwned(() => item.handle.close()))); }
      catch (error) { result.inputCleanup = { status: 'FAIL', ...errorRecord(error) }; result.status = 'FAIL'; }
    }
    // Cleanup subprocesses/file closures also must settle before admission can be released.
    if (!drainFailed && pending.size) {
      for (const controller of pending.values()) controller?.abort();
      const draining = Promise.allSettled([...pending.keys()]);
      try { await bounded(() => draining, Math.min(15000, Math.max(1, (deadline - deps.now()) / 2)), true); }
      catch (error) { drainFailed = true; result.status = 'FAIL'; result.operationCleanup = { status: 'FAIL', ...errorRecord(error) }; }
    }
    if (admission) {
      if (drainFailed) result.admissionCleanup = { status: 'FAIL', category: 'HELD_UNTIL_PROCESS_EXIT' };
      else {
        try { await closeOwned(() => admission.release()); result.admissionCleanup = { status: 'PASS' }; }
        catch (error) { result.admissionCleanup = { status: 'FAIL', ...errorRecord(error) }; result.status = 'FAIL'; }
      }
    }
    // The admission close itself is tracked: a timed-out release must not leave an
    // unobserved live pipe (or a late release continuation) after normal harness return.
    if (!drainFailed && pending.size) {
      for (const controller of pending.values()) controller?.abort();
      const draining = Promise.allSettled([...pending.keys()]);
      try { await bounded(() => draining, Math.min(15000, Math.max(1, (deadline - deps.now()) / 2)), true); }
      catch (error) { drainFailed = true; result.status = 'FAIL'; result.operationCleanup = { status: 'FAIL', ...errorRecord(error) }; }
    }
    if (prepared && prepared.outputExists !== false) {
      // This immutable receipt is serialized before publication can be acknowledged.
      // Only the runner's terminal verdict can confirm successful publication in time.
      const receipt = sanitized({ ...result, status: result.status === 'FAIL' ? 'FAIL' : 'UNKNOWN',
        verdictSource: 'runner process exit + emitted terminal JSON', publication: 'PENDING_AT_SERIALIZATION' });
      try { await bounded(options => deps.writeFinal(prepared, receipt, options), 15000, true); }
      catch (error) { result.status = 'FAIL'; result.evidence = { status: 'FAIL', ...errorRecord(error) }; }
    }
    if (!drainFailed && pending.size) {
      for (const controller of pending.values()) controller?.abort();
      const draining = Promise.allSettled([...pending.keys()]);
      try { await bounded(() => draining, Math.min(15000, Math.max(1, (deadline - deps.now()) / 2)), true); }
      catch (error) { drainFailed = true; result.status = 'FAIL'; result.operationCleanup = { status: 'FAIL', ...errorRecord(error) }; }
    }
    if (drainFailed) {
      deps.terminate(result);
      throw failure('TERMINATION_REQUIRED', 'Terminal hook returned with pending work; admission remains held');
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['preflight', 'run'].includes(args[0])) {
    console.error('Usage: node runtime.mjs preflight|run'); process.exitCode = 1;
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    runHarness(args[0], { signal: controller.signal }).then(result => {
      console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'PASS' ? 0 : 1;
    }).catch(error => { console.error(safeError(error.message)); process.exitCode = 1; }).finally(() => {
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    });
  }
}

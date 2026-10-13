import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, lstat, realpath, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, win32 } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const execFile = promisify(execFileCallback);
const directory = dirname(fileURLToPath(import.meta.url));
const project = 'babacom-matrix-proof';
const distro = 'BabaCom-Matrix-Proof';
const runtime = 'D:/Code/babacom/.matrix-runtime';
const secretDirectory = `${runtime}/secrets`;
const secretNames = ['homeserver.yaml', 'postgres.env', 'test-users.json'];
const linuxSecrets = '/mnt/d/Code/babacom/.matrix-runtime/secrets';
const keepalivePid = '/run/babacom-matrix-proof-keepalive.pid';
const images = {
  synapse: 'ghcr.io/element-hq/synapse@sha256:43fd704aedef503a6fba2e5696439ef7bac24479a3472e364561973f550e4aad',
  element: 'ghcr.io/element-hq/element-web@sha256:9189d2871ecc9ba8a79a1a94c29c4696648fbaa7a6979092919d9b18d0f1ae09',
  postgres: 'docker.io/library/postgres@sha256:66aafa11cf15800a3c94763f7e11d1e7b2e37e5e84bc4ce027cb6e1e4bfaf4df',
};
const check = (ok, label) => { if (!ok) throw new Error(label); };
function privateJson(text) {
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid JSON; private input withheld'); }
}
const pass = label => console.log(`PASS ${label}`);
const linuxPath = p => '/mnt/' + p.replaceAll('\\', '/').replace(/^([A-Z]):/i, (_, drive) => drive.toLowerCase());
let deadline = Infinity;
function remaining(maximum) {
  const ms = Math.min(maximum, deadline - Date.now());
  check(ms > 0, 'DEADLINE: command budget exhausted');
  return Math.ceil(ms);
}

// Child output stays in memory: Compose config/inspect and Matrix responses can contain secrets.
async function run(executable, args, label, maximum = 15000) {
  try {
    const { stdout } = await execFile(executable, args, {
      timeout: remaining(maximum), windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer',
    });
    return (stdout.includes(0) ? stdout.toString('utf16le') : stdout.toString('utf8')).trim();
  } catch (error) {
    throw new Error(`${label}: child exit=${typeof error.code === 'number' ? error.code : error.code ?? 'unknown'}; output withheld`);
  }
}
const psQuote = s => `'${s.replaceAll("'", "''")}'`;
const registeredPath = p => win32.resolve(p.replace(/^\\\\\?\\/, '')).toLowerCase();
// #97/C0 require a valid version response. These v3 core endpoints need v1.1;
// the research's v1.17 edition is not a claim of complete component conformance.
const validVersions = versions => Array.isArray(versions) && versions.includes('v1.1') && versions.every(version => typeof version === 'string' && /^(?:v1\.\d+|r0\.\d+\.\d+)$/.test(version));
const powershell = script => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; ${script}`], 'Windows permission check');
const wsl = (args, label, maximum = 15000) => run('wsl.exe', ['-d', distro, '-u', 'root', '--cd', '/', '--exec', 'timeout', '-k', '1', String(Math.ceil(remaining(maximum) / 1000)), ...args], label, maximum);
const docker = (args, label, maximum) => wsl(['docker', ...args], label, maximum);
const compose = (args, label, maximum) => docker(['compose', '--project-name', project, '--file', linuxPath(`${directory}/compose.yaml`), ...args], label, maximum);

async function checkOwner() {
  check(process.platform === 'win32', 'HOLD: proof requires Windows and the signed dedicated WSL2 distribution');
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(major > 22 || (major === 22 && minor >= 12), 'HOLD: Node >=22.12 required');
  check((await realpath(runtime)).toLowerCase() === resolve(runtime).toLowerCase(), 'HOLD: runtime path redirected');
  check(!(await lstat(`${runtime}/wsl/ext4.vhdx`)).isSymbolicLink(), 'HOLD: virtual disk redirected');
  const location = privateJson(await powershell(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss' | Get-ItemProperty | Where-Object DistributionName -eq ${psQuote(distro)} | Select-Object BasePath,Version | ConvertTo-Json -Compress`));
  check(location.Version === 2 && registeredPath(location.BasePath) === registeredPath(resolve(`${runtime}/wsl`)), 'HOLD: WSL resource ownership mismatch');
  check(await wsl(['cat', '/.babacom-matrix-proof'], 'WSL ownership') === project, 'HOLD: WSL marker mismatch');
  await wsl(['sh', '-c', 'test "$(. /etc/os-release; echo "$ID:$VERSION_ID")" = ubuntu:24.04'], 'Ubuntu version');
  await wsl(['sh', '-c', 'findmnt -no OPTIONS /mnt/d | grep -qw metadata'], 'Linux permission metadata');
}

async function protectNewPath(path, isDirectory) {
  const fileType = isDirectory ? 'Directory' : 'File';
  const inheritance = isDirectory ? 'ContainerInherit,ObjectInherit' : 'None';
  // Preserve the current owner/group: resetting them unnecessarily requires WRITE_OWNER.
  await powershell(`$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[IO.${fileType}]::GetAccessControl(${psQuote(path)}); if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.Value) {throw 'Wrong owner'}; $acl.SetAccessRuleProtection($true,$false); foreach($principal in @($identity.Value,'S-1-5-18','S-1-5-32-544')) { $sid=New-Object Security.Principal.SecurityIdentifier($principal); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl',${psQuote(inheritance)},'None','Allow'); $acl.AddAccessRule($rule) }; [IO.${fileType}]::SetAccessControl(${psQuote(path)},$acl)`);
}
async function checkWindowsAcl(paths) {
  const report = privateJson(await powershell(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $items=@(foreach($path in @(${paths.map(psQuote).join(',')})) { $acl=if([IO.Directory]::Exists($path)) {[IO.Directory]::GetAccessControl($path)} else {[IO.File]::GetAccessControl($path)}; [pscustomobject]@{ owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; protected=$acl.AreAccessRulesProtected; entries=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); inherited=$_.IsInherited} }) } }); [pscustomobject]@{sid=$sid; items=$items} | ConvertTo-Json -Depth 6 -Compress`));
  for (const item of report.items) {
    check(item.owner === report.sid && item.protected, 'ACL: wrong owner or inherited DACL');
    validateAcl(item.entries, report.sid);
  }
}

async function secrets() {
  const paths = secretNames.map(name => `${secretDirectory}/${name}`);
  const exists = await lstat(secretDirectory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (exists) check(!exists.isSymbolicLink() && registeredPath(await realpath(secretDirectory)) === registeredPath(secretDirectory), 'ACL: secrets path redirected');
  if (!exists || (await readdir(secretDirectory)).length === 0) {
    // Empty directory is protected and checked before any secret bytes are created.
    if (!exists) {
      await powershell(`New-Item -ItemType Directory -Path ${psQuote(secretDirectory)} -ErrorAction Stop | Out-Null`);
      await protectNewPath(secretDirectory, true);
    }
    await checkWindowsAcl([secretDirectory]);
    const random = () => randomBytes(32).toString('hex');
    const databasePassword = random();
    let homeserver = await readFile(`${directory}/homeserver.yaml.example`, 'utf8');
    for (const [placeholder, value] of Object.entries({ DATABASE_PASSWORD: databasePassword, REGISTRATION_SECRET: random(), MACAROON_SECRET: random(), FORM_SECRET: random() })) homeserver = homeserver.replace(`__${placeholder}__`, value);
    const users = Object.fromEntries(['proof-a', 'proof-b', 'proof-outsider'].map(name => [name, { password: random() }]));
    for (const [i, contents] of [homeserver, `POSTGRES_PASSWORD=${databasePassword}\n`, JSON.stringify(users)].entries()) {
      await writeFile(paths[i], contents, { flag: 'wx', mode: 0o600 });
      await protectNewPath(paths[i], false);
    }
    await wsl(['chmod', '700', linuxSecrets], 'Linux secrets directory');
    await wsl(['chown', '991:991', `${linuxSecrets}/homeserver.yaml`], 'Linux config owner');
    await wsl(['chmod', '400', `${linuxSecrets}/homeserver.yaml`], 'Linux config mode');
    await wsl(['chmod', '600', `${linuxSecrets}/postgres.env`, `${linuxSecrets}/test-users.json`], 'Linux credentials mode');
  }
  check(!(await lstat(secretDirectory)).isSymbolicLink(), 'ACL: secrets path redirected');
  check((await readdir(secretDirectory)).sort().join(',') === [...secretNames].sort().join(','), 'HOLD: partial or unknown secrets; existing files retained');
  for (const path of paths) check(!(await lstat(path)).isSymbolicLink(), 'ACL: secret file redirected');
  await checkWindowsAcl([secretDirectory, ...paths]);
  const modes = (await wsl(['stat', '-c', '%a:%u:%g', linuxSecrets, ...secretNames.map(name => `${linuxSecrets}/${name}`)], 'Linux secret permission check')).split(/\r?\n/);
  check(modes.join(',') === '700:0:0,400:991:991,600:0:0,600:0:0', 'ACL: Linux secret permissions mismatch');
  let expectedHome = await readFile(`${directory}/homeserver.yaml.example`, 'utf8');
  const actualHome = await readFile(paths[0], 'utf8');
  const placeholders = { DATABASE_PASSWORD: 'password', REGISTRATION_SECRET: 'registration_shared_secret', MACAROON_SECRET: 'macaroon_secret_key', FORM_SECRET: 'form_secret' };
  let databasePassword;
  for (const [placeholder, setting] of Object.entries(placeholders)) {
    const value = actualHome.match(new RegExp(`^\\s*${setting}: ([a-f0-9]{64})$`, 'm'))?.[1];
    check(value, 'HOLD: generated secret format mismatch');
    expectedHome = expectedHome.replace(`__${placeholder}__`, value);
    if (placeholder === 'DATABASE_PASSWORD') databasePassword = value;
  }
  check(actualHome === expectedHome && await readFile(paths[1], 'utf8') === `POSTGRES_PASSWORD=${databasePassword}\n`, 'HOLD: live homeserver policy or database secret differs; files retained');
  const users = privateJson(await readFile(paths[2], 'utf8'));
  check(Object.keys(users).sort().join(',') === 'proof-a,proof-b,proof-outsider' && Object.values(users).every(user => /^[a-f0-9]{64}$/.test(user.password)), 'HOLD: synthetic account file mismatch');
  pass('Windows ACL and independent Linux secret permissions; existing secrets retained');
  return users;
}

async function containers() {
  const ids = (await docker(['ps', '-aq'], 'Container inventory')).split(/\s+/).filter(Boolean);
  const items = ids.length ? privateJson(await docker(['inspect', ...ids], 'Container ownership')) : [];
  for (const item of items) {
    const labels = item.Config.Labels;
    check(labels?.['com.docker.compose.project'] === project && Object.hasOwn(images, labels['com.docker.compose.service']), 'HOLD: unknown container in dedicated engine');
    check(item.Config.Image === images[labels['com.docker.compose.service']], 'HOLD: unexpected running image');
  }
  return items;
}

async function configuration() {
  await checkOwner();
  const users = await secrets();
  const config = privateJson(await compose(['config', '--format', 'json'], 'Compose config'));
  validateConfig(config);
  for (const [name, image] of Object.entries(images)) {
    check(config.services[name].image === image && config.services[name].platform === 'linux/amd64', 'ISOLATION: image or platform differs from signed candidate');
    const [artifact] = privateJson(await docker(['image', 'inspect', image], 'Pinned image check'));
    check(artifact.Os === 'linux' && artifact.Architecture === 'amd64' && artifact.RepoDigests.some(digest => digest.endsWith(image.slice(image.indexOf('@')))), 'HOLD: actual artifact digest/platform mismatch');
    if (name === 'synapse') check(artifact.Config.Labels?.['org.opencontainers.image.version'] === '1.162.0', 'HOLD: Synapse metadata version mismatch');
    if (name === 'element') check(artifact.Config.Labels?.['org.opencontainers.image.version'] === 'v1.12.30', 'HOLD: Element metadata version mismatch');
  }
  const volumes = (await docker(['volume', 'ls', '--format', '{{json .}}'], 'Volume inventory')).split(/\r?\n/).filter(Boolean).map(privateJson);
  for (const volume of volumes) {
    check([`${project}_database`, `${project}_data`].includes(volume.Name), 'HOLD: unknown volume in dedicated engine');
    const [detail] = privateJson(await docker(['volume', 'inspect', volume.Name], 'Volume ownership'));
    check(detail.Labels?.['com.docker.compose.project'] === project, 'HOLD: volume ownership mismatch');
  }
  await containers();
  pass('immutable official images, linux/amd64, isolated network and loopback-only Compose config');
  return users;
}

async function portsAvailable() {
  for (const port of [18008, 18080]) {
    const server = createServer();
    await new Promise((accept, reject) => { server.once('error', () => reject(new Error(`BUSY: Windows loopback port ${port}`))); server.listen({ host: '127.0.0.1', port, exclusive: true }, accept); });
    await new Promise(accept => server.close(accept));
  }
  check(!(await wsl(['ss', '-H', '-ltn', '( sport = :18008 or sport = :18080 )'], 'WSL port availability')), 'BUSY: WSL proof port occupied');
}

async function startKeepalive(onLaunch = () => {}) {
  // systemd services alone do not keep WSL alive. This bounded, marked WSL client does.
  await wsl(['sh', '-c', `test ! -e ${keepalivePid}`], 'BUSY: owned WSL keepalive already exists');
  const child = spawn('wsl.exe', ['-d', distro, '-u', 'root', '--cd', '/', '--exec', 'sh', '-c', `set -eu; umask 077; set -C; echo $$ > ${keepalivePid}; exec env BABACOM_MATRIX_PROOF_KEEPALIVE=${project} sleep 3600`], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', () => reject(new Error('WSL keepalive launch failed'))); });
  onLaunch();
  child.unref();
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await checkKeepalive(); return; } catch { await delay(100); }
  }
  throw new Error('WSL keepalive ownership could not be confirmed');
}

async function checkKeepalive(stop = false) {
  const script = `set -eu; test "$(stat -c '%a:%u' ${keepalivePid})" = '600:0'; pid=$(cat ${keepalivePid}); case "$pid" in ''|*[!0-9]*) exit 8;; esac; if test ! -d /proc/$pid; then ${stop ? `rm -- ${keepalivePid}; exit 0` : 'exit 8'}; fi; test "$(cat /proc/$pid/comm)" = sleep; tr '\\0' '\\n' < /proc/$pid/environ | grep -qx 'BABACOM_MATRIX_PROOF_KEEPALIVE=${project}'; ${stop ? `kill "$pid"; rm -- ${keepalivePid}` : 'true'}`;
  await wsl(['sh', '-c', script], 'WSL keepalive ownership check');
}

async function withStartupCleanup(start, cleanup) {
  try { return await start(); }
  catch (error) {
    try { await cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], `${error.message}; startup cleanup failed: ${cleanupError.message}`); }
    throw error;
  }
}

async function stopOwnedRuntime() {
  await checkOwner();
  const failures = [];
  try {
    await containers(); // No stop request is sent for an unknown owner.
    await compose(['stop', '--timeout', '10'], 'Owned project stop', 40000);
    check((await containers()).every(item => !item.State.Running), 'STOP: owned service remains running');
  } catch (error) { failures.push(error); }
  // A container failure must not skip independently verified, owned keepalive cleanup.
  try { await checkKeepalive(true); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
}

async function runtimeIsolation() {
  const items = await containers();
  check(items.length === 3 && items.every(item => item.State.Running), 'ISOLATION: three owned services must run');
  for (const item of items) {
    const service = item.Config.Labels['com.docker.compose.service'];
    const expected = service === 'element' ? [['8008/tcp', '18008'], ['80/tcp', '18080']] : [];
    const bindings = item.HostConfig.PortBindings ?? {};
    check(Object.keys(bindings).length === expected.length && expected.every(([port, published]) => bindings[port]?.length === 1 && bindings[port][0].HostIp === '127.0.0.1' && bindings[port][0].HostPort === published && item.NetworkSettings.Ports[port]?.[0]?.HostIp === '127.0.0.1' && item.NetworkSettings.Ports[port][0].HostPort === published), 'ISOLATION: requested and actual published ports');
    const networks = service === 'element' ? [`${project}_ingress`, `${project}_isolated`] : [`${project}_isolated`];
    check(Object.keys(item.NetworkSettings.Networks).sort().join(',') === networks.join(','), 'ISOLATION: actual container networks');
  }
  const [network] = privateJson(await docker(['network', 'inspect', `${project}_isolated`], 'Network isolation'));
  check(network.Internal === true && network.EnableIPv6 === false && network.Labels?.['com.docker.compose.project'] === project, 'ISOLATION: actual internal network');
  const [ingress] = privateJson(await docker(['network', 'inspect', `${project}_ingress`], 'Ingress network ownership'));
  check(ingress.Internal === false && ingress.Labels?.['com.docker.compose.project'] === project && Object.keys(ingress.Containers).length === 1, 'ISOLATION: only static nginx ingress may use the frontend network');
  // Docker's internal network is the outbound enforcement boundary, independently of Synapse policy.
  await compose(['exec', '-T', 'synapse', 'python', '-c', 'import socket\ns=socket.socket(); s.settimeout(1)\ntry:\n s.connect(("1.1.1.1",443))\nexcept OSError:\n print("EGRESS_BLOCKED")\nelse:\n raise SystemExit(9)\nfinally:\n s.close()'], 'Outbound isolation probe', 5000);
  const listeners = await wsl(['ss', '-H', '-ltn', '( sport = :18008 or sport = :18080 )'], 'Actual WSL listeners');
  check(listeners.split(/\r?\n/).filter(Boolean).length === 2 && listeners.split(/\r?\n/).every(line => /127\.0\.0\.1:(18008|18080)\s/.test(line)), 'ISOLATION: WSL listener address');
  const win = privateJson(await powershell('[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -in 18008,18080 | ForEach-Object {[pscustomobject]@{LocalAddress=$_.Address.IPAddressToString;LocalPort=$_.Port}} | ConvertTo-Json -Compress'));
  const windowsListeners = Array.isArray(win) ? win : [win];
  check(windowsListeners.length >= 2 && windowsListeners.every(item => ['127.0.0.1', '::1'].includes(item.LocalAddress)), 'ISOLATION: Windows listener address');
  pass('actual WSL/Windows loopback listeners and container outbound isolation');
}

async function request(path, { token, method = 'GET', body, status = 200, errcode } = {}) {
  while (true) {
  const response = await fetch(`http://127.0.0.1:18008${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(remaining(10000)), redirect: 'error',
  });
  const data = privateJson(await response.text());
  if (response.status === 429 && status !== 429 && data.errcode === 'M_LIMIT_EXCEEDED') {
    const wait = data.retry_after_ms;
    check(Number.isSafeInteger(wait) && wait >= 0 && wait < remaining(100000) - 1000, 'RATE_LIMIT: server wait exceeds remaining proof budget');
    console.log(`WAIT stock Matrix rate limit ${wait}ms; deadline retained`);
    await delay(Math.max(1, wait));
    continue;
  }
  check(response.status === status, `HTTP ${method} ${path.split('?')[0]}: expected ${status}, received ${response.status}${response.status === 429 ? ` retry_after_ms=${Number(data.retry_after_ms)}` : ''}`);
  if (errcode) check(data.errcode === errcode, 'HTTP: unexpected Matrix error code');
  return data;
  }
}

async function ready() {
  while (true) {
    try {
      await request('/_matrix/client/versions');
      const response = await fetch('http://127.0.0.1:18080/version', { signal: AbortSignal.timeout(remaining(2000)), redirect: 'error' });
      check(response.ok && (await response.text()).trim() === '1.12.30', 'Element version/readiness');
      return;
    } catch (error) {
      if (deadline - Date.now() < 1200) throw error;
      await delay(500);
    }
  }
}

async function login(name, users) {
  const response = await request('/_matrix/client/v3/login', { method: 'POST', body: { type: 'm.login.password', identifier: { type: 'm.id.user', user: name }, password: users[name].password, initial_device_display_name: 'BabaCom isolated proof' } });
  check(response.user_id === `@${name}:proof.babacom.test` && response.access_token, 'Login identity');
  return { name, token: response.access_token, userId: response.user_id };
}

function uiSessionQuery(name, device) {
  check(['proof-a', 'proof-b'].includes(name) && typeof device === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(device), 'UI session selector is outside this synthetic proof');
  return `SELECT t.token FROM access_tokens t JOIN devices d ON d.user_id=t.user_id AND d.device_id=t.device_id WHERE t.user_id='@${name}:proof.babacom.test' AND t.device_id='${device}' AND d.display_name='127.0.0.1:18080: Edge on Windows'`;
}

// Observe the actual stock UI session; never export its token to the coordinator, files or argv.
// Start this command with the public device id shown in Element's Sessions panel, then log out in UI.
async function verifyUiSession() {
  deadline = Date.now() + 120000;
  const [name, device] = process.argv.slice(3);
  const query = uiSessionQuery(name, device);
  await configuration();
  await runtimeIsolation();
  let token;
  try {
    token = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'synapse', '-d', 'synapse', '-Atc', query], 'Read-only synthetic UI session observation', 5000);
    check(/^[A-Za-z0-9_-]{32,4096}$/.test(token), 'UI session is missing or ambiguous; private query output withheld');
    const identity = await request('/_matrix/client/v3/account/whoami', { token });
    check(identity.user_id === `@${name}:proof.babacom.test` && identity.device_id === device, 'UI account/device identity mismatch');
    pass(`stock UI session ${name}/${device} is valid; waiting for UI logout`);
    while (true) {
      const response = await fetch('http://127.0.0.1:18008/_matrix/client/v3/account/whoami', {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(remaining(2000)), redirect: 'error',
      });
      const data = privateJson(await response.text());
      if (response.status === 401) {
        check(data.errcode === 'M_UNKNOWN_TOKEN', 'UI logout returned an unexpected rejection code');
        pass(`stock UI session ${name}/${device}: same old token rejected with 401/M_UNKNOWN_TOKEN`);
        return;
      }
      check(response.status === 200 && data.user_id === identity.user_id && data.device_id === device, 'UI session observation failed before revocation');
      await delay(Math.min(500, remaining(500)));
    }
  } finally { token = undefined; }
}

function accountTimeouts(budget) {
  check(budget >= 4000, 'DEADLINE: insufficient budget to start account writes');
  // Leave one second for the container kill and another for the outer WSL timeout.
  const innerSeconds = Math.floor((budget - 2000) / 1000);
  return { innerSeconds, outerSeconds: innerSeconds + 1, hostMs: budget };
}

async function createUsers(users) {
  const limits = accountTimeouts(remaining(37000));
  // Uses the stock local administration command. Passwords are supplied on stdin, never argv.
  const code = 'import json,sys,subprocess\nu=json.load(sys.stdin)\nfor name,item in u.items():\n p=subprocess.run(["register_new_matrix_user","-c","/run/secrets/homeserver.yaml","-u",name,"--no-admin","http://127.0.0.1:8008"],input=item["password"]+"\\n"+item["password"]+"\\n",text=True,capture_output=True,timeout=10)\n if p.returncode and "User ID already taken" not in p.stdout+p.stderr:\n  raise SystemExit(8)\nprint("ACCOUNT_COMMANDS_OK")';
  // execFile has no stdin option, so explicitly bound this one child and retain all output privately.
  await new Promise((accept, reject) => {
    const child = spawn('wsl.exe', ['-d', distro, '-u', 'root', '--cd', '/', '--exec', 'timeout', '-k', '1', String(limits.outerSeconds), 'docker', 'compose', '--project-name', project, '--file', linuxPath(`${directory}/compose.yaml`), 'exec', '-T', 'synapse', 'timeout', '-k', '1', String(limits.innerSeconds), 'python', '-c', code], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('DEADLINE: local account creation')); }, limits.hostMs);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Local account command failed')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`Local account command exit=${code}; output withheld`)); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(users));
  });
  // `verify` checks retained passwords via real login. Avoid redundant login bursts in `up`.
  pass('synthetic account initialization via container-local stock admin command; existing accounts retained');
}

async function up() {
  deadline = Date.now() + 120000;
  const users = await configuration();
  await portsAvailable();
  let launched = false;
  await withStartupCleanup(async () => {
    await startKeepalive(() => { launched = true; });
    await compose(['run', '--rm', '--no-deps', '--user', '0:0', '--entrypoint', 'sh', 'synapse', '-c', 'chown 991:991 /data'], 'Owned data directory initialization');
    await compose(['run', '--rm', '--no-deps', '--entrypoint', 'python', 'synapse', '-m', 'synapse.app.homeserver', '--config-path', '/run/secrets/homeserver.yaml', '--generate-keys'], 'Stock signing-key initialization');
    await compose(['up', '-d', '--wait', '--wait-timeout', '60'], 'Owned services readiness', 65000);
    await ready();
    await runtimeIsolation();
    await createUsers(users);
  }, async () => {
    if (!launched) return;
    deadline = Date.now() + 60000; // A failed startup gets a separate, bounded stop budget.
    await stopOwnedRuntime();
    pass('failed startup stopped owned services and keepalive; volumes and secrets retained');
  });
  pass('up completed inside 120-second budget');
}

async function logoutSessions(sessions, client = request) {
  const outcomes = await Promise.allSettled(sessions.map(async session => {
    await client('/_matrix/client/v3/logout', { method: 'POST', token: session.token, body: {} });
    await client('/_matrix/client/v3/account/whoami', { token: session.token, status: 401, errcode: 'M_UNKNOWN_TOKEN' });
    session.token = undefined;
  }));
  return outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
}

async function verify() {
  const finishBy = Date.now() + 120000;
  deadline = finishBy - 15000; // Reserve bounded logout time even when a test fails.
  const sessions = [];
  let failure;
  try {
    const users = await configuration();
    await runtimeIsolation();
    const versions = await request('/_matrix/client/versions');
    check(validVersions(versions.versions), 'Matrix Client-Server version endpoint');
    console.log(`ADVERTISED_VERSIONS ${versions.versions.join(',')}; broader specification conformance NOT_RUN`);
    check(await compose(['exec', '-T', 'synapse', 'python', '-c', 'import synapse; print(synapse.__version__)'], 'Synapse runtime version') === '1.162.0', 'Synapse runtime version mismatch');
    check((await compose(['exec', '-T', 'postgres', 'postgres', '--version'], 'PostgreSQL runtime version')).includes('17.11'), 'PostgreSQL runtime version mismatch');
    await request('/_matrix/client/v3/register', { method: 'POST', body: {}, status: 403, errcode: 'M_FORBIDDEN' });
    await request('/_matrix/client/v3/publicRooms', { status: 401, errcode: 'M_MISSING_TOKEN' });
    for (const name of ['proof-a', 'proof-b', 'proof-outsider']) sessions.push(await login(name, users));
    const [a, b, outsider] = sessions;
    for (const session of sessions) check((await request('/_matrix/client/v3/account/whoami', { token: session.token })).user_id === session.userId, 'whoami identity mismatch');
    pass('stock runtime versions, standard login/whoami, closed registration and unauthenticated directory');
    const room = await request('/_matrix/client/v3/createRoom', { method: 'POST', token: a.token, body: { visibility: 'private', preset: 'private_chat', name: `BabaCom Proof ${new Date().toISOString()}`, creation_content: { 'm.federate': false }, initial_state: [{ type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } }] } });
    const base = `/_matrix/client/v3/rooms/${encodeURIComponent(room.room_id)}`;
    await request(`/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`, { method: 'POST', token: b.token, body: {}, status: 403, errcode: 'M_FORBIDDEN' });
    await request(`${base}/invite`, { method: 'POST', token: a.token, body: { user_id: b.userId } });
    await request(`/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`, { method: 'POST', token: b.token, body: {} });
    const txn = randomUUID();
    const body = { msgtype: 'm.text', body: `BabaCom isolated Matrix proof ${txn}` };
    const sent = await request(`${base}/send/m.room.message/${txn}`, { method: 'PUT', token: a.token, body });
    const duplicate = await request(`${base}/send/m.room.message/${txn}`, { method: 'PUT', token: a.token, body });
    check(sent.event_id === duplicate.event_id, 'Transaction idempotency');
    const sync = await request('/_matrix/client/v3/sync?timeout=0', { token: b.token });
    const matching = sync.rooms?.join?.[room.room_id]?.timeline?.events?.filter(event => event.event_id === sent.event_id) ?? [];
    check(matching.length === 1 && matching[0].sender === a.userId && matching[0].content.body === body.body, 'Two-account sync event/sender/body and no duplicate');
    check((await request(`${base}/state/m.room.create/`, { token: a.token }))['m.federate'] === false, 'Private room federation policy');
    pass('private invitation, same event/sender/body on B sync and transaction deduplication');
    await request(`${base}/messages?dir=b&limit=10`, { token: outsider.token, status: 403, errcode: 'M_FORBIDDEN' });
    await request(`${base}/send/m.room.message/${randomUUID()}`, { method: 'PUT', token: outsider.token, body, status: 403, errcode: 'M_FORBIDDEN' });
    await request(`${base}/state/m.room.name/`, { method: 'PUT', token: b.token, body: { name: 'unauthorized' }, status: 403, errcode: 'M_FORBIDDEN' });
    await request(`${base}/kick`, { method: 'POST', token: a.token, body: { user_id: b.userId } });
    await request(`${base}/send/m.room.message/${randomUUID()}`, { method: 'PUT', token: b.token, body, status: 403, errcode: 'M_FORBIDDEN' });
    pass('outsider read/send, member privileged-state change and kicked-member send denied');
    const before = await containers();
    await compose(['stop', '--timeout', '5', 'synapse', 'postgres'], 'Owned database/server stop', 18000);
    await compose(['up', '-d', '--wait', '--wait-timeout', '15', 'postgres'], 'Retained PostgreSQL restart', 18000);
    await compose(['up', '-d', '--wait', '--wait-timeout', '15', 'synapse'], 'Retained Synapse restart', 18000);
    await ready();
    const after = await containers();
    check(before.map(item => item.Id).sort().join(',') === after.map(item => item.Id).sort().join(','), 'Restart replaced containers');
    for (const session of sessions) check((await request('/_matrix/client/v3/account/whoami', { token: session.token })).user_id === session.userId, 'Identity persisted after restart');
    const history = await request(`${base}/messages?dir=b&limit=20`, { token: a.token });
    check(history.chunk.filter(event => event.event_id === sent.event_id && event.content.body === body.body).length === 1, 'Same room/event/history retained after restart');
    // Restore B membership for the separate stock Element UI observation; denial above remains asserted.
    await request(`${base}/invite`, { method: 'POST', token: a.token, body: { user_id: b.userId } });
    await request(`/_matrix/client/v3/join/${encodeURIComponent(room.room_id)}`, { method: 'POST', token: b.token, body: {} });
    pass('same containers, accounts, private room and message after database/server restart');
    console.log(`UI_REFERENCE room=${room.room_id} event=${sent.event_id} body=${body.body}`);
  } catch (error) { failure = error; }
  finally {
    deadline = finishBy;
    const cleanupErrors = await logoutSessions(sessions);
    if (cleanupErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], `${failure ? `${failure.message}; ` : ''}session cleanup failed: ${cleanupErrors.map(error => error.message).join('; ')}`);
    if (!failure) pass('all script sessions logged out and old tokens rejected inside 120 seconds');
  }
  if (failure) throw failure;
  pass('API/restart proof only; stock Element UI observation is separate');
}

async function stop() {
  deadline = Date.now() + 60000;
  await stopOwnedRuntime();
  for (const name of ['database', 'data']) await docker(['volume', 'inspect', `${project}_${name}`], 'Retained volume check');
  await secrets();
  await portsAvailable();
  pass('only owned services stopped; both volumes and all three secrets retained');
}

function validateConfig(config) {
  const requireIsolation = (ok, detail) => assert.ok(ok, `ISOLATION: ${detail}`);
  requireIsolation(config.name === 'babacom-matrix-proof', 'project owner');
  requireIsolation(Object.keys(config.services).sort().join(',') === 'element,postgres,synapse', 'service set');
  requireIsolation(Object.keys(config.networks).sort().join(',') === 'ingress,isolated' && config.networks.isolated.internal === true && config.networks.ingress.internal !== true, 'internal backend and separate ingress networks');
  for (const [name, service] of Object.entries(config.services)) {
    requireIsolation(/@sha256:[a-f0-9]{64}$/.test(service.image), `${name} immutable image`);
    requireIsolation(Object.keys(service.networks).sort().join(',') === (name === 'element' ? 'ingress,isolated' : 'isolated') && !service.network_mode, `${name} egress`);
    const expected = name === 'element' ? [['18008', 8008], ['18080', 80]] : [];
    const ports = service.ports ?? [];
    requireIsolation(ports.length === expected.length, `${name} port count`);
    for (const [published, target] of expected) requireIsolation(ports.some(port => port.host_ip === '127.0.0.1' && String(port.published) === published && port.target === target), `${name} loopback port`);
    requireIsolation(!service.privileged && !service.pid && !service.devices?.length, `${name} host access`);
  }
}

function validateAcl(entries, currentSid) {
  const allowed = new Set([currentSid, 'S-1-5-18', 'S-1-5-32-544']);
  assert.ok(entries.length > 0 && entries.every(e => allowed.has(e.sid) && e.type === 'Allow' && e.inherited === false), 'ACL: unexpected principal, inheritance or deny rule');
  assert.ok(entries.some(e => e.sid === currentSid), 'ACL: owner access required');
}

if (process.argv[2] === 'self-test') {
  test('UI session observation accepts only the two synthetic accounts and a bounded device id', () => {
    assert.match(uiSessionQuery('proof-a', 'DEVICE1234'), /127\.0\.0\.1:18080: Edge on Windows/);
    for (const [name, device] of [['proof-outsider', 'DEVICE1234'], ['real-user', 'DEVICE1234'], ['proof-a', "bad' OR 1=1"], ['proof-b', '']]) {
      assert.throws(() => uiSessionQuery(name, device), /UI session selector/);
    }
  });
  test('startup failure releases owned resources and preserves the original error', async () => {
    const failure = new Error('injected startup failure');
    let active = false;
    await assert.rejects(withStartupCleanup(async () => { active = true; throw failure; }, async () => { active = false; }), error => error === failure);
    assert.equal(active, false);
    const cleanupFailure = new Error('injected cleanup failure');
    await assert.rejects(withStartupCleanup(async () => { throw failure; }, async () => { throw cleanupFailure; }), error => error.errors?.[0] === failure && error.errors?.[1] === cleanupFailure);
  });
  test('account writes have a container timeout inside the host budget; exhausted budgets never launch', () => {
    assert.throws(() => accountTimeouts(5), /DEADLINE/);
    for (const budget of [4000, 9999, 37000]) {
      const limits = accountTimeouts(budget);
      assert.ok((limits.innerSeconds + 1) * 1000 < budget);
      assert.ok((limits.outerSeconds + 1) * 1000 <= budget);
    }
  });
  test('all issued sessions begin logout before any slow session finishes', async () => {
    const sessions = ['a', 'b', 'outsider'].map(token => ({ token }));
    const started = [];
    const release = [];
    const cleanup = logoutSessions(sessions, async (path, { token }) => {
      if (path.endsWith('/logout')) await new Promise(resolve => { started.push(token); release.push(resolve); });
      return {};
    });
    await Promise.resolve();
    assert.deepEqual(started, ['a', 'b', 'outsider']);
    release.forEach(resolve => resolve());
    assert.deepEqual(await cleanup, []);
    assert.ok(sessions.every(session => session.token === undefined));
  });
  test('one logout failure is reported without skipping other sessions', async () => {
    const started = [];
    const failure = new Error('injected logout failure');
    const errors = await logoutSessions(['a', 'b', 'outsider'].map(token => ({ token })), async (path, { token }) => {
      if (path.endsWith('/logout')) { started.push(token); if (token === 'a') throw failure; }
      return {};
    });
    assert.deepEqual(started, ['a', 'b', 'outsider']);
    assert.deepEqual(errors, [failure]);
  });
  test('malformed private JSON never exposes its secret input in an error', () => {
    assert.throws(() => privateJson('S3CR3T'), error => !error.message.includes('S3CR3T'));
  });
  test('C0 validates advertised API versions without equating the research edition with component conformance', () => {
    assert.equal(validVersions(['r0.6.1', 'v1.1', 'v1.12']), true);
    for (const versions of [undefined, [], ['v1.17'], ['v1.1', null]]) assert.equal(validVersions(versions), false);
  });
  test('Windows WSL registered path accepts separators but rejects another distribution path', () => {
    assert.equal(registeredPath('D:/Code/babacom/.matrix-runtime/wsl'), registeredPath('D:\\Code\\babacom\\.matrix-runtime\\wsl\\'));
    assert.notEqual(registeredPath('D:/Code/babacom/another-runtime/wsl'), registeredPath('D:/Code/babacom/.matrix-runtime/wsl'));
  });
  const fixedImage = 'official@sha256:' + 'a'.repeat(64);
  const config = () => ({
    name: 'babacom-matrix-proof',
    services: {
      synapse: { image: fixedImage, networks: { isolated: null } },
      element: { image: fixedImage, ports: [{ host_ip: '127.0.0.1', published: '18008', target: 8008 }, { host_ip: '127.0.0.1', published: '18080', target: 80 }], networks: { isolated: null, ingress: null } },
      postgres: { image: fixedImage, networks: { isolated: null } },
    },
    networks: { isolated: { internal: true }, ingress: { internal: false } },
  });
  test('accepts the owned, digest-pinned, internally isolated loopback project', () => {
    assert.doesNotThrow(() => validateConfig(config()));
  });
  test('rejects a wildcard port, unpinned image and outbound network', () => {
    for (const mutate of [
      c => { c.services.element.ports[0].host_ip = '0.0.0.0'; },
      c => { c.services.synapse.image = 'official:latest'; },
      c => { c.networks.isolated.internal = false; },
      c => { c.services.synapse.networks.ingress = null; },
      c => { c.services.postgres.ports = [{ host_ip: '127.0.0.1', published: '5432', target: 5432 }]; },
      c => { c.name = 'another-project'; },
    ]) {
      const c = config(); mutate(c);
      assert.throws(() => validateConfig(c), /ISOLATION/);
    }
  });
  test('Windows secrets allow only the owner, SYSTEM and Administrators', () => {
    const entries = ['S-1-5-21-123', 'S-1-5-18', 'S-1-5-32-544'].map(sid => ({ sid, type: 'Allow', inherited: false }));
    assert.doesNotThrow(() => validateAcl(entries, 'S-1-5-21-123'));
    assert.throws(() => validateAcl([...entries, { sid: 'S-1-1-0', type: 'Allow', inherited: false }], 'S-1-5-21-123'), /ACL/);
    assert.throws(() => validateAcl(entries.slice(1), 'S-1-5-21-123'), /ACL/);
  });
}

if (process.argv[2] !== 'self-test') {
  try {
    const command = { config: configuration, up, verify, stop, 'verify-ui-session': verifyUiSession }[process.argv[2]];
    check(command, 'Use config, up, verify, stop, verify-ui-session or self-test');
    await command();
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

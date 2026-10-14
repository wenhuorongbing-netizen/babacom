import { open, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const BASELINE = Object.freeze({
  path: 'D:/Code/babacom/.matrix-runtime/g1/windows/Element Setup 1.12.30.exe',
  size: 208730288,
  sha256: 'b9ac9617acfa667eb5470e67e5db744d3b595b35c285100a53ad17719f7cc6d3',
});

const PUBLISHER = 'ELEMENT CREATIONS LIMITED';
const SIGNER = '0166C56D35C7F22F78D870D0C1BCF729F2CAA3E9';
const ISSUER = 'SSL.com EV Code Signing Intermediate CA RSA R3';
const TIMESTAMP = 'DigiCert SHA256 RSA4096 Timestamp Responder 2026 1';
const TIMESTAMP_CERT = '51D9ABDA034973D84F4266ACA48248E6B369C439';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const TOTAL_MS = 60000;

// Literal trusted command: no caller-controlled path, executable, script or environment.
const SIGNATURE_COMMAND = `
$ErrorActionPreference = 'Stop'
$file = 'D:/Code/babacom/.matrix-runtime/g1/windows/Element Setup 1.12.30.exe'
function Read-Attributes {
  $current = $file
  $items = @()
  while ($true) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point in artifact path' }
    $items += [pscustomobject]@{ path = $current; attributes = [int]$item.Attributes }
    $parent = [IO.Path]::GetDirectoryName($current)
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
    $current = $parent
  }
  return $items
}
$before = @(Read-Attributes)
$signature = Get-AuthenticodeSignature -LiteralPath 'D:/Code/babacom/.matrix-runtime/g1/windows/Element Setup 1.12.30.exe' -ErrorAction Stop
$after = @(Read-Attributes)
$timestampName = $null
if ($null -ne $signature.TimeStamperCertificate) { $timestampName = $signature.TimeStamperCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }
[pscustomobject]@{
  status = [string]$signature.Status
  signerSubject = $signature.SignerCertificate.Subject
  signerThumbprint = $signature.SignerCertificate.Thumbprint
  signerIssuer = $signature.SignerCertificate.Issuer
  timestampName = $timestampName
  timestampThumbprint = $signature.TimeStamperCertificate.Thumbprint
  before = $before
  after = $after
} | ConvertTo-Json -Depth 5 -Compress
`;

function safeError(value) {
  return String(value).replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 8192);
}

export function readWindowsSignature({ transport = execFile, signal, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    transport(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SIGNATURE_COMMAND], {
      timeout: Math.max(1, Math.floor(Math.min(30000, timeout))), signal, windowsHide: true, shell: false,
      encoding: 'utf8', maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error || stderr.trim()) {
        reject(new Error(`signature command failed: ${safeError(`code=${error?.code}; signal=${error?.signal}; killed=${error?.killed}; ${error?.message ?? ''} ${stderr}`)}`));
        return;
      }
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); }
      catch (error) { reject(new Error(`signature JSON invalid: ${safeError(error.message)}`)); }
    });
  });
}

function ancestors(file) {
  const entries = [file];
  while (path.dirname(entries.at(-1)) !== entries.at(-1)) entries.push(path.dirname(entries.at(-1)));
  return entries;
}

async function snapshot(entries, check) {
  const stats = [];
  for (const [index, entry] of entries.entries()) {
    check();
    const stat = await lstat(entry, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error('link/reparse in artifact path');
    if (index === 0 ? !stat.isFile() : !stat.isDirectory()) throw new Error('artifact must be a regular file with directory ancestors');
    stats.push(stat);
  }
  return stats;
}

function unchanged(before, after, full = true) {
  const fields = full ? ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'] : ['dev', 'ino', 'mode'];
  if (fields.some(key => before[key] !== after[key])) throw new Error('artifact identity/metadata changed');
}

async function hash(handle, baseline, check) {
  check();
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size !== BigInt(baseline.size)) throw new Error('artifact size mismatch');
  const digest = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let position = 0;
  while (true) {
    check();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    position += bytesRead;
    if (position > baseline.size) throw new Error('artifact size changed');
    digest.update(buffer.subarray(0, bytesRead));
  }
  check();
  unchanged(before, await handle.stat({ bigint: true }));
  const sha256 = digest.digest('hex');
  if (position !== baseline.size || sha256 !== baseline.sha256) throw new Error('artifact size/hash mismatch');
  return sha256;
}

function distinguishedName(subject, key) {
  if (typeof subject !== 'string') return null;
  const parts = subject.split(/,\s*/).filter(part => part.startsWith(`${key}=`));
  return parts.length === 1 ? parts[0].slice(key.length + 1) : null;
}

function validateSignature(signature, entries) {
  if (!signature || signature.status !== 'Valid') throw new Error('signature missing or not Valid');
  if (distinguishedName(signature.signerSubject, 'CN') !== PUBLISHER ||
      distinguishedName(signature.signerSubject, 'O') !== PUBLISHER || signature.signerThumbprint !== SIGNER) {
    throw new Error('signer identity/certificate mismatch');
  }
  if (distinguishedName(signature.signerIssuer, 'CN') !== ISSUER) throw new Error('issuer mismatch');
  if (signature.timestampName !== TIMESTAMP || signature.timestampThumbprint !== TIMESTAMP_CERT) throw new Error('timestamp identity/certificate mismatch');
  for (const phase of ['before', 'after']) {
    const attributes = signature[phase];
    if (!Array.isArray(attributes) || attributes.length !== entries.length) throw new Error('native attribute evidence missing');
    for (const [index, item] of attributes.entries()) {
      if (!item || typeof item.path !== 'string' || path.resolve(item.path) !== entries[index] ||
          !Number.isInteger(item.attributes) || item.attributes < 0) throw new Error('native attribute evidence invalid');
      if (item.attributes & 1024) throw new Error('native reparse attribute detected');
      if (Boolean(item.attributes & 16) !== (index !== 0)) throw new Error('native regular file/directory attributes invalid');
      if (phase === 'after' && item.attributes !== signature.before[index].attributes) throw new Error('native attribute metadata changed');
    }
  }
}

// Exported boundary accepts small fixtures; CLI never exposes these seams.
export async function verifyArtifact(file, baseline = BASELINE, { readSignature = readWindowsSignature, now = () => performance.now() } = {}) {
  if (file !== baseline.path) throw new Error('fixed path required');
  const started = now();
  const controller = new AbortController();
  const check = () => {
    if (controller.signal.aborted || now() - started >= TOTAL_MS) throw new Error('total verification timeout (60000 ms)');
  };
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('total verification timeout (60000 ms)'));
    }, TOTAL_MS);
  });
  const verify = async () => {
    const entries = ancestors(path.resolve(file));
    const before = await snapshot(entries, check);
    let handle;
    let postHandle;
    try {
      check();
      handle = await open(file, 'r');
      unchanged(before[0], await handle.stat({ bigint: true }));
      const sha256 = await hash(handle, baseline, check);
      // Keep the hashed file open: Windows denies ancestor directory renames
      // while it has an open descendant, including transient junction swaps.
      check();
      const signature = await readSignature({ signal: controller.signal, timeout: Math.min(30000, TOTAL_MS - (now() - started)) });
      check();
      validateSignature(signature, entries);
      const after = await snapshot(entries, check);
      before.forEach((stat, index) => unchanged(stat, after[index], index === 0));
      unchanged(before[0], await handle.stat({ bigint: true }));
      postHandle = await open(file, 'r');
      unchanged(before[0], await postHandle.stat({ bigint: true }));
      await hash(postHandle, baseline, check);
      unchanged(before[0], await handle.stat({ bigint: true }));
      const final = await snapshot(entries, check);
      before.forEach((stat, index) => unchanged(stat, final[index], index === 0));
      check();
      const { status, signerSubject, signerThumbprint, signerIssuer, timestampName, timestampThumbprint } = signature;
      return { bytes: baseline.size, sha256, signature: { status, signerSubject, signerThumbprint, signerIssuer, timestampName, timestampThumbprint } };
    } finally {
      await postHandle?.close();
      await handle?.close();
    }
  };
  try { return await Promise.race([verify(), deadline]); }
  finally { clearTimeout(timer); }
}

async function main(args) {
  if (args.length !== 1 || args[0] !== 'verify') throw new Error('Usage: node artifact.mjs verify');
  if (process.platform !== 'win32') throw new Error('Windows is required for Authenticode validation');
  const result = await verifyArtifact(BASELINE.path);
  console.log(JSON.stringify({
    result: 'VERIFIED', path: BASELINE.path,
    upstream: 'Element Web/Desktop v1.12.30', source: 'f19cfd9030429240a4209bf5175b372175cf0464',
    topLevelSdk: '43.0.0', embeddedCall: '0.26.0',
    officialInstaller: 'https://packages.element.io/desktop/install/win32/x64/Element%20Setup%201.12.30.exe',
    officialWorkflow: 'https://github.com/element-hq/element-web/actions/runs/36573707260',
    ...result,
    limits: 'SHA-256 is locally observed, not an upstream published digest. Official workflow is provenance association, not reproducible-build or source-to-byte proof. Windows trust validation may consult system policy. Installation, startup, licensing, audio, RTC and physical release are NOT_VERIFIED; G1/M04/M05 remain open.',
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(safeError(error.message)); process.exitCode = 1; });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, lstat, rename, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const api = await import('./artifact.mjs').catch(() => ({}));
const exec = promisify(execFile);
const cli = path.resolve(import.meta.dirname, 'artifact.mjs');
const prefix = path.resolve(tmpdir(), 'babacom-g1-artifact-');
const signer = {
  status: 'Valid',
  signerSubject: 'CN=ELEMENT CREATIONS LIMITED, O=ELEMENT CREATIONS LIMITED, C=GB',
  signerThumbprint: '0166C56D35C7F22F78D870D0C1BCF729F2CAA3E9',
  signerIssuer: 'CN=SSL.com EV Code Signing Intermediate CA RSA R3, O=SSL Corp, C=US',
  timestampName: 'DigiCert SHA256 RSA4096 Timestamp Responder 2026 1',
  timestampThumbprint: '51D9ABDA034973D84F4266ACA48248E6B369C439',
};

function ancestors(file) {
  const result = [file];
  while (path.dirname(result.at(-1)) !== result.at(-1)) result.push(path.dirname(result.at(-1)));
  return result;
}

async function fixture(t) {
  assert.equal(typeof api.verifyArtifact, 'function', 'artifact verifier must be implemented');
  const root = path.resolve(await mkdtemp(prefix));
  assert.ok(root.startsWith(prefix) && path.dirname(root) === path.dirname(prefix));
  // Freeze and check ownership before any recursive deletion.
  t.after(async () => {
    assert.ok(root.startsWith(prefix) && path.dirname(root) === path.dirname(prefix));
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(root, { recursive: true, force: true });
  });
  const parent = path.join(root, 'input');
  await mkdir(parent);
  const file = path.join(parent, 'fixture.exe');
  const bytes = Buffer.from('small signed fixture\n');
  await writeFile(file, bytes);
  const baseline = { path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const attrs = ancestors(file).map((entry, index) => ({ path: entry, attributes: index === 0 ? 32 : 16 }));
  const signature = { ...signer, before: attrs, after: attrs.map(entry => ({ ...entry })) };
  let calls = 0;
  const options = { readSignature: async () => { calls++; return signature; } };
  return { root, parent, file, bytes, baseline, signature, options, calls: () => calls };
}

test('valid fixture is read only and reports verified bytes and native signature', async t => {
  const f = await fixture(t);
  const before = await lstat(f.file, { bigint: true });
  const result = await api.verifyArtifact(f.file, f.baseline, f.options);
  assert.equal(result.sha256, f.baseline.sha256);
  assert.equal(result.bytes, 21);
  assert.equal(result.signature.status, 'Valid');
  assert.equal(f.calls(), 1);
  assert.deepEqual(await readFile(f.file), f.bytes);
  const after = await lstat(f.file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key]);
});

test('wrong fixed path rejects before reading input or invoking signature', async t => {
  const f = await fixture(t);
  await assert.rejects(api.verifyArtifact(`${f.file}.absent`, f.baseline, f.options), /fixed path/);
  assert.equal(f.calls(), 0);
});

test('missing, nonregular, linked, truncated and corrupt input fail before signature', async t => {
  for (const kind of ['missing', 'directory', 'junction', 'short', 'hash']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      if (kind === 'missing') await rm(f.file);
      if (kind === 'directory') { await rm(f.file); await mkdir(f.file); }
      if (kind === 'junction') {
        const target = path.join(f.root, 'target');
        await rename(f.parent, target);
        await symlink(target, f.parent, 'junction');
      }
      if (kind === 'short') await writeFile(f.file, 'short');
      if (kind === 'hash') await writeFile(f.file, Buffer.alloc(f.bytes.length, 88));
      await assert.rejects(api.verifyArtifact(f.file, f.baseline, f.options), /ENOENT|regular file|link|reparse|size|hash/i);
      assert.equal(f.calls(), 0);
    });
  }
});

test('signature fields and native attribute evidence fail closed', async t => {
  const changes = [
    ['missing signature', () => null],
    ['invalid status', s => ({ ...s, status: 'UnknownError' })],
    ['missing signer', s => ({ ...s, signerSubject: null })],
    ['wrong CN', s => ({ ...s, signerSubject: 'CN=WRONG, O=ELEMENT CREATIONS LIMITED' })],
    ['wrong O', s => ({ ...s, signerSubject: 'CN=ELEMENT CREATIONS LIMITED, O=WRONG' })],
    ['substring publisher', s => ({ ...s, signerSubject: 'CN=ELEMENT CREATIONS LIMITED EVIL, O=ELEMENT CREATIONS LIMITED' })],
    ['wrong certificate', s => ({ ...s, signerThumbprint: '0'.repeat(40) })],
    ['missing certificate', s => ({ ...s, signerThumbprint: null })],
    ['wrong issuer', s => ({ ...s, signerIssuer: 'CN=WRONG' })],
    ['missing issuer', s => ({ ...s, signerIssuer: null })],
    ['missing timestamp', s => ({ ...s, timestampName: null })],
    ['wrong timestamp name', s => ({ ...s, timestampName: 'WRONG' })],
    ['wrong timestamp certificate', s => ({ ...s, timestampThumbprint: '0'.repeat(40) })],
    ['missing timestamp certificate', s => ({ ...s, timestampThumbprint: null })],
    ['missing attributes', s => ({ ...s, before: null })],
    ['missing ancestor', s => ({ ...s, after: s.after.slice(0, -1) })],
    ['wrong ancestor', s => ({ ...s, after: s.after.map((v, i) => i === 1 ? { ...v, path: 'elsewhere' } : v) })],
    ['pre reparse', s => ({ ...s, before: s.before.map((v, i) => i === 1 ? { ...v, attributes: 1040 } : v) })],
    ['post reparse', s => ({ ...s, after: s.after.map((v, i) => i === 1 ? { ...v, attributes: 1040 } : v) })],
    ['invalid attributes', s => ({ ...s, after: s.after.map((v, i) => i === 0 ? { ...v, attributes: null } : v) })],
    ['attribute metadata changed', s => ({ ...s, after: s.after.map((v, i) => i === 0 ? { ...v, attributes: 34 } : v) })],
  ];
  for (const [name, change] of changes) await t.test(name, async t => {
    const f = await fixture(t);
    await assert.rejects(api.verifyArtifact(f.file, f.baseline, { readSignature: async () => change(f.signature) }), /signature|signer|issuer|timestamp|attribute|reparse/i);
    assert.deepEqual(await readFile(f.file), f.bytes);
  });
});

test('native failure and timeout propagate through verification without changing input', async t => {
  for (const code of ['EACCES', 'ETIMEDOUT']) {
    const f = await fixture(t);
    await assert.rejects(api.verifyArtifact(f.file, f.baseline, {
      readSignature: options => api.readWindowsSignature({ ...options, transport: (_e, _a, _o, callback) => {
        callback(Object.assign(new Error('native original error'), { code }), '', 'details');
      } }),
    }), new RegExp(`${code}.*native original error.*details`));
    assert.deepEqual(await readFile(f.file), f.bytes);
  }
});

test('changes during signature including a junction to the SAME file fail', async t => {
  for (const kind of ['replace', 'rewrite', 'truncate', 'metadata', 'late junction', 'native late reparse']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      const readSignature = async () => {
        if (kind === 'replace') { await rename(f.file, `${f.file}.old`); await writeFile(f.file, f.bytes); }
        if (kind === 'rewrite') await writeFile(f.file, Buffer.alloc(f.bytes.length, 89));
        if (kind === 'truncate') await writeFile(f.file, 'short');
        if (kind === 'metadata') { const { chmod } = await import('node:fs/promises'); await chmod(f.file, 0o444); }
        if (kind === 'late junction') {
          const target = path.join(f.root, 'same-file');
          await rename(f.parent, target);
          await symlink(target, f.parent, 'junction');
        }
        if (kind === 'native late reparse') f.signature.after[1].attributes = 1040;
        return f.signature;
      };
      await assert.rejects(api.verifyArtifact(f.file, f.baseline, { readSignature }), /changed|identity|metadata|size|hash|link|reparse/i);
    });
  }
});

test('total deadline fails before signature and after a slow signature', async t => {
  const f = await fixture(t);
  let time = 0;
  await assert.rejects(api.verifyArtifact(f.file, f.baseline, { ...f.options, now: () => { time += 60001; return time; } }), /total.*timeout/i);
  assert.equal(f.calls(), 0);
  time = 0;
  await assert.rejects(api.verifyArtifact(f.file, f.baseline, {
    now: () => time,
    readSignature: async () => { time = 60001; return f.signature; },
  }), /total.*timeout/i);
});

test('only a bounded absolute PowerShell signature command is launched', async () => {
  assert.equal(typeof api.readWindowsSignature, 'function', 'native signature reader must be implemented');
  let calls = 0;
  const transport = (exe, args, options, callback) => {
    calls++;
    assert.equal(exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    assert.match(args.at(-1), /Get-AuthenticodeSignature -LiteralPath 'D:\/Code\/babacom\/\.matrix-runtime\/g1\/windows\/Element Setup 1\.12\.30\.exe'/);
    assert.match(args.at(-1), /ReparsePoint/);
    assert.equal(options.timeout, 30000);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, false);
    assert.ok(options.signal instanceof AbortSignal);
    callback(null, JSON.stringify({ ...signer, before: [], after: [] }), '');
  };
  await api.readWindowsSignature({ transport, signal: new AbortController().signal });
  assert.equal(calls, 1);
  for (const [name, invoke, pattern] of [
    ['failure', cb => cb(Object.assign(new Error('access denied'), { code: 'EACCES' }), '', 'native failure'), /EACCES.*access denied.*native failure/s],
    ['timeout', cb => cb(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true }), '', ''), /ETIMEDOUT.*timed out/s],
    ['malformed', cb => cb(null, '{broken', ''), /signature.*JSON/i],
    ['stderr', cb => cb(null, '{}', 'unexpected warning'), /unexpected warning/],
  ]) await assert.rejects(api.readWindowsSignature({ transport: (_e, _a, _o, cb) => invoke(cb), signal: new AbortController().signal }), pattern, name);
});

test('CLI rejects every unsupported or extra argument with nonzero status', async () => {
  for (const args of [[], ['download'], ['verify', '--path', 'elsewhere'], ['verify', 'extra'], ['verify', '--url=https://example.org'], ['verify', '--skip-signature']]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], { timeout: 5000 }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Usage:.*verify/);
      assert.doesNotMatch(error.stderr, /ENOENT|Authenticode|signature command/);
      return true;
    });
  }
});

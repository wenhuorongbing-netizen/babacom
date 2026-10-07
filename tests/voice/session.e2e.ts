import { _electron as electron, expect, test } from '@playwright/test';
import { SignalResponse } from '@livekit/protocol';
import Ajv from 'ajv';
import { mediaSessionSchema } from '@babacom/contracts';
import type { ElectronApplication, Page } from '@playwright/test';
import { join } from 'node:path';
import { desktop } from '../../apps/desktop/scripts/build.mjs';
import { startRenderer, startStartupPipe, startTestService, startMediaService, startRealMediaService } from '../../apps/desktop/scripts/dev.mjs';
import type { StartupConfiguration, MediaStartup, AdmissionSuccess, MediaRuntimeCommand } from '@babacom/contracts';
import { MediaSession } from '../../apps/desktop/src/main/media-session';

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
  const renderer = packaged ? null : await startRenderer();
  const pipes: Awaited<ReturnType<typeof startStartupPipe>>[] = [];
  const applications: { application: ElectronApplication; closed: boolean }[] = [];
  const own = (application: ElectronApplication) => {
    const item = { application, closed: false };
    application.on('close', () => { item.closed = true; });
    applications.push(item);
  };
  let diagnostics = '';
  async function close() {
    for (const item of applications.reverse()) {
      if (!item.closed) await item.application.close();
    }
    await Promise.all(pipes.map((pipe) => pipe.close()));
    await renderer?.close();
  }
  try {
    const startup = await startStartupPipe(configuration);
    pipes.push(startup);
    const mediaStartup = mediaConfiguration ? await startStartupPipe(mediaConfiguration) : null;
    if (mediaStartup) pipes.push(mediaStartup);
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
    const application = await electron.launch({
      executablePath: packaged ? join(desktop, 'build/windows/win-unpacked/BabaCom.exe') : undefined,
      args: [...(packaged ? [] : [join(desktop, 'dist/main/main.cjs')]), '--babacom-startup-pipe=' + startup.path,
        ...(mediaStartup ? ['--babacom-media-pipe=' + mediaStartup.path] : [])],
      env: environment,
    });
    own(application);
    application.process().stdout?.on('data', (chunk) => { diagnostics += String(chunk); });
    application.process().stderr?.on('data', (chunk) => { diagnostics += String(chunk); });
    const page = await application.firstWindow();
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
      const pipe = await startStartupPipe(peerConfiguration);
      pipes.push(pipe);
      peer = await electron.launch({ args: [join(desktop, '../../tests/voice/sfu-peer.cjs'), '--peer-pipe=' + pipe.path] });
      own(peer);
      const peerPage = await peer.firstWindow();
      await expect(peerPage.locator('#status')).toHaveText('connected', { timeout: 15_000 });
      await peerPage.getByRole('button', { name: 'Start synthetic audio' }).click();
      await expect(peerPage.locator('#status')).toHaveText('publishing', { timeout: 10_000 });
    }
    return { application, page, peer, diagnostics: () => diagnostics, browserCredentialLeak: () => {
      if (diagnosticProbeFailed) throw new Error('Native browser diagnostic probe failed');
      return browserCredentialLeak;
    }, close };
  } catch (error) { await close(); throw error; }
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
      expect(await running.page.evaluate(() => Object.keys(window.media).sort())).toEqual(['cancelJoin', 'getSnapshot', 'join', 'leave', 'subscribe']);
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

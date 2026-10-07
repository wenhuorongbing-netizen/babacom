import { _electron as electron, expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { startRenderer, startStartupPipe, startTestService } from '../../apps/desktop/scripts/dev.mjs';
import { desktop } from '../../apps/desktop/scripts/build.mjs';
import type { StartupConfiguration } from '@babacom/contracts';

async function postStatus(configuration: StartupConfiguration, displayName = '额度验证') {
  const response = await fetch(configuration.apiBase + '/api/v1/tokens/media', {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + configuration.applicationSession,
    },
    body: JSON.stringify({ roomName: configuration.roomName, displayName }),
  });
  await response.arrayBuffer();
  return response.status;
}

async function controlledApplication(scenario = 'ready', fillQuota = false) {
  const service = await startTestService(scenario);
  const packaged = test.info().project.name === 'packaged';
  const renderer = packaged ? null : await startRenderer();
  const startup = await startStartupPipe(service.configuration);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  delete environment.BABACOM_RENDERER_URL;
  if (renderer) environment.BABACOM_RENDERER_URL = renderer.url;
  if (packaged) {
    environment.PATH = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    delete environment.ELECTRON_RUN_AS_NODE;
  }
  let application;
  try {
    application = await electron.launch({
      executablePath: packaged ? join(desktop, 'build/windows/win-unpacked/BabaCom.exe') : undefined,
      args: [...(packaged ? [] : [join(desktop, 'dist/main/main.cjs')]), '--babacom-startup-pipe=' + startup.path],
      env: environment,
    });
  } catch (error) {
    await Promise.allSettled([renderer?.close(), startup.close(), service.close()]);
    throw error;
  }
  const applicationProcess = application.process();
  let output = '';
  applicationProcess.stdout?.on('data', (chunk) => { output += String(chunk); });
  applicationProcess.stderr?.on('data', (chunk) => { output += String(chunk); });
  if (fillQuota) {
    for (let count = 0; count < 6; count++) {
      expect(await postStatus(service.configuration, '初始')).toBe(200);
    }
  }
  const page = await application.firstWindow();
  const sockets: string[] = [];
  page.on('websocket', (socket) => {
    const developmentOrigin = renderer?.url.replace('http:', 'ws:');
    if (!developmentOrigin || new URL(socket.url()).origin !== new URL(developmentOrigin).origin) sockets.push(socket.url());
  });
  if (packaged) {
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true);
    expect(new URL(page.url()).protocol).toBe('file:');
  }
  return {
    application, applicationProcess, page, configuration: service.configuration,
    diagnostics: () => output + service.diagnostics(),
    recover: () => service.recover(),
    responses: () => service.responses(),
    traffic: () => service.traffic(),
    release: () => service.release(),
    close: async () => {
      if (applicationProcess.exitCode === null) await application.close();
      await renderer?.close();
      await startup.close();
      await service.close();
      expect(sockets, 'Admission never connects to an SFU').toEqual([]);
    },
  };
}

test('real desktop prepares a normalized nickname without exposing credentials', async () => {
  const running = await controlledApplication();
  try {
    const { page } = running;
    await expect(page.getByText('本地测试环境')).toBeVisible();
    const nickname = page.getByLabel('展示昵称');
    await nickname.fill('  e\u0301 玩家 🎮  ');
    await nickname.press('Tab');
    await expect(page.getByRole('button', { name: '准备入房', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('准备完成');
    await expect(page.getByText('é 玩家 🎮', { exact: true })).toBeVisible();
    await expect(page.getByText('准备完成后尚未开始通话。')).toBeVisible();
    const response = await page.evaluate(() => window.admission.prepare({ roomName: window.admission.roomName, displayName: '第二昵称' }));
    expect(response.status).toBe('ready');
    if (response.status === 'ready') {
      expect(Object.keys(response.summary).sort()).toEqual(['displayName', 'expiresAt', 'participantIdentity', 'roomName']);
      expect(response.summary.displayName).toBe('第二昵称');
    }
    const text = await page.locator('body').innerText();
    expect((text + running.diagnostics()).includes(running.configuration.applicationSession), 'No session in renderer or diagnostics').toBe(false);
    expect(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(text + running.diagnostics()), 'No media JWT in renderer or diagnostics').toBe(false);
    expect(text).not.toContain('accessToken');
    expect(await page.evaluate(() => typeof Reflect.get(window, 'require'))).toBe('undefined');
    expect(await page.evaluate(() => typeof Reflect.get(window, 'process'))).toBe('undefined');
    expect(await page.evaluate(() => Object.keys(window.admission).sort())).toEqual(['cancel', 'environment', 'prepare', 'roomName']);
    await page.screenshot({ path: join(desktop, 'build/' + test.info().project.name + '-admission-ready.png') });
  } finally { await running.close(); }
});

for (const [scenario, message, status] of [
  ['no-session', '会话无效，请重新打开受控应用。', 401],
  ['forbidden', '你暂时没有进入这个房间的权限。', 403],
  ['service-fault', '服务暂时不可用，请稍后重试。', 503],
] as const) {
  test('real HTTP ' + scenario + ' allows a safe manual recovery', async () => {
    const running = await controlledApplication(scenario);
    try {
      await running.page.getByLabel('展示昵称').fill('玩家');
      await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
      await expect(running.page.getByRole('status')).toContainText(message);
      await expect(running.page.getByRole('button', { name: '重新准备', exact: true })).toBeEnabled();
      const text = await running.page.locator('body').innerText() + running.diagnostics();
      expect(text.includes(running.configuration.applicationSession)).toBe(false);
      expect(text).not.toContain('Traceback');
      expect(text).not.toContain('Controlled provider failure');
      expect(text).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
      await expect.poll(running.responses).toEqual([status]);
      await running.recover();
      await expect(running.page.getByRole('status')).toContainText(message);
      await running.page.waitForTimeout(300);
      expect(running.responses()).toEqual([status]);
      await running.page.getByLabel('展示昵称').fill('修正后的玩家');
      await running.page.getByRole('button', { name: '重新准备', exact: true }).click();
      await expect(running.page.getByRole('status')).toContainText('准备完成');
      await expect(running.page.getByText('修正后的玩家', { exact: true })).toBeVisible();
      await expect.poll(running.responses).toEqual([status, 200]);
    } finally { await running.close(); }
  });
}

test('the seventh approved request waits for Retry-After before a manual recovery', async () => {
  test.setTimeout(90_000);
  const running = await controlledApplication('ready', true);
  try {
    await running.page.getByLabel('展示昵称').fill('玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('请求过快');
    await expect(running.page.getByRole('status')).toContainText('请等待');
    const retry = running.page.getByRole('button', { name: '重新准备', exact: true });
    await expect(retry).toBeDisabled();
    await expect.poll(running.responses).toEqual([200, 200, 200, 200, 200, 200, 429]);
    await expect(retry).toBeEnabled({ timeout: 70_000 });
    await running.page.waitForTimeout(500);
    expect(running.responses()).toEqual([200, 200, 200, 200, 200, 200, 429]);
    await expect(running.page.getByRole('status')).toContainText('请求过快');
    await running.page.getByLabel('展示昵称').fill('等待后的玩家');
    await retry.click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('等待后的玩家', { exact: true })).toBeVisible();
    await expect.poll(running.responses).toEqual([200, 200, 200, 200, 200, 200, 429, 200]);
  } finally { await running.close(); }
});

for (const invalidName of ['', '界'.repeat(33), '\u200b玩家', 'x'.repeat(257)]) {
  test('invalid nickname ' + JSON.stringify(invalidName.slice(0, 4)) + ' can be corrected in the real desktop', async () => {
    const running = await controlledApplication();
    try {
      await running.page.getByLabel('展示昵称').fill(invalidName);
      await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
      await expect(running.page.getByRole('status')).toContainText('昵称须为 1–32 个字');
      expect(running.responses()).toEqual([]);
      const retry = running.page.getByRole('button', { name: '重新准备', exact: true });
      await expect(retry).toBeEnabled();
      await running.page.getByLabel('展示昵称').fill('有效玩家');
      await retry.click();
      await expect(running.page.getByRole('status')).toContainText('准备完成');
      await expect(running.page.getByText('有效玩家', { exact: true })).toBeVisible();
      await expect.poll(running.responses).toEqual([200]);
    } finally { await running.close(); }
  });
}

test('an HTML-shaped nickname remains literal text in the real desktop', async () => {
  const running = await controlledApplication();
  try {
    const nickname = '<img src=x onerror=alert(1)>';
    let dialogs = 0;
    running.page.on('dialog', async (dialog) => { dialogs++; await dialog.dismiss(); });
    await running.page.getByLabel('展示昵称').fill(nickname);
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText(nickname, { exact: true })).toBeVisible();
    expect(await running.page.locator('img').count()).toBe(0);
    expect(dialogs).toBe(0);
    await expect.poll(running.responses).toEqual([200]);
  } finally { await running.close(); }
});

test('duplicate submissions during a delayed real HTTP response prepare only once', async () => {
  const running = await controlledApplication('delayed');
  try {
    await running.page.getByLabel('展示昵称').fill('等待中的玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click({ clickCount: 3 });
    await expect(running.page.getByRole('status')).toContainText('正在准备…');
    await expect(running.page.getByLabel('展示昵称')).toBeDisabled();
    await expect(running.page.getByRole('button', { name: '正在准备…', exact: true })).toBeDisabled();
    await expect.poll(running.responses).toEqual([200]);
    const duplicates = await running.page.evaluate(() => Promise.all([
      window.admission.prepare({ roomName: window.admission.roomName, displayName: '重复一' }),
      window.admission.prepare({ roomName: window.admission.roomName, displayName: '重复二' }),
    ]));
    expect(duplicates).toEqual([
      { status: 'failure', code: 'REQUEST_FAILED' }, { status: 'failure', code: 'REQUEST_FAILED' },
    ]);
    expect(running.traffic().filter((event) => event.event === 'request')).toHaveLength(1);
    await running.release();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('等待中的玩家', { exact: true })).toBeVisible();
    expect(running.responses()).toEqual([200]);
  } finally { await running.close(); }
});

test('cancel discards a delayed operation and preserves the new manual result', async () => {
  const running = await controlledApplication('delayed');
  try {
    await running.page.getByLabel('展示昵称').fill('已取消的旧玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect.poll(running.responses).toEqual([200]);
    await running.page.getByRole('button', { name: '取消准备', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('等待输入昵称');
    await expect(running.page.locator('dl')).toHaveCount(0);
    await running.page.getByLabel('展示昵称').fill('取消后的新玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect.poll(running.responses).toEqual([200, 200]);
    await running.release();
    await expect.poll(() => running.traffic().filter((event) => event.event === 'finished').length).toBe(2);
    await expect(running.page.getByText('取消后的新玩家', { exact: true })).toBeVisible();
    await expect(running.page.getByText('已取消的旧玩家', { exact: true })).toHaveCount(0);
    const remaining = [];
    for (let count = 0; count < 5; count++) remaining.push(await postStatus(running.configuration));
    expect(remaining).toEqual([200, 200, 200, 200, 429]);
  } finally { await running.close(); }
});

test('a real ten-second timeout requires a new request and ignores the old response', async () => {
  const running = await controlledApplication('delayed');
  try {
    await running.page.getByLabel('展示昵称').fill('超时的旧玩家');
    const started = Date.now();
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect.poll(running.responses).toEqual([200]);
    await expect(running.page.getByRole('status')).toContainText('请求超时，请重新准备。', { timeout: 15_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_500);
    await running.page.waitForTimeout(400);
    expect(running.responses()).toEqual([200]);
    await running.page.getByLabel('展示昵称').fill('超时后的新玩家');
    await running.page.getByRole('button', { name: '重新准备', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect.poll(running.responses).toEqual([200, 200]);
    await running.release();
    await expect.poll(() => running.traffic().filter((event) => event.event === 'finished').length).toBe(2);
    await expect(running.page.getByText('超时后的新玩家', { exact: true })).toBeVisible();
    await expect(running.page.getByText('超时的旧玩家', { exact: true })).toHaveCount(0);
  } finally { await running.close(); }
});

test('cancelling a ready admission clears its summary and requires a new HTTP request', async () => {
  const running = await controlledApplication();
  try {
    await running.page.getByLabel('展示昵称').fill('已准备的旧玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await running.page.getByRole('button', { name: '取消准备', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('等待输入昵称');
    await expect(running.page.locator('dl')).toHaveCount(0);
    await running.page.getByLabel('展示昵称').fill('重新准备的新玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('重新准备的新玩家', { exact: true })).toBeVisible();
    await expect.poll(running.responses).toEqual([200, 200]);
  } finally { await running.close(); }
});

test('closing the real window during a response exits and preserves accepted server quota', async () => {
  const running = await controlledApplication('delayed');
  try {
    await running.page.getByLabel('展示昵称').fill('关闭前的玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect.poll(running.responses).toEqual([200]);
    const exited = new Promise((resolve) => running.applicationProcess.once('exit', resolve));
    await running.page.close();
    expect(await exited).toBe(0);
    await running.release();
    await expect.poll(() => running.traffic().filter((event) => event.event === 'finished').length).toBe(1);
    const remaining = [];
    for (let count = 0; count < 6; count++) remaining.push(await postStatus(running.configuration));
    expect(remaining).toEqual([200, 200, 200, 200, 200, 429]);
    expect(running.diagnostics()).not.toContain(running.configuration.applicationSession);
    expect(running.diagnostics()).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
  } finally { await running.close(); }
});

test('the real initial credential expires after 120 seconds and needs a fresh manual request', async () => {
  test.setTimeout(150_000);
  const running = await controlledApplication();
  try {
    await running.page.getByLabel('展示昵称').fill('即将到期的玩家');
    const started = Date.now();
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('准备完成后尚未开始通话。')).toBeVisible();
    await expect(running.page.getByRole('status')).toContainText('准备凭据已过期，请重新准备。', { timeout: 130_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(115_000);
    await expect(running.page.locator('dl')).toHaveCount(0);
    await expect(running.page.getByRole('button', { name: '重新准备', exact: true })).toBeEnabled();
    await running.page.waitForTimeout(400);
    expect(running.responses()).toEqual([200]);
    const publicOutput = await running.page.locator('body').innerText() + running.diagnostics();
    expect(publicOutput).not.toContain(running.configuration.applicationSession);
    expect(publicOutput).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
    await running.page.screenshot({ path: join(desktop, 'build/' + test.info().project.name + '-admission-expired.png') });
    await running.page.getByLabel('展示昵称').fill('到期后的新玩家');
    await running.page.getByRole('button', { name: '重新准备', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('到期后的新玩家', { exact: true })).toBeVisible();
    await expect.poll(running.responses).toEqual([200, 200]);
  } finally { await running.close(); }
});

test('an already expired HTTP credential has an expiry failure and a fresh manual retry', async () => {
  const running = await controlledApplication('expired');
  try {
    await running.page.getByLabel('展示昵称').fill('过期测试玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备凭据已过期，请重新准备。');
    await expect(running.page.locator('dl')).toHaveCount(0);
    await expect.poll(running.responses).toEqual([200]);
    await running.recover();
    await running.page.getByLabel('展示昵称').fill('有效期已刷新');
    await running.page.getByRole('button', { name: '重新准备', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect(running.page.getByText('有效期已刷新', { exact: true })).toBeVisible();
    await expect.poll(running.responses).toEqual([200, 200]);
  } finally { await running.close(); }
});

test('the real window denies media, navigation, popups and forged IPC parameters', async () => {
  const running = await controlledApplication();
  try {
    const { page } = running;
    const requests: string[] = [];
    await expect(page.getByText('本地测试环境')).toBeVisible();
    page.on('websocket', (socket) => requests.push(socket.url()));
    expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state)).toBe('denied');
    const permission = await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); return 'allowed'; }
      catch { return 'denied'; }
    });
    expect(permission).toBe('denied');
    const response = await page.evaluate(() => window.admission.prepare({ roomName: 'unapproved', displayName: '玩家' }));
    expect(response).toEqual({ status: 'failure', code: 'INVALID_REQUEST' });
    expect(await page.evaluate(() => window.open('https://example.invalid/') === null)).toBe(true);
    const url = page.url();
    await page.evaluate(() => location.assign('https://example.invalid/'));
    expect(page.url()).toBe(url);
    // Electron cancels before commit; Chromium's pending navigation can outlive
    // Playwright's locator wait. Observe the actual window via its public API.
    const visibleWindow = await running.application.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      return { url: contents.getURL(), text: await contents.executeJavaScript('document.body.innerText') };
    });
    expect(visibleWindow.url).toBe(url);
    expect(visibleWindow.text).toContain('本地测试环境');
    expect(running.application.windows()).toHaveLength(1);
    expect(requests).toEqual([]);
  } finally { await running.close(); }
});

test('the approved page blocks a child frame before it can request admission', async () => {
  const running = await controlledApplication();
  try {
    const violation = await running.page.evaluate(() => new Promise<{ directive: string; enforced: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Frame blocking was not observed')), 5_000);
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.effectiveDirective !== 'frame-src') return;
        clearTimeout(timer);
        resolve({ directive: event.effectiveDirective, enforced: event.disposition === 'enforce' });
      }, { once: true });
      const frame = document.createElement('iframe');
      frame.id = 'unapproved-frame';
      frame.src = location.href;
      document.body.append(frame);
    }));
    expect(violation).toEqual({ directive: 'frame-src', enforced: true });
    const bridgeAccess = await running.page.evaluate(() => {
      const frame = document.getElementById('unapproved-frame');
      if (!(frame instanceof HTMLIFrameElement)) throw new Error('Actual child frame is missing');
      try { return typeof frame.contentWindow?.admission; }
      catch (error) {
        // CSP blocking can leave an opaque error document in HTTP development mode.
        if (error instanceof DOMException && error.name === 'SecurityError') return 'SecurityError';
        throw error;
      }
    });
    expect(['undefined', 'SecurityError']).toContain(bridgeAccess);
    expect(running.responses()).toEqual([]);
    await running.page.evaluate(() => document.getElementById('unapproved-frame')?.remove());
    await running.page.getByLabel('展示昵称').fill('框架拒绝后');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect.poll(running.responses).toEqual([200]);
  } finally { await running.close(); }
});

async function packagedProcess(args: string[], environment = process.env) {
  const child = spawn(join(desktop, 'build/windows/win-unpacked/BabaCom.exe'), args, {
    env: environment, windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Packaged process did not exit')), 20_000);
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, output };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}

test('a different real window cannot use the approved preload to request admission', async () => {
  const running = await controlledApplication();
  try {
    const foreignWindow = running.application.waitForEvent('window');
    await running.application.evaluate(async ({ app, BrowserWindow }, configuration) => {
      const main = BrowserWindow.getAllWindows()[0].webContents;
      const foreign = new BrowserWindow({
        show: false, webPreferences: {
          preload: configuration.preloadPath ?? process.getBuiltinModule('path').join(app.getAppPath(), 'dist/main/preload.cjs'),
          additionalArguments: ['--babacom-room=' + configuration.roomName,
            '--babacom-environment=' + configuration.environment],
          contextIsolation: true, sandbox: true, nodeIntegration: false,
        },
      });
      await foreign.loadURL(main.getURL());
    }, { roomName: running.configuration.roomName, environment: running.configuration.environment,
      preloadPath: test.info().project.name === 'packaged' ? null : join(desktop, 'dist/main/preload.cjs') });
    const foreign = await foreignWindow;
    const denied = await foreign.evaluate(() => window.admission.prepare({
      roomName: window.admission.roomName, displayName: 'foreign-window',
    }));
    expect(denied).toEqual({ status: 'failure', code: 'FORBIDDEN' });
    expect(running.responses()).toEqual([]);
    await foreign.close();
    await running.page.getByLabel('展示昵称').fill('批准窗口的玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    await expect.poll(running.responses).toEqual([200]);
  } finally { await running.close(); }
});

test('the distributed application contains only bundled client resources and no runtime secrets', async () => {
  test.skip(test.info().project.name !== 'packaged', 'Distribution is checked by test:e2e');
  const running = await controlledApplication();
  try {
    await running.page.getByLabel('展示昵称').fill('资源验收的玩家');
    await running.page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(running.page.getByRole('status')).toContainText('准备完成');
    const response = await fetch(running.configuration.apiBase + '/api/v1/tokens/media', {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + running.configuration.applicationSession,
      },
      body: JSON.stringify({ roomName: running.configuration.roomName, displayName: '秘密扫描哨兵' }),
    });
    expect(response.status).toBe(200);
    const credential: { accessToken: string } = await response.json();
    const files = await running.application.evaluate(async ({ app }) => {
      const { readdir } = process.getBuiltinModule('fs/promises');
      const { join } = process.getBuiltinModule('path');
      const walk = async (directory: string, prefix = ''): Promise<string[]> => {
        const files: string[] = [];
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const relative = prefix + entry.name;
          if (entry.isDirectory()) files.push(...await walk(join(directory, entry.name), relative + '/'));
          else files.push(relative);
        }
        return files;
      };
      return walk(app.getAppPath());
    });
    expect(files).toContain('dist/main/main.cjs');
    expect(files).toContain('dist/main/preload.cjs');
    expect(files).toContain('dist/renderer/index.html');
    expect(files).toContain('dist/main/media-preload.cjs');
    expect(files).toContain('dist/media/media.html');
    for (const file of files) {
      expect(file === 'package.json' || [
        'dist/main/main.cjs', 'dist/main/preload.cjs', 'dist/renderer/index.html',
        'dist/main/media-preload.cjs', 'dist/media/media.html',
      ].includes(file)
        || /^dist\/renderer\/assets\/[^/]+\.(js|css)$/.test(file), 'Only bundled application resources').toBe(true);
    }
    const resourceDirectory = join(desktop, 'build/windows/win-unpacked/resources');
    expect(await readdir(resourceDirectory)).toEqual(['app.asar']);
    // ASAR stores its files uncompressed; searching all bytes includes payloads.
    const resource = await readFile(join(resourceDirectory, 'app.asar'));
    for (const secret of [running.configuration.applicationSession, credential.accessToken]) {
      expect(resource.includes(Buffer.from(secret)), 'No runtime sentinel in distributed resources').toBe(false);
      expect((await running.page.locator('body').innerText() + running.diagnostics()).includes(secret),
        'No runtime sentinel in UI or diagnostics').toBe(false);
    }
    expect(resource.includes(Buffer.from('local_service.py')), 'No fixture launcher in distribution').toBe(false);
    expect(resource.includes(Buffer.from('--sandbox-acceptance')), 'No test harness in distribution').toBe(false);
  } finally { await running.close(); }
});

test('a packaged client without controlled startup exits instead of selecting a fixture', async () => {
  test.skip(test.info().project.name !== 'packaged', 'Distribution is checked by test:e2e');
  const { code, output } = await packagedProcess([]);
  expect(code).toBe(1);
  expect(output).toContain('Controlled desktop startup failed.');
  expect(output).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
});

test('a packaged client rejects a development renderer location', async () => {
  test.skip(test.info().project.name !== 'packaged', 'Distribution is checked by test:e2e');
  const service = await startTestService();
  const startup = await startStartupPipe(service.configuration);
  try {
    const { code, output } = await packagedProcess(['--babacom-startup-pipe=' + startup.path],
      { ...process.env, BABACOM_RENDERER_URL: 'http://127.0.0.1:1/' });
    expect(code).toBe(1);
    expect(service.responses()).toEqual([]);
    expect(output).toContain('Controlled desktop startup failed.');
    expect(output).not.toContain(service.configuration.applicationSession);
    expect(output).not.toMatch(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/);
  } finally { await startup.close(); await service.close(); }
});

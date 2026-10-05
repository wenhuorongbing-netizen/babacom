import { _electron as electron, expect, test } from '@playwright/test';
import { join } from 'node:path';
import { startRenderer, startStartupPipe, startTestService } from '../../apps/desktop/scripts/dev.mjs';
import { desktop } from '../../apps/desktop/scripts/build.mjs';

async function controlledApplication(scenario = 'ready', fillQuota = false) {
  const service = await startTestService(scenario);
  const renderer = await startRenderer();
  const startup = await startStartupPipe(service.configuration);
  const application = await electron.launch({
    args: [join(desktop, 'dist/main/main.cjs'), '--babacom-startup-pipe=' + startup.path],
    env: { ...process.env, BABACOM_RENDERER_URL: renderer.url },
  });
  let output = '';
  application.process().stdout?.on('data', (chunk) => { output += String(chunk); });
  application.process().stderr?.on('data', (chunk) => { output += String(chunk); });
  if (fillQuota) {
    for (let count = 0; count < 6; count++) {
      const response = await fetch(service.configuration.apiBase + '/api/v1/tokens/media', {
        method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: 'Bearer ' + service.configuration.applicationSession,
        },
        body: JSON.stringify({ roomName: 't1-room', displayName: '初始' }),
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
  }
  const page = await application.firstWindow();
  return {
    application, page, configuration: service.configuration,
    diagnostics: () => output + service.diagnostics(),
    recover: () => service.recover(),
    responses: () => service.responses(),
    close: async () => {
      await application.close();
      await renderer.close();
      await startup.close();
      await service.close();
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
    expect(await page.evaluate(() => Object.keys(window.admission).sort())).toEqual(['cancel', 'environment', 'prepare', 'roomName']);
    await page.screenshot({ path: join(desktop, 'build/admission-ready.png') });
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

test('the real window denies media, navigation, popups and forged IPC parameters', async () => {
  const running = await controlledApplication();
  try {
    const { page } = running;
    const requests: string[] = [];
    await expect(page.getByText('本地测试环境')).toBeVisible();
    page.on('websocket', (socket) => requests.push(socket.url()));
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

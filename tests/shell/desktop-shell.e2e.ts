import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { createStartupCleanup, startRenderer, startStartupPipe, startTestService, startMediaService } from '../../apps/desktop/scripts/dev.mjs';
import { desktop } from '../../apps/desktop/scripts/build.mjs';
import { join } from 'node:path';

function parseRgb(color: string): [number, number, number] {
  const match = color.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) return [0, 0, 0];
  return [Number(match[0]), Number(match[1]), Number(match[2])];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(colorA: string, colorB: string): number {
  const l1 = relativeLuminance(parseRgb(colorA));
  const l2 = relativeLuminance(parseRgb(colorB));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function getMainWindowId(application: ElectronApplication, page: Page): Promise<number> {
  const targetUrl = page.url();
  return application.evaluate(({ BrowserWindow }, url) => {
    const windows = BrowserWindow.getAllWindows();
    const match = windows.find((w) => {
      try {
        return !w.isDestroyed() && w.webContents.getURL() === url;
      } catch {
        return false;
      }
    });
    if (!match) {
      throw new Error(`Main BrowserWindow for URL ${url} not found among ${windows.length} windows`);
    }
    return match.id;
  }, targetUrl);
}

async function verifyWindowAndZoomCombinations(
  page: Page,
  application: ElectronApplication,
  windowId: number,
  controls: Locator[],
) {
  for (const size of [{ width: 760, height: 740 }, { width: 1280, height: 800 }]) {
    // Set actual Electron BrowserWindow content size on the bound main window
    await application.evaluate(({ BrowserWindow }, { id, s }) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      win.setContentSize(s.width, s.height);
    }, { id: windowId, s: size });

    const actualContentSize = await application.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      return win.getContentSize();
    }, windowId);
    expect(actualContentSize[0]).toBe(size.width);
    expect(actualContentSize[1]).toBe(size.height);

    for (const factor of [1.0, 1.25, 1.5]) {
      // Set actual webContents zoom factor on the bound main window
      await application.evaluate(({ BrowserWindow }, { id, z }) => {
        const win = BrowserWindow.fromId(id);
        if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
        win.webContents.setZoomFactor(z);
      }, { id: windowId, z: factor });

      const actualZoom = await application.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.fromId(id);
        if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
        return win.webContents.getZoomFactor();
      }, windowId);
      expect(Math.abs(actualZoom - factor)).toBeLessThan(0.01);

      // Verify consistent innerWidth/innerHeight scaling
      const expectedWidth = Math.round(size.width / factor);
      const expectedHeight = Math.round(size.height / factor);
      await expect.poll(async () => {
        return await page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        }));
      }).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });

      // Inspect document AND shell stage scrollWidth/clientWidth: no horizontal scroll/overflow
      const overflowMetrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const stage = document.querySelector('.shell-stage');
        return {
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          stageScrollWidth: stage ? stage.scrollWidth : 0,
          stageClientWidth: stage ? stage.clientWidth : 0,
        };
      });
      expect(
        overflowMetrics.docScrollWidth,
        `Document horizontal overflow at ${size.width}x${size.height} zoom ${factor}`,
      ).toBeLessThanOrEqual(overflowMetrics.docClientWidth + 1);
      expect(
        overflowMetrics.stageScrollWidth,
        `Shell stage horizontal overflow at ${size.width}x${size.height} zoom ${factor}`,
      ).toBeLessThanOrEqual(overflowMetrics.stageClientWidth + 1);

      // Check all supplied relevant controls after scrolling into view: within viewport and scroll stage
      const stageBox = await page.locator('.shell-stage').boundingBox();
      expect(stageBox).toBeTruthy();

      for (const control of controls) {
        await expect(control).toBeVisible();
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box, `Control bounding box at ${size.width}x${size.height} zoom ${factor}`).toBeTruthy();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(expectedWidth + 1);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(expectedHeight + 1);

          if (stageBox) {
            expect(box.x).toBeGreaterThanOrEqual(stageBox.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(stageBox.y - 1);
            expect(box.y + box.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
          }
        }
      }
    }
  }

  // Restore zoom to 1.0 and window content size to default 1280x800 on the bound main window
  await application.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.fromId(id);
    if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
    win.webContents.setZoomFactor(1.0);
    win.setContentSize(1280, 800);
  }, windowId);
}

async function launchAdmissionDesktop(scenario = 'ready') {
  const owner = createStartupCleanup();
  let stage = 'API';
  try {
    const service = await startTestService(scenario);
    await owner.own('API', () => service.close());
    const packaged = test.info().project.name === 'packaged';
    stage = 'RENDERER';
    const renderer = packaged ? null : await startRenderer();
    if (renderer) await owner.own('RENDERER', () => renderer.close());
    stage = 'PIPE';
    const startup = await startStartupPipe(service.configuration);
    await owner.own('PIPE', () => startup.close());
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) environment[key] = value;
    }
    delete environment.BABACOM_RENDERER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    if (renderer) environment.BABACOM_RENDERER_URL = renderer.url;
    if (packaged) {
      environment.PATH = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
      delete environment.NODE_OPTIONS;
      delete environment.NODE_PATH;
    }
    stage = 'DRIVER';
    const application = await electron.launch({
      executablePath: packaged ? join(desktop, 'build/windows/win-unpacked/BabaCom.exe') : undefined,
      args: [...(packaged ? [] : [join(desktop, 'dist/main/main.cjs')]), '--babacom-startup-pipe=' + startup.path],
      env: environment,
    });
    const applicationProcess = application.process();
    await owner.own('DRIVER', async () => {
      if (applicationProcess.exitCode === null) await application.close();
    });
    stage = 'WINDOW';
    const page = await application.firstWindow();
    return {
      application,
      page,
      configuration: service.configuration,
      close: () => owner.close(),
    };
  } catch (error) {
    return owner.fail(stage, error);
  }
}

async function launchMediaDesktop(scenario = 'ready') {
  const owner = createStartupCleanup();
  let stage = 'API';
  try {
    const service = await startMediaService(scenario);
    await owner.own('API', () => service.close());
    const packaged = test.info().project.name === 'packaged';
    stage = 'RENDERER';
    const renderer = packaged ? null : await startRenderer();
    if (renderer) await owner.own('RENDERER', () => renderer.close());
    stage = 'PIPE';
    const startup = await startStartupPipe(service.configuration);
    await owner.own('PIPE', () => startup.close());
    const mediaStartup = service.media ? await startStartupPipe(service.media) : null;
    if (mediaStartup) await owner.own('PIPE', () => mediaStartup.close());
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) environment[key] = value;
    }
    delete environment.BABACOM_RENDERER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    if (renderer) environment.BABACOM_RENDERER_URL = renderer.url;
    if (packaged) {
      environment.PATH = join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
      delete environment.NODE_OPTIONS;
      delete environment.NODE_PATH;
    }
    stage = 'DRIVER';
    const application = await electron.launch({
      executablePath: packaged ? join(desktop, 'build/windows/win-unpacked/BabaCom.exe') : undefined,
      args: [
        ...(packaged ? [] : [join(desktop, 'dist/main/main.cjs')]),
        '--babacom-startup-pipe=' + startup.path,
        ...(mediaStartup ? ['--babacom-media-pipe=' + mediaStartup.path] : []),
      ],
      env: environment,
    });
    const applicationProcess = application.process();
    await owner.own('DRIVER', async () => {
      if (applicationProcess.exitCode === null) await application.close();
    });
    stage = 'WINDOW';
    const page = await application.firstWindow();
    return {
      application,
      page,
      service,
      configuration: service.configuration,
      close: () => owner.close(),
    };
  } catch (error) {
    return owner.fail(stage, error);
  }
}

test('persistent Discord shell renders server rail, channel sidebar, and main stage in admission state', async ({}, testInfo) => {
  const running = await launchAdmissionDesktop();
  try {
    const { page, application } = running;
    const windowId = await getMainWindowId(application, page);

    // Shell container and landmarks
    const shell = page.locator('.desktop-shell');
    await expect(shell).toBeVisible();

    const serverRail = page.getByRole('navigation', { name: '服务器列表' });
    await expect(serverRail).toBeVisible();

    const channelSidebar = page.getByRole('navigation', { name: '频道导航' });
    await expect(channelSidebar).toBeVisible();

    // BabaCom identity in rail and sidebar header
    const railBadge = serverRail.locator('.rail-server-badge');
    await expect(railBadge).toBeVisible();
    await expect(railBadge).toHaveAttribute('aria-label', 'BabaCom');
    await expect(railBadge.locator('.rail-server-initials')).toHaveText('BC');
    await expect(channelSidebar.locator('.sidebar-header')).toContainText('BabaCom');
    await expect(channelSidebar.locator('.sidebar-badge')).toHaveText('当前社区');

    // Room presentation and honest initial idle status
    const channelItem = channelSidebar.locator('.channel-item');
    await expect(channelItem).toContainText(running.configuration.roomName);
    await expect(channelItem.locator('.channel-status-label')).toHaveText('未加入');
    await expect(channelItem).not.toHaveClass(/connected/);

    // Exactly one main landmark in the entire document
    await expect(page.locator('main')).toHaveCount(1);

    // Singular page.getByRole('status') assertion must continue to work without ambiguity
    await expect(page.getByRole('status')).toContainText('等待输入昵称');

    // Computed text contrast from actual rendered colors/backgrounds (>= 4.5:1)
    const titleMetrics = await page.locator('.sidebar-server-title').evaluate((el) => {
      const cs = getComputedStyle(el);
      const sidebar = el.closest('.shell-sidebar');
      const bg = sidebar ? getComputedStyle(sidebar).backgroundColor : 'rgb(43, 45, 49)';
      return { color: cs.color, bg };
    });
    expect(contrastRatio(titleMetrics.color, titleMetrics.bg)).toBeGreaterThanOrEqual(4.5);

    const channelMetrics = await page.locator('.channel-name').evaluate((el) => {
      const cs = getComputedStyle(el);
      const sidebar = el.closest('.shell-sidebar');
      const bg = sidebar ? getComputedStyle(sidebar).backgroundColor : 'rgb(43, 45, 49)';
      return { color: cs.color, bg };
    });
    expect(contrastRatio(channelMetrics.color, channelMetrics.bg)).toBeGreaterThanOrEqual(4.5);

    // Keyboard navigation and focus-visible outline contrast
    const nickname = page.getByLabel('展示昵称');
    await nickname.focus();

    const focusMetrics = await nickname.evaluate((el) => {
      const cs = getComputedStyle(el);
      const parentBg = getComputedStyle(el.closest('.card') || el.parentElement || el).backgroundColor;
      return {
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
        parentBg,
      };
    });
    expect(focusMetrics.outlineWidth).toBeGreaterThan(0);
    expect(focusMetrics.outlineStyle).not.toBe('none');
    expect(contrastRatio(focusMetrics.outlineColor, focusMetrics.parentBg)).toBeGreaterThanOrEqual(3.0);

    // Input border contrast against both adjacent surfaces: input background and card surface (>= 3:1)
    const borderMetrics = await nickname.evaluate((el) => {
      const cs = getComputedStyle(el);
      const inputBg = cs.backgroundColor;
      const cardBg = getComputedStyle(el.closest('.card') || el.parentElement || el).backgroundColor;
      return { borderColor: cs.borderTopColor, inputBg, cardBg };
    });
    expect(contrastRatio(borderMetrics.borderColor, borderMetrics.inputBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(borderMetrics.borderColor, borderMetrics.cardBg)).toBeGreaterThanOrEqual(3.0);

    // Trigger failure status via invalid nickname to verify failure text contrast (>= 4.5:1)
    const prepareBtn = page.getByRole('button', { name: '准备入房', exact: true });
    await nickname.fill('x'.repeat(33));
    await expect(prepareBtn).toBeEnabled();
    const buttonMetrics = await prepareBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      const cardBg = getComputedStyle(el.closest('.card') || el.parentElement || el).backgroundColor;
      return { color: cs.color, backgroundColor: cs.backgroundColor, cardBg };
    });
    expect(contrastRatio(buttonMetrics.backgroundColor, buttonMetrics.cardBg)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(buttonMetrics.color, buttonMetrics.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    await prepareBtn.click();
    const failureStatus = page.getByRole('status');
    await expect(failureStatus).toContainText('昵称须为 1–32 个字');

    const failureMetrics = await failureStatus.evaluate((el) => {
      const cs = getComputedStyle(el);
      const cardBg = getComputedStyle(el.closest('.card') || el.parentElement || el).backgroundColor;
      return { color: cs.color, cardBg };
    });
    expect(contrastRatio(failureMetrics.color, failureMetrics.cardBg)).toBeGreaterThanOrEqual(4.5);

    // Meaningful keyboard order: Fill valid nickname, Tab reaches retry button, Enter submits recovery
    await nickname.fill('测试玩家');
    await page.keyboard.press('Tab');
    const retryBtn = page.getByRole('button', { name: '重新准备', exact: true });
    await expect(retryBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('准备完成');

    // After recovery to ready state, prepare button is back and join button is visible
    const joinVoiceBtn = page.getByRole('button', { name: '加入语音房间', exact: true });
    await expect(joinVoiceBtn).toBeVisible();
    await expect(prepareBtn).toBeVisible();

    // Viewport & zoom combinations (760x740 and 1280x800 at 100%, 125%, 150%) on bound main BrowserWindow
    await verifyWindowAndZoomCombinations(page, application, windowId, [nickname, prepareBtn, joinVoiceBtn]);

    // Current-run append-only screenshots: overview at 100%
    await page.locator('.shell-stage').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-admission-100.png') });

    // Set 760x740 and 150% zoom on bound main window
    await application.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      win.setContentSize(760, 740);
      win.webContents.setZoomFactor(1.5);
    }, windowId);

    // Scroll to top for overview at 150%
    await page.locator('.shell-stage').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-admission-150-overview.png') });

    // Scroll controls into view for controls capture at 150%
    await prepareBtn.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-admission-150-controls.png') });

    // Reset window size and zoom factor
    await application.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      win.webContents.setZoomFactor(1.0);
      win.setContentSize(1280, 800);
    }, windowId);
  } finally {
    await running.close();
  }
});

test('persistent Discord shell survives transition into active call and back to admission', async ({}, testInfo) => {
  const running = await launchMediaDesktop();
  try {
    const { page, application } = running;
    const windowId = await getMainWindowId(application, page);

    // Verify initial shell in admission
    const shell = page.locator('.desktop-shell');
    await expect(shell).toBeVisible();
    await expect(page.getByRole('navigation', { name: '服务器列表' })).toBeVisible();
    const channelSidebar = page.getByRole('navigation', { name: '频道导航' });
    await expect(channelSidebar).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);

    // Initial idle channel status
    const channelItem = channelSidebar.locator('.channel-item');
    await expect(channelItem.locator('.channel-status-label')).toHaveText('未加入');
    await expect(channelItem).not.toHaveClass(/connected/);

    // Prepare admission
    await page.getByLabel('展示昵称').fill('外壳测试玩家');
    await page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('准备完成');

    // Join voice room
    await page.getByRole('button', { name: '加入语音房间', exact: true }).click();
    const micButton = page.getByRole('button', { name: '开启麦克风', exact: true });
    await expect(micButton).toBeVisible({ timeout: 30_000 });

    // In active call state: persistent shell must still be present
    await expect(shell).toBeVisible();
    await expect(page.getByRole('navigation', { name: '服务器列表' })).toBeVisible();
    await expect(channelSidebar).toBeVisible();

    // In active call state: channel status is honestly mapped to "已连接" and styled connected
    await expect(channelItem.locator('.channel-status-label')).toHaveText('已连接');
    await expect(channelItem).toHaveClass(/connected/);

    // In active call state: exactly one main landmark containing call controls
    await expect(page.locator('main')).toHaveCount(1);
    await expect(micButton).toBeVisible();
    const enableAudioBtn = page.getByRole('button', { name: '启用声音', exact: true });
    await expect(enableAudioBtn).toBeVisible();
    const leaveVoiceBtn = page.getByRole('button', { name: '离开语音房间', exact: true });
    await expect(leaveVoiceBtn).toBeVisible();

    // Verify viewport and zoom combination with active call controls on bound main BrowserWindow
    await verifyWindowAndZoomCombinations(page, application, windowId, [leaveVoiceBtn, micButton, enableAudioBtn]);

    // Current-run append-only screenshots in active call: overview at 100%
    await page.locator('.shell-stage').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-active-100.png') });

    // Set 760x740 and 150% zoom on bound main window
    await application.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      win.setContentSize(760, 740);
      win.webContents.setZoomFactor(1.5);
    }, windowId);

    // Scroll to top for overview at 150%
    await page.locator('.shell-stage').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-active-150-overview.png') });

    // Scroll controls into view for controls capture at 150%
    await micButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-active-150-controls.png') });

    // Reset window size and zoom factor
    await application.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      if (!win) throw new Error(`BrowserWindow with id ${id} missing`);
      win.webContents.setZoomFactor(1.0);
      win.setContentSize(1280, 800);
    }, windowId);

    // Leave voice room
    await leaveVoiceBtn.click();

    // Verify returning to admission: shell remains mounted, admission form is back, and channel returns to idle
    await expect(page.getByLabel('展示昵称')).toBeVisible();
    await expect(shell).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(channelItem.locator('.channel-status-label')).toHaveText('未加入');
    await expect(channelItem).not.toHaveClass(/connected/);
  } finally {
    await running.close();
  }
});

test('persistent Discord shell maps failed status honestly when connection fails', async ({}, testInfo) => {
  const running = await launchMediaDesktop('url-mismatch');
  try {
    const { page } = running;
    const shell = page.locator('.desktop-shell');
    await expect(shell).toBeVisible();

    const channelSidebar = page.getByRole('navigation', { name: '频道导航' });
    const channelItem = channelSidebar.locator('.channel-item');
    await expect(channelItem.locator('.channel-status-label')).toHaveText('未加入');

    // Prepare admission
    await page.getByLabel('展示昵称').fill('失败测试玩家');
    await page.getByRole('button', { name: '准备入房', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('准备完成');

    // Click join - with url-mismatch fixture, join fails
    await page.getByRole('button', { name: '加入语音房间', exact: true }).click();

    // Verify failure status in channel sidebar: honestly mapped to '连接失败' without connected styling
    await expect(channelItem.locator('.channel-status-label')).toHaveText('连接失败', { timeout: 15_000 });
    await expect(channelItem).not.toHaveClass(/connected/);

    // Capture screenshot of failed state
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-failed-status.png') });
  } finally {
    await running.close();
  }
});

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import { createStartupCleanup, startRenderer, startStartupPipe, startTestService, startMediaService } from '../../apps/desktop/scripts/dev.mjs';
import { desktop } from '../../apps/desktop/scripts/build.mjs';

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

async function verifyViewportAndZoomCombinations(
  page: Page,
  application: ElectronApplication,
  controlSelector: Locator,
) {
  for (const viewport of [{ width: 760, height: 740 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const factor of [1.0, 1.25, 1.5]) {
      await application.evaluate(({ BrowserWindow }, z) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z);
      }, factor);

      const actualZoom = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      );
      expect(Math.abs(actualZoom - factor)).toBeLessThan(0.01);

      const hasNoHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(hasNoHorizontalOverflow, `Horizontal overflow at ${viewport.width}x${viewport.height} zoom ${factor}`).toBe(true);

      const box = await controlSelector.boundingBox();
      expect(box, `Key control bounding box at ${viewport.width}x${viewport.height} zoom ${factor}`).toBeTruthy();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
  }
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.0);
  });
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
    await expect(channelSidebar.locator('.sidebar-header')).toContainText('BabaCom');

    // Room presentation in sidebar
    await expect(channelSidebar.locator('.channel-item')).toContainText(running.configuration.roomName);

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

    // Keyboard order and focus visible styling: nickname -> Tab -> prepare button
    const nickname = page.getByLabel('展示昵称');
    await nickname.focus();

    // Focus-visible outline contrast and metrics (>= 3:1 contrast against adjacent surface, positive visible width)
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

    // Meaningful keyboard order: Fill nickname, Tab to prepare, Enter submits
    await nickname.fill('测试玩家');
    await page.keyboard.press('Tab');
    const prepareBtn = page.getByRole('button', { name: '准备入房', exact: true });
    await expect(prepareBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('准备完成');

    // Viewport & zoom combinations (760x740 and 1280x800 at 100%, 125%, 150%)
    await verifyViewportAndZoomCombinations(page, application, nickname);

    // Capture admission screenshot using only testInfo.outputPath
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-admission.png') });
  } finally {
    await running.close();
  }
});

test('persistent Discord shell survives transition into active call and back to admission', async ({}, testInfo) => {
  const running = await launchMediaDesktop();
  try {
    const { page, application } = running;

    // Verify initial shell in admission
    const shell = page.locator('.desktop-shell');
    await expect(shell).toBeVisible();
    await expect(page.getByRole('navigation', { name: '服务器列表' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '频道导航' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);

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
    await expect(page.getByRole('navigation', { name: '频道导航' })).toBeVisible();

    // In active call state: exactly one main landmark containing call controls
    await expect(page.locator('main')).toHaveCount(1);
    await expect(micButton).toBeVisible();
    await expect(page.getByRole('button', { name: '启用声音', exact: true })).toBeVisible();

    // Verify viewport and zoom combination with active call controls
    await verifyViewportAndZoomCombinations(page, application, micButton);

    // Capture active call screenshot using only testInfo.outputPath
    await page.screenshot({ path: testInfo.outputPath('desktop-shell-active.png') });

    // Leave voice room
    await page.getByRole('button', { name: '离开语音房间', exact: true }).click();

    // Verify returning to admission: shell remains mounted and admission form is back
    await expect(page.getByLabel('展示昵称')).toBeVisible();
    await expect(shell).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
  } finally {
    await running.close();
  }
});

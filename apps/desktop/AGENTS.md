# apps/desktop — 桌面客户端约定

> 只有改动这棵树时才会被加载。仓库级铁律见根目录 [`AGENTS.md`](../../AGENTS.md)。

## 技术栈（ADR-0001 已裁决，不得擅自更换）

Electron + React + TypeScript + Vite

选 Electron 不是因为它轻 —— 安装包和内存占用都比原生壳大。
是因为：Chromium 的 WebRTC 行为成熟 · 可复用网页前端生态 · 有桌面窗口捕获 ·
能做托盘/快捷键/自动更新 · TypeScript 的类型约束在多人协作时有用。

## 目录约定

```
src/
├─ main/        Electron 主进程（窗口、托盘、全局快捷键、desktopCapturer）
├─ shell/       应用外壳与布局 —— 6.1 所有
├─ routes/      路由 —— 6.1 所有
├─ features/    按模块一个目录，互不跨目录 import
│  ├─ voice/         3.1
│  ├─ audio/         3.2
│  ├─ camera/        3.3
│  ├─ share/publish/ 4.1
│  ├─ share/watch/   4.2
│  ├─ connection/    4.3
│  ├─ chat/          5.1
│  └─ ...
├─ i18n/        文案 —— 6.2 所有
└─ styles/      设计令牌 —— 6.2 所有
```

## 硬性规则

1. **`features/` 之间不得互相 import。** 需要共享 → 提到 `packages/ui` 或 `packages/contracts`，走 Tech Lead。
2. **不得硬编码颜色、字号、间距。** 全部用 `styles/tokens.css` 的 CSS 变量。
3. **不得自己造按钮、弹窗、列表、头像。** 用 `packages/ui`，缺什么就提议加。
4. **所有面向用户的字符串必须走 `t()`。** 中文文案可以先写全，英文可以留待 R03 校对，
   但**不能不包 `t()`** —— 事后补 i18n 比一开始做贵得多。
5. **不得在渲染进程直接调 Node API。** 走 preload 暴露的受限接口。
6. **不得关闭 `contextIsolation` 或打开 `nodeIntegration`。**

## 媒体相关

- 房间连接、参与者、麦克风、屏幕共享一律用 **LiveKit JS SDK**，
  不自己写 WebRTC 信令（ADR-0002）
- 麦克风和屏幕音频是**两条独立音轨**，任何把它们混成一路的实现都是错的
- token 一律向 7.2 的接口申请，**不在客户端铸造**

## Validation

```bash
npm run typecheck
npm run lint
npm run test
npm run build          # Windows 打包必须能过
```

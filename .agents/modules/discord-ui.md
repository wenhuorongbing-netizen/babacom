# discord-ui — 单社区、单房间桌面外壳（范围已签认）

| | |
|---|---|
| Status | DECIDED：Jack 已于 2026-10-12 签认；独立 docs PR 合并前不得产品写入 |
| Module | discord-ui（本次六文件纵切片，不代表完整 6.1 / 6.2） |
| Baseline | main `e36e986ff0686cc1527a4689932ec5479863746d` |
| Authority | Jack；A 为协调者，原战略 PO 负责产品建议 |
| Issue | 范围文档 [#46](https://github.com/wenhuorongbing-netizen/babacom/issues/46)；产品实施票在 docs 合并后另建并绑定 |

## 来源与生效

2026-10-12，Jack 要求遵循 Discord 桌面布局和交互习惯，由 Antigravity 的
Gemini 3.8 Flash (High) 代理承担设计和修改。原
[战略 PO](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ac2188a-8b8c-83ee-ab67-968c584fe99f)
本轮补齐设计，确认此前没有完整 Discord 版式定案，并建议此最小外壳切片。

Jack 已在 2026-10-12 明确回复“签认并授权上述流程”，授权建票、发布和审查合并独立
范围文档 PR，再由单一 Gemini Builder 实施六文件并提交产品 PR；产品 PR 合并仍由 Jack 裁定。
本范围须通过独立 `Module: docs` PR 审查、合并本清单与
`docs/04-open-decisions.md` 的 D15。此后方可在一个明确 Issue 下实施六文件产品 PR。
草稿、PO 的设计 GO 或通过 scope_guard，均不单独构成扩权或合并授权。
既有 6.1、6.2、T1、T2 清单不变；本清单仅对该 UI 切片生效。

## 用户可见结果

- 左侧产品入口、频道区与弹性主区采用 Discord 熟悉的深灰分层和蓝紫强调色，保留 BabaCom 名称。
- 同一个外壳持续包裹准入与通话两条渲染分支；不把外壳仅挂到 AdmissionPage 内。
- 复用现有准入、VoicePanel 与 AudioControls，保持挂载条件、状态机、按钮动作、可访问名称与测试语义。
- 第一片不重排完整成员列表或音频控制，不引入聊天室、屏幕共享、摄像头入口或虚假成员/指标。
- 房间、身份和成员仅来自现有真实数据；缺少展示字段时使用诚实的通用标签，不增加推测数据源。

## Allowed files

<!-- allowed-files:start -->
apps/desktop/src/shell/DesktopShell.tsx
apps/desktop/src/renderer.tsx
apps/desktop/src/styles/tokens.css
apps/desktop/src/i18n/zh-CN.json
apps/desktop/playwright.config.ts
tests/shell/desktop-shell.e2e.ts
<!-- allowed-files:end -->

前述六条是完整上界，不使用目录通配。`DesktopShell.tsx` 与测试文件为拟建路径。
`renderer.tsx` 只接入布局外壳；不改变媒体订阅、准入准备、会话切换或清理行为。
`tokens.css` 保留既有 token 名称和功能样式；只增加必要布局 token、调整视觉值与焦点/缩放适配。
沿用系统中文字体栈，复用现有 UI 原语；新文案使用现有 `t()`。
公共组件接口保持不变，不新建未消费的 Modal、Avatar 或图标依赖。

`playwright.config.ts` 只向既有 testMatch 增加 `**/shell/desktop-shell.e2e.ts`；
保留 admission、voice、audio 全部既有匹配、两项目、单 worker、零重试与原期限。
不修改既有测试、辅助函数、应用启动脚本或全局测试配置以掩盖失败。

## 代理与集成

视觉基础、布局、状态映射三个设计角色可以并行；独立审查者复核合并后的方案。
所有角色固定 `gemini-3.8-flash-high`，原生子代理使用 `inherit`，不得默换模型。
产品写入阶段仅设一个 Gemini Builder，按 token → 外壳接线 → 精确测试串行实施。
A 负责调度、范围控制、验证和 Git 集成，不替代用户指定的 Gemini 美术实现者。
共享 token 和同一文件不并发写入，其他工作副本的未提交草稿继续排除。

## 冻结与真实性

不修改 main/preload、API、schema、依赖、SFU、JWT、权限同意、TTL、限流或设备生命周期。
默认闭麦、播放手势、手动重新加入及退出清理规则均保持。
准备完成不表示已连接；麦克风开启不表示正在说话；静音不表示设备已释放。
#41 未修复前，audioReceiving 不作为当前接收、说话光环或实际听音成功证据。
缺少实时电平字段，不添加本地或远端说话动画、假波形、延迟、区域或降噪指标。

## Validation

文档 PR：

```powershell
node .agents/scope_guard.mjs docs --files .agents/modules/discord-ui.md docs/04-open-decisions.md
git diff --check
```

产品 PR 在已签认范围生效后，依次执行；每条须 exit 0 才可登记通过：

```powershell
node .agents/scope_guard.mjs discord-ui --files apps/desktop/src/shell/DesktopShell.tsx apps/desktop/src/renderer.tsx apps/desktop/src/styles/tokens.css apps/desktop/src/i18n/zh-CN.json apps/desktop/playwright.config.ts tests/shell/desktop-shell.e2e.ts
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run test --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
npm run test:e2e --workspace apps/desktop
git diff --check
```

新测试通过现有 development / packaged 项目执行，在真实窗口验证外壳在准入与通话状态间持续存在；
同时保留旧用例。测试输出须能确认该新文件被实际发现并执行，不能把零用例当通过。
760×740、1280×800、125% 与 150% 页面缩放均不得遮挡主要操作或产生页面横向溢出；
键盘焦点可见、顺序合理，文本对比度至少 4.5:1，交互边界与焦点环至少 3:1。
开发界面与实际 EXE 分别保存本次视觉证据；模拟状态若用于设计展示须明确标注。

## 完成条件

- [x] Jack 已签认范围及上述流程。
- [ ] 独立 docs PR 已审查合并，实施 Issue 已绑定。
- [ ] 产品 diff 严格限于六文件；既有公共接口与媒体行为不变。
- [ ] 新测试实际运行，覆盖持续外壳、两尺寸、缩放与键盘操作，旧断言不削弱。
- [ ] 规定命令真实通过，开发与 EXE 视觉证据齐全，无假功能或指标。
- [ ] Standards 与 Spec 审查无阻塞，已如实记录原有失败与未运行项。

设计及获准后的 UI 工作不必等待 #31 / #42 关闭；环境失败仍记 HOLD，不能跳过或换绿。
本片不关闭 #18，不签收真人听音、物理设备释放、中德、完整 6.1 / 6.2、M0 或 Alpha。

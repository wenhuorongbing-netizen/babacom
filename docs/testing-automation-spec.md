# T2-A1 — 开发启动与测试资源清理

2026-10-08，Europe/Berlin。对应测试调研中的 A1：启动超时与失败清理。本文件独立列明实施范围与验收，不依赖尚未发布的研究报告。用户以 `/implement 1` 请求实施 A1；这不是 GitHub 的旧 Issue #1。

生效条件：本契约随独立 Module: docs PR 审阅合并生效。该 PR 合并前，本文件不解除正常 T1 测试/辅助函数的零改动规则。本地草稿、CI绿色或实施请求不代替该仓库要求的具体范围 PR；A1实施授权已有，不重复申请。

契约签认与集成裁决者：Jack（@wenhuorongbing-netizen），仅本 fork。实施票与 #28/T2-V1 分开；#28的两文件限制和已完成 Sandbox 修复不因此扩展。Jack于2026-10-08明确授权发布/合并本次 docs PR并继续实施A1。

## 问题及目标

最近开发版原始昵称用例在30秒期限内不能完成。有限探针证明API、Vite与startup pipe约2.2秒内就绪，此后Electron/Playwright握手超时；最小空窗口也失败。打包版相同原始用例通过。根因未确认，不能先认定需要改依赖、fuse、Vite或产品入口。

另一个可观察缺口：`controlledApplication()` 从服务分配到 `firstWindow()` 返回之间尚未全部受失败清理覆盖。外层调用者的finally只有helper成功返回后才生效。测试worker结束或关闭外围shell也不能证明其子进程已释放。

A1目标是定位并最小修复启动故障，让原始开发用例恢复；集中本次测试资源所有权，使启动失败、取消、正常关闭和worker退出均有可验证的有限清理。先修根因，不借重构、跳过或重试掩盖失败。

## 实施 Allowed Files：仅三条

- `apps/desktop/scripts/dev.mjs`
- `tests/shell/admission.e2e.ts`
- `tests/voice/session.e2e.ts`

dev.mjs只允许本次开发/测试启动、阶段诊断和拥有资源清理所需的最小函数子集。Sandbox已有行为、guest断言、结果语义、原生连接修复和拥有实例检查保留；不将A1功能写进#28提交。

admission.e2e.ts只允许受控启动/关闭helper、其调用接线及针对启动/清理的新回归。既有每个测试主体、断言、测试数量、昵称/会话/限流/凭据语义、原始timeout和打包资源白名单零改动。异常路径的诊断只能使用允许的有限字段。

session.e2e.ts只允许本次启动helper及针对启动失败、取消、迟到资源、worker结束和非本次资源保存的新回归。既有媒体/身份/准入断言和Sandbox runner回归不降低、不删除。

Job Object候选脚本不在本次三路径内。若实际正确seam需要新helper、依赖、配置或第四处文件，先停并提交独立范围变更，不内联复杂机制来规避范围约束。

## 不变与范围外

- T1规格/清单与三份旧schema，产品main/preload、认证/授权、媒体fixture、infra和历史证据零diff。
- 不新增/更换框架或依赖，不修改node_modules、Electron fuse、系统全局配置或安全开关。需要其中任何一项时另说明证据、范围与资源。
- 不增加timeout/retries，不mock驱动握手冒充修好，不用packaged或浏览器测试替代development，不减少发现用例或把先决条件失败变成skip/PASS。
- 不实施A2分层/构建缓存、A3CI、双客户端、非回环/TLS、网络损伤、物理采集、服务器操作或中德验收。

## 启动、诊断与所有权

1. 使用既有API、SID限定命名管道、Vite和真实Electron/Playwright路径。每次会话/房间授权/限流状态独立，保留回环约束。
2. 从第一次分配资源起由helper或fixture拥有并清理，不等待helper成功返回后才建立finally；关闭可重复调用。每一阶段失败仍回收此前所有资源，后续清理不被前一项异常阻断。
3. 保留每个测试原期限，启动/读取/关闭操作有有限预算和取消处理；迟到创建的资源不得变成无人拥有的后台对象。
4. 正常关闭先走已有客户端/API关闭方式；强制结束只能针对已确认属于本次的进程。不得按进程名清空Electron/Node/Python，不接管未知管道或Sandbox。
5. worker退出路径不能只由普通finally证明。若平台正确seam不可达，明确报告BLOCKED并补范围，不声明完成。
6. 清理失败单独标识并阻止成功；保留原失败阶段及实际退出码，不让清理异常覆盖最初故障。停止外围shell不构成资源释放证据。
7. 固定阶段包括API、RENDERER、PIPE、DRIVER、WINDOW、UI、RELEASE；只记录阶段、单调耗时、有限类别、实际数字退出码、归属和释放结果。应用会话/JWT、配置、URL正文和原始stdout/stderr不进入新增可持久化诊断；trace默认关闭。

## 验证与完成标准

先用原始命令保留RED，再在正确seam建立最小回归并修复。诊断过程中不反复运行已知启动失败的完整套件。以下短循环运行路径、参数和断言保持原意：

```powershell
node node_modules/@playwright/test/cli.js test tests/shell/admission.e2e.ts --config apps/desktop/playwright.config.ts --project development --grep "normalized nickname" --max-failures 1
node node_modules/@playwright/test/cli.js test tests/shell/admission.e2e.ts --config apps/desktop/playwright.config.ts --project packaged --grep "normalized nickname" --max-failures 1
```

新增生命周期测试的稳定标题必须包含 `A1 startup`，由既有session.e2e.ts入口实际发现；真实驱动与替身断言分别报告。先确认因当前缺陷失败，再测实现通过：

```powershell
node node_modules/@playwright/test/cli.js test tests/voice/session.e2e.ts --config apps/desktop/playwright.config.ts --grep "A1 startup"
```

局部恢复后串行执行既有完整要求，不与build/package并发：

```powershell
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run test --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
npm run test:e2e --workspace apps/desktop
npm run dev --workspace apps/desktop -- --sandbox-acceptance
node .agents/scope_guard.mjs t2 --files apps/desktop/scripts/dev.mjs tests/shell/admission.e2e.ts tests/voice/session.e2e.ts
git diff --check
```

完成必须同时满足：原始development/packaged用例通过；启动各失败点、取消、迟到资源、worker退出的拥有资源回收实际成立；非本次资源保存；完整desktop回归0失败且旧覆盖无遗漏；同产物真实Sandbox PASS/RELEASED；新增诊断无秘密；实施diff仅三路径。新增原生检查的NOT_RUN/skip不能作为完成。DB NOT_APPLICABLE。

API业务/权限/媒体协议未修改，原完整desktop用例继续覆盖既有真实fixture。#18真人两设备、人耳、物理释放、中德验收保持原边界，A1通过不关闭它们。

## 本次前置docs的验证

本次只修改本文件、docs/T2-spec.md的A1条件引用，以及.agents/modules/t2.md的狭窄例外；不修改任何实施文件。

```powershell
node .agents/scope_guard.mjs docs --files docs/testing-automation-spec.md docs/T2-spec.md .agents/modules/t2.md
node --test .agents/scope_guard.test.mjs
git diff --check
```

通过条件：exit 0，三份文档一致，现有实现源文件摘要不变；A1实施测试在docs范围生效前明确NOT_RUN。

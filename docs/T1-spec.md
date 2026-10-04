# T1 — 安全桌面启动与本地受控准入薄片

## Problem Statement

BabaCom 的第一组用户需要一个能实际启动、说明当前状态并安全准备入房的 Windows 客户端。项目现在只有规划资料和本地合成音频实验，尚无桌面应用、准入 API、统一 UI 原语或产品构建入口。现有实验不能证明用户能够打开安装产物、获得受限凭据或理解失败原因。

直接复制演示项目又会产生新的问题：展示昵称可能被误当作认证身份，媒体签名密钥可能进入分发包，测试身份可能成为普通服务的匿名入口。现有 UI、模块归属和公共契约规则还存在启动前置条件，需要先形成明确、最小的实施范围。

## Solution

交付一个可以在 Windows 开发模式和实际打包模式运行的单页客户端。用户在明确的本地测试环境中填写展示昵称，通过受控准入请求看到“准备完成”或可理解的失败状态。客户端不展示媒体 token，也不把准入成功描述为已经加入通话。

本片使用隔离测试入口提供认证主体、房间及能力；普通 API 入口缺少真实认证或授权提供者时拒绝启动。T1 为后续真实语音建立可验证的启动、信任和构建边界，完成范围是桌面启动与本地准入，尚不建立媒体连接。

## User Stories

1. As a Windows 测试用户, I want 打开实际打包的 BabaCom 应用, so that 我能验证交付产物能启动。
2. As a Windows 测试用户, I want 在开发模式和打包模式看到同一条准入流程, so that 两种运行方式的差异不会被开发环境掩盖。
3. As a Windows 测试用户, I want 清楚看到当前处于本地测试环境, so that 我能理解测试身份和服务的适用范围。
4. As a Windows 测试用户, I want 填写自己的展示昵称, so that 后续界面可以使用可读的名称。
5. As a Windows 测试用户, I want 空白或不符合契约的昵称得到明确反馈, so that 我知道怎样修正输入。
6. As a Windows 测试用户, I want 昵称只影响展示信息, so that 改名不会改变我的认证身份或权限。
7. As a Windows 测试用户, I want 发起准入后看到正在处理的状态, so that 我知道请求仍在进行。
8. As a Windows 测试用户, I want 连续点击时不会重复发起同一准入操作, so that 我不会因重复操作意外触发限流或得到混乱结果。
9. As a Windows 测试用户, I want 准入成功后看到准备完成, so that 我能确认这条控制链路已经跑通。
10. As a Windows 测试用户, I want 准入准备和已经加入通话有明确区别, so that 我不会误以为此时已经有声音连接。
11. As a Windows 测试用户, I want 服务不可用或请求失败时看到可理解的错误, so that 我能够判断是否需要重试。
12. As a Windows 测试用户, I want 失败后能够再次发起准入, so that 一次失败不会让应用只能重启。
13. As a Windows 测试用户, I want 未认证、无权限和请求过快得到不同的可理解反馈, so that 我能采取相应的下一步行动。
14. As a Windows 测试用户, I want 在此流程中不会突然申请麦克风或屏幕权限, so that 准入准备不会启动尚未请求的媒体采集。
15. As a Windows 测试用户, I want 用键盘操作有标签的输入和按钮，并读取当前状态, so that 基础交互不依赖鼠标或仅靠颜色表达。
16. As a Windows 测试用户, I want 界面文案、按钮与状态显示使用一致的语言和原语, so that 后续功能能沿用同一套基础交互。
17. As a 私人房间维护者, I want 未认证请求被拒绝, so that 媒体准入服务不会成为开放入口。
18. As a 私人房间维护者, I want 主体身份来自服务端认证结果, so that 客户端不能冒充另一位成员。
19. As a 私人房间维护者, I want 房间和发布能力经过统一授权判断, so that 客户端不能自行扩大访问范围。
20. As a 私人房间维护者, I want 初始媒体凭据短时有效且只限定到获准房间与能力, so that 准备通话不会同时获得管理、录制或共享权限。
21. As a 私人房间维护者, I want 准入接口执行可重复验证的限流, so that 正常重试和滥用请求有明确边界。
22. As a 私人房间维护者, I want 普通服务没有真实认证提供者时拒绝启动, so that 本地 fixture 不会悄悄成为外部登录方案。
23. As a 私人房间维护者, I want 密钥、会话凭据和媒体 token 不进入日志、URL、源码或分发资源, so that 调试和交付不会泄露访问能力。
24. As a 后续切片开发者, I want 使用稳定的准入响应与认证授权边界, so that T2 可以接入真实会话而无需重新定义身份和 token。
25. As a 审查者, I want 自动化结果、实际打包启动和未验证项分别记录, so that 我能判断 T1 真正证明了什么。

## Implementation Decisions

本节固定本 fork 的 T1 开发基线。Jack 是 T1 唯一契约签认者与集成裁决者；Codex A 负责起草、核对与后续串行实现，不能自行扩大边界。用户本轮已授权完善规格并发布，本文不把这项授权表述为尚未发生的代码审查或合并。原仓库 D9、其余切片与全局并行安排保持各自的决策范围。

1. 技术栈保持 Electron、React、TypeScript、Vite 与 FastAPI。JavaScript 使用 npm workspaces，Python 使用独立 uv 环境和锁定文件。实现 Issue 必须明确新增依赖及用途：Electron/React/Vite/TypeScript 用于桌面构建，electron-builder 用于 Windows 打包，FastAPI/Uvicorn 用于 HTTP 服务，PyJWT 用于标准 JWT 签名，JSON Schema 校验器用于执行共享契约，ESLint/Playwright/pytest/ruff 用于验证。具体兼容版本在实施时核对官方来源并锁定；此前 PO 的 Electron 版本候选不视为已验证的依赖组合。T1 不需要 LiveKit JS SDK、Redis、数据库或 ORM 运行依赖。
2. 最小 UI 固定为一页准入表单、Button、TextInput、状态/错误反馈、设计令牌和中文翻译入口。按钮、输入和状态来自共享 UI 原语；共享 UI 不调用业务 API，面向用户的字符串均走 t()，样式使用统一令牌。这是 T1 的交付范围，不要求完整侧栏、成员列表、主题系统或组件展厅。
3. Electron 始终启用 contextIsolation 与 sandbox，关闭 nodeIntegration，不放宽 webSecurity。主进程只加载自己的开发/打包页面，阻止非批准导航、新窗口和媒体权限；IPC 检查当前主窗口、主 frame、页面来源及参数。preload 仅暴露受限的准入准备与取消能力，不暴露通用网络、文件、shell 或任意 IPC 通道。
4. 主进程负责受控 HTTP 准入请求、响应校验和凭据内存管理。renderer 仅提交昵称及指定房间，并接收不含 accessToken 的状态摘要；JWT 与应用会话凭据不进入 DOM、renderer、URL、日志或持久存储。API 基地址来自可信启动配置，不能由页面任意改写。T1 控制服务仅绑定回环地址；正常入口不接受缺少真实 provider 的启动配置。
5. 昵称校验的固定顺序：原始字符串最多 256 个 Unicode 码点；做 NFC 规范化；仅去除首尾 U+0020 空格；规范化结果须为 1–32 个 Unicode 码点，不能仅含空白。拒绝 Unicode Cc 控制字符、Cs 未配对代理项、U+200B/U+FEFF，以及 U+061C、U+200E–U+200F、U+202A–U+202E、U+2066–U+2069 双向控制符。其他合法文字、标点和 emoji 保留，不强制唯一，也不改变大小写。服务端为权威校验方；客户端执行同一规则给予即时反馈，成功后显示服务端返回的规范化结果。
6. 固定 POST /api/v1/tokens/media；只接收 application/json，正文上限 4096 字节。请求仅有 roomName 与 displayName，拒绝额外字段，尤其是客户端提供的 identity、subjectId、角色或权限。roomName 为 1–64 个 ASCII 字符，只允许字母、数字、下划线和连字符，并须与服务端批准房间精确匹配。应用会话通过 Authorization Bearer 头传递；身份来自认证 provider，绝不来自昵称、请求正文或未验证 header。
7. 认证边界只引入 provider 接口；权限决策统一调用真实 can(user, action, channel) 原语。T1 固定动作 room.join、media.subscribe、media.publish.microphone，必须全部获准才签发本片凭据；未知主体、资源或动作默认拒绝。授权输入由服务端解析，不能由客户端声称。测试 provider 注入获准主体与房间，但路由仍执行真实校验、can()、限流和签名；普通 policy 不硬编码测试成员。
8. 唯一隔离 fixture 由独立测试启动器创建，控制服务绑定 127.0.0.1，批准房间固定为 t1-room，主体由启动器控制，密钥及应用会话凭据在每次运行时随机生成。启动器将回环服务地址和短期会话凭据仅交给本次客户端主进程，不写进源码、分发资源或用户配置。普通入口不导入 fixture，不根据运行失败回退到 fixture，也不提供匿名或远程启用 fixture 的路径；缺少真实认证/授权 provider 时明确拒绝启动。
9. HTTP 200 成功响应固定含 livekitUrl、roomName、participantIdentity、displayName、accessToken、expiresAt，拒绝未定义字段。participantIdentity 与认证主体的稳定、不含个人信息的标识一致；displayName 为规范化后的展示名；expiresAt 为与 JWT exp 相同的 UTC RFC3339 秒精度时间（以 Z 结尾）。客户端主进程校验响应再保留凭据，renderer 只得到 roomName、participantIdentity、displayName、expiresAt。接口所有响应均使用 Cache-Control: no-store。
10. 媒体 JWT 的初始 TTL 固定 120 秒。签发器一次读取 UTC 秒级时间，nbf 使用该时间，exp 等于 nbf 加 120，issuer 为运行期 API key 标识，sub 为认证主体。签名算法固定 HS256，使用成熟 JWT 库签名并用官方 LiveKit 服务端校验器验证兼容性，不自行实现密码算法。roomJoin、canSubscribe、canPublish 明确为 true，room 仅为获准房间，canPublishSources 仅含 microphone；canPublishData 明确为 false，不授予 camera、screen_share、screen_share_audio、房间管理、录制、创建房间或其他管理能力。不能依赖库的宽泛默认授权。
11. LiveKit URL 来自服务端批准配置；T1 fixture 可以返回回环 ws 地址，但不连接 SFU。以后对外部署使用批准的 wss 地址，另由后续切片完成。120 秒只是初始准入凭据的有效期；本片不将其解释为已连接通话的强制截止，也不声称已解决会话刷新或撤销。
12. 固定三层滚动窗口限流：每个来源 IP 120 次/60 秒；每个认证主体 20 次/60 秒；每个获准主体与房间组合 6 次/60 秒。窗口采用单调时间，恰好达到 60 秒的旧记录退出。IP 层先于认证并计入失败尝试；主体层在认证后计入请求（包括非法参数或拒绝授权）；主体/房间层只为获准房间建立记录，并在签发前检查。重试及内部签发失败同样消耗已通过层的额度，不回滚；任何层拒绝都不签 token。
13. 限流层的检查与扣额须原子化，同一主体并发请求不能超发。达到额度后返回 429，Retry-After 为当前首次拒绝层最早可重试时间的向上取整秒数，至少 1 秒；等待后新请求仍须通过全部层的检查，该 header 不保证届时一定签发成功。T1 使用一个服务进程/worker 的内存限流，启动参数要求单 worker；多进程、多实例及分布式限流属于后续任务，不将本片宣称为生产滥用防护完成。
14. 固定错误响应为经过过滤的 code/message，可在 429 附带 retryAfterSeconds，不回显请求正文、header、JWT、密钥、异常堆栈或本机路径。状态为 401（缺少或无效会话）、403（无房间/能力权限）、413（正文超限）、422（有效 JSON 的字段/昵称/房间校验失败）、429（限流）、503（受控的服务/签发故障）；无法解析的 JSON/编码为 400。主体受限检查在正文解析前，权限校验在主体/房间限流前，任何失败都不得先签发后报错。
15. 应用固定为待输入、处理中、准备完成、失败四类状态；到期映射为“准备凭据已过期，请重新准备”的失败。单次准入超时固定 10 秒，整个请求期间禁止重复提交，无自动重试。失败可手动重试，429 显示并遵守等待时间；取消、关闭窗口或凭据到期清除关联内存，迟到结果不能复活已结束操作。准备完成不等于已连接通话。
16. T1 不启动媒体连接，不采集麦克风/屏幕，不请求采集权限，也不显示虚构成员。打包客户端本身不依赖用户安装 Node、npm、TypeScript 或 Vite；测试 API 的 Python 运行环境作为独立测试依赖记录，不混同于客户端免开发工具链启动。
17. 共享准入、token claims 与权限动作各有一份权威 schema；TypeScript/Python 校验消费同一份契约，不各写独立枚举与字段定义。签认后的 T1 值是此 fork 的开发基线，变更交由 Jack 裁决；既有模块的全部 Release 完成标准不因 T1 薄片自动达成。
18. 本片无持久数据库变化；alembic check 明确记录为 NOT_APPLICABLE（没有 ORM/数据库/迁移变化），由前置 docs PR 将 T1 的适用规则落实，不伪造 PASS。任何持久化、额外权限、生产准入或文件范围变化必须回到契约与独立范围审查。

## Testing Decisions

固定两个最高可观察入口：真实 Windows Electron 应用旅程，以及完整 HTTP 准入接口。用户本轮要求固定测试边界，采用此前提出的这两个入口；不另设组件私有状态或签名函数内部调用的验收边界。测试替身仅隔离运行环境中的认证/授权输入与时间；T1 的路由、校验、can()、限流和签名执行真实代码。

- 应用旅程：启动开发产物及实际 Windows 打包产物，输入昵称并完成本地受控准入；验证正在处理、规范化名称、准备完成、失败与手动重试。快速重复操作只产生一次服务器端准入结果；超时、429 等待、凭据到期及等待响应时关闭窗口均可复现。页面和诊断不得含 JWT/应用会话值，正常流程没有媒体连接或权限弹窗。
- HTTP 契约：从真实 HTTP 路由请求完整服务，验证正确认证、稳定主体、房间/能力边界、严格请求/响应 schema、昵称校验及错误过滤。校验 401/403/400/413/422/429/503，没有真实 provider 的普通入口启动失败；拒绝任何 fixture 自动回退或对非回环地址的 fixture 绑定。
- 昵称断言：空字符串、只含空格、33 个码点、原始 257 个码点、控制/双向字符和未配对代理项被拒绝；1 与 32 个码点、中文和 emoji 的码点计数正确。首尾 U+0020 被去除，NFC 等价名称获得同一规范化结果；昵称改变不改变认证主体。HTML 形状的名称仅作为文本显示，不执行脚本。
- 限流断言：在独立测试实例或可控单调时间下，主体/房间第 7 次、主体第 21 次、同 IP 第 121 次返回 429；主体层以已认证但昵称非法的请求隔离房间层，IP 层以未认证请求隔离主体层。59.999 秒仍受限，60 秒窗口恢复；未认证请求消耗 IP 额度，非法参数消耗主体额度，拒绝授权不创建任意房间的限流记录。并发请求不超过额度，Retry-After 与重试时机一致，拒绝分支没有 JWT。故意限流不计入普通准入成功率。
- 凭据断言：校验签名、issuer、sub、房间、发布来源白名单、data/admin 等禁止能力、exp-nbf 恰为 120，以及 expiresAt 与 exp 一致。以独立解码/官方服务端校验器证明兼容性；普通未授权调用没有签发结果。短期凭据过期后不得继续保留或复用；不据此声称实际 SFU 会话刷新或撤销已经验证。
- 安全断言通过应用/HTTP 入口及它们产生的产物观察：非批准页面、frame 和参数无法调用准入；媒体权限默认拒绝；普通入口无 provider 时不启动。对 UI、stdout/stderr、受控日志和打包文件扫描本次运行的秘密哨兵，不读取真实用户凭据。fixture 的运行期秘密和测试启动器不被收进分发包。
- UI 断言：标签、键盘操作、状态读出、错误修正和禁用等待可用；界面文案来自中文翻译入口，基础控件来自共享原语；不能以字符串出现、函数调用次数或文件布局代替用户行为证明。
- 先例：现有本地测量实验的行为测试、可选真实集成验证及 NOT_RUN 表达方式可参考；它们不是桌面、HTTP 或打包验收证据，不作为产品依赖。T1 不要求真实 SFU、采购服务器或联系中德用户。

实施后在仓库根提供并运行以下桌面入口，必须包含本片的共享 UI 和契约检查；不得使用空脚本或跳过共享依赖：

```text
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run test --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
npm run test:e2e --workspace apps/desktop
```

桌面 test 驱动开发构建的应用旅程，test:e2e 驱动 Windows 打包产物上的同类旅程；两者分别证明开发与分发行为。

API 在其专用 uv 环境、API 工作目录提供以下入口；pytest 的用例经 HTTP 边界覆盖认证/授权注入，不要求实现完整账号系统：

```text
uv run python -m ruff check app ../../tests/conftest.py ../../tests/tokens ../../tests/ratelimit
uv run python -m ruff format --check app ../../tests/conftest.py ../../tests/tokens ../../tests/ratelimit
uv run python -m pytest ../../tests/tokens ../../tests/ratelimit -v
```

这些产品命令尚未实现，本次规格任务的状态是 NOT_RUN。T1 完成时须全部检查成功，实际打包启动、准入成功、拒绝/重试/限流、秘密隔离和零媒体采集均有可复现断言。桌面构建通过不代表所有 Electron 安全或无工具链设备验收通过。

无 Node/npm/Vite 的 Windows 环境启动单独记录实际设备与运行结果；测试 API/harness 所需 Python 环境另行注明。若缺少该环境则记录 NOT_RUN，T1 验收不完成。数据库检查仅为 NOT_APPLICABLE，不可写成 PASS。所有证据沿用既有 Issue/PR 验证字段和只追加证据约定，不新建状态看板或收尾文档。

## Out of Scope

- T2：房间连接、真实麦克风、成员、静音、音频设备、音量与重连。
- T3：游戏窗口/整屏捕获、系统音频、观看音量、数字回传排除。
- 实网节点、TURN/TLS、域名、采购、联系参与者、中德实际通话验收。
- 真实注册、登录和邀请运营、密码找回、持久会话、完整权限模块、数据库及迁移。
- 消息、WebSocket 网关、多频道、好友、通知、完整主题与组件展厅、第二套 Web 产品。
- 多进程/多节点限流、生产认证接入、媒体会话刷新和撤销。
- 自动更新、公开产品发布、签名采购、集中遥测与完整运维监控。
- 改动原仓库 D9 或全局并行安排、实现产品代码、安装产品依赖、提交代码、push、tag 或发布软件版本。这次发布仅指授权的规格 GitHub Issue。

## Further Notes

- Module: docs。来源为此前战略 PO 的开发计划与执行前修正附记，研究日期 2026-10-04；本次依据用户授权将候选值收敛为 T1 规格决策。详见[原 PO 对话](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ac2188a-8b8c-83ee-ab67-968c584fe99f)。这些数值是开发基线，不是实测最优值。
- 规格发布目标为 wenhuorongbing-netizen/babacom 的 GitHub Issues，应用 ready-for-agent。该标签表示规格可进入任务拆分，不授予修改所有模块或绕过以下前置 PR 的权限。产品测试仍为 NOT_RUN；对应规格 Issue 的链接以发布工具回执为准。
- T1 的最终契约 Owner/签认者固定为 Jack；Codex A 起草、验证和执行已授权任务。代码审查/合并是后续具体 PR 的动作，不能写成已签字；此安排仅适用于当前 fork 的 T1，不任命原仓库或后续阶段的全局 Tech Lead。
- 前置工作必须成为独立 docs Issue/PR：增加仅覆盖下表的 T1 模块边界，落实最小 UI、fixture/provider、共享契约、单 worker 与数据库验证适用规则，并由 Jack 审查合并。边界合并前只允许规格/任务/该 docs PR 的准备，产品实现被该 PR 阻塞；不能把范围扩展混入产品功能 PR。
- 该前置 docs PR 的允许文件逐个固定为 `.agents/modules/t1.md`、`.github/CODEOWNERS`、`docs/04-open-decisions.md`。CODEOWNERS 仅补充本 fork 的 T1 所有权；任何额外章程文件改动都须先说明具体必要性，不能自动扩大。此规格本身没有修改这些边界或 CODEOWNERS。
- 下表是 T1 产品实现的最大允许集合，每个后续 Issue 必须从中逐个选取实际使用的更小集合，并采用前置 PR 合并后的 Module: t1。职责列保持既有领域归属；新启动/契约文件由 T1 的 Jack 负责。表外文件默认不允许，新增必要路径先回到独立 docs 范围 PR。

| 职责 | 具体文件 |
|---|---|
| T1 启动 | `package.json` |
| T1 启动 | `package-lock.json` |
| T1 启动 | `apps/desktop/package.json` |
| T1 启动 | `apps/desktop/tsconfig.json` |
| T1 启动 | `apps/desktop/eslint.config.mjs` |
| T1 启动 | `apps/desktop/vite.config.ts` |
| T1 启动 | `apps/desktop/electron-builder.yml` |
| T1 启动 | `apps/desktop/playwright.config.ts` |
| T1 启动 | `apps/desktop/index.html` |
| T1 启动 | `apps/desktop/scripts/build.mjs` |
| T1 启动 | `apps/desktop/scripts/dev.mjs` |
| T1 启动 | `apps/desktop/src/main/main.ts` |
| T1 启动 | `apps/desktop/src/main/preload.ts` |
| T1 启动 | `apps/desktop/src/renderer.tsx` |
| 6.1 | `apps/desktop/src/shell/AdmissionPage.tsx` |
| 6.2 | `apps/desktop/src/i18n/index.ts` |
| 6.2 | `apps/desktop/src/i18n/zh-CN.json` |
| 6.2 | `apps/desktop/src/styles/tokens.css` |
| 6.2 | `packages/ui/package.json` |
| 6.2 | `packages/ui/tsconfig.json` |
| 6.2 | `packages/ui/src/index.tsx` |
| T1 契约 | `packages/contracts/package.json` |
| T1 契约 | `packages/contracts/admission.schema.json` |
| T1 契约 | `packages/contracts/token-claims.schema.json` |
| T1 契约 | `packages/contracts/permissions.schema.json` |
| T1 启动 | `apps/api/pyproject.toml` |
| T1 启动 | `apps/api/uv.lock` |
| T1 启动 | `apps/api/app/__init__.py` |
| T1 启动 | `apps/api/app/main.py` |
| T1 启动 | `apps/api/app/factory.py` |
| 2.2 | `apps/api/app/auth/__init__.py` |
| 2.2 | `apps/api/app/auth/provider.py` |
| 2.3 | `apps/api/app/permissions/__init__.py` |
| 2.3 | `apps/api/app/permissions/policy.py` |
| 7.2 | `apps/api/app/tokens/__init__.py` |
| 7.2 | `apps/api/app/tokens/routes.py` |
| 7.2 | `apps/api/app/tokens/service.py` |
| 7.2 | `apps/api/app/ratelimit/__init__.py` |
| 7.2 | `apps/api/app/ratelimit/limiter.py` |
| T1 测试 | `tests/conftest.py` |
| 7.2 测试 | `tests/tokens/local_service.py` |
| 7.2 测试 | `tests/tokens/test_admission_http.py` |
| 7.2 测试 | `tests/ratelimit/test_admission_limits.py` |
| 6.1 测试 | `tests/shell/admission.e2e.ts` |

- 不创建或修改正式迁移、`.env`、生产配置、基础设施或现有测量实验。构建输出、依赖目录与专用环境是忽略的运行产物，不进入源文件清单；证据目录只能追加。
- 保留现有 dirty/untracked 规划与实验；后续审查实际工作树、暂存区和新文件内容，不能只比较已提交 HEAD。一次处理一个 Issue，按真实阻塞关系串行执行。
- 本次规格修订的 Allowed Files 只有 `docs/T1-spec.md` 与 `docs/04-open-decisions.md`。Validation 是 docs scope_guard、七章节/故事/定值/范围一致性检查、无待定占位，以及发布后 Issue 正文和 ready-for-agent 标签回读。
- LiveKit 能力和初始过期语义依据[官方 tokens/grants](https://docs.livekit.io/frontends/reference/tokens-grants/)；字段兼容性对照[官方 Python 服务端 SDK](https://github.com/livekit/python-sdks/blob/main/livekit-api/livekit/api/access_token.py)。昵称与额度为本规格选择，不声称是这些来源给出的产品建议。
- T1 规划估计 16–28 个有效工时，前置范围 PR 与外部等待另计。T1 不代表 M0 或 Alpha 完成，不调整 Alpha 负载/质量目标，也不沿用旧的普适丢包/FEC 断言。

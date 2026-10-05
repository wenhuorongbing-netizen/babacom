# T2 — 从受控准入走向真实桌面语音

> T2-C 书面规格草稿 · 2026-10-05 · 本 fork 唯一契约签认与集成裁决者建议沿用 Jack。
> 本轮授权形成并发布规格；本文不是已发生的签认、依赖安装、设备同意或媒体验收。
> 文档 PR 经 Jack 审阅并明确批准下列凭据边界后，才允许启动相应实现票。

## Problem Statement

T1 已交付可启动的 Windows 客户端和本地受控准入，但“准备完成”还不能让用户进入真实语音房间、听到成员或安全控制麦克风。私人小组需要先验证真实桌面媒体链路，再验证正式身份和房间授权，逐步走向中德两端可通话。

当前准入凭据只留在 main，普通 renderer 不能联网或申请媒体；准入页到期和卸载仍会取消准备。这些正确的 T1 边界不能直接接上需要媒体 JWT 的浏览器 SDK。添加依赖、把凭据藏进 UI 闭包或放开任意网络都不能解决这个契约冲突。

## Solution

按 T2-C → T2-01 → T2-02 → T2-03 串行推进：
先签认隔离媒体执行域、准入交接与逐文件范围；
再默认闭麦连接真实本地 SFU，显示真实成员并安全离开；
随后将非 fixture 的受控会话与统一房间权限接入同一条链；
最后在明确设备同意下开麦、静音、退出并完成真实双设备听音。

T2-C 只交付可审阅的文档。T2-01 的合成媒体只证明真实协议和媒体传输；
物理采集、双设备听音、中德网络和 M0 分别保留独立条件与证据。沿用现有技术栈、UI 原语和三份 T1 schema，不重建脚手架。

## User Stories

1. As a Windows 测试用户, I want 启动后仍保持未入房和闭麦, so that 应用不会自动连接或采集。
2. As a Windows 测试用户, I want 继续使用已有昵称和准入准备流程, so that 已验收的基础不会被重做。
3. As a Windows 测试用户, I want 明确点击加入后连接真实房间, so that 准入准备与实际通话状态有区别。
4. As a Windows 测试用户, I want 看到来自真实 SFU 的成员列表, so that 我能确认谁实际在房间。
5. As a Windows 测试用户, I want 重复点击只产生一个加入操作和一个活动房间, so that 不会产生重复成员或连接。
6. As a Windows 测试用户, I want 在连接中取消并实际终止连接, so that 取消后的迟到成功不会让应用偷偷入房。
7. As a Windows 测试用户, I want 服务不可用和连接超时得到明确反馈, so that 我能决定手动重试。
8. As a Windows 测试用户, I want 未消费的过期凭据不能入房, so that 失效的准备不会继续使用。
9. As a Windows 测试用户, I want 已连接通话不因初始票的120秒到期而被结束, so that 凭据寿命不会被误作通话时长。
10. As a Windows 测试用户, I want 已入房时默认关闭麦克风, so that 收听与采集由我分别控制。
11. As a Windows 测试用户, I want 首次开麦前获得明确的同意提示, so that 我知道将使用物理设备。
12. As a Windows 测试用户, I want 拒绝开麦仍能保持收听, so that 拒绝设备权限不会迫使我退出。
13. As a Windows 测试用户, I want 设备不可用或发布失败时保持闭麦并显示原因, so that 界面不会虚报开麦成功。
14. As a Windows 测试用户, I want 离开或关闭开麦操作后的迟到授权不被发布, so that 旧操作不会重新开启声音。
15. As a Windows 测试用户, I want 静音后对端收不到有效人声, so that 自我静音的实际效果与界面一致。
16. As a Windows 测试用户, I want 明确离开后释放自有采集轨道与播放器, so that 应用不继续使用设备或播放旧会话。
17. As a Windows 测试用户, I want 离开后手动重入再次认证且默认闭麦, so that 旧 token 和开麦状态不会自动恢复。
18. As a Windows 测试用户, I want 网络断开后看见失败并选择手动重入, so that 当前切片没有隐蔽的自动重连。
19. As a Windows 测试用户, I want 播放受阻时单独点击启用声音, so that 无需通过开麦解锁播放。
20. As a Windows 测试用户, I want 相同流程在开发模式和打包 EXE 中运行, so that 测试不会只证明开发环境。
21. As a Windows 测试用户, I want 用有标签的控件、键盘和中文状态文案操作, so that 基础交互保持一致。
22. As a 受控房间维护者, I want 身份来自真实认证提供者, so that 昵称不会被当成登录凭据。
23. As a 受控房间维护者, I want 过期或撤销会话不能再领媒体票, so that 发票权由服务端控制。
24. As a 受控房间维护者, I want 主体只能进入获准房间并发布麦克风, so that 不能扩大到视频、共享、数据或管理能力。
25. As a 受控房间维护者, I want 普通入口没有 provider 时仍拒绝, so that fixture 不会成为生产绕过。
26. As a 受控房间维护者, I want 应用会话和签名密钥不进入媒体域或 UI, so that 媒体接线不泄露更大权限。
27. As a 受控房间维护者, I want 媒体 JWT 只在签认过的执行域与 SFU 信令中使用, so that UI、日志和分发资源不持有凭据。
28. As a 审查者, I want 自动化、合成传输、真人听音和跨境结果分别记录, so that 能准确判断每一步证明了什么。

## Implementation Decisions

### 1. 基线、签认与非目标边界

- 基线固定为 PR13 合并提交 `9f523711634fc21fbf3c3b0459046141c28ad82f`。
  T1 工程交付可直接复用；父票 #1 的最终签认保持独立，本文不代 Jack 关闭。
- 技术栈保持 Electron 44.5.1、React、TypeScript、Vite、FastAPI、npm workspaces 与 uv。
  首票提议锁定 `livekit-client@2.22.3`；它提供现有依赖没有的浏览器 RTC 能力，
  不新增 React 封装、原生 RTC SDK 或另一个依赖管理器。当前未安装、组合兼容 NOT_RUN。
- 建议 Jack 只担任本 fork T2 的唯一契约签认与集成 Owner；A 起草、验证和串行执行获准任务。
  T1 的指定不自动覆盖 T2；本文与边界 PR 的明确审阅合并才形成 T2 签认，全局 D9 不变。
- 首个兼容验证约束为一个有效工作日；沙箱或打包失败时记录实际阻碍，停止该方案，
  不不断叠加 shim、升级服务器或增加例外。独立媒体页面只是后续待裁定的备选。
- 此前本地 SFU/合成实验仅为资源线索。首票必须核对缓存官方 SFU 二进制及版本/校验值，
  明确本机回环实验条件后复用；不可把历史实验当作当前 Electron 兼容证据。
  未有合适本地资源时只暂停媒体执行，不购买、部署或操作韩国服务器。

### 2. 两项需要书面签认的凭据变更

**隔离媒体执行域。** 推荐把浏览器 SDK 打包进同一窗口的隔离 preload 执行域。
API secret 始终留在后端，应用会话凭据始终留在 main。
main 仅向当前操作的指定隔离媒体域交付短期媒体 JWT；
React UI 主世界不获得 JWT、Room 对象、任意 IPC 或原始 SDK 错误。

preload 仍是 renderer 进程的一部分：这是对 T1“JWT 只留 main”的明确、局部修订，
不是改名后声称原约束未变。主世界与 preload 上下文隔离也不是设备权限隔离；
同 frame 的 UI 代码可能影响已授权的媒体行为，不宣称对受损 UI 有独立设备防线。
若 Jack 要求所有 renderer 零 JWT，当前浏览器 SDK 路线 HOLD，另行裁定执行位置。

**官方 SDK 信令 URL 的窄例外。** 媒体 JWT 可由官方 SDK 携带到获准 SFU 的
WS/WSS 握手及同地址的 HTTP/HTTPS validate 请求。业务页面 URL、导航、日志、
公开桥接返回、持久化和一般诊断仍禁止凭据；应用会话及 API secret 不适用例外。

批准SFU地址由运营者通过独立、可选的一次性媒体配置命名管道交给main，
使用新增媒体schema中的私有mediaStartup定义，保持旧T1启动schema原样。
仅传批准SFU基础地址，不含secret或应用会话；沿用UUID管道名、4KiB上限和15秒读取期限。
缺少该配置仍可执行T1准备，但媒体加入拒绝；UI不能提供或修改此配置。
后端准入响应的livekitUrl必须与本次批准地址完全一致，再交给SDK。
本地只允许批准的 `127.0.0.1:端口`，SFU 基础地址须为根路径且无用户信息、查询或片段。
锁定 SDK 对应的路径仅为 `/rtc`、`/rtc/v1`、`/rtc/validate`、`/rtc/v1/validate`；
显式批准协议协商路径，不允许任意同源请求或重定向到其他地址。
未来外部连接只能用获准 WSS/HTTPS，需另行明确运行配置与资源条件。

保持 contextIsolation、sandbox、nodeIntegration=false、webSecurity 和禁止导航/子窗策略。
CSP 与资源请求白名单只作上述最小扩展。该白名单不等同于 ICE/UDP 的网络隔离证明；
本地 SFU、媒体候选地址和真实网络目的地也须在实验中核对。
未知地址或 SDK 新增请求失败时记录事实，不临时放开网络。
整个成功、失败、超时链路测试脱敏；代理日志/HAR 不原样发布。

### 3. 现有接口复用与唯一交接

- 认证复用 AuthenticationProvider.authenticate；授权复用 AuthorizationProvider 和
  PermissionPolicy.can。T2 补适配器，不再造 can 或并行权限逻辑。
- main 负责准入、已批准地址、响应校验、操作代次、会话所有权、设备同意和窗口退出。
  main 不签 token，不把 SDK 未连接状态宣称成功。
- 隔离媒体域拥有唯一 Room、订阅、采集轨道、播放器和 SDK 内部 token 刷新状态；
  语音模块负责房间，音频模块负责采集与播放。preload 是组合入口，
  通过注入端口协调二者，feature 之间不互相 import。
- UI 保留已有 prepare/cancel 准入接口；新增窄媒体能力为 join、cancelJoin、leave、
  setMicrophoneEnabled、enableAudio、getSnapshot、subscribe。
  join 不接收 URL、JWT、主体或 grants；控制命令只引用 main 产生的 mediaSessionId。
  subscribe 只回传校验后的快照并返回取消订阅函数。
- 公共命令、快照与错误码以新增 JSON schema 为单一真相，沿用既有生成和校验方式。
  未知字段/命令、错误类型、旧会话或非批准主 frame 默认拒绝。
  UI 快照只含连接、麦克风、播放状态、有限成员摘要和稳定错误码，不含 SDK 对象。
- main 私有交接核对窗口、主 frame、批准页面、房间、代次和凭据有效期；
  原子消费准备凭据，创建当前 mediaSessionId。一次消费只是本应用的交接限制，
  不使 bearer token 成为 SFU 一次性票据。
- subjectId/participantIdentity 沿用服务端稳定身份；displayName 只用于展示。
  generation 标记操作代次，不替换主体。本片不支持同一主体同时多设备通话；
  两位测试者用两个主体，身份冲突显示失败，不随机换身份绕过规则。
- 准入、连接、麦克风/播放采用独立状态。交接后，准入页的到期和卸载只清理未消费准备，
  不能终止已接管的媒体会话；离开由媒体会话入口处理。
- 保留 T1 昵称全部规则、初始 TTL 120 秒、grants 和滚动60秒
  IP120/主体20/主体房间6的限流值，保持单 API worker。
  SDK 刷新 token 只留在媒体域；下一次手动入房仍需新的应用准入。

### 4. 非 fixture 的最小会话与房间授权

T2-02 实现运营者预置的有限会话注册表；不能只是给 fixture 换名字。
会话秘密是独立产生的256位随机值，不是昵称、密码或固定测试常量。
服务端记录凭据 SHA-256 摘要、稳定主体、创建/到期时间和撤销状态，不记录明文。
该摘要用于高熵 bearer 凭据，不是密码哈希；本片不实现密码登录。

建议初始应用会话寿命固定3600秒，严格在 now >= expiresAt 时拒绝；
客户端不自动续期。每条记录可撤销，主体撤销使其注册表内全部记录失效；
无记录、过期、撤销或配置缺失均拒绝。注册表限于单进程显式提供，重启后重新发放。
此寿命与媒体票120秒、已连接通话寿命分别定义，不改变 Alpha 两小时目标。

运营者在未来获准的本机测试启动器中私下发放会话，通过既有启动命名管道注入 main；
仅在服务端给出的有限授权映射中解析主体—房间—动作。
本轮不产生或分发实际秘密；跨设备发放、非回环 API、持久化与生产运维均是另行条件。
两条测试链仍使用 local-test 标识，非 fixture 与 fixture 的差别由实际认证、
到期/撤销和授权算法证明，不靠环境标签。

普通 run/create_app 接受显式真实适配器，缺 provider 仍拒绝，不能导入 fixture 或回退。
测试启动器分别构造真实适配器及配置，与 T1 fixture 启动器隔离。
未授权房间/动作通过唯一 can() 拒绝；客户端改昵称不改变主体。

撤销分三层：本地取消/离开使旧操作立即失效；应用会话撤销拒绝后续签发，
本客户端主动登出同时退出媒体；已经签发或由 SDK 刷新的媒体 token 的 SFU 撤销未解决。
自托管的移除参与者不保证旧票立即失效；短 TTL、拒绝续票和关闭自动重连不等同即时撤销。
需要“被移除者绝不能用旧票重入”的试验 HOLD，不声明完整2.2或2.3完成。

### 5. 加入、采集、播放与清理

- 启动、填写昵称和准备不自动连接 SFU，不采集、不预热或枚举设备。
  join 期间禁止第二个准入/Room；SDK 的协议协商不等于第二次应用操作，
  但任何时刻只能有一个活动入房流程与一个活动 Room。
- 首次连接使用明确的总超时30秒，初始 maxRetries=0；
  ReconnectPolicy.nextRetryDelayInMs 返回 null，不写自己的恢复循环。
  固定版本上实际验证初始失败、信令断开和服务端移除后无后台恢复/重新发布。
- cancelJoin 先使代次失效，再中断准入或调用 Room.disconnect；
  迟到凭据、连接结果和旧成员事件不能复活状态，取消后不能留下 SFU 成员。
- 麦克风默认关闭。仅已连接且具有 microphone grant 时，明确点击开麦，
  经 main 控制的首次同意后启动本次音频采集事务。同意仅限当前媒体会话；
  重入默认闭麦并重新同意，不做永久授权或自动重弹。
- 同时实现 permission check/request，只认可批准主 frame、当前会话、
  当前采集事务及 audio 类型；camera、display-capture、未知类型继续拒绝。
  同一采集事务可以产生多个检查回调，不能假定只调用一次。
- 创建本地音轨与发布分两步；创建后、发布前和异步发布完成后重新核对
  房间与麦克风操作代次。用户已关麦、取消或离开时，迟到轨道停止且不保留发布。
  拒绝、无设备或发布失败保持闭麦，不虚报成功；收听会话可以保留。
- AEC/NS/AGC 默认开启，不做设置页。静音停止有效人声传输；
  暂保留底层轨道，不承诺设备已释放或 RTP 包数归零。
  独立采集超时30秒后使操作失效，之后授权产生的轨道仍要停止。
- 播放受阻单独提供启用声音，使用 Room.startAudio，并验证跨桥用户激活。
  不通过开麦或全局 autoplay 开关绕过。每个远端轨道只绑定一个播放器；
  订阅快照与增量事件按参与者/轨道身份合并，旧代次事件失效。
- leave、窗口关闭和终止性失败停止全部自有轨道、取消发布、断开 Room，
  清理播放器、事件监听、订阅与计时器，随后才允许手动重入。
  清理超时5秒时保持会话不可重入并显示清理失败；不伪称已退出，
  不创建新 Room 掩盖旧资源。窗口关闭以结束所属媒体执行上下文兜底。
- 正常离开后的手动重入重新经过认证、can、限流与签发，并创建新的本地会话代次。

## Testing Decisions

### 主边界与已有测试先例

主要验收边界是实际 Windows 客户端 → 真实 HTTP 准入 → 真实 SFU。
现有准入应用旅程、真实 HTTP schema/限流测试和 provider 接口是先例。
测试外部状态、服务器收到的准入次数、SFU 成员和可接收媒体，不断言内部私有变量。
SDK 适配器只在真实异步顺序难以重现的拒绝/迟到轨道/发布失败/清理失败中使用可控替身；
替身不能替代真实 Room/SFU 证据。

T1 回归保持原样并确实运行。新 voice/audio/account/permission 目录须接入检查发现，
从输出证明用例被运行；不能以未发现新测试的全绿命令签收。
单写者、逐票更小文件子集；代码、schema、类型生成与消费者在对应实现票中同步。

### 四层证据与通过条件

| 层 | 必须观察的结果 | 不证明 |
|---|---|---|
| 自动化 UI/HTTP | 严格命令/快照；默认闭麦；认证/授权拒绝；限流；重复加入去重；取消及迟到清理；脱敏；T1回归 | 真实声音可懂 |
| 本地真实 SDK/SFU | 开发产物与 packaged EXE 的实际入房/成员/退出/重入；独立peer发送合成麦克风源，真实订阅收到媒体；无重复Room/播放器 | 物理麦克风、耳机、真人体验 |
| 两台真实 Windows | 两主体明确同意后双向听音、静音/恢复、离开释放设备、拒绝后可收听；实际版本/设备分别记录 | 中德网络稳定 |
| 中德真实窗口 | 指定两端/节点/时窗的完整入房和通话结果，保留原定项目指标 | 所有运营商、完整1.2或稳定Alpha |

本地 peer 只使用相同锁定 JS SDK 的独立测试 Electron 入口与合成音轨，
生成资源只放现有忽略的 build；不增加产品注入任意音轨的接口或第二套 Python RTC 依赖。
第一张票不使用物理麦克风；合成接收可用解码/接收统计验证，播放操作按实际同意条件执行。

HTTP 验证真实 provider 的正确/未知/过期/撤销主体，已准/未准房间，缺少动作、昵称与限流。
SFU 独立验证有效票能入房，坏签名与到期票拒绝，并核对房间隔离；
房间由 JWT 决定，不能假设 Room.connect 另有 roomName 参数。
有效房间A的票不能把成员送进未获准房间B；不把它正常进入A描述成 SFU 拒绝。

生命周期至少覆盖：双击/多击；取消前后响应；连接中离开；权限拒绝；
请求权限→关麦/离开→迟到允许；发布中取消/失败；旧成员/音轨事件；
重复成员快照；重复轨道订阅；播放受阻；信令中断；服务端移除；窗口关闭；
正常退出反复重入及资源数量不持续增长。资源检查允许预热后稳定基线，不要求内存逐位相等。

T2-03 沿用原 PO 暂定的20分钟短句、每方向19/20可懂及正常入房9/10指标。
10次正常入房按每主体/房间6次/60秒排程，刻意429另测，不调额度或改阈值换绿。
Alpha 的10语音/1共享/9观看/至少2小时保持原规划，T2通过不签收Alpha或完整模块。

### 逐票完成与停止条件

| 顺序 | 用户可见结果 | 完成条件 | 依赖/停止条件 |
|---|---|---|---|
| T2-C | 一份可执行规格及范围 | 四份文档一致；具体范围、签认者、接口与证据层明确；文档校验通过；Jack审阅书面规格 | 本轮仅文档；未签认不实施 |
| T2-01 | 闭麦进入真实本地房间、看见成员、离开并重入 | 开发/打包均使用真实SDK；合成订阅成立；取消/超时/去重/泄密回归通过 | T2-C签认、依赖与本地资源获准；兼容失败不关沙箱、不自动换架构 |
| T2-02 | 非fixture主体进入获准房间，拒绝分支无媒体票 | 真实有限会话/房间provider；完整HTTP及真实SFU验票与隔离；缺provider拒绝 | 发放/到期/撤销契约明确；不声明生产登录或即时媒体撤销 |
| T2-03 | 显式开麦、静音、退出及真实双设备通话 | 权限/迟到轨道/清理/播放回归；两台Windows人耳证据；跨境条件成立后另验 | 物理设备明确同意、两主体与资源条件；缺中德证据不签收M0 |

每票使用单独 Issue，声明具体 Allowed Files 子集及依赖。这里的票序不是本轮新建的实现票。
T2父规格的签收条件是Jack书面签认及T2-01、T2-02、T2-03的双设备标准全部满足。
中德窗口未通过时，M0与3.1/R01整体仍为HOLD，不因本地或双设备签收解除。
无 ORM/数据库/迁移变化时 DB NOT_APPLICABLE；不能编造 alembic PASS。

## Out of Scope

- T3 屏幕/窗口共享、系统音频回传排除、摄像头与视频布局。
- 自动重连、PTT、快捷键、设备选择/热插拔、音量设置、配置持久化。
- 注册、密码登录/找回、邀请全流程、头像、数据库、完整角色或管理员媒体处罚。
- 生产账号安全、已签发媒体 token 即时撤销、同主体同时多设备通话。
- 外部 API 地址/凭据发放、采购/部署、韩国现有服务器、自动联系朋友或启动物理采集。
- SDK fork、自研信令代理/RTC、关闭沙箱或隔离、任意 IPC/网络放行。
- 改 T1 昵称/TTL/grants/限流，降低既有测试断言，提前宣称完整R01/M0/Alpha。

## Further Notes

### 本轮与后续精确范围

T2-C 的源文件仅为：
`docs/T2-spec.md`、`docs/04-open-decisions.md`、
`.agents/modules/t2.md`、`.github/CODEOWNERS`。所有应用、schema 与依赖文件零 diff。
临时 PR 正文为 `apps/desktop/build/t2-contract-pr-body-20261005.md`，不提交。

下列31个路径是后续 T2 实现的拟签认上界，不是本轮改动授权；
已有或拟建状态均以本轮基线核对。每张票只使用实际需要的更小子集：

```text
package-lock.json
apps/desktop/package.json
apps/desktop/tsconfig.json
apps/desktop/eslint.config.mjs
apps/desktop/playwright.config.ts
apps/desktop/index.html
apps/desktop/scripts/build.mjs
apps/desktop/scripts/dev.mjs
apps/desktop/src/main/main.ts
apps/desktop/src/main/preload.ts
apps/desktop/src/main/media-session.ts
apps/desktop/src/renderer.tsx
apps/desktop/src/shell/AdmissionPage.tsx
apps/desktop/src/features/voice/session.ts
apps/desktop/src/features/voice/VoicePanel.tsx
apps/desktop/src/features/audio/microphone.ts
apps/desktop/src/features/audio/playback.ts
apps/desktop/src/features/audio/AudioControls.tsx
apps/desktop/src/i18n/zh-CN.json
packages/contracts/package.json
packages/contracts/media-session.schema.json
apps/api/app/auth/session.py
apps/api/app/permissions/room_access.py
tests/voice/local_media_service.py
tests/voice/sfu-peer.cjs
tests/voice/sfu-peer.ts
tests/voice/peer.html
tests/voice/session.e2e.ts
tests/audio/microphone.e2e.ts
tests/accounts/test_session.py
tests/permissions/test_room_access.py
```

`tests/accounts/test_session.py`属于账号测试；不新建`tests/auth`。
已有认证/权限原语不需修改；不另建同用途permissions/service。
正常T1测试与冻结schema不进入本轮或后续默认改动上界。
如实际发现必须改表外文件，停止并先走独立 docs 范围 PR。
CODEOWNERS 为上述路径及 T2 治理文件逐个指定 Jack，只影响本 fork T2，不任命全局 D9。

### 本轮 Validation 与后续命令

本轮运行并记录退出码：
```powershell
git diff --check
node .agents/scope_guard.mjs docs --files docs/T2-spec.md docs/04-open-decisions.md .agents/modules/t2.md .github/CODEOWNERS
node --test .agents/scope_guard.test.mjs
```
另以可执行断言检查：实际diff仅四文件；T2边界与本文路径完全一致；31个产品路径及T2治理所有权为Jack；
T1-spec与t1清单、既有产品文件零diff；相对链接可解析。所有断言必须成功。

以下仅是未来实现票的 Validation，当前 NOT_RUN：
```powershell
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run test --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
npm run test:e2e --workspace apps/desktop
```
T2-02目录与测试发现接线后，在apps/api运行：
```powershell
uv run python -m ruff check app ../../tests/conftest.py ../../tests/tokens ../../tests/ratelimit ../../tests/accounts ../../tests/permissions
uv run python -m ruff format --check app ../../tests/conftest.py ../../tests/tokens ../../tests/ratelimit ../../tests/accounts ../../tests/permissions
uv run python -m pytest ../../tests/tokens ../../tests/ratelimit ../../tests/accounts ../../tests/permissions -v
```
未来实际本地SFU、合成peer、双设备与跨境命令、输入和通过条件必须在对应Issue中固定后执行。
本轮不把规划命令写成测试通过记录，也不重跑与四份文档无关的已通过T1产品检查。

### 来源与事实状态

- VERIFIED：PR13已合并；以上T1基线与provider/权限原语、preload、准入页和测试发现入口按当前源码核对。
  T1历史验收见[PR13](https://github.com/wenhuorongbing-netizen/babacom/pull/13)，本轮未重跑。
- RECORDED：原[战略PO对话](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ac2188a-8b8c-83ee-ab67-968c584fe99f)，
  2026-10-05 19:27回报后完整答复；其建议不增加权限。对应用会话3600秒、超时、具体接口和独立媒体启动配置管道的选择为A的书面提案，须由Jack随规格审阅。
- 官方依据：[LiveKit token寿命/撤销](https://docs.livekit.io/frontends/reference/tokens-grants/)，
  [固定JS v2.22.3信令](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/api/SignalClient.ts)，
  [固定信令URL构造](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/api/utils.ts)，
  [初次连接选项](https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomConnectOptions.html)，
  [重连策略](https://docs.livekit.io/reference/client-sdk-js/interfaces/ReconnectPolicy.html)，
  [Electron上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、
  [沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox)、
  [权限入口](https://www.electronjs.org/docs/latest/api/session)。
  资料支持接口存在，不保证本组合运行；动态API文档显示的版本不能替代锁定版本测试。
- NOT_RUN：T2依赖、沙箱preload兼容、真实本地媒体、物理设备、双设备及跨境。
  T1工程交付、Jack的规格签认与真人产品验收分别保留事实。

# T2 — 从受控准入走向真实桌面语音

> T2-C3 打包资源断言修订 · 2026-10-07 · 本 fork T2 唯一契约签认与集成裁决者为 Jack。
> T2-C / T2-C2 已分别在 PR15 / PR20 合并；Jack 已签认本次最小测试修订方案。
> 本次具体 Module: docs 范围 PR 经 Jack 审阅合并并同步 #16 子集后生效；此前 #16 保持 BLOCKED。
> 方向确认和文档合并均不等于产品修复、物理设备同意或媒体验收。

## Problem Statement

T1 已交付可启动的 Windows 客户端和本地受控准入，但“准备完成”还不能让用户进入真实语音房间、听到成员或安全控制麦克风。私人小组需要先验证真实桌面媒体链路，再验证正式身份和房间授权，逐步走向中德两端可通话。

T2-01 的真实诊断已发现：锁定 SDK 在设备变化时被动枚举，退出后的 SDK 监听仍可响应；坏签名握手使 Chromium 网络诊断记录带 JWT 的连接 URL。现有共享组件库还缺少成员列表。用户需要保持默认闭麦、安全退出和无凭据日志，不能用隐藏失败或降低脱敏断言交付。

T2-C2 已将媒体执行位置与初始票据传输分开修订，并明确被动枚举的有限例外。
T2-C3 处理实际EXE中必需媒体资源与旧T1打包白名单的契约冲突，仅修订该资源断言的精确清单；主界面准入与既有安全断言继续保留。

## Solution

按已合并 T2-C → T2-C2 → T2-C3 打包断言修订 → T2-01 → T2-02 → T2-03 串行推进：
专用可销毁媒体执行域、初始认证头、被动枚举边界及共享列表已由PR20签认；本次先固定打包资源测试的狭窄例外；
再默认闭麦连接真实本地 SFU，显示真实成员并安全离开；
随后将非 fixture 的受控会话与统一房间权限接入同一条链；
最后在明确设备同意下开麦、静音、退出并完成真实双设备听音。

本轮 T2-C3 只交付可审阅的文档与范围 PR，不修改测试或产品。T2-01 的合成媒体只证明真实协议和媒体传输；
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
29. As a Windows 测试用户, I want SDK 在活动媒体上下文内读取设备清单时仍不申请采集权限, so that 默认闭麦不会变成隐蔽录音。
30. As a Windows 测试用户, I want 离开完成后旧媒体上下文已销毁, so that 旧设备事件不会再次响应或影响重入。
31. As a 受控房间维护者, I want UI 请求不能借用媒体域的认证头, so that 隐藏票据仍能保持授权隔离。
32. As a 受控房间维护者, I want 连接失败和信令诊断不出现真实票据, so that 短期凭据不会通过错误信息泄露。
33. As a Windows 测试用户, I want 成员列表使用统一且可访问的共享组件, so that 控件语义与现有客户端一致。
34. As a 审查者, I want 修订契约与范围先独立合并再修复产品, so that 可清楚区分批准的设计与尚未验收的实现。
35. As a Windows 用户, I want EXE确实包含两个必需媒体资源, so that 已批准的独立媒体上下文可以启动。
36. As a 审查者, I want 打包白名单只新增两个精确文件且仍检查它们存在, so that 缺失或其他额外资源继续被拒绝。
37. As a 受控房间维护者, I want 分发秘密扫描及其他T1断言保持并实际执行, so that 资源扩展不会掩盖安全失败。

## Implementation Decisions

### 1. 基线、签认与非目标边界

- 本次T2-C3基线为PR20合并提交 `c0064f522b7ccec3e9211f4cceb692115f51d883`；T2-C2此前基于PR15的 `cb0fd0c71c4a4b99796fc1e37370b6b91fe4fd25`。
  T1 工程基线仍是 PR13 的 `9f523711634fc21fbf3c3b0459046141c28ad82f`；
  父票 #1 最终签认与 T2 父票 #14 保持 OPEN，本文不代 Jack 关闭。
- 技术栈保持 Electron 44.5.1、React、TypeScript、Vite、FastAPI、npm workspaces 与 uv。
  继续锁定已获准的 `livekit-client@2.22.3`，不新增 RTC 依赖或升级现有版本。
  诊断 worktree 已安装并运行该版本；本轮文档 worktree 不安装依赖。
- Jack 已作为本 fork T2 唯一契约签认与集成 Owner 批准 PR15；A 起草、验证和串行执行获准任务。
  2026-10-07已签认T2-C3最小方案；具体范围以本次docs PR经Jack审阅合并为准，全局D9不变。
- 同窗口媒体方案因诊断失败停止；专用媒体上下文已通过PR20独立文档签认，本次保持该设计。
  修订方案的首轮兼容验证仍限约一个有效工作日；失败记录阻碍并重新裁定，
  不叠加 shim、修改 SDK、升级服务器或关闭安全开关。
- 此前本地 SFU/合成实验仅为资源线索。首票必须核对缓存官方 SFU 二进制及版本/校验值，
  明确本机回环实验条件后复用；不可把历史实验当作当前 Electron 兼容证据。
  未有合适本地资源时只暂停媒体执行，不购买、部署或操作韩国服务器。

### 2. 专用媒体执行域与认证头

**专用媒体上下文。** main 在明确 join 后为当前 mediaSessionId 创建隐藏的专用 BrowserWindow，
使用独立、非持久 session partition 和静态媒体页面，SDK 仅运行在其隔离沙箱 preload。
业务 UI 窗口和媒体窗口拥有不同 webContents；不复用 UI frame 承载 SDK 或认证头。
媒体页面没有业务 UI、外部脚本或导航；main 创建窗口是受控生命周期操作，网页子窗仍禁止。
API secret 留后端，应用会话留 main；业务 UI 只经有限命令和经 schema 校验的快照与 main 沟通。

**初始票据。** main 原子消费当前准入准备后持有初始 JWT；
私有启动命令交付会话 ID、获准 SFU 与预期房间/主体，不交付该 JWT。
SDK 的连接 token 参数使用固定、非秘密且不能独立通过 SFU 验签的占位值。
main 仅为当前媒体 webContents 的批准主 frame、批准静态页面、当前代次与 GET 信令请求
添加 Authorization: Bearer 认证头；目标必须精确匹配获准协议、主机、端口与四条信令路径。
未知 frame、UI 窗口、外来窗口、旧媒体上下文、非 GET、重定向及未知路径均不得获得认证头。
URL 白名单和认证头授权分别校验；同源并不自动获得票据。

保留同地址 HTTP/HTTPS validate 的认证头支持；初始握手授权在结束连接事务后撤销，
初始 JWT 从 main 清除；取消、失败、离开和上下文销毁立即使旧代次的请求头授权失效。
连接总超时覆盖 HTTP validate，期间只能有一个初始连接事务。
SDK 协议路径协商仍使用同一事务，不能因首次 WS 失败就提前撤销随后 validate 的授权。
本机制使用 Electron 原生请求头入口与 SFU 既有认证方式，不新增信令代理或修改 SDK。

**SFU 刷新票据。** SDK 可能从信令收到刷新 token 并保存在专用媒体域；
因此不宣称所有 renderer 零 JWT。刷新票据不能进入 UI、业务页面 URL、日志或存储。
禁自动重连仍保持；刷新后发生信令失败不得开启携带真实 JWT 的新握手。
若固定 SDK 在此路径仍产生含票据 URL 或诊断，修订方案保持 BLOCKED，不能增加日志例外。
要求所有 renderer 零 JWT 时，浏览器 SDK 路线仍 HOLD，须另行裁定。

本修订撤销 PR15 的真实 JWT 信令 URL 例外；JWT 只可在获准请求的认证头及专用媒体域接收的
SFU 信令刷新中出现。业务页面 URL、导航、公开桥接、错误对象、控制台、一般诊断与持久化
继续禁止凭据。原生网络错误也属于脱敏验收，不能只检查应用 stdout/stderr。

批准SFU地址由运营者通过独立、可选的一次性媒体配置命名管道交给main，
使用新增媒体schema中的私有mediaStartup定义，保持旧T1启动schema原样。
仅传批准SFU基础地址，不含secret或应用会话；沿用UUID管道名、4KiB上限和15秒读取期限。
缺少该配置仍可执行T1准备，但媒体加入拒绝；UI不能提供或修改此配置。
后端准入响应的livekitUrl必须与本次批准地址完全一致，再交给SDK。
本地只允许批准的 `127.0.0.1:端口`，SFU 基础地址须为根路径且无用户信息、查询或片段。
锁定 SDK 对应的路径仅为 `/rtc`、`/rtc/v1`、`/rtc/validate`、`/rtc/v1/validate`；
显式批准协议协商路径，不允许任意同源请求或重定向到其他地址。
未来外部连接只能用获准 WSS/HTTPS，需另行明确运行配置与资源条件。

两窗口保持 contextIsolation、sandbox、nodeIntegration=false、webSecurity 和禁止导航/网页子窗策略。
仅媒体上下文的 CSP 与请求白名单允许上述获准信令目标；业务 UI 不获得 SFU 访问或认证头。
媒体资源仅来自打包的本地静态入口和本次获准 SFU；重入使用全新媒体 partition。
该白名单不等同于 ICE/UDP 的网络隔离证明；
本地 SFU、媒体候选地址和真实网络目的地也须在实验中核对。
未知地址或 SDK 新增请求失败时记录事实，不临时放开网络。
整个成功、失败、超时链路测试脱敏；代理日志/HAR 不原样发布。

### 3. 现有接口复用与唯一交接

- 认证复用 AuthenticationProvider.authenticate；授权复用 AuthorizationProvider 和
  PermissionPolicy.can。T2 补适配器，不再造 can 或并行权限逻辑。
- main 负责准入、已批准地址、响应校验、操作代次、会话所有权、设备同意和窗口退出。
  main 不签 token，不把 SDK 未连接状态宣称成功。
- 隔离媒体域拥有唯一 Room、订阅、采集轨道、播放器和 SDK 内部 token 刷新状态；
  语音模块负责房间，音频模块负责采集与播放。专用媒体 preload 是组合入口，
  通过注入端口协调二者，feature 之间不互相 import；业务 preload 只暴露有限 UI 能力。
- UI 保留已有 prepare/cancel 准入接口；新增窄媒体能力为 join、cancelJoin、leave、
  setMicrophoneEnabled、enableAudio、getSnapshot、subscribe。
  join 不接收 URL、JWT、主体或 grants；控制命令只引用 main 产生的 mediaSessionId。
  subscribe 只回传校验后的快照并返回取消订阅函数。
- 公共命令、快照与错误码以新增 JSON schema 为单一真相，沿用既有生成和校验方式。
  未知字段/命令、错误类型、旧会话或非批准主 frame 默认拒绝。
  UI 快照只含连接、麦克风、播放状态、有限成员摘要和稳定错误码，不含 SDK 对象。
  私有媒体启动命令同步移除初始 JWT 字段，绑定指定媒体上下文与代次；旧命令和未知字段拒绝。
- 共享 UI 增加一个通用、可访问的列表原语，只接收稳定键和展示内容；
  VoicePanel 组合真实成员摘要与 t() 文案，不在 feature 自造列表或让共享 UI 依赖媒体 schema。
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
  SDK 刷新 token 只留在专用媒体域；销毁上下文清除该域持有的票据。
  下一次手动入房仍需新的应用准入和新的媒体上下文。

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

- 启动、填写昵称和准备不创建媒体 Room、不连接 SFU、不采集、不预热或枚举设备。
  明确 join 后只创建一个当前会话拥有的媒体上下文；清理完成前禁止第二个准入/Room。
  SDK 的协议协商不等于第二次应用操作，任何时刻只有一个活动入房流程与一个活动 Room。
- 有限例外：当前媒体上下文生存期间，允许锁定 SDK 因 devicechange 被动 enumerateDevices，
  但必须不请求权限、不预热或采集；应用不主动枚举，不把设备清单暴露给业务 UI。
  这是对 T2-01 原“默认零枚举”的明确修订，不是把枚举计数假报为零。
  枚举不等于采集；默认及设备变化时 getUserMedia/getDisplayMedia 必须仍为 0。
  启动/准备和退出完成后仍要求无媒体上下文、无 SDK 枚举或旧事件响应。
- 首次连接使用明确的总超时30秒，初始 maxRetries=0；
  ReconnectPolicy.nextRetryDelayInMs 返回 null，不写自己的恢复循环。
  固定版本上实际验证初始失败、信令断开和服务端移除后无后台恢复/重新发布。
- cancelJoin 先使代次失效，再中断准入或调用 Room.disconnect；
  迟到凭据、连接结果和旧成员事件不能复活状态，取消后不能留下 SFU 成员。
- 麦克风默认关闭。仅已连接且具有 microphone grant 时，明确点击开麦，
  经 main 控制的首次同意后启动本次音频采集事务。同意仅限当前媒体会话；
  重入默认闭麦并重新同意，不做永久授权或自动重弹。
- 同时实现 permission check/request，只认可专用媒体窗口的批准主 frame、当前会话、
  当前采集事务及 audio 类型；业务 UI、外来窗口、camera、display-capture、未知类型继续拒绝。
  同一采集事务可以产生多个检查回调，不能假定只调用一次。
- 创建本地音轨与发布分两步；创建后、发布前和异步发布完成后重新核对
  房间与麦克风操作代次。用户已关麦、取消或离开时，迟到轨道停止且不保留发布。
  拒绝、无设备或发布失败保持闭麦，不虚报成功；收听会话可以保留。
- AEC/NS/AGC 默认开启，不做设置页。静音停止有效人声传输；
  暂保留底层轨道，不承诺设备已释放或 RTP 包数归零。
  独立采集超时30秒后使操作失效，之后授权产生的轨道仍要停止。
- 播放受阻单独提供启用声音，使用 Room.startAudio，并实际验证 UI→main→媒体域的用户激活。
  不通过开麦或全局 autoplay 开关绕过。每个远端轨道只绑定一个播放器；
  订阅快照与增量事件按参与者/轨道身份合并，旧代次事件失效。
- leave、业务窗口关闭和终止性失败先使代次与请求头授权失效，再停止自有轨道、
  取消发布、断开 Room、清理播放器/应用监听/订阅/计时器，并销毁专用媒体 webContents。
  SDK 内部设备监听以销毁所属上下文清除，不能靠 GC 或 removeAllListeners 宣称已释放。
  确认媒体上下文已销毁后才报告退出完成并允许手动重入；每次重入新建上下文和 partition。
  清理总期限5秒，包含断开与销毁；超时保持 cleanup-failed 隔离，即使后来销毁也不自动解锁，
  关闭业务窗口可终止全部所属上下文。不得新建 Room 掩盖旧资源。
  媒体窗口意外关闭/进程崩溃属于终止性失败，不复活旧会话或自动重连。
- 正常离开后的手动重入重新经过认证、can、限流与签发，并创建新的本地会话代次。

## Testing Decisions

### 主边界与已有测试先例

主要验收边界是实际 Windows 客户端 → 真实 HTTP 准入 → 真实 SFU。
现有准入应用旅程、真实 HTTP schema/限流测试和 provider 接口是先例。
测试外部状态、服务器收到的准入次数、SFU 成员和可接收媒体，不断言内部私有变量。
SDK 适配器只在真实异步顺序难以重现的拒绝/迟到轨道/发布失败/清理失败中使用可控替身；
替身不能替代真实 Room/SFU 证据。

除下述T2-C3打包资源断言例外外，T1回归保持原样并确实运行。新 voice/audio/account/permission 目录须接入检查发现，
从输出证明用例被运行；不能以未发现新测试的全绿命令签收。
单写者、逐票更小文件子集；代码、schema、类型生成与消费者在对应实现票中同步。

### T2-C3 打包资源断言例外

本例外由独立契约/测试修订票[#21](https://github.com/wenhuorongbing-netizen/babacom/issues/21)固定。
Jack于2026-10-07签认最小方案；具体Module: docs范围PR经其审阅合并，并将#16同步为27路径及明确测试修复范围后，才可执行。

只允许#16修改`tests/shell/admission.e2e.ts`中
`the distributed application contains only bundled client resources and no runtime secrets`用例的
必需资源存在性检查和精确文件白名单：增加`dist/main/media-preload.cjs`与`dist/media/media.html`两项。
两文件必须存在；其余文件仍按原闭集拒绝，不能扩大成任意dist文件或目录放行。
保留resources目录只含app.asar、会话/JWT哨兵不进入ASAR/UI/诊断、fixture与测试启动器排除等全部其他原断言。
该用例的其他断言、所有其他T1用例及测试辅助函数零改动；冻结schema、昵称、120秒TTL、grants和限流保持原样。
不跳过失败用例，不修改SDK、构建器或产品来隐藏新资源。#17/#18不因总上界变化获得该路径权限。

原始完整结果（代码树`59875dfb3b6c5a0f670aee934cf96b6de70cc0d2`）：
开发52 passed / 3 packaged-only skipped (11.6m)，exit 0；
EXE54 passed / 1 failed (9.7m)，exit 1，全部32条T2媒体用例通过。
失败为原资源白名单的`Error: Only bundled application resources; Expected: true; Received: false`。
后续分发资源秘密扫描因提前失败尚未执行，不作为PASS；ASAR实测仅新增上述两个必需文件。
这些是修订前RECORDED证据，本轮docs不重跑产品或声称修复通过。
后续#16须运行完整六项客户端验证，开发与EXE测试均exit 0、0 failed，且全部原分发/秘密扫描断言实际执行，才可签收。

### 本修订新增的外部断言

- 启动/准备没有媒体上下文且枚举/采集为0；当前媒体上下文可被动枚举，但权限请求、
  getUserMedia/getDisplayMedia 为0；业务 UI 不收到设备清单。只观察实际浏览器 API 调用，不改 SDK。
- leave/cancel/终止失败后，旧 webContents 确实销毁，SDK 设备事件不再响应；
  下一次 join 产生新的上下文/partition，成员与资源数量有界。不能只验证 SFU 成员已离开。
- 真实 SFU 有效认证头可入房，坏签名/过期/缺头拒绝；占位 token 单独不能入房。
  UI/外来窗口、非批准 frame、旧代次、未知路径、非 GET 和重定向均不能借用头认证。
  在 UI 直接请求获准 validate 地址也必须没有媒体授权，不能把“UI未拿到JWT”当成该检查通过。
- 成功、坏签名、拒绝、超时、协议协商、信令断开和服务端移除都覆盖 stdout/stderr、
  浏览器 console/pageerror 与 Chromium 原生网络诊断；URL 与可序列化错误无真实凭据。
  确认真正发生 SFU token 刷新后再次覆盖信令失败，断言没有含刷新 JWT 的新握手或诊断；
  缺少刷新路径证据时标 NOT_RUN，T2-01 不签收，不能仅凭首次握手无泄露放行。
- 两窗口的实际沙箱/隔离偏好、独立权限域、初始化失败/崩溃/销毁及打包路径均在真实 Electron 验证。
  T2-03 的启用播放还需独立媒体域的用户激活与人耳验证，不能从本轮夹具发布合成音轨推断。
- 本次明确授权实现票同步修正 T2 专用“默认零枚举”和同窗口交接断言，保留原失败证据；
  以默认零采集、准备零枚举、退出后零旧响应和授权隔离断言替代。除T2-C3打包资源断言例外外，T1正常测试与旧schema仍零改动。
- 共享成员列表检查真实成员数量/稳定身份、可访问列表语义与中文标签；不以UI元素名断言内部实现。

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
| T2-C | 原规格及31路径 | Jack已批准，PR15合并 | 原文档票已完成；同窗口方案的T2-01诊断失败，T2-01不能视为完成 |
| T2-C2 | 修订规格及34路径 | Jack已审阅并在PR20合并 | 已完成契约前置，产品验收独立 |
| T2-C3 | 打包资源断言例外及35路径 | 三份文档一致；方案已签认；文档校验及Jack审阅合并 | 本轮仅文档；合并并同步#16的27路径与例外前保持BLOCKED |
| T2-01 | 闭麦进入真实本地房间、看见成员、离开并重入 | 开发/打包真实SDK；合成订阅；专用上下文销毁/重入；头认证隔离、刷新后无URL/日志凭据；共享列表与T1回归 | T2-C3合并并同步#16的新契约、27路径与打包断言例外；依赖/本地资源核验；兼容失败不关沙箱、不再自行换架构 |
| T2-02 | 非fixture主体进入获准房间，拒绝分支无媒体票 | 真实有限会话/房间provider；完整HTTP及真实SFU验票与隔离；缺provider拒绝 | 发放/到期/撤销契约明确；不声明生产登录或即时媒体撤销 |
| T2-03 | 显式开麦、静音、退出及真实双设备通话 | 权限/迟到轨道/清理/播放回归；两台Windows人耳证据；跨境条件成立后另验 | 物理设备明确同意、两主体与资源条件；缺中德证据不签收M0 |

每票使用单独 Issue，声明具体 Allowed Files 子集及依赖。既有实现票为#16、#17、#18，
保持串行依赖；本轮单独发布T2-C3契约/测试修订票#21与docs PR，不重新创建三张实现票。
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
- 改 T1 昵称/TTL/grants/限流，未经明确契约修订降低既有测试断言，提前宣称完整R01/M0/Alpha；仅授权已签认T2专属断言同步及上述T2-C3打包资源例外，其他正常T1测试仍零改动。

## Further Notes

### 本轮与后续精确范围

本轮T2-C3的源文件仅为：
`docs/T2-spec.md`、`docs/04-open-decisions.md`、`.agents/modules/t2.md`。
所有应用、测试、schema、依赖、infra、T1规格/清单与CODEOWNERS零diff。
临时验证脚本及Issue/PR正文仅放已忽略的桌面build目录，不提交。

下列35个路径是T2-C3修订后实现的拟签认上界，不是本轮产品或测试改动授权；
已有或拟建状态均以本轮基线核对。每张票只使用实际需要的更小子集：

```text
package-lock.json
apps/desktop/package.json
apps/desktop/tsconfig.json
apps/desktop/eslint.config.mjs
apps/desktop/playwright.config.ts
apps/desktop/index.html
apps/desktop/media.html
apps/desktop/scripts/build.mjs
apps/desktop/scripts/dev.mjs
apps/desktop/src/main/main.ts
apps/desktop/src/main/preload.ts
apps/desktop/src/main/media-preload.ts
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
packages/ui/src/index.tsx
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
tests/shell/admission.e2e.ts
```

PR20已签认34路径；本次相对PR20仅增加`tests/shell/admission.e2e.ts`，用途严格限定于T2-C3打包资源断言例外。
桌面打包规则已包含全部dist文件；媒体入口/预载构建接线在既有build脚本完成，不改打包器配置。
具体docs PR合并后，将既有#16的26路径子集同步为27路径，只新增该测试路径并明确该票包含此狭窄测试修复。
#17/#18按实际需要逐个声明子集，不包含本例外测试路径。

`tests/accounts/test_session.py`属于账号测试；不新建`tests/auth`。
已有认证/权限原语不需修改；不另建同用途permissions/service。
本轮docs中的正常T1测试与冻结schema零diff；后续仅#16可执行上述狭窄测试例外，其他T1测试与冻结schema零改动。
如实际发现必须改表外文件，停止并先走独立 docs 范围 PR。
CODEOWNERS 为上述路径及 T2 治理文件逐个指定 Jack，只影响本 fork T2，不任命全局 D9。

### 本轮 Validation 与后续命令

本轮运行并记录退出码：
```powershell
git diff --check
node .agents/scope_guard.mjs docs --files docs/T2-spec.md docs/04-open-decisions.md .agents/modules/t2.md
node --test .agents/scope_guard.test.mjs
```
另运行不提交的`node apps/desktop/build/t2-c3-validation-20261007.mjs`：断言实际diff恰好三文件，
T2清单与本文同为35路径且相对PR20只增加指定测试路径，狭窄例外、#16后续27路径及合并前BLOCKED状态一致；
全部产品/测试、T1-spec/t1清单、schema、依赖、infra、其他模块与CODEOWNERS零diff，既有Jack所有权有效，
相对链接可解析，两个原工作副本暂存树保持不变。原C2安全边界保持。所有断言必须成功。

以下为修订后实现票的 Validation；本轮文档任务 NOT_RUN，不沿用诊断结果冒充修复通过：
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
本轮不把规划命令写成测试通过记录，也不重跑与三份文档无关的产品检查；已有失败仍按RECORDED报告，不冒充本轮PASS。

### 来源与事实状态

- VERIFIED：原规格已在[PR15](https://github.com/wenhuorongbing-netizen/babacom/pull/15)合并；
  T2-C2历史修订从cb0fd0c开始；本次T2-C3从已合并PR20的c0064f5开始。T1历史交付见[PR13](https://github.com/wenhuorongbing-netizen/babacom/pull/13)，本轮未重跑。
- RECORDED（2026-10-05诊断）：9个定向用例4通过、5失败；未连接Room设备事件枚举1次，
  实际连接/离开后计数1→2，物理采集0；坏签名触发Chromium network诊断JWT。
  头认证夹具证明有效签名/合成发布、坏签名、缺头和不同窗口拒绝；同frame UI validate却返回200，
  因而只能作为机制线索，不能直接把该夹具方案放进同窗口产品。
  当时typecheck/lint/docs外产品scope通过，Windows打包、物理设备与跨境未运行；#16未提交或发布。
- RECORDED：原[战略PO对话](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ac2188a-8b8c-83ee-ab67-968c584fe99f)，
  2026-10-05完整答复；其建议不增加权限。原3600秒应用会话、超时与独立媒体配置管道已随PR15签认。
  Jack于2026-10-06确认C2方向并已批准合并PR20；2026-10-07签认C3最小方案，本次docs PR待审阅合并，产品检查继续独立。
- 官方依据：[LiveKit token寿命/撤销](https://docs.livekit.io/frontends/reference/tokens-grants/)，
  [固定JS v2.22.3信令](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/api/SignalClient.ts)，
  [固定信令URL构造](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/api/utils.ts)，
  [固定SFU认证头优先级](https://github.com/livekit/livekit/blob/v1.13.7/pkg/service/auth.go)，
  [固定Room设备监听](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/room/Room.ts)，
  [固定SDK刷新token状态](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/room/RTCEngine.ts)，
  [Electron原生请求头](https://www.electronjs.org/docs/latest/api/web-request#webrequestonbeforesendheadersfilter-listener)，
  [初次连接选项](https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomConnectOptions.html)，
  [重连策略](https://docs.livekit.io/reference/client-sdk-js/interfaces/ReconnectPolicy.html)，
  [Electron上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、
  [沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox)、
  [权限入口](https://www.electronjs.org/docs/latest/api/session)。
  资料支持接口存在，不保证本组合运行；动态API文档显示的版本不能替代锁定版本测试。
- NOT_RUN（本修订）：独立媒体上下文的实际开发/packaged修复、刷新票据后失败链、
  播放用户激活、物理设备、双设备及跨境。本轮不安装依赖、不采购部署、不运行设备采集。
  T1工程交付、T2方向确认、具体PR合并及真人产品验收分别保留事实。

## T2-V1：沙盒启动与结果回传修复

> 2026-10-08 · 独立于 #18 的测试启动器任务；Module: t2。
> Jack已于2026-10-08签认下面的具体范围；#18 的18条 Allowed Files和真人验收条件保持。
> 独立 Module: docs 范围PR合并后，建立引用本节的单独实现Issue。
> 范围PR未合并时，不修改下面的产品/测试文件。

### 问题与目标

本机 `wsb` CLI 0.8.107.0 已可调用，但现有沙盒入口仅在120秒内等待最终结果文件。
先前运行exit 1、NOT_RUN，没有实际guest结果；失败原因尚未确定。
进程名检查和终止启动器不构成沙盒实例生命周期证明。
本票先定位启动、用户桌面、guest脚本及结果回传的故障，并在干净Windows中保留既有EXE启动验收。
来源与环境核实见 [调研报告](T2-03-acceptance-research.md)。

### 实现边界与设计

- 复用已安装 `wsb`、现有打包产物、Python运行时及T1 fixture；不新增依赖或安装软件。
- 使用本次随机实例ID和本次唯一运行目录。记录启动前实例集合，验证CLI返回ID及创建结果；
  归属不明确时拒绝connect、exec、share和stop。既有或陌生实例不作为测试目标，不终止它们。
- 通过CLI创建/连接本次实例，在实际登录用户桌面执行既有guest启动检查；
  仅System命令成功不构成客户端窗口或当前用户环境证据。
- 每个CLI动作有15秒期限，既有guest结果等待上限120秒保留，拥有实例的清理最多15秒；
  整轮在180秒总预算内结束。超时不增加无界重试，也不放宽原客户端/API的启动、关闭断言。
- guest仅向本次映射输出目录写不含秘密的阶段结果：执行开始、fixture就绪、客户端启动、最终结果。
  每项使用独立新文件，保留历史字节；输入只读，输出仅限本次目录，不共享其他目录。
- 每种失败报告固定阶段与有限错误类别，保留实际退出码；不直接输出CLI/guest原始stdout、stderr，
  不发布应用会话、JWT、API secret、HAR或任意异常正文。
- 只有本次guest实际返回既有PASS字段、产物摘要匹配且本次实例已释放才报告PASS；
  缺少结果为NOT_RUN，实际断言或执行失败为FAIL，清理失败单独报告并阻止PASS。
- 网络、AudioInput、VideoInput、剪贴板与打印机转接维持显式Disable；
  不采集物理设备，不连接外部服务，不改变API/SFU回环白名单、SDK、服务端版本或生产启动入口。

### Allowed Files（实现票仅两条）

- `apps/desktop/scripts/dev.mjs`
- `tests/voice/session.e2e.ts`

仅修复沙盒运行编排、有限诊断与本次测试。既有T1 guest的环境、窗口、准入控件、
秘密检查及客户端/API关闭断言全部保留；正常T1测试、T1规格/清单、三份旧schema、
产品main/preload、认证/授权原语、媒体fixture和infra零diff。
发现第三条必要文件时先停，重新提交独立docs范围变更。

### 自动化与真实运行断言

新增 `Sandbox runner` 用例通过既有Playwright入口发现并执行，至少覆盖以下行为：

1. 既有陌生实例不会被connect、exec、share或stop，创建返回未知ID也不会借用或停止它。
2. CLI启动失败/超时保持非PASS，输出只含允许的错误类别和退出码，不泄露原始诊断中的秘密。
3. 缺少guest结果、无实际用户客户端证据或结果结构无效均不能报告PASS。
4. guest返回的应用摘要与本次打包产物不同则拒绝PASS。
5. 正常完成、失败与取消均仅清理本次已确认拥有的实例和调用方资源。
6. 清理失败或超时不能被成功guest结果覆盖，结果明确保留未释放状态。

可控CLI替身仅用于难复现故障/顺序；不能替代真实Windows Sandbox运行。
真实运行须证明本次实例创建及用户桌面就绪、既有EXE窗口/准入控件、实际guest结果、
app.asar摘要相同、本次实例释放、陌生实例保留。条件未齐如实记录NOT_RUN/HOLD。

### Validation与完成条件

实现前以下均NOT_RUN；必须记录实际退出码、发现的用例及guest结果，不能用全绿替身签收。

```powershell
node --check apps/desktop/scripts/dev.mjs
node node_modules/@playwright/test/cli.js test --config apps/desktop/playwright.config.ts --project development tests/voice/session.e2e.ts --grep "Sandbox runner"
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run test --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
npm run test:e2e --workspace apps/desktop
npm run dev --workspace apps/desktop -- --sandbox-acceptance
git diff --check
git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs t2
```

通过条件：所需命令exit 0、自动化0失败，新增用例实际执行，diff仅两条Allowed Files，
原有T1回归不变，真实guest检查PASS且本次实例实际释放。若沙盒资源或登录桌面不可用，
保留软件验证结果和明确运行阻塞，不把本票或设备验收写成完成。DB NOT_APPLICABLE。

T2-V1不扩展为沙盒双客户端、非回环HTTPS/WSS启动、跨设备会话发放、真实开麦或中德验收。
这些是后续独立任务；下一步双客户端须另固定两稳定主体、同一API/SFU、依赖复制及精确文件子集。
本票通过不关闭#18/T2/M0，也不替代两台真实Windows、两测试者及人耳/物理设备释放证据。

## T2-A1：开发启动与测试清理的独立范围（docs PR合并生效）

2026-10-08 Jack以`/implement 1`请求实施测试调研中的A1：启动超时与失败清理。
具体契约见[testing-automation-spec.md](testing-automation-spec.md)。该独立Module: docs范围PR经Jack审阅合并前，
正常T1测试及其辅助函数的零改动继续有效；本地草稿或研究报告不解除限制。

该PR生效后，仅T2-A1独立实施票允许修改以下三条的必要子集：
`apps/desktop/scripts/dev.mjs`、`tests/shell/admission.e2e.ts`、`tests/voice/session.e2e.ts`。
T1狭窄例外只涉及受控启动/关闭helper、调用接线及新生命周期回归；既有测试主体、全部断言、
原始期限、昵称/凭据/限流语义与打包资源白名单保持。产品main/preload、旧schema、媒体fixture、infra和依赖零diff。
第四条必要文件、Job Object新脚本、框架/运行时/fuse/系统配置变更先另签范围。

本节不扩展T2-V1/#28；A1不得混入#28实现。验收包含原始超时RED→GREEN、完整development/packaged回归、
启动失败/取消/worker退出清理及非本次资源保存、同产物真实SandboxPASS与实例释放。
A2及后续自动化、双端/物理/中德验收仍是独立任务；#18边界不变。签认者仅为本fork的Jack，已于2026-10-08明确授权发布/合并本范围PR及继续实施A1。

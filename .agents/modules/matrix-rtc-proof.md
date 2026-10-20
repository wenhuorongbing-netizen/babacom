# matrix-rtc-proof — 同机零媒体 R0 候选

状态：**范围与实现 PR119、PR125–128 已合并；真实 R0 启动 FAIL，原实验已停止。Caddy 最小能力修订已由 Jack 签认，独立审查和可信合并后生效。** 实施票 #124 的原候选保留在 `feat/matrix-rtc-r0-proof`（`ff4cd0933950dfb8e3afb8bef8b5d5eb7e9684e8`）。具体运行细节及负例未核定仍HOLD；关联 M04 #63、M10 #69、M29 #88。

## 目标与范围

仅证明真实 Matrix 身份/私房成员授权、SFU签票及LiveKit信令，初始和全程零媒体轨道；不以health或伪造token代替。沿用[固定版本/摘要与接口](../../docs/Matrix-protocol-research.md#3-固定候选版本尚不是兼容组合签收)，首轮compatibility `/sfu/get`，AS与full-access只绑定同一个测试homeserver。新TLS代理镜像及完整构建来源仍须核定，缺项HOLD。

## Allowed Files（已合并七文件范围）

<!-- allowed-files:start -->
infra/staging/matrix-rtc-proof/compose.yaml
infra/staging/matrix-rtc-proof/homeserver.yaml.example
infra/staging/matrix-rtc-proof/appservice-registration.yaml.example
infra/staging/matrix-rtc-proof/livekit.yaml.example
infra/staging/matrix-rtc-proof/Caddyfile
infra/staging/matrix-rtc-proof/proof.mjs
infra/staging/matrix-rtc-proof/proof.test.mjs
<!-- allowed-files:end -->

仅以上七个源码/配置文件；精简文档候选不修改它们，不改现有matrix-proof、产品、依赖manifest或旧业务配置。宿主秘密、证书和运行数据不入Git。

## 候选运行合同

| 边界 | 约定与必须检查的事实 |
|---|---|
| 主机例外 | 仅 `lhins-af0ntal8` 的临时R0；授权与资源快照见[04](../../docs/04-open-decisions.md#matrix-rtc-e1-same-host-2026-10-16)，默认规则见[infra/AGENTS](../../infra/AGENTS.md)。不据此签收生产或媒体共置。 |
| 归属 | 新批次仅 `/opt/babacom-matrix-rtc-e2`，Compose项目 `babacom-matrix-rtc-e2`；创建前核对目录不存在或归属明确，绑定主机/项目/镜像/全新run ID。全新合成DB、卷、应用秘密；独立Docker网络，无旧业务挂载、host网络或privileged。旧e1现场按下文只读保留。 |
| 容量 | 四个实验容器与Node/CLI及其验证辅助进程合计CPU quota/period≤1，memory限制总和≤1610612736字节；实查实际cgroups，不以Compose文本代替。共享Docker/containerd及shim开销按下文资源核算修订单独测量和止损，不计作已受实验硬限额封顶。启动前复核空间/内存/负载及旧服务基线；测量范围和止损阈值须随运行细节冻结，缺项即HOLD。 |
| 故障/退出 | 超限、实验OOM或旧服务基线异常即停止本次自有实验；未知归属为UNKNOWN。只停确认归属的资源，保留合成DB/卷/秘密及追加证据；不停止旧服务、不全局down或删除卷。 |
| TLS/入口 | 所有发布入口仅loopback，实际域名、精确端口、可信证书/取得方式、TLS代理平台摘要及访问方均待核定；缺项拒绝运行。严格验证证书链和主机名，另实测auth的OpenID入口；无跳过校验或安装自签CA，不改旧DNS/代理/防火墙，不新增公网端口。 |
| 身份/秘密 | 仅新合成账号rtc-a/rtc-b/rtc-outsider和新私房，Matrix成员为唯一权威。秘密运行前随机生成并核对精确目录/文件最小权限；不覆盖旧秘密。验证器取得的token只在内存，不额外落盘；固定Synapse必要认证状态仅保存在本实验自有、受保护的DB及其事务文件。凭据不进Git、命令行、导航URL、日志、截图或证据。协议必需的传输例外及日志准入见下文，未核定即HOLD。 |
| 媒体 | LiveKit仅供API和信令；TURN关闭，不协商音视频轨道，不采集设备；任何媒体轨道使R0失败。R1–R3另定范围，强制relay/真人/中德不由R0代替。 |
| 期限 | 单次验证总预算120秒、单HTTP≤10秒，清理≤60秒；保留T1/T2及安装/退出期限。冲突即FAIL/BUSY，不杀占用者、不自动换端口、不重置预算。 |
| 准入 | 上述缺项、摘要/平台不符、权限不明、通配/多homeserver或无法读取成员状态均拒绝；不退回浮动tag、无成员校验或不可信TLS。 |

录制归档传输期间不并行性能验收；录制备份/删除不属于本模块。保留现有生产入口、证书、业务数据及服务。

### R0 凭据传输与日志准入（修订候选，待签认）

仅允许本实验合成OpenID token进入唯一已核定测试homeserver的可信HTTPS `/_matrix/federation/v1/openid/userinfo` 请求中、标准必需的 `access_token` query；不允许其他目的地、重定向携票、浏览器导航或真实账号。其他秘密不因此获得URL例外。R0验证器的LiveKit信令使用Bearer header；固定Call客户端的query行为属于R1待签认范围，不以R0代验。协议与固定源码依据见[研究](../../docs/Matrix-protocol-research.md#r0-凭据边界修订候选)。

仅关闭access log不足：固定auth的传输错误可能含完整URL。逐服务的原始日志控制、写盘前脱敏和安全事件留存方案仍HOLD，具体运行合同签认前不发送有效令牌；不改宿主或旧业务监控。先用不具认证能力的唯一哨兵覆盖成功、超时、TLS/连接和握手失败，检查代理、Synapse、auth、LiveKit、Docker、验证器的全部输出及拟保留证据，确认原值、URL编码及日志转义形式均未泄漏；真实运行再以只输出计数/结果的扫描复核。发现泄漏即FAIL并停止自有实验、保留受限证据，不能事后删日志伪造通过。允许留存时间、状态/errcode、事件计数、资源与退出码等脱敏安全事件，不把丢弃所有日志当验收。

### 标准组件精简修订（已签认；可信合并后生效）

目标是四个固定官方服务（Synapse、auth、LiveKit、Caddy）加现有 Node 脚本，保留上述七文件范围。移除自建 OpenID 代理、手写 RFC6455 与自建监管层；使用 Node 24.13.0 内置 WebSocket 的 Bearer header 扩展，不加 SDK/npm 依赖，不建立 ICE/媒体连接。源码依据统一见[研究](../../docs/Matrix-protocol-research.md#标准-r0-精简候选2026-10-16)。

| Jack已签认的窄变化 | 边界 |
|---|---|
| Caddy 能力（2026-10-19签认；本修订可信合并后生效） | 仅固定官方 Caddy 容器的 CapAdd 必须恰为 `NET_BIND_SERVICE`；其文件能力要求由实际容器核验。Synapse、auth、LiveKit 的 CapAdd 仍为空；全部保留 cap_drop ALL、no-new-privileges、只读文件系统及现有资源、网络、日志限制。缺失、重复或额外能力均拒绝，不改官方映像或用特权模式替代。 |
| 资源核算（2026-10-18签认；本修订可信合并后生效） | 四个实验容器与Node/CLI及其验证辅助进程仍合计硬限≤1 CPU、≤1610612736字节。共享Docker/containerd及shim开销单独实测，冻结测量范围、基线与止损门槛，启动、验证及清理期间按此检查；超限或旧服务异常即停止确认归属的实验，无法测量或归属不明即HOLD/UNKNOWN。不得声称共享运行时或shim从创建起受实验cgroup硬封顶，不迁移共享进程、不调整共享daemon或旧服务的限额。其余权限、TLS、日志、退出与期限要求不变。 |
| 期限 | 验证客户端单 HTTP 仍≤10秒；不再承诺 stock auth 内部 socket≤10秒。仅已核定的 OpenID/客户端发现请求为30秒，Twirp总期限未证实；整个启动/验证任务由标准 systemd/Compose 在120秒外界期限内终止，清理≤60秒。进程死亡、卡住及退出负例未实证即HOLD，不把 `WebSocket.close()` 当作 socket 已销毁。 |
| 合成凭据持久化例外 | 仅本实验合成凭据可受操作系统常规内存管理影响，可能进入受保护的 swap/core；stock auth 原始 stderr 可暂存于受信运行时管道内存。这是对旧 memory-only/原始输出禁令的新例外，不追认旧验收。必须先冻结实际路径、权限和可访问主体；未知即HOLD，不修改宿主或旧业务监控。验证器不额外落盘；凭据仍不得进入持久日志、Git、命令行、导航URL、终端或证据。 |
| 日志与留证 | 容器使用 `logging: none`、关闭access log；逐项核验Docker与旁路不持久化原始输出。保留脱敏状态、errcode、计数、资源及退出事件；哨兵先验证输出/持久化边界，再发送有效令牌，不把丢弃原始日志当完整验收。发现非获准持久化或外传立即FAIL，只停自有实验并保留受限证据。 |
| TLS候选 | `rtc-r0.beidi.games:18443`，仅loopback；新独立密钥与公信证书，DNS-01仅新增本次 `_acme-challenge.rtc-r0` TXT，不改旧A记录、代理、防火墙或公网端口。域名使用/证书取得及具体运行细节仍待签认，未核定不运行。 |

Matrix登录token注销必须独立验证；注销/停服不等于已签发OpenID或LiveKit JWT立即失效。记录固定栈的实际TTL，停止后不重启复用该实验状态。上述例外不覆盖真实账号、产品、R1–R3或其他主机；保留原分支、数据库、秘密及全部历史证据。

本次能力修复先独立合并现有模块与 `docs/04-open-decisions.md`，再只改 `compose.yaml`、`proof.mjs`、`proof.test.mjs`；独立审查和托管检查通过后合并。随后最多两个全新固定官方 Caddy 诊断容器：先 validate，成功且独立超时清理实证有效后才以另一个容器 run≤5秒。仅只读现有实验 TLS、network=none、无发布端口、原始输出仅受限 RAM；诊断容器、Node/CLI与辅助进程合计仍硬限≤0.2 CPU/268435456字节，总期限≤120秒、清理≤60秒；只向既有 `/opt/babacom-matrix-rtc-e1/events/caddy-startup-diagnostic-20261019.jsonl` 追加脱敏归属与结果。失败即停，保留旧 FAIL 实验及业务；诊断通过不能代替完整 R0、可信 TLS 链路或媒体验收。

### 新批次隔离（2026-10-20候选）

旧e1的目录、四个停止容器、DB、应用秘密、运行合同与历史证据原位保留，不重启、覆盖、重命名或删除。新e2固定使用独立目录/Compose项目、全新run ID、DB和应用秘密；不增加可配置根目录或通用批次管理器。新实验可只读复用e1已核定摘要的官方Node二进制，并将同一实验域名的既有TLS证书/私钥以独占创建方式复制到e2受保护目录；不复用旧账号/令牌或应用秘密。

先独立审查、签认并可信合并本模块与既有04中的最小契约修订，再只修改既有compose.yaml、proof.mjs、proof.test.mjs。回归必须拒绝旧e1/混合归属及旧挂载；e2冲突仍BUSY，不重试换名。执行前重新冻结具体运行合同、源文件摘要、资源/旧服务基线和退出保障，e1只读快照前后核对；上述门槛不齐不启动。沿用原TLS/18443 loopback、日志、零媒体、资源及120秒/60秒约定；通过Caddy诊断不代表完整R0通过。

## Validation（原候选接口；精简实现与真实运行尚未验证）

仓库根执行范围与自测：
```powershell
node .agents/scope_guard.mjs matrix-rtc-proof --files infra/staging/matrix-rtc-proof/compose.yaml infra/staging/matrix-rtc-proof/homeserver.yaml.example infra/staging/matrix-rtc-proof/appservice-registration.yaml.example infra/staging/matrix-rtc-proof/livekit.yaml.example infra/staging/matrix-rtc-proof/Caddyfile infra/staging/matrix-rtc-proof/proof.mjs infra/staging/matrix-rtc-proof/proof.test.mjs
node --test infra/staging/matrix-rtc-proof/proof.test.mjs
git diff --check
```

范围生效、精确运行细节签认后，Linux宿主按序执行未来接口：
```bash
node /opt/babacom-matrix-rtc-e2/proof.mjs preflight
node /opt/babacom-matrix-rtc-e2/proof.mjs config
node /opt/babacom-matrix-rtc-e2/proof.mjs up
node /opt/babacom-matrix-rtc-e2/proof.mjs verify
node /opt/babacom-matrix-rtc-e2/proof.mjs stop
```

`preflight/config`必须证明归属、秘密权限、固定摘要/平台、TLS/精确loopback入口与拟定资源限制；`up`≤120秒，创建容器后、就绪验收和验证请求前实查实际cgroups，不符即停自有实验。`verify`执行上述预算，任何失败非零退出；`stop`≤60秒且保留数据。当前缺失的域名/端口/证书/代理摘要/止损阈值须作为拒绝用例，不以默认值运行。

## Completion Criteria

- [ ] 范围/具体运行合同获独立审查、Jack签认及可信合并；没有以候选清单自授权。
- [ ] 真实OpenID、已加入私房签票200；JWT身份/房间/最小grants匹配，LiveKit实际接受对应信令且轨道始终为0。
- [ ] 未加入/仅受邀/无权的已存在私房、错主体及踢出后新请求拒绝且无JWT/参与者；旧JWT重连与既有参与者撤销另记，不以网络错误当权限证据。
- [ ] 可信TLS、成员配置、摘要、入口、资源限制及失败关闭正反例通过；日志方案已签认、哨兵与真实秘密扫描通过，秘密无输出，运行期限符合合同。
- [ ] 退出仅停止自有实验，数据/证据保留；旧容器身份/映像/状态/挂载、服务与入口基线保持。失败/HOLD/NOT_RUN逐层记录；G1/G4与旧契约不降级。

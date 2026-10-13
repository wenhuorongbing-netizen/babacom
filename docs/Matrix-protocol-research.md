# Matrix 协议与最小部署研究

核查日期：2026-10-13。关联 [迁移规格](Matrix-migration-spec.md)、[Backlog](Matrix-migration-backlog.md)。
范围：官方协议、固定源码与隔离实验建议；本文不改变 T1/T2 契约，不证明部署或 G1/G4 已通过。
证据状态：下述源码事实 **VERIFIED**；本资料完成时隔离服务**未部署**、G1 **NOT_RUN**。候选组合联调、镜像摘要、Windows 系统音频、E2EE 恢复和实物验收均 **NOT_RUN / UNKNOWN**，以各实施票的新证据更新。

## 1. 必须掌握的协议边界

通用协议解释复用 [Digo 的 v1.19 学习索引](../Source/README.md)：账号/设备、sync gap、成员权限及密钥见 [Client-Server](../Source/01-client-server-api.md)，房间演进见 [Room Versions](../Source/06-room-versions.md)。显示名不作身份；Space 导航不授予子房权限；客户端应复用 SDK 而不是另写同步/加密核心。

原核查和下文 API 示例以 **v1.17** 为基准；Digo 笔记以 **v1.19** 为基准。两者均保留固定来源，不把链接全部替换为 latest，也不将规范版本等同于某个 SDK 或组件的全部兼容能力。当前产品仍未迁移。

架构约束沿用迁移规格：单一长期 MatrixClient/crypto owner；每次通话独立短期媒体 session；离开语音房不能销毁账号密钥库。上述是本项目设计选择，不冒称协议自动保证。

### 版本与部署差异

本轮核对 Digo 固定提交的索引、Client-Server、Application Service 与 Changelog 的关键条款；未声称逐条审核全部 12 章。原笔记保留，实施时以下列固定来源与实际候选实验校准历史选型用语。

| 差异 | 本项目适用规则与证据 |
|---|---|
| 规范、房间与组件版本 | v1.19 已发布；房间版本与协议版本分别演进。[v12 格式](https://spec.matrix.org/v1.19/rooms/v12/#event-format) 的 room ID 不再要求旧式域名部分，不能套用统一旧正则。组件/MSC 支持按 M04 的固定版本和实际行为验证，不由“支持 v1.19”推定。 |
| 邀请与注册 | registration token 限制创建账号，room invite 授予入房机会，两者不同。当前 proof 候选由管理员预建账号并关闭公开注册；若另选 token 注册，固定 Synapse 要同时配置 `enable_registration: true` 与 `registration_requires_token: true`，另验有效期/次数/撤销/限流。[固定配置](https://github.com/element-hq/synapse/blob/v1.162.0/docs/usage/configuration/config_documentation.md#registration_requires_token) |
| 联邦“留空” | `federation_domain_whitelist: []` 拒绝全部；不设置或 `null` 允许全部，不能混称留空即关闭。另验 listener、代理、出站网络及房间 `m.federate`；只关 8448 不能证明无出站联邦。[固定配置](https://github.com/element-hq/synapse/blob/v1.162.0/docs/usage/configuration/config_documentation.md#federation_domain_whitelist) |
| E2EE 与恢复 | 客户端管理加解密、设备验证和私钥；homeserver 存密文、公开设备密钥及加密备份。数据库恢复不等于设备私钥恢复或旧历史可解密，M09/M31 分开验证。[协议](https://spec.matrix.org/v1.19/client-server-api/#end-to-end-encryption) |
| Application Service | Source 第 03 章的经典桥接语境保留；本候选 lk-jwt-service v0.8.0 的 homeserver-mediated 模式使用 AS 接线，旧 standalone 已 deprecated，详见 §4。25 人规模不构成省略 AS 的依据。 |
| 轻量 homeserver | 首个 proof 使用 Synapse。[Dendrite 官方说明](https://github.com/element-hq/dendrite#readme) 标为维护模式且未实现 MSC4186/MSC3861；[Conduit](https://conduit.rs/) 的本候选 RTC 支持仍 UNKNOWN，不据此宣称已废弃。替代优先级须有版本、升级、恢复和 Call 兼容证据。 |
| 工作量与媒体规模 | “近零工作量”和“4–6 人全互联”是历史选型判断，未构成本项目兼容、成本或负载实测。保留 NFR 的 10 语音/1 共享/9 观看/≥2 小时与 G1；1440p60 仍属后续目标，不以笔记降低当前验收。 |

## 2. Matrix 不是一套可直接替代全部服务的“内核”

| 层 | 责任与边界 |
|---|---|
| Matrix 协议 | 规定身份、事件、同步与权限语义；不保证某客户端满足游戏共享体验。[协议入口](https://spec.matrix.org/v1.17/) |
| Synapse | homeserver 实现，持有服务端状态；生产配置、数据库与备份仍需运维。[固定说明](https://github.com/element-hq/synapse/blob/v1.162.0/README.rst) |
| Element Web/Desktop | 客户端产品与平台适配；候选 A 使用同仓库的 `apps/desktop/`，不基于旧归档桌面仓库开发。[固定树](https://github.com/element-hq/element-web/tree/v1.12.30/apps/desktop) |
| MatrixRTC / Element Call | 通话参与、发现与媒体接入；所需 MSC、homeserver 与客户端支持必须匹配。[Call 固定自托管说明](https://github.com/element-hq/element-call/blob/v0.26.0/docs/self_hosting.md) |
| RTC auth / SFU | 授权服务将 Matrix 身份/房间映射至 LiveKit JWT；SFU 转发媒体，不能另建独立成员权威。[固定 RTC auth](https://github.com/element-hq/lk-jwt-service/blob/v0.8.0/README.md) |
| TURN / 网络 | 解决受限网络的媒体中继；HTTPS 健康检查通过不证明 UDP、强制中继或中德链路通过。[LiveKit 端口](https://docs.livekit.io/transport/self-hosting/ports-firewall/) |

## 3. 固定候选版本，尚不是兼容组合签收

| 组件 | 固定源码 commit | 许可来源 |
|---|---|---|
| Element v1.12.30 | `f19cfd9030429240a4209bf5175b372175cf0464` | [README](https://github.com/element-hq/element-web/blob/v1.12.30/README.md)：AGPLv3+ / GPLv3+ / 商业 |
| embedded Element Call v0.26.0 | `71593f1a245b1afa971e3940596e1c500edf9548` | [README](https://github.com/element-hq/element-call/blob/v0.26.0/README.md)：AGPLv3+ / 商业 |
| matrix-js-sdk v43.0.0 | `5723f58cb8675398970fc2945819ae0f4b7c1b58` | [package.json](https://github.com/matrix-org/matrix-js-sdk/blob/v43.0.0/package.json)：Apache-2.0 |
| Synapse v1.162.0 | `63dc0cbfe514f60743212566374ffeb5e9e295c2` | [README](https://github.com/element-hq/synapse/blob/v1.162.0/README.rst)：AGPLv3+ / 商业 |
| lk-jwt-service tag v0.8.0 | `32522b7da1889a3dafefeb1c527e86b76f19d2c3` | [Cargo.toml](https://github.com/element-hq/lk-jwt-service/blob/v0.8.0/Cargo.toml)：AGPL-3.0-only |

Element 的 [固定 package.json](https://github.com/element-hq/element-web/blob/v1.12.30/apps/web/package.json) 直接声明 SDK `43.0.0` 与 embedded Call `0.26.0`，不能混入 `0.26.1` 后仍声称这是原组合。
lk-jwt-service 的 [v0.8.0 发布](https://github.com/element-hq/lk-jwt-service/releases/tag/v0.8.0) 存在，但该标签 Cargo.toml 自报 package version `0.6.0`；M04 必须核对实际二进制/镜像摘要和版本输出，不能只锁字符串。
LiveKit SFU、数据库、反向代理、TURN 的具体版本/镜像摘要和全部传递依赖仍 **UNKNOWN**，须列入 M04/M29；本表不是 SBOM 或完整许可审查。分发源码、NOTICE、品牌/字体与商业条款按实际发货清单核对，不在此作法律结论。

## 4. RTC 候选拓扑与风险

建议研究路径：Element 内嵌 Call → homeserver-mediated MatrixRTC endpoint → lk-jwt-service application service → LiveKit；客户端另连 SFU 信令/媒体。
lk-jwt-service v0.8.0 [官方说明](https://github.com/element-hq/lk-jwt-service/blob/v0.8.0/README.md#-homeserver-wiring-application-service) 将旧客户端直连 standalone 模式标为 deprecated；新模式依赖 MSC4502/MSC4512 与 MSC4195，仍使用 unstable 标识。
Synapse v1.162.0 [experimental.py](https://github.com/element-hq/synapse/blob/v1.162.0/synapse/config/experimental.py) 确有 `msc4502_enabled`、`msc4512_enabled` 和 `msc4143_enabled`；**存在 flag 不等于联调通过**。
Call v0.26.0 [自托管前置要求](https://github.com/element-hq/element-call/blob/v0.26.0/docs/self_hosting.md) 还列 delayed events、state-after、transports registry 等；M29 对照固定版本逐项验证，不复制动态 main 示例当最终配置。
授权负向必须覆盖错房、非成员、踢出后的新请求与活动通话撤销；同时检查 webhook/延迟离开，不能只证明 JWT 能签发。
先验证认证与媒体闭环，再冻结主动撤销最大窗口；没有可测结果前不能用 UI 状态宣称已撤销 SFU 能力。

## 5. 隔离控制面 proof：先少量服务，先获得真实证据

建议边界：stock Synapse + 独立 proof 数据目录 + stock Element 静态客户端；仅 loopback 监听，单独端口，不接旧 FastAPI、不迁移真实数据、不修改活动账号。
Synapse [安装说明](https://github.com/element-hq/synapse/blob/v1.162.0/docs/setup/installation.md#windows) 明确原生 Windows 不受官方支持；使用已获准的 Linux/WSL/container runtime。runtime 未就绪时只能报部署准备，不能报部署完成。
[Docker 说明](https://github.com/element-hq/synapse/blob/v1.162.0/docker/README.md) 允许 SQLite 本地测试，生产建议 PostgreSQL；镜像不包含 TURN；HTTP 本地测试与实际 HTTPS 部署分开。
本地测试需关闭公开注册、公开目录、遥测和 federation，使用一次性测试账号；仅不开放 federation listener 不足以证明没有出站 federation。每项检查实际生成配置和监听地址。
`server_name` 在 proof 时选专用可丢弃名称；生产前再签认稳定名称及发现/TLS，不将 proof 身份带入正式数据。[server_name 配置](https://github.com/element-hq/synapse/blob/v1.162.0/docs/usage/configuration/config_documentation.md#server_name)
控制面 proof 不启用采集，不安装自签 CA，不开放公网媒体端口；独立媒体主机、DNS/证书、SFU/TURN 与真实 Windows 属于后续窄实施票。

### 最小可执行验收输入与断言

实施脚本使用已冻结的 loopback URL 与两个本地测试账号；密码/令牌只在受保护本地输入和内存中传递，输出不含 token、密码或密钥。
下列是待执行协议断言，不是执行结果；API 细节以 [固定 Client-Server API](https://spec.matrix.org/v1.17/client-server-api/) 为准。

| 步骤 | 请求 / 操作 | 必须断言 |
|---|---|---|
| C0 | `GET /_matrix/client/versions` | 200、有效版本数组；监听仅 loopback；客户端实际加载所固定构建 |
| C1 | 两账号 `POST /v3/login`、`GET /v3/account/whoami` | 200；不同稳定 user ID，device ID 分别归属对应用户；公开注册拒绝，输出秘密脱敏 |
| C2 | A `POST /v3/createRoom` 建 invite-only、非联邦私房；B 未受邀直接 join | A 成功，B 拒绝；再 invite→join 成功，不能把同昵称当同主体 |
| C3 | A `PUT /v3/rooms/{id}/send/m.room.message/{txn}`；B `GET /v3/sync` | 对应 event ID/body/sender 收到；同 token/txn 重发不重复建事件 |
| C4 | B 修改 `m.room.name`；A kick B；B 再发送 | 按冻结 power levels 拒绝越权；踢出后写入拒绝；记录真实 HTTP/errcode |
| C5 | 专用数据目录重启 Synapse，A 重新登录/取历史 | 原 room/event/identity 保持；不得以重建空库代替恢复验证 |
| C6 | A `POST /v3/logout`，重用原 token 调 whoami | 原 token 拒绝；B 不受影响；令牌不写日志 |
| C7 | 创建 `m.space`、设置 parent/child，并检查 B 的子房权限 | 导航关系存在；仍按子房成员与权限独立判断 |

其中 `/v3/…` 前缀为 `/_matrix/client/v3/…`。健康检查可在实施端口冻结后执行：

```powershell
$proofBase = $env:BABACOM_PROOF_BASE_URL
if (-not $proofBase -or -not ([Uri]$proofBase).IsLoopback) { throw 'loopback URL required' }
$versions = Invoke-RestMethod -Uri ($proofBase.TrimEnd('/') + '/_matrix/client/versions')
if (-not $versions.versions -or $versions.versions.Count -eq 0) { throw 'missing Matrix versions' }
```

HTTP/明文私房证明仅覆盖控制面。独立 E2EE 验收使用真实固定客户端：双设备验证→加密收发→退出/重登→新设备恢复→旧历史解密→丢恢复秘密失败提示；保存服务器密文不当作成功解密证据。

## 6. Sprint 出口与不能提前签收的事项

先完成 M01/M02 的最小 proof 契约与数据边界、M03 滚动 Ready、M04 版本/摘要、M29 窄控制面 proof；以上不要求其余 36 票同时 Ready。
控制面通过后做 stock Windows 包与 MatrixRTC 最小闭环，再尽早执行 M21/M22 的系统音频/独立音量证明；G1 前不扩大品牌重做或社区功能面。
Element v1.12.30 [共享回调](https://github.com/element-hq/element-web/blob/v1.12.30/apps/desktop/src/ipc.ts#L151-L165) 已检查路径仅传 `video`；[handler](https://github.com/element-hq/element-web/blob/v1.12.30/apps/desktop/src/electron-main.ts#L376-L398) 是需要实测的线索，不能据此判定全部系统音频路径失败或已支持。
G1 仍需两台真实 Windows：游戏画面、系统声音、独立麦克风、接收端两类音量、无数字回授，以及拒绝/取消/晚到/停止/退出/崩溃释放；VM、API 与合成音频均不替代。
本地 HTTP proof ≠ 完整 RTC 部署 ≠ 干净 Windows 安装包 ≠ 真人中德验收；每层分别记 VERIFIED / FAIL / NOT_RUN / UNKNOWN。

# Matrix 协议与最小部署研究

核查日期：2026-10-15；保留原 2026-10-13 协议基准。关联 [迁移规格](Matrix-migration-spec.md)、[Backlog](Matrix-migration-backlog.md)。
范围：官方协议、固定源码与隔离实验建议；本文不改变 T1/T2 契约，不证明部署或 G1/G4 已通过。
证据状态：固定源码及下列镜像 manifest 元数据 **VERIFIED**；控制面 proof 已合并 PR104，隔离 Windows 安装/退出与回归分别已合并 PR112/PR117。RTC 组合联调、Windows 系统音频、E2EE 恢复及完整 G1 仍 **NOT_RUN / UNKNOWN**，源码与摘要核对不作为运行兼容证明。

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
| Application Service | Source 第 03 章的经典桥接语境保留；RTC-E1 选 lk-jwt-service v0.9.0 的旧接口兼容候选，仍要求 AS 接线和单一关联 homeserver 才有成员检查，详见 §4。旧接口 deprecated，不能为方便部署省略授权。 |
| 轻量 homeserver | 首个 proof 使用 Synapse。[Dendrite 官方说明](https://github.com/element-hq/dendrite#readme) 标为维护模式且未实现 MSC4186/MSC3861；[Conduit](https://conduit.rs/) 的本候选 RTC 支持仍 UNKNOWN，不据此宣称已废弃。替代优先级须有版本、升级、恢复和 Call 兼容证据。 |
| 工作量与媒体规模 | “近零工作量”和“4–6 人全互联”是历史选型判断，未构成本项目兼容、成本或负载实测。保留 NFR 的 10 语音/1 共享/9 观看/≥2 小时与 G1；1440p60 仍属后续目标，不以笔记降低当前验收。 |

## 2. Matrix 不是一套可直接替代全部服务的“内核”

| 层 | 责任与边界 |
|---|---|
| Matrix 协议 | 规定身份、事件、同步与权限语义；不保证某客户端满足游戏共享体验。[协议入口](https://spec.matrix.org/v1.17/) |
| Synapse | homeserver 实现，持有服务端状态；生产配置、数据库与备份仍需运维。[固定说明](https://github.com/element-hq/synapse/blob/v1.162.0/README.rst) |
| Element Web/Desktop | 客户端产品与平台适配；候选 A 使用同仓库的 `apps/desktop/`，不基于旧归档桌面仓库开发。[固定树](https://github.com/element-hq/element-web/tree/v1.12.30/apps/desktop) |
| MatrixRTC / Element Call | 通话参与、发现与媒体接入；所需 MSC、homeserver 与客户端支持必须匹配。[Call 固定自托管说明](https://github.com/element-hq/element-call/blob/v0.26.0/docs/self_hosting.md) |
| RTC auth / SFU | 授权服务将 Matrix 身份/房间映射至 LiveKit JWT；SFU 转发媒体，不能另建独立成员权威。[固定 RTC auth](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/README.md) |
| TURN / 网络 | 解决受限网络的媒体中继；HTTPS 健康检查通过不证明 UDP、强制中继或中德链路通过。[LiveKit 端口](https://docs.livekit.io/transport/self-hosting/ports-firewall/) |

## 3. 固定候选版本，尚不是兼容组合签收

| 组件 | 固定源码 commit | 许可来源 |
|---|---|---|
| Element v1.12.30 | `f19cfd9030429240a4209bf5175b372175cf0464` | [README](https://github.com/element-hq/element-web/blob/v1.12.30/README.md)：AGPLv3+ / GPLv3+ / 商业 |
| embedded Element Call v0.26.0 | `71593f1a245b1afa971e3940596e1c500edf9548` | [README](https://github.com/element-hq/element-call/blob/v0.26.0/README.md)：AGPLv3+ / 商业 |
| matrix-js-sdk v43.0.0 | `5723f58cb8675398970fc2945819ae0f4b7c1b58` | [package.json](https://github.com/matrix-org/matrix-js-sdk/blob/v43.0.0/package.json)：Apache-2.0 |
| Synapse v1.162.0 | `63dc0cbfe514f60743212566374ffeb5e9e295c2` | [README](https://github.com/element-hq/synapse/blob/v1.162.0/README.rst)：AGPLv3+ / 商业 |
| lk-jwt-service v0.9.0 | `0e176b1eca44e67b11484d0bdf56999807bf2b8e` | [Cargo.toml](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/Cargo.toml)：AGPL-3.0-only |
| LiveKit SFU v1.13.4 | `0b3fd288e3ef3263ec475ba0d78cf3ad77459981` | [LICENSE](https://github.com/livekit/livekit/blob/0b3fd288e3ef3263ec475ba0d78cf3ad77459981/LICENSE)：Apache-2.0 |

Element 的 [固定 package.json](https://github.com/element-hq/element-web/blob/v1.12.30/apps/web/package.json) 直接声明 SDK `43.0.0` 与 embedded Call `0.26.0`，不能混入 `0.26.1` 后仍声称这是原组合。
RTC-E1 不再选 v0.8.0；v0.9.0 的 Cargo package version 仍为 `0.6.0`，不能只看运行版本字符串确认来源。固定 Call 的[自身锁文件](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/pnpm-lock.yaml)含 SDK `42.2.0` / commit `24929be0e741be6a5d0a7226f1c682e245263b8a`；不能把 Element 顶层 SDK43 当成全部传递依赖。[embedded npm 0.26.0 元数据](https://registry.npmjs.org/@element-hq/element-call-embedded/0.26.0) 的 gitHead 对应该 Call commit；运行包的完整依赖、构建来源和许可仍须 M04/M05 核对。

RTC-E1 的 Linux/amd64 镜像候选由官方 registry manifest 核对；部署用右列平台摘要，启动后另核实际 image ID/平台/版本，不能只相信 tag：

| 官方镜像 | index digest | Linux/amd64 digest |
|---|---|---|
| `ghcr.io/element-hq/lk-jwt-service:0.9.0` | `sha256:d210fd778ba38b7e42e6fc64e8a24a7d66ccc3b938fb20d73bd713224af2dfea` | `sha256:2c985ab98de8da3b101c09fb597404dcb2723bb984b1ee20a430a8bb4f6a51a9` |
| `docker.io/livekit/livekit-server:v1.13.4` | `sha256:189f7c81b704a36642bc5c7e2d3e1ae83744627c11978a23a251bf19fbec64e0` | `sha256:f63579e294b6dbf38e0e6151a24a5b425e9293e75e6d41959f470c957248b8a7` |

来源为 [GHCR manifest](https://ghcr.io/v2/element-hq/lk-jwt-service/manifests/0.9.0) 与 [Docker Hub manifest](https://registry-1.docker.io/v2/livekit/livekit-server/manifests/v1.13.4)；仅查询公共元数据，未拉取镜像层或运行服务。现有 Synapse/Element/PostgreSQL 摘要保留于 [控制面 compose](../infra/staging/matrix-proof/compose.yaml)，该四文件范围不因此扩为 RTC。新反向代理/TLS 配置及完整发货 SBOM 仍未固定；本表不作法律结论。

TURN 首选同版本 LiveKit 的[内置实现](https://github.com/livekit/livekit/blob/0b3fd288e3ef3263ec475ba0d78cf3ad77459981/pkg/service/turn.go)，复用同一平台摘要，不另加 coturn。TLS/UDP/relay 的精确端口、域名/证书和必要 peer CIDR 例外须在资源盘点后固定，不默认开放私网或公网端口。源码支持不是运行证明；必须观察实际 relay candidate pair、双向媒体及退出，不能以健康检查或 Allocate 成功代替。

该版本 [roommanager.go](https://github.com/livekit/livekit/blob/0b3fd288e3ef3263ec475ba0d78cf3ad77459981/pkg/service/roommanager.go) 在 TURN TLS 启用时向客户端发布 `turns:<domain>:443?transport=tcp`，不能仅开放内部配置的5349。单公网IP同时承载HTTPS/WSS443与TURN/TLS443时，须明确并实测L4/SNI分流或独立入口；普通HTTP反代不能转发TURN协议，也不能让两个监听者抢同一端口。

## 4. RTC 候选拓扑与风险

RTC-E1 首选候选：固定 Element 内嵌 Call 的 compatibility 路径 → 直接 `/sfu/get` → 配好 AS 的 auth v0.9.0 → 独立 LiveKit 主机。这是待实验的兼容路径，不新增客户端补丁；其旧接口 deprecated，升级到 mediated 模式需另做字段/撤销/回归验证。

| 边界 | 固定候选与必须观察的事实 |
|---|---|
| 发现 | Synapse transports registry 公布 `type: livekit`、`livekit_service_url`。不能把只有 `url` 的新 managed 配置当成旧 Call 可识别；实际 Windows 包必须记录选中的 transport 与请求路径。 |
| Call 模式 | 固定 `matrix_rtc_mode: compatibility` 走 `/sfu/get`；`matrix_2_0` 的直接 `/get_token` 另有路径，不混入首轮结果。默认值与真实包行为仍分别验证。 |
| 新 mediated 反证 | SDK43 相关请求用嵌套 `member.id/claimed_device_id`，auth v0.9 对应新 C-S 请求需要顶层 `member_id`；Synapse 代理不转换 body。C-S `/rtc/livekit/get_token` 与直接 `/get_token` 不混称；只开 MSC4502/4512 不能证明兼容。 |
| 成员权威 | AS 注册与 `LIVEKIT_FULL_ACCESS_HOMESERVERS` 必须绑定恰好一个相同测试 homeserver；通配或多个 homeserver 会失去旧接口的成员检查。候选验证器必须在未配置、错 homeserver 或成员状态不可读时拒绝运行，不退回无成员校验模式。 |
| 临时凭据 | 上游 3600 秒 SFU JWT 是观察到的签发寿命，不是本项目生产政策或主动撤销窗口。新票拒绝、旧票重用、已连接参与者三项分别测；不能用踢出 UI 代替 SFU 证据。 |

auth的 [OpenID 验证实现](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/src/helper.rs) 会请求 Matrix federation `/_matrix/federation/v1/openid/userinfo`；无显式端口时先查 `/.well-known/matrix/server`，没有有效委派则回退8448。因此客户端HTTPS登录通过不证明auth能验证身份；应固定可达的委派与最小OpenID入口，不因此开放完整联邦或跳过证书校验。

固定实现来源：[Call 发现](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/src/state/CallViewModel/localMember/RtcTransportAutoDiscovery.ts)、[模式](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/src/config/ConfigOptions.ts)、[直接请求](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/src/livekit/openIDSFU.ts)、[auth 请求结构](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/src/requests.rs)、[auth handler](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/src/handler.rs)、[Synapse 代理](https://github.com/element-hq/synapse/blob/63dc0cbfe514f60743212566374ffeb5e9e295c2/synapse/rest/client/appservice_proxy.py)。Call 的[开发 compose](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/docker-compose-dev.yml)关联 LiveKit1.13.4，却同时选 auth0.7/Synapse develop；不能当成本候选联调证据。delayed events、state-after、transports registry 与 AS 能力仍须逐项验证。

### RTC-E1 隔离实验候选与出口

资源与具体运行范围见 [04 的本次 RTC-E1 记录](04-open-decisions.md#matrix-rtc-e1-2026-10-15)。当前只形成文档候选，新的 RTC 实现 Allowed Files 为 **none**；新模块清单须单独范围 PR 审查签认。不能改现有四文件 proof 的无媒体合同。

2026-10-15腾讯云控制台与现有免密会话实查：账号仅显示一台运行中的首尔2核/4GB Ubuntu24.04主机，已有其他控制面/门户/VPN相关服务，根盘仅余743MiB。它不满足本项目媒体分机边界，不能以CPU空闲或新开容器代替专机。现有两域名可管理，但RTC专用DNS、证书和独立媒体入口尚未配置；当前网站HTTPS也不自动覆盖新增子域名。具体资源与TLS实测结果只记在04，不复制账号、客户端IP或凭据。Jack确认暂无独立主机，先完成部署和测试准备；所有RTC运行保持NOT_RUN。

R0正向签票也有运行依赖：auth的[成员分支](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/src/handler.rs)会调用LiveKit RoomService创建房间，不能宣称完全无SFU即可跑通。上游[成员测试](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/e2e-tests/tests/standalone_membership.rs)及[信令辅助代码](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/e2e-tests/src/lib.rs)可参考断言，但其[compose](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/e2e-tests/docker/docker-compose.yml)使用develop/latest、未限定loopback端口并关闭部分TLS校验，[Synapse fixture](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/e2e-tests/docker/homeserver-a.yaml)还开放免验证注册；不得原样作为本项目部署基线。无媒体协商的信令测试与实时媒体阶段分开签认；可信TLS、固定镜像、隔离与精确范围未落实前均不运行。

1. **R0 身份/授权**：两个合成成员与一个 outsider，私房直接 API；错房/错主体/未成员/被踢后新票拒绝，记录 HTTP/errcode 与实际 JWT room/identity/grants，秘密脱敏。这里尚未证明媒体。
2. **R1 闭麦接入**：同一固定 Windows 包两端入房，初始无轨道、无设备采集；实际发现、签票、WSS 和 SFU participant identity/room 一致，离开后会话清理可观察。
3. **R2 合成媒体**：仅专门获准的合成轨道，真实两端 SFU 收发、独立音量、取消晚到/重连/退出释放；强制 TURN relay 单列，不用直连通过替代。
4. **R3 实物 G1**：两台真实 Windows 的游戏画面/系统声音/独立麦克风、物理释放与无数字回授；真人、中德高峰和负载仍依原 G1/G4，不由合成轨道替代。

任何 auth 负向放行、凭据泄露、未知资源归属、摘要不符、无可信 TLS 或媒体共置立即停止。生产 TTL/限流/撤销窗口在实验后由 Jack 另签，不在此猜值。旧票/活动参与者撤销有缺口时记录 FAIL，不提前关闭 M10/M29 或扩大 UI。

后续窄实施票应固化以下断言，全部是**待执行测试设计**，不计入本轮通过数：

| 用例 | 可检查的通过条件 |
|---|---|
| 成员正向 | 真实OpenID、已加入私房；`/sfu/get`返回200，JWT身份/房间/最小grants匹配；LiveKit实际接受信令，初始零媒体轨道。 |
| 未加入／仅受邀／错房 | 使用真实身份请求另一已存在、但该主体未获准的私房，403／`M_FORBIDDEN`且没有JWT或SFU参与者；不把未知房间或网络错误当权限证据。 |
| 错OpenID或主体 | 请求被拒绝、无凭据或参与者；HTTP/errcode按固定实际接口断言，不把网络故障当权限拒绝。 |
| 被踢后的新请求 | Matrix成员状态已为leave，新`/sfu/get`拒绝；旧JWT重连与已连接参与者另记，任何撤销缺口为FAIL。 |
| AS缺失／通配／多homeserver | 本项目运行入口在发请求前拒绝不安全配置，不能利用上游full-access行为跳过成员检查。 |
| TLS／端口／摘要错误 | 严格校验失败即停止；无跳过校验、换端口、杀占用者、回退浮动tag或重置预算。 |
| TURN强制中继 | 记录实际选中relay candidate pair、两端合成音频收发；单纯Allocate、health或直连成功不通过。 |
| 退出与清理 | 验证总预算120秒／HTTP≤10秒／脚本清理≤60秒；只停绑定归属的资源，保留证据/数据；未知归属为UNKNOWN，产品退出目标仍按原规格独立验证。 |

准备顺序为：先完成这两文档与独立审查；安全TLS/两节点与访问方落实后，单独范围PR逐个列控制面/auth/AS、媒体/TURN、TLS及验证器文件并签认；随后实现和执行R0→R1→R2。本轮只运行既有`proof.mjs self-test`及文档守卫，尚不存在RTC运行命令；不得把拟定命令、上游测试或待定文件清单当已实施。

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

### 2026-10-16 同机 R0 候选例外

Jack 随后明确允许使用现有腾讯云实例做 RTC；这更新了 §4 中该实例的分机阻塞判断，不将 Docker 隔离等同于独立机器。当前只准备零媒体 R0 的同机候选：范围与资源合同见 [matrix-rtc-proof](../.agents/modules/matrix-rtc-proof.md)，新实查及授权见 [04](04-open-decisions.md#matrix-rtc-e1-same-host-2026-10-16)。此前日期的观测保留。
七个未来运行文件仍未实施；独立范围 PR、签认与可信合并前不运行。可信 TLS、域名/loopback 精确端口、代理摘要及访问方仍须核定；不开放 TURN、新增公网端口或改旧服务。R0 必须真实验证成员授权与 LiveKit 信令且零媒体轨道；R1–R3、完整 G1/G4 和生产能力仍未验收。

### R0 凭据边界修订候选

[Matrix v1.19](https://spec.matrix.org/v1.19/server-server-api/#get_matrixfederationv1openiduserinfo)要求OpenID userinfo的 `access_token` 为query参数；固定[auth helper](https://github.com/element-hq/lk-jwt-service/blob/0e176b1eca44e67b11484d0bdf56999807bf2b8e/src/helper.rs#L642)确实这样发送，传输失败又将错误链写入ERROR，可能包含完整请求URL。因此“全部token不得进URL”与该标准路径冲突，可信TLS也不证明日志无泄漏。固定[Synapse OpenID存储](https://github.com/element-hq/synapse/blob/63dc0cbfe514f60743212566374ffeb5e9e295c2/synapse/storage/databases/main/openid.py#L28)及[会话存储](https://github.com/element-hq/synapse/blob/63dc0cbfe514f60743212566374ffeb5e9e295c2/synapse/storage/databases/main/registration.py#L2749)还会持久化必要认证状态，不能承诺所有服务只在内存保留token。

仅新R0的候选替代边界、精确OpenID query例外、验证器内存限制、受保护合成DB以及日志哨兵准入统一维护在[模块清单](../.agents/modules/matrix-rtc-proof.md#r0-凭据传输与日志准入修订候选待签认)。这是待签认修订，未解决日志实施方案，未运行或证明无泄漏；原实验及T1/T2凭据合同不因此改变。

后续stock Call也不能沿用绝对URL禁令：固定[Call lockfile](https://github.com/element-hq/element-call/blob/71593f1a245b1afa971e3940596e1c500edf9548/pnpm-lock.yaml#L184)锁定livekit-client2.22.3，其[SignalClient](https://github.com/livekit/client-sdk-js/blob/v2.22.3/src/api/SignalClient.ts#L1360)在WSS `/rtc`或`/rtc/v1`及握手失败的HTTPS验证请求中使用query。R0验证器可用Bearer header，但不证明stock包路径；R1的端点例外、日志与实际包行为须另行审查签认，当前不授权执行。

### 标准 R0 精简候选（2026-10-16）

固定[auth v0.9.0](https://github.com/element-hq/lk-jwt-service/blob/v0.9.0/src/helper.rs#L595-L625)的OpenID请求硬编码30秒；客户端发现也是30秒，Twirp未证实总timeout。因此stock组件不满足旧“所有内部HTTP≤10秒”，客户端Abort也不证明上游已停止。候选保留客户端10秒与整个任务120秒外界期限，使用标准systemd/Compose并先验证失败/停止行为；具体修订见[模块候选](../.agents/modules/matrix-rtc-proof.md#标准组件精简修订proposed尚未替换原合同)。

本机Node为24.13.0；其[内置WebSocket](https://github.com/nodejs/node/blob/v24.13.0/deps/undici/src/lib/web/websocket/websocket.js)接受Undici扩展的第二参数 `{headers: {Authorization: 'Bearer …'}}`，[握手源码](https://github.com/nodejs/node/blob/v24.13.0/deps/undici/src/lib/web/websocket/connection.js)把header送入请求。可去掉手写RFC6455，不增加SDK或token query，也不启动ICE/媒体；默认TLS校验保持，仍须实测Bearer、零query、TLS负例及JoinResponse。公开 `close()` 不保证限时销毁socket，不能代替停止实证；这不是stock Element/Call或完整RTC客户端验收。

现有专用WSL可响应归属检查、Docker29.9.0/cgroup v2查询，原控制面三容器均exited；观测到swap4GB和 `|/wsl-capture-crash %t %E %p %s`。微软[collector源码](https://github.com/microsoft/WSL/blob/b275ed2f6b66e3e0c515be781aafe4661900cd91/src/linux/init/init.cpp)会转送core，宿主[接收器](https://github.com/microsoft/WSL/blob/b275ed2f6b66e3e0c515be781aafe4661900cd91/src/windows/service/exe/WslCoreVm.cpp)可落盘；这是固定上游源码，未证明本机二进制版本完全对应。Linux管道core不受普通`LimitCORE=0`保护；`MemorySwapMax=0`也只约束对应cgroup，不能证明整个宿主零落盘。故不为补绝对memory-only承诺再造wrapper或全局修改WSL；是否接受合成实验OS持久化例外须Jack明确裁定，未知权限/路径仍HOLD。

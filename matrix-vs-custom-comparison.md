# 原自研通信层方案 vs Matrix 方案 对比

> 日期:2026-09-27
> 用途:Babacom 通信层选型的历史决策参考。原引用 `communication-layer-notes.md` 未随固定提交提供；下文保留原三平面方案和 Matrix 学习笔记的比较。
> 结论先行,细节在后。
>
> 2026-10-13 整合注：原稿和作者历史保留，以下仍是 2026-09-27 的选型判断。合入后的当前 [PRD](docs/PRD-matrix-migration.md) 与 [版本/部署差异](docs/Matrix-protocol-research.md#版本与部署差异) 为新增入口。邀请注册、联邦“留空”、E2EE/AS 责任、候选维护状态、近零工作量和 4–6 人说法按差异段核对，不直接复制为运行配置、排期或验收阈值；实际 10 语音/1 共享/9 观看/≥2 小时与 G1 要求保持。

---

## 0. TL;DR(结论)

1. **媒体层两条路其实是同一条路**:都要 LiveKit(SFU)扛音视频/屏幕共享。真正的差异不在媒体,在「消息 + 信令 + 身份 + 同步」这一层。
2. **这一层,Matrix 是成熟成品,原方案要自研数周~数月**——尤其是 E2EE、多设备、离线补齐、消息编辑/撤回/reaction/线程,每一项单独拎出来都是「看起来简单、做对很难」。
3. **对 25 人封闭圈,建议:自托管一个 homeserver + Element Call(LiveKit SFU)**,而不是自研协议层。
4. 代价要认清:Matrix 不是免费午餐——你要付「homeserver 选型与运维」+「把它从『全球开放联邦』改造成『封闭私有部署』」+「理解事件 DAG/状态解析的复杂度(仅当你深度二次开发时)」三笔账。

---

## 1. 两个方案各是什么

### 原方案:自研三平面(见 communication-layer-notes.md)

| 平面 | 走什么 | 干什么 |
|---|---|---|
| 控制面 | HTTP/REST + Postgres | 命令/查询:登录、邀请、频道、消息历史、上传、语音 join 前置校验 |
| 事件面 | 裸 `ws` + 自建信封 | 服务器推送:新消息、编辑/删除、typing、reaction、presence、未读 |
| 媒体面 | WebRTC → LiveKit(SFU) | 语音/视频/屏幕共享的音视频流,客户端直连 SFU |

自研重点:契约 #2(HTTP API)、#3(WS 事件)、#6(LiveKit token)+ 模块 7.1(实时网关)、7.2(token 签发/限流)。

### Matrix 方案:自托管 homeserver + 现成客户端

| 层 | 用什么 | 干什么 |
|---|---|---|
| 身份/房间/消息/历史 | 自托管 **homeserver**(Synapse / Dendrite / Conduit) | 账号、房间、事件存储、`/sync` 离线补齐、E2EE |
| 客户端 | 现成 SDK(matrix-js-sdk 等) | 不自己写协议,用 SDK 说话 |
| 媒体 | **MatrixRTC / Element Call → LiveKit(SFU)** | 音视频/屏幕共享,信令 + E2EE 现成,媒体仍走 SFU |

---

## 2. 逐功能域对比(核心表)

对照你 scope.html 的 84 项功能和三份契约:

| 功能域 | 原方案(自研)要做的 | Matrix 现成对应 | 结论 |
|---|---|---|---|
| **账号 / 登录** | 自建 login + HttpOnly cookie + CSRF | homeserver 内置 `login`/`register` + `access_token`(或 OAuth 2.0) | Matrix 省 |
| **邀请制注册** | 自建(仅邀请,无开放注册) | homeserver 关开放注册 + 邀请流程,天然支持 | 平手(都要配,但 Matrix 有现成开关) |
| **消息发送 / 历史分页** | 自建 REST + Postgres 游标分页 `?before=` | `PUT /send` + `GET /messages`(原生游标 token 分页) | Matrix 省 |
| **实时推送 + 断线续传** | 自建裸 ws + 信封 + `seq`/resume + 事件日志 + Redis fan-out | `GET /sync` 长轮询(原生增量 + `since` token 续传) | **Matrix 大省**(这是原方案投入最大的地方) |
| **消息编辑 / 撤回** | 自建(编辑 + 撤回语义) | `redaction` + 聚合关系 `m.replace`(原生) | Matrix 省 |
| **reaction / 线程** | 自建(scope 里两个「贵功能」) | `m.annotation` + `m.thread`(原生) | **Matrix 大省**(这俩是 PRD 里明说的贵功能) |
| **typing / 已读 / presence** | 自建 WS 事件 | 原生端点(typing / receipts / presence) | Matrix 省 |
| **权限 `can(user,action,channel)`** | 自建权限原语(契约 #5) | `m.room.power_levels`(内置);细粒度自定义仍要自己套 | 平手偏 Matrix(基础内置,细粒度需二次封装) |
| **E2EE** | **原方案未覆盖**,要自研(最难一块) | Olm/Megolm + cross-signing + key backup,全内置 | **Matrix 大省**(自研 E2EE 是数月的密码学工作) |
| **多设备 / 离线补齐** | 自建(复杂:每设备游标 + 快照) | 原生(device_id + sync 游标) | Matrix 大省 |
| **文件 / 媒体上传下载** | 自建上传 + 存储 + 缩略图 | `/media` 上传下载 + `mxc://` + 缩略图 | Matrix 省 |
| **音视频 / 屏幕共享** | WebRTC → LiveKit + 自建信令 + token 签发 + webhook 回流 | MatrixRTC/Element Call → LiveKit(信令 + 成员 + E2EE 现成) | 平手偏 Matrix(媒体都是 LiveKit,但 Matrix 把信令/E2EE 也包了) |
| **推送通知(移动端)** | 自建 | Push Gateway(现成) | Matrix 省(仅做移动端才有意义) |
| **契约 #2 HTTP API** | 自建 REST + 共享 zod/OpenAPI | Client-Server API 现成规范 + SDK | Matrix 省 |
| **契约 #3 WS 事件** | 自建信封 + 冻结事件清单 | `/sync` + 事件类型体系(现成) | Matrix 省 |
| **契约 #6 LiveKit token** | 自建 voice/join + `can()` + JWT 签发 | MatrixRTC token 流程(现成,含 SFU 自动发现) | 平手(都要签 token,Matrix 有现成实现) |

**一句话**:原方案里你(负责的)三份契约 #2/#3/#6 + 两个模块 7.1/7.2,几乎全部被 Matrix 的「homeserver + SDK + MatrixRTC」覆盖;而 E2EE、多设备、编辑/reaction/线程这些原方案「先不做或后面补」的东西,Matrix 是开箱即用。

---

## 3. 架构图对比

### 原方案(自研三平面)

```
浏览器 ──TCP 443──► Caddy ──► App(自建 HTTP + 自建 WS 网关)──► Postgres
                                        │
                                        └──SDK──► LiveKit(签 token + 收 webhook)
浏览器 ──UDP 50000──► LiveKit SFU(自建信令闭环:签 token → 连 SFU → webhook 回流)
```

### Matrix 方案

```
浏览器(现成 SDK)──TCP 443──► Caddy ──► Homeserver(Synapse/Dendrite/Conduit)
                                              │ 账号/房间/消息/E2EE/同步
                                              ├──► Postgres(Synapse 自带存储)
                                              └──► 联邦(可关)
浏览器(Element Call)──TCP/UDP──► LiveKit SFU(MatrixRTC 信令,现成)
```

**结构几乎同构**——差别在于中间那个「App」:原方案是你要从零写的 HTTP+WS 网关,Matrix 方案是一个成熟的 homeserver。

---

## 4. 工作量与复杂度对比

| 维度 | 原方案 | Matrix |
|---|---|---|
| **协议层工作量** | 高(HTTP API + WS 信封 + 事件日志 + resume + 权限 + E2EE + 多设备…) | ~零(用现成) |
| **媒体层工作量** | 中(自建 LiveKit 信令 + token + webhook) | 低(MatrixRTC 现成) |
| **运维复杂度** | 低(组件你都熟:Caddy/Postgres/Redis/LiveKit) | 中(homeserver 是新组件,要选型、调优、升级) |
| **「关掉多余能力」成本** | 无(天生贴合场景) | 中(要关联邦、限制注册、隐藏公开目录) |
| **深度定制学习成本** | 无(自己写的当然懂) | 高(事件 DAG、状态解析、联邦语义,见 `Source/06`、`Source/02`) |
| **风险来源** | 自研进度 / 协议设计失误 | 外部依赖黑盒 / 版本升级 / 与 Matrix 生态绑定 |

---

## 5. 关键权衡(诚实列两边)

### Matrix 的代价(容易被「开箱即用」掩盖)

1. **homeserver 是重依赖**。Synapse 成熟但资源占用大(Python);Dendrite/Conduit 轻但生态兼容性略弱。25 人场景三者都能扛,但「选型 + 调优 + 升级」是持续成本。
2. **协议面向「全球开放联邦」,你是「封闭 25 人」**。你需要主动关掉一堆东西:关开放注册、不公开房间目录、封住联邦端口(8448)/`federation_domain_whitelist` 留空。这部分是「逆向使用」,文档默认假设你要开放。
3. **事件 DAG + 状态解析是真实复杂度**。若你只是「自托管 + 用 SDK」,几乎不用碰;一旦要深度改内核(自定义事件、改权限语义、桥接),学习曲线陡(见 `Source/06-room-versions.md` 的演进史就知道这玩意修了 12 版)。
4. **媒体要走对路**:Matrix 原生 full-mesh 呼叫(`m.call.*`)只能撑 4~6 人,**不适合你 25 人一起开黑**。必须走 MatrixRTC/Element Call(LiveKit SFU)路线,这仍是相对新的东西,且 Sliding Sync/MatrixRTC 在 v1.19 里**尚未完全稳定落地**(见 `Source/11-changelog.md`)。

### 原方案的代价

1. **每一块都要自己造对**,尤其这几块自研难度被低估:
   - **E2EE**(原方案根本没列)—— 正确的双棘轮 + 密钥分发 + 多设备 + 备份,是数月密码学工程,自研基本不现实;
   - **离线同步/多设备** —— 你的 `seq`/resume 方案能覆盖「断线重连」,但「多设备各自游标 + 状态快照 + 消息去重」的完整语义很复杂;
   - **编辑/撤回/reaction/线程** —— scope 里明说的「贵功能」,Matrix 原生。
2. **单人 13–16 周**(scope 估算)里,通信层是地基,卡着后面所有东西;地基自研越久,上层越晚启动。

---

## 6. 关键洞察:媒体层两条路是「合流」,不是「分叉」

这是最容易误解、也最决定选型的一点:

- 你原方案的拳头功能(1440p60 屏幕共享、25 人语音)靠的是 **LiveKit SFU**;
- Matrix 方案的媒体层,**用的也是 LiveKit SFU**(MatrixRTC/Element Call 的 MSC4195);
- 也就是说,**换 Matrix 不等于丢掉你之前对媒体层的全部判断**——「TCP 扛信令 / UDP 扛媒体」「单 UDP 端口」「TURN/443 兜底」「先实测跨境丢包再定参数」这些结论**原样保留**。

Matrix 真正替换掉的,是**媒体之外的那一坨**:信令、身份、成员关系、消息历史、E2EE、多设备。而这些恰好是原方案里「投入最大、最没差异化价值」的部分。

---

## 7. 决策建议

### 推荐:自托管 homeserver + Element Call

- **homeserver 选型**:25 人封闭圈,轻量优先 → **Dendrite**(Go,官方二代)或 **Conduit**(Rust,极轻);若想最大兼容 Element 全家桶 → **Synapse**。资源都不是问题,选型点在于「你要不要 Element 生态的完整兼容」。
- **媒体**:Element Call(或自集成 `matrix-js-sdk` 的 MatrixRTC 能力)+ 自托管 LiveKit SFU,沿用你已有的 UDP 单端口/TURN 部署结论。
- **封闭化改造**(必做清单):关开放注册(仅邀请)、不暴露联邦端口、隐藏公开房间目录、自托管媒体(LiveKit)而不依赖公网 Focus。

### 不推荐:继续自研协议层

除非你的目标是「学习通信协议本身」或「协议层是产品差异化的一部分」,否则 25 人圈子的协议层没有自研的杠杆——它是纯成本,而 Matrix 已经把它做成了免费的开源成品。

### 一个中间态(如果想折中)

**「用 Matrix 内核,但只保留你要的部分」** 是可行的:很多 homeserver 允许关闭联邦、限制注册、自定义 `power_levels` 映射你的权限模型;媒体层甚至可以不用 Element Call 前端,而直接用 `matrix-js-sdk` 的 MatrixRTC 接口接你自己的 UI——这样你拿到「协议 + E2EE + 同步」的成熟内核,仍保留产品外观的自定义权。

---

## 8. 下一步建议(若要落地)

1. **PoC 先证媒体**(对齐你 notes 里的「先证网络」):海外盒跑 LiveKit + Element Call,国内+欧洲各一真人,北京时间 21:00 实测游戏串流,量丢包/延迟——这个数字两条路都决定成败,先做它。
2. 起一个 Dendrite/Conduit 单实例,关联邦、限注册,用 `matrix-js-sdk` 拉一个最小聊天客户端,验证「账号 + 房间 + 消息 + 同步 + E2EE」闭环。
3. 验证 MatrixRTC 的屏幕共享(最高 1440p60 是你产品的核心指标,务必单独压测,别只看普通视频通话)。
4. 若媒体/E2EE/同步都过关,再决定 homeserver 最终选型,并把你 `communication-layer-notes.md` 里「三条平面」的部署契约改写成「homeserver + LiveKit」版。

---

## 参考文件

- 原方案:`../communication-layer-notes.md`
- PRD:`scope.html`、`teams.html`(同目录)
- Matrix 学习笔记:`Source/README.md`(索引)、`Source/01-client-server-api.md`、`Source/02-server-server-api.md`、`Source/06-room-versions.md`、`Source/07-olm.md`、`Source/08-megolm.md`、`Source/11-changelog.md`

# 规范总览(Matrix Specification Overview)

> 原文:https://spec.matrix.org/v1.19/
> 规范版本:v1.19 · 类型:概述

## 一句话概述

Matrix 是一套用于**去中心化通信**的开放 API 集合,目标是在「全球开放联邦、无单一控制点」的服务器网络上安全地发布(publish)、持久化(persist)与订阅(subscribe)数据;规范自身以「JSON over REST」为主,客户端通过 homeserver 收发事件,服务器之间通过联邦(federation)复制房间数据,最终一致地同步一个全局共享的、经过密码学签名的房间状态。

## 核心内容

### Matrix 是什么

规范原文给出的定义:Matrix 是 *"a set of open APIs for decentralised communication, suitable for securely publishing, persisting and subscribing to data over a global open federation of servers with no single point of control"*。

典型用例:即时消息(instant messaging)、VoIP 信令、IoT 通信、以及桥接(bridge)既有的通信孤岛(如 IRC、Slack、Discord 等)。

设计原则:

- **Pragmatic Web-friendly API**:JSON over REST,对 Web 开发者友好。
- **Simplicity**:尽量简单。
- **Full openness**:任何人都可以参与联邦,没有准入门槛。
- **User empowerment**:用户可自由选择服务器与客户端、掌控隐私、知晓自己数据存放在哪里。
- **Full decentralisation**:完全去中心化。
- **Learning from history**:从 XMPP、SIP、IRC、SMTP、IMAP、NNTP 等旧协议中汲取经验。

功能范围(functional scope):

- 无单点故障的分布式聊天室;
- 最终一致的、密码学安全的房间状态同步;
- 可扩展的消息,支持可选的端到端加密(E2EE);
- 基于 power level 的用户管理;
- 房间状态管理(名称、主题、成员等);
- 用户资料(profile)管理;
- 账户管理;
- 3PID(第三方标识,如邮箱/手机号)支持;
- 可信的 Identity Server 联邦,用于公钥发布与「3PID → Matrix ID」映射。

### 架构

规范整体由若干独立 API 组成:Client-Server API、Server-Server API、Application Service API、Identity Service API、Push Gateway API,以及 Room Versions 与 Olm / Megolm(加密)。

#### Clients(客户端)与 Homeservers

- 客户端(通常为消息/VoIP 应用或 IoT 设备)通过 **Client-Server API** 与其「homeserver」同步通信历史。
- 每个 homeserver 为自己的用户存储历史与账户信息,并通过 **Server-Server API** 与更广的生态共享数据。
- 服务器之间的这种同步被称为 **Federation(联邦)**。

数据流(client A → client B):

1. A 对自己的 homeserver 做一次 HTTP `PUT`,写入一个 JSON event;
2. A 的 homeserver 把该 event 追加到自己那份房间事件图(event graph)中,并对其**签名**以保证完整性;
3. A 的 homeserver 再通过一次 HTTP `PUT` 把 event 复制(replicate)给 B 的 homeserver;
4. B 的 homeserver 认证来源、校验签名、授权内容,然后加入自己的事件图副本;
5. client B 通过一个长连接 GET(long-lived GET)收到该 event。

#### CAP 取舍

规范明确写道:*"Matrix optimises for the Availability and Partitioned properties of CAP theorem at the expense of Consistency."* —— 即 **牺牲一致性(C),换取可用性(A)与分区容忍(P)**。

- 房间数据被复制到所有参与该房间的 homeserver 上,因此没有单一服务器「控制」或「拥有」某个房间;
- 事件图通过**最终一致(eventual consistency)**的方式同步。

#### Application Services 与 Identity Servers

- **Application Service**:独立的受信服务,可以像一个整体那样桥接外部系统(典型用途是 bridge),拥有独立的 Application Service API。
- **Identity Servers**:一个「全球联邦的、受信任的」服务集群,负责验证 3PID 并持久化/复制「3PID → 用户 ID」的映射。它们是**可选的**——没有 Identity Server,客户端就无法通过 3PID 查找用户。

### 核心概念

#### Users(用户)

每个客户端绑定到一个用户账户,用户由一个唯一的 **user ID** 标识,格式 `@localpart:domain`,并以分配该账户的 homeserver 作为命名空间(namespace)。

#### Devices(设备)

一个「设备」大致对应一台物理设备或一个独立的客户端应用实例:

- 同一台机器上的多个浏览器、同一部手机上的多个应用,各自算作不同设备;
- 设备主要用来管理 E2EE 密钥——每台设备持有自己的解密密钥副本;
- 也用于访问控制管理(例如吊销某台设备);
- Web 客户端通常在登出时丢弃状态、每次登录创建新设备;移动客户端在相同用户重新认证时可能复用同一设备;
- 每台设备有 `device_id`(在用户范围内唯一),可携带人类可读的显示名。

#### Events(事件)

- 所有交换的数据都表达为 event;**每个客户端动作通常对应一个 event**。
- 每个 event 有一个 `type`;type 值 MUST 遵循 Java 包命名约定做全局唯一命名,顶层 `m.` 命名空间保留给规范定义的 event(如 `m.room.message`)。
- **event body 被明确视为不可信数据(untrusted data)**:规范警告不要假设一个 event 一定具备所有期望的字段与类型(参见 MSC2801)。

#### Event Graph(DAG,有向无环图)

- 一个房间内的 events 构成一个称为「事件图」的 **DAG**,其偏序(partial ordering)提供时间顺序;
- 每个 event 列出 0 个或多个父事件(parent events)。通常只有一个父事件(发送时刻的最近消息),但竞争的 homeserver 可能产生多个后继,所以后续 event 可能列出多个父事件;
- 每个事件图有一个唯一的、没有父节点的**根事件(root event)**;
- 每个 event 上有 `depth` 元数据:正整数,严格大于其所有父事件的 depth;根事件的 depth 应为 1;若一个 event 先于另一个,其 depth 必须严格更小。

#### Rooms(房间)

- 房间是用户收发事件的「概念场所」,用形如 `!opaque_id:domain` 的 room ID 唯一标识;domain 仅用于全局命名空间,不表示房间所在位置。
- 联邦为每个房间维护共享的数据结构,分为两类:
  - **Message events(消息事件)**:瞬态活动,如即时消息、VoIP 呼叫建立、文件传输;
  - **State events(状态事件)**:对持久房间信息(名称、主题、成员、参与服务器)的更新,建模为每个房间的一张 key/value 表,key 是 `(state_key, event type)` 元组。

#### 状态解析(State Resolution)

- 某时刻的房间状态由「截至并包含某个 event 的所有 events」计算得出;
- 当多个 events 描述同一状态时,应用**合并冲突算法**;
- 规范强调:*"The state resolution algorithm is transitive and does not depend on server state."* —— 无论哪个服务器、以何种顺序接收,都必须选出相同的 event。

补充要点:

- Events 由发起服务器签名(签名覆盖父关系、type、depth 与 payload hash);
- 联邦采用**全网格(full mesh)拓扑**推送事件;服务器可从其他参与者 backfill(补拉)事件;
- 允许自定义 event type(如 `com.example.game.score`)。

#### Room Aliases(房间别名)

- 房间可有多个别名,格式 `#room_alias:domain`,作为人类可读的发现标签;
- 别名「指向」一个 room ID,映射不固定、可随时间变化;
- 客户端 SHOULD 只解析一次别名得到 room ID,后续请求都用 room ID;
- 解析别名还会返回一组可用于加入该房间的服务器列表。

#### Identity 与 Profiles(身份与资料)

- 一个 Matrix 身份 = Matrix user ID + 关联的第三方标识(邮箱、电话、社交账号);
- 用户可发布任意的资料 key/value 数据(显示名、头像 URL、联系方式);
- 用户还可在账户中存储任意的**私有** key/value 数据(客户端偏好、服务器无专属 API 的配置),通过一个与资料管理对称的 API 完成。

### 通用概念

#### Namespacing(命名空间)

- 防止应用与规范之间的冲突;`m.` 前缀标记规范控制的字段;
- 自定义命名空间 MUST 使用 Java 包命名约定(reverse DNS,如 `com.example.game.score`)。

#### Timestamps(时间戳)

- 毫秒级 Unix epoch(1970-01-01 00:00:00 UTC 起),**不含闰秒**,因此每天恰好 86,400,000 毫秒;
- 后果:闰秒期间时间戳可能重复。

### 规范版本号规则

#### 全局 vX.Y 方案

Matrix 以一个单一规范版本号 `vX.Y` 发布:

- **`X` 变化**:破坏性或大幅侵入性的变更(例如放弃 JSON、更换签名算法,或 `Y` 变化的大量累积)。由 Spec Core Team 决定何时递增;
- **`Y` 变化**:向后兼容(或「受管控的向后兼容」)的变更,通常是新特性。

连字符后可跟任意元数据(如 `v1.1-alpha`),用于预发布构建。规范提醒:虽然 `v1.2` 本意是对 `v1.1` 向后兼容,但**未来版本不保证对 `v1.1` 完全向后兼容**——例如 `v1.1` 引入、`v1.2` 弃用的端点,可能在 `v1.3` 被移除。

#### 每端点独立版本(Per-Endpoint Versioning)

所有 API 端点**各自独立**版本化。例如 `/v3/sync` 可被弃用并换为 `/v4/sync`,而不影响 `/v3/profile`;支持 `/v4/sync` 的服务器仍照旧提供 `/v3/profile`。当某个 MSC 提议对某端点做破坏性变更时,该 MSC 还应同时弃用现有端点(某些情况下隐式即可,微妙情况应显式弃用)。

#### 弃用政策(Deprecation Policy)

- 把一个东西从「stable」变为「deprecated」需要一份 MSC;
- 弃用「足够久(通常 1 个版本)」之后,才可通过另一份 MSC 移除;
- 实现方必须实现其所声明支持的规范版本中的已弃用功能。例:若 `/test` 在 `v1.2` 弃用、`v1.3` 移除,则声明支持 `v1.2` 的实现仍须实现 `/test`,而只声明 `v1.3` 的实现不必。

#### 历史版本方案(Legacy,历史)

- 统一方案之前,各 API 分别以 `rX.Y.Z` 版本化:`X` 破坏性、`Y` 向后兼容、`Z` 补丁;
- 当前全局方案从 `v1.1` 引入;
- Matrix 1.0 基于各 API 的特定版本:Client-Server API r0.5.0、Server-Server r0.1.2、Application Service r0.1.1、Identity Service r0.2.0、Push Gateway r0.1.0、Room Versions 1–5;
- 服务器不应在 `GET /_matrix/client/versions` 响应中返回 `v1.0`。

### 要求级别与许可证

- 规范使用 RFC 2119 关键词(MUST / SHOULD / MAY 等);某些整节是可选的(如 Client-Server API 的某些模块),要求级别仅在该节本身适用时生效。
- 许可证:Apache License, Version 2.0。

## 易混淆点 / 笔记

- **Room ID 的 domain 不含位置信息**:`!opaque_id:domain` 中的 domain 只做全局命名空间去重,不代表「房间住在这里」——这点与「用户 ID 的 domain 表示归属 homeserver」容易混淆(后者 domain 才是分配账户的服务器)。
- **Event 不可信**:所有 event body(包括来自自己 homeserver 的)都应按不可信数据处理,不要假设字段齐全、类型正确。
- **`depth` 是「严格大于父」而非「+1」**:并发分支会让 depth 跳变;它只保证先后关系的单调性,不等于精确序号。
- **`v1.0` 是「追溯定义」**:统一版本化从 `v1.1` 才开始;`v1.0` 只是用各 API 的旧 `rX.Y.Z` 版本拼出来的历史快照,服务器不返回它。
- **每端点版本独立**:不要以为「服务器支持 v1.19 规范」就意味着所有端点都在同一版本;每个端点(如 `/v3/sync`、`/v4/sync`)单独演进。

## 与自托管聊天项目(Babacom)的相关性

- **联邦模型决定数据归属**:自托管 homeserver 意味着自己拥有用户与房间数据副本,契合 Babacom「自己掌控数据」的定位;但要注意 CAP 取舍是 AP——房间状态是最终一致的,实现方需容忍短暂不一致。
- **核心抽象可复用**:Users / Devices / Events / DAG / Rooms / state resolution 是任何 Matrix 实现(客户端、homeserver 或 bridge)都必须落地的数据模型;Babacom 若做 homeserver,这些是地基。
- **版本号规则直接指导兼容策略**:端点的独立版本化 + 「弃用 1 个版本后再移除」意味着自托管服务升级时要保留对已弃用端点的实现,直到明确只声明新版本。
- **E2EE 由 Devices 承载**:设备粒度密钥管理是 E2EE 的前提,Babacom 的账户/设备模型需要与之对齐(参见 07-olm.md、08-megolm.md)。

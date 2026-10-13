# Server-Server API(联邦)

> 原文:https://spec.matrix.org/v1.19/server-server-api/
> 规范版本:v1.19 · 类型:API 参考 / 协议机制

## 一句话概述

Server-Server API(常称 Federation API / 联邦 API)定义了两台 Matrix homeserver 之间如何**发现彼此、交换签名密钥、互相认证请求、推送与回补房间事件、完成加入/邀请/离开握手**,以及如何对到达的事件做一整套校验,从而在没有中心权威的分布式拓扑下,让不同服务器上的用户处于"同一个房间"。

---

## 核心概念(PDU / EDU / Query、Transaction)

### 三种通信类别

| 类别 | 全称 | 含义 |
|---|---|---|
| **PDU** | Persistent Data Unit(持久数据单元) | "从一台 homeserver 广播给同一房间内其他服务器的**事件**";长期持久化、构成房间历史。因为 PDU 用源服务器私钥签名,可经第三方服务器中继转发 |
| **EDU** | Ephemeral Data Unit(瞬时数据单元) | "在**成对**服务器之间推送";不持久化、不属于房间历史、接收方**无需回复**(如 typing、presence、receipt 等) |
| **Query** | 查询 | 单次 HTTPS GET 请求/响应;不持久化、"不含长期意义的历史",只返回查询时点的快照(如 room_alias → room_id 映射) |

### Transaction(事务信封)

PDU 与 EDU 被打包进一个 **Transaction**,通过 HTTPS PUT 传输。事务"只对交换它的这一对 homeserver 有意义,并非全局意义"。

#### 端点:`PUT /_matrix/federation/v1/send/{txnId}`

- 方法 PUT;路径参数 `txnId`(string,必填,事务 ID)
- 需认证;不限速

请求体字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `origin` | string | 必填 | 发送此事务的 homeserver 的 `server_name` |
| `origin_server_ts` | integer | 必填 | 事务开始时源服务器上的 POSIX 毫秒时间戳 |
| `pdus` | [PDU] | 必填 | 房间的持久更新;**最多 50 个 PDU** |
| `edus` | [EDU] | 可选 | 瞬时消息;**最多 100 个 EDU**,无则可省略 |

EDU 对象 schema:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `edu_type` | string | 必填 | 瞬时消息类型 |
| `content` | object | 必填 | 瞬时消息内容 |

#### 批量限制

- 规范原文:"Transactions are limited in size; they can have **at most 50 PDUs and 100 EDUs**."(事务有大小上限:至多 50 个 PDU、100 个 EDU)
- `pdus`:"Must not include more than 50 PDUs.";`edus`:"Must not include more than 100 EDUs."

#### 200 响应:PDU Processing Results

```json
{
  "pdus": {
    "$failed_event:example.org": { "error": "You are not allowed to send a message to this room." },
    "$successful_event:example.org": {}
  }
}
```

- `pdus`(map,eventId → 结果,必填),key 为被处理的 PDU(event)ID
- 每个 PDU Processing Result 只有一个可选字段 `error`(string);无 `error` 即视为处理成功
- **即使个别 PDU 失败,也返回 200**:错误是逐条上报的,不使整个事务失败

#### txnId 语义与重试

- 原文:"The sending server must wait and retry for a 200 OK response before sending a transaction with a different `txnId` to the receiving server."
- 即:发送方在收到当前事务的 200 前,必须等待并重试**同一个 txnId**,不得推进到新 txnId。

### PDU 的两个关键字段:`prev_events` 与 `auth_events`

- **`prev_events`**:标识事件的"父事件",把房间内事件连成**有向无环图(DAG)** 建立偏序。发送方填入"它尚未见到子事件的所有房间事件"(即图的当前叶节点)。
- **`auth_events`**:标识"授予发送者发送该事件权限"的事件集:
  - `m.room.create` 的 auth_events 为空;
  - 其余事件应是房间状态的子集:`m.room.create`(视房间版本)、当前 `m.room.power_levels`、发送者当前 `m.room.member`;
  - 对 `m.room.member` 事件还需:目标用户当前 `m.room.member`、join/invite/knock 时的当前 `m.room.join_rules`、第三方邀请对应的 `m.room.third_party_invite`、restricted-room 加入时匹配 `content.join_authorised_via_users_server` 的 `m.room.member`。
- 注意:事件格式随房间版本不同而不同(见房间版本规范)。
- **特例**:`/backfill` 响应**不得**校验 `prev_events`/`auth_events` 的数量限制(历史兼容);`/send`、`/get_missing_events` 等仍须强制。

---

## 服务器发现与信任模型

### 服务器名解析链(把 server_name 变成 IP:端口)

1. **IP 字面量主机名**:直接用该 IP + 给定端口(无则 8448);目标须出示对该 IP 有效的证书。
2. **显式端口、非 IP 主机名**:经 CNAME/AAAA/A 解析,用解析出的 IP + 给定端口,`Host` 头为原 server_name(带端口);证书须对该主机名有效。
3. **`/.well-known/matrix/server` 查找**:对 `https://<hostname>/.well-known/matrix/server` 发起常规 HTTPS 请求;30x 重定向应跟随但避免循环;缓存默认建议 24 小时、上限 48 小时;错误缓存不超过 1 小时并鼓励指数退避。若响应有效,解析 `m.server` 为 `<delegated_hostname>[:<delegated_port>]` 再分子步骤处理:
   - 委托主机名是 IP → 用该 IP + `delegated_port`(无则 8448),证书对该 IP 有效;
   - 委托主机名非 IP、带端口 → CNAME/AAAA/A 解析,`Host` 头 `<delegated_hostname>:<delegated_port>`;
   - **[v1.8] 非 IP、无端口** → SRV 查找 `_matrix-fed._tcp.<delegated_hostname>`;`Host` 头为委托主机名;
   - **[弃用]** 回退 SRV `_matrix._tcp.<delegated_hostname>`;
   - 无 SRV → CNAME/AAAA/A 解析,端口 8448,`Host` 头为委托主机名。
4. **.well-known 出错时的 SRV 回退 [v1.8]**:`_matrix-fed._tcp.<hostname>`。
5. **[弃用]** `_matrix._tcp.<hostname>` 回退。
6. **最终回退**:CNAME/AAAA/A 解析 + 端口 8448,`Host` 头为原主机名;"目标服务器必须出示对该主机名有效的证书"。

> 为什么 SRV 回退用 `<hostname>` 而非委托主机名:DNS 无 DNSSEC 时不可信,委托方必须通过 TLS 证明其有效性(符合 RFC 6125 与 XMPP 实践)。

### `GET /.well-known/matrix/server`

- 返回一个字段:`m.server`(string)="要委托服务器间通信的服务器名,可带端口"。例:`{"m.server": "delegated.example.com:1234"}`。
- 不限速、不需认证;解析方应假定 body 是 JSON 而不管 Content-Type;JSON 无效/缺属性 → 降级到下一发现步骤,而非硬错误。

### TLS 要求

- 服务器间通信**必须走 HTTPS**。
- 目标服务器**必须提供由已知 CA 签发的 TLS 证书**。
- 请求方自选信任哪些 CA;强烈建议用 OS 信任库;可允许管理员覆盖,或对白名单域/网段(如 `.onion`)跳过校验。
- 应尽可能发送 SNI(IP 字面量不支持 SNI,除外);鼓励启用 Certificate Transparency。

### 端口 8448 vs 443

- **8448**:Matrix 联邦默认回退端口,用于所有未指定端口/无 SRV/无 .well-known 委托的情况;IANA 同时注册了端口 8448 与 `matrix-fed` 服务名。
- **443**:隐含用于最初的 `https://<hostname>/.well-known/matrix/server` 查找(普通 HTTPS 请求);后续委托解析若未得出其他端口,最终仍回退到 8448。

### 发布密钥:`GET /_matrix/key/v2/server`

每台 homeserver 在此发布公钥。不限速、不需认证、无请求参数/body。

200 响应 schema:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server_name` | string | 必填 | homeserver 的服务器名 |
| `verify_keys` | {string: Verify Key} | 必填 | 用于验证数字签名的公钥 |
| `old_verify_keys` | {string: Old Verify Key} | — | 服务器**曾用过**的密钥及其停用时间 |
| `valid_until_ts` | integer | 必填 | 该密钥列表应被刷新的 POSIX 毫秒时间戳 |
| `signatures` | {string: {string: string}} | 必填 | 用 `verify_keys` 对本对象签名的数字签名 |

- Verify Key 对象:`key`(string,必填,Unpadded base64 编码的密钥)。
- Old Verify Key 对象:`expired_ts`(integer,必填,密钥过期毫秒时间戳)+ `key`。
- **Key ID**:由 `algorithm:version` 组合而成,如 `ed25519:abc123`;version 部分须匹配正则 `[a-zA-Z0-9_]`。
- `verify_keys` 用于签名联邦请求;`old_verify_keys` **仅**用于验证事件。

### 密钥有效期

- `valid_until_ts` 在房间版本 1/2/3/4 中**必须忽略**。
- 后续版本:判断密钥是否有效时,取 `min(valid_until_ts, 现在+7 天)`;7 天上限是为了避免密钥"长时间有效却无法被 owner 撤销"。
- 超过计算上限的密钥**必须视为无效**(视房间版本规范)。

### 公证服务器(Notary / Perspectives 风格)

- 服务器可直接 `GET /_matrix/key/v2/server` 取键,也可经中间公证服务器 `/_matrix/key/v2/query/{serverName}` 取键。
- 公证服务器"通过 `/_matrix/key/v2/server` 从被查询服务器取键",并"用自己的密钥对响应签名"。
- 建议查询多个公证服务器互相印证;设计上"避免单一信任根",因为"每台服务器可自由选择信任哪些公证服务器"。
- **`POST /_matrix/key/v2/query`**(批量):请求体 `server_keys`(必填,外层 string 键为服务器名、内层 string 键为 Key ID;无 Key ID → 查所有键);每条查询可带 `minimum_valid_until_ts`(返回的键应至少有效到此时刻,缺省用当前时间)。响应 `server_keys` 为公证服务器签名的完整 Server Keys 对象数组;离线且无缓存键的服务器不会出现在结果中。
- **`GET /_matrix/key/v2/query/{serverName}`**(单个):路径参数 `serverName`,query 参数 `minimum_valid_until_ts`;响应 `server_keys`(该服务器的键,或无法到达且无缓存时为空数组)。
- 缓存指导:公证服务器应"缓存半个有效期的时长";源服务器应避免响应在 1 小时内过期;源失效时公证服务器"应继续返回最后一次收到的响应"。

> **TOFU**:规范中**未**使用 "trust-on-first-use" 一词;最接近的机制是上述公证/Perspectives 模型(自选信任的公证服务器 + 多源印证 + 缓存,使源服务器离线时仍能验证旧事件的密钥)。

---

## 请求与事件签名

### 请求签名:`Authorization: X-Matrix` 头

原文示例:

```
Authorization: X-Matrix origin="origin.hs.example.com",destination="destination.hs.example.com",key="ed25519:key1",sig="ABCDEF..."
```

四个参数:

- `origin` — 发送服务器的 server_name;
- `destination` — 接收服务器的 server_name(**v1.3 新增**);
- `key` — 发送方用于签名的密钥 ID(含算法名);
- `sig` — 按下述步骤算出的 JSON 签名。

头解析遵循 **RFC 9110 §11.4**:name=value 逗号分隔、名字大小写不敏感;值含 token 不允许的字符时须加引号,引号内可反斜杠转义(接收方须反转义);未知参数忽略。

#### 被签名覆盖的请求字段

请求方法、目标、body 通过"包进一个 JSON 对象"来签名:

```json
{
    "method": "POST",
    "uri": "/target",
    "origin": "origin.hs.example.com",
    "destination": "destination.hs.example.com",
    "content": <JSON 解析后的请求体>,
    "signatures": {
        "origin.hs.example.com": { "ed25519:key1": "ABCDEF..." }
    }
}
```

- `uri` 应含完整路径(从 `/_matrix/...` 起,含 `?` 与 query 参数),但**不含**开头的 `https:` 和接收方主机名。
- JSON 中的 `origin`/`destination` 使用**委托前**的 server_name("Delegation … do not affect these")。
- 请求无 body 时省略 `content`。

#### 签名验证

- 若 `destination` 存在但值不匹配接收服务器名,接收方须以 **401 Unauthorized** 拒绝。
- **响应不这样签名**:响应由 TLS 服务器证书认证。
- 可选:homeserver 可提供 TLS 客户端证书,接收方可校验其与源服务器证书一致。

### Canonical JSON(规范 JSON,签名用编码)

- 定义:"最短 UTF-8 JSON 编码,字典键按 Unicode codepoint 排序"。
- 约束:
  - 数字必须是 `[-(2^53)+1, (2^53)-1]` 范围内的**整数**,不带指数或小数点;
  - **禁止 `-0`**;禁止浮点值;
  - 字符串:仅允许未转义字符 `%x20-21 / %x23-5B / %x5D-10FFFF`(即除 ASCII 控制字符、`"`、`\` 外的所有 UTF-8 码点);仅允许特定转义(`\b \t \n \f \r \" \\` 及两个短 Unicode 控制形式);**禁止冗余转义**(如 `"日"` 必须规范化为 `"日"`);整数无前导零;`1e10` → `10000000000`、`-0` → `0`。
  - 房间版本 1–5 的事件可能出现超范围整数,服务器应尽可能宽容处理这类"非法" JSON。

### 事件签名 / 通用 JSON 签名算法(Signing JSON)

- "JSON 签名 = 把 JSON 对象**去掉 `signatures` 与归组在 `unsigned` 下的键**后做 Canonical JSON 编码,再用签名算法签名,结果用 Unpadded Base64 编码"。
- 签名密钥标识 = `签名算法:密钥标识`(当前唯一支持算法为 NACL 实现的 `ed25519`)。
- `unsigned` 对象与 `signatures` 对象**不被签名覆盖**。
- 伪代码要点:`pop("signatures")`、`pop("unsigned")` → 对剩余对象 canonical 编码并签名 → base64 → `signatures[signing_name][key_id] = sig` → 再把 `unsigned` 放回。
- **验签(Checking for a signature)7 步**:1) 检查 `signatures` 中是否有该实体条目(无则失败);2) 移除其不认识的算法对应的密钥标识(无剩余则失败);3) 从本地缓存或可信密钥服务器查找验证密钥(找不到则失败);4) base64 解码签名(失败则失败);5) 移除对象的 `signatures`、`unsigned`;6) 对剩余部分 Canonical JSON 编码;7) 用验证密钥核对签名(不符则失败,否则成功)。

### 事件哈希:内容哈希(content hash)vs 引用哈希(reference hash)

**出站事件签名顺序**(Adding hashes and signatures to outgoing events):

1. 先计算**内容哈希**,用 Unpadded Base64 编码后存入事件的 `hashes.sha256`;
2. 把事件对象按 redaction 算法**红改**;
3. 按 Signing JSON 用服务器签名密钥签名;
4. 把签名拷回原始事件对象。

- **[v1.18 新增]** 在含 Policy Server 的房间里,事件还必须请求 Policy Server 追加一个签名。

**收件验证顺序**(Validating hashes and signatures on received events):

- 先查**签名**:把事件按 redaction 算法红改,对红改结果按 Checking for a signature 校验源服务器签名。无论收到完整事件还是红改副本,此步都应成功。
- 房间版本 ≥3:除非是第三方邀请,否则只需源服务器(发送者所属服务器)的签名;v1/v2 若 event_id 域与源服务器不同,还要求 event_id 域的签名。未知/过期密钥的签名被跳过(过期指早于事件 `origin_server_ts`);Policy Server 密钥此时也被跳过。
- 若所有已知未过期源服务器签名均有效,计算期望**内容哈希**,与收到事件 `hashes` 属性里的值(base64 解码后)比较。**哈希不匹配** → 假定"我们只拿到了红改版本",接收方应用它自己算出的红改副本继续处理,而非收到的完整副本。

**计算引用哈希(reference hash)**:

1. 事件走 redaction 算法;
2. 移除 `signatures` 与 `unsigned`(若存在);
3. 转 Canonical JSON;
4. 对结果算 SHA-256。

> 引用哈希覆盖"事件的关键字段(含内容哈希)";在**某些房间版本**中被用作 event_id。详见房间版本规范。

**计算内容哈希(content hash)**:

- 覆盖完整事件(含**未红改**内容)。
- 移除 `unsigned`、`signatures`、`hashes` → Canonical JSON → SHA-256。

**为什么红改后仍可校验**(来自示例代码注释):

- `hashes` 不被剥离,且覆盖事件的所有键 → 能检测任何非关键键被改/删;
- 签名只覆盖关键键 + hashes → 即使事件被红改仍可核对签名;
- `unsigned` 可被其他服务器修改(如传递途中变化的 age),故排除出哈希;`signatures` 依赖当前 `hashes`,不能先加新哈希再验旧签名,故排除;排除 `hashes` 是为将来迁移哈希算法留余地。

---

## 事件接收校验流程

> 本节为"Checks performed on receipt of a PDU"的七步流程,按顺序执行。

### 七步校验

1. **事件合法(符合该房间版本事件格式),否则丢弃(drop)**。"For an event to be valid, it must comply with the event format of that room version."某些房间版本要求事件带 `room_id` 才能确定适用哪个版本的规则。
2. **通过签名检查,否则丢弃**。
3. **通过哈希检查,否则先红改再继续处理**(哈希失败不丢弃,而是红改后走完剩余步骤)。
4. **基于事件的 `auth_events` 通过授权规则,否则拒绝(rejected)**。
5. **基于事件前状态(state before the event)通过授权规则,否则 rejected**。
6. **基于房间当前状态(current state)通过授权规则,否则"软失败"(soft failed)**——用于防止"引用旧 DAG 分支绕过封禁(banned)"。
7. **[v1.18 新增] 若房间使用 Policy Server,须通过 Policy Server 校验,否则 soft failed**。

### rejected vs soft failed vs dropped vs redacted

- **rejected(拒绝)**:既不应转发给客户端,也不应作为服务器新事件的 prev 事件;引用被拒绝事件的后继事件只要仍通过授权规则就允许;状态计算照常,但被拒绝的**状态事件**不生效;拒绝不使所在事务报错(`/send` 按 PDU 逐条上报);被拒绝事件仍留在 DAG(区别于 drop)。
- **soft failed(软失败)**:事件在其自身状态前通过、但相对当前状态失败。原文:"it is impossible to distinguish such an event from a legitimate one which has been delayed"(无法区分这种事件与被延迟的合法事件),故接受进 DAG,但不转发客户端、不被新事件引用、不加入 forward extremities;但它仍完全参与状态解析,若最终落入解析后的当前状态,须经正常状态通道发给客户端;`/event/{eventId}`、`/backfill`、`/get_missing_events` 仍返回软失败事件。
- **redacted(红改)**:与两者不同——红改事件**仍影响房间状态**(例:"a redacted `join` event will still result in the user being considered joined")。
- **顺序记忆**:合法/签名失败 → drop;哈希失败 → redact;auth_events 或事件前状态失败 → reject;当前状态或 Policy Server 失败 → soft fail。

### 状态解析(State Resolution)概述

> 详细算法在各房间版本规范(见 `/v1.19/rooms/`),本页只有概述。

- 房间**状态**是 `(event_type, state_key)` → `event_id` 的映射。
- 房间从空状态开始,每个被接受进房间的**状态事件**更新一次状态。
- 当事件图(DAG)的两个分支合并、两分支状态可能不一致时,需**状态解析算法**决定合并后的结果状态。
- 规范给出小图示例(E0→E1→E2/E4→E3→E5):"若 E3 与 E4 都是设置房间名的 `m.room.name` 事件,那么在 E5 处房间名应是什么?"
- 具体算法"取决于房间版本",本页不展开(auth chain / auth DAG、unconflicted vs conflicted state、tie-breaking 等细节均在房间版本页,标注「未覆盖」于本页)。

---

## 加入 / 邀请 / 离开 握手

### Join(两阶段握手)

**阶段一 `GET /_matrix/federation/v1/make_join/{roomId}/{userId}`**

- 路径参数 `roomId`、`userId`(`userId` MUST 是源服务器上的用户 ID)。
- Query 参数 `ver`(发送方支持的房间版本列表,缺省 `[1]`)。
- 200 响应:`event`(未签名模板,含 `content`、`origin`、`origin_server_ts`、`sender`、`state_key`、`type`(`m.room.member`)、`content.membership`(`join`));`room_version`(房间版本,缺省按 1 或 2 处理)。
- Restricted 房间时 `content` 可含 `join_authorised_via_users_server`("房间内居民服务器上、能发邀请的任意用户 ID")。
- 调用方在签名并 `/send_join` 前**必须**验证:`room_id` 等于路径参数、`sender`/`state_key` 等于 `userId`、`type` 为 `m.room.member`、`content.membership` 为 `join`。
- 错误:400(含 `M_INCOMPATIBLE_ROOM_VERSION`,body 须带 `room_version`)、403(`M_FORBIDDEN`)、404(`M_NOT_FOUND`)。

**阶段二 `PUT /_matrix/federation/v2/send_join/{roomId}/{eventId}`**

- 路径参数 `roomId`、`eventId`;query 参数 `omit_members`(boolean,v1.6 新增,表示可接受精简响应:从 `state` 省略成员事件、从 `auth_chain` 去掉冗余事件)。
- 请求体:签名后的成员事件。
- 接收方须验证:签名通过、`type` 为 `m.room.member`、`membership` 为 `join`、sender 是源服务器上的用户、`state_key` 等于 sender;失败 SHOULD 返回 `M_INVALID_PARAM`。
- 200 响应:
  - `auth_chain` — 新 join 事件与返回 `state` 事件的完整授权链;
  - `state` — "join 事件之前解析出的当前房间状态";
  - `event` — "居民服务器发给其他服务器看的成员事件"(含居民服务器签名;restricted-room 加入必需);
  - `members_omitted`(boolean,v1.6);
  - `servers_in_room` — 当 `members_omitted` 为 true 时必填,join 前在房内活跃的服务器列表。

### Restricted rooms 与 `join_authorised_via_users_server`

- 居民服务器须确认加入方满足至少一条 `m.room.join_rules` 条件;`join_authorised_via_users_server` 在"房间受限且经某条件加入"时必填。
- 拥有该用户 ID 的居民服务器必须**先签名**再持久化/转发事件。

### Knock

- `GET /_matrix/federation/v1/make_knock/{roomId}/{userId}`(v1.1 新增),类似 `make_join`,但验证 `content.membership` 为 `knock`。
- `PUT /_matrix/federation/v1/send_knock/{roomId}/{eventId}` 提交签名后的 knock 事件。

### Leave / 拒绝邀请

- `GET /_matrix/federation/v1/make_leave/{roomId}/{userId}` + `PUT /_matrix/federation/v2/send_leave/{roomId}/{eventId}`。
- 撤回 knock = 走 leave(离开房间)。

### Invite(邀请)

- `PUT /_matrix/federation/v1/invite/{roomId}/{eventId}`(旧)+ `PUT /_matrix/federation/v2/invite/{roomId}/{eventId}`。

### 错误码汇总

| 错误码 | HTTP | 含义 |
|---|---|---|
| `M_UNABLE_TO_AUTHORISE_JOIN` | 400(`make_join`/`send_join`) | 居民服务器无法验证任何 restricted-room 条件(如缺少条件房间的状态) |
| `M_UNABLE_TO_GRANT_JOIN` | 400 | 居民服务器无法满足 `join_authorised_via_users_server` 的授权规则,"应尝试另一台服务器" |
| `M_FORBIDDEN` | 403 | 用户不被允许加入 |
| `M_INCOMPATIBLE_ROOM_VERSION` | 400 | 请求方 `ver` 列表不含该房间版本 |
| `M_NOT_FOUND` | 404 | 接收方不认识该房间 |
| `M_INVALID_PARAM` / `M_MISSING_PARAM` | 400(`send_join`) | 请求畸形;若关联 C-S 调用,该调用 SHOULD 以 5xx 失败而非透传 |

---

## 历史回补与状态拉取

### `GET /_matrix/federation/v1/backfill/{roomId}`

- Query:`v`(必填,字符串数组,回补起点事件 ID)、`limit`(必填,最多返回 PDU 数,**含传入的起点事件**)。
- 200 返回 Transaction(`origin`、`origin_server_ts`、`pdus`)。
- 语义:从 `v` 中的 ID 向后(过去方向)滑动窗口取前序 PDU,直到 `limit` 个。
- 特例:响应**不得**校验 PDU 的 `prev_events`/`auth_events` 大小限制(历史兼容)。

### `POST /_matrix/federation/v1/get_missing_events/{roomId}`

- 请求体:`earliest_events`(必填,已拥有的事件 ID,遍历时跳过)、`latest_events`(必填,要找其祖先的事件 ID)、`limit`(integer,缺省 10)、`min_depth`(integer,缺省 0)。
- 200 返回 `{ "events": [...] }`。
- 语义:从 `latest_events` 沿 `prev_events` 做广度优先遍历,排除 `earliest_events`,到 `limit` 停止。

### 单事件与状态拉取

| 端点 | 方法 | 说明 |
|---|---|---|
| `/_matrix/federation/v1/event/{eventId}` | GET | 返回含**恰好一个** PDU 的 Transaction(`origin`、`origin_server_ts`、`pdus`) |
| `/_matrix/federation/v1/state/{roomId}` | GET | query `event_id`(必填,计算状态的时间点);返回 `auth_chain`(状态事件的完整递归授权集)+ `pdus`(该事件处**完全解析的状态**,不含该事件自身引起的变更) |
| `/_matrix/federation/v1/state_ids/{roomId}` | GET | query `event_id`(必填);返回 `auth_chain_ids`(字符串数组)+ `pdu_ids`(字符串数组);403 `M_FORBIDDEN`(不在房间或被 `m.room.server_acl` 拦)、404 `M_NOT_FOUND` |
| `/_matrix/federation/v1/timestamp_to_event/{roomId}` | GET | query `ts`(必填,毫秒时间戳)、`dir`(必填,`f` 前向 / `b` 后向);返回 `event_id` + `origin_server_ts`;404 `M_NOT_FOUND` |

> 事务全局约束:一个 Transaction 至多 50 PDU + 100 EDU。

---

## 易混淆点 / 笔记

1. **三层签名别混**:① 请求签名在 `Authorization: X-Matrix` 头(签 method/uri/origin/destination/content);② 事件签名在事件的 `signatures` 字段(签红改后的事件);③ 服务器密钥签名在 `/_matrix/key/v2/server` 响应(用 `verify_keys` 自签)。三者都用 Canonical JSON + Ed25519,但对象与位置不同。
2. **content hash ≠ reference hash**:content hash 覆盖**未红改的完整事件**(去 unsigned/signatures/hashes 后),存入 `hashes.sha256`;reference hash 覆盖**红改后**的事件(再去 signatures/unsigned),某些房间版本用作 event_id。签名/引用哈希只看红改后的关键字段 + hashes,所以事件红改后仍可验签、可检测非关键字段被篡改。
3. **事件格式、状态解析算法、授权规则、密钥有效期规则都由"房间版本"决定**,不是全局统一。读任何 PDU 细节前先确认房间版本。
4. **四种"失败"结局不同**:drop(不合法/签名失败,直接扔)→ redact(哈希失败,红改继续)→ reject(auth_events 或事件前状态失败,留 DAG 但不上发/不被引用)→ soft fail(当前状态失败,防封禁规避,留 DAG 且参与状态解析)。
5. **destination 参数是 v1.3 才加的**,老实现可能不带;带错必须 401。
6. **8448 是联邦默认端口,443 是 .well-known 初始 HTTPS**;`.well-known` 与 SRV 委托**不影响**签名用的 `origin`/`destination`(用委托前的名字)。
7. **PDU 是广播(一对多,可经第三方中继),EDU 是点对点(成对)且无回复**;Query 是一次性快照,常与 C-S 请求联动(如 room_alias 查 room_id)。
8. **`make_*` 返回的是模板,必须由调用方重新签名后再 `send_*`**;restricted-room 场景里居民服务器要二次签名后才落库。
9. **backfill 豁免数量限制**是历史遗留;别把这条豁免套到 `/send`、`/get_missing_events`。
10. **`valid_until_ts` 在房间版本 1–4 被忽略**;后续版本取 min(值, 7 天后),超期密钥视为无效。
11. 域所有权变更风险:新控制者可能伪装前 owner 接收消息或请求历史(类似 email 的接管问题),相关改进提案(MSC1228)尚未落地。

---

## 与自托管聊天项目(Babacom)的相关性

### 跨境双节点联邦是否值得

- **两节点专用场景下,完整联邦协议性价比低**。联邦的核心价值是与第三方(如 matrix.org)互通 + 跨多服务器共享房间。若 Babacom 只有"境内节点 + 境外节点"两台自托管服务器且不接外部 Matrix 生态,直接的做法是:一台中心 homeserver + 双端 Client-Server 直连(或经反向代理/专线),无需实现联邦的服务器发现、X-Matrix 签名、公证服务器、状态解析这一整套。联邦带来的是"任意两台互不认识服务器间可信通信"的通用机制,对固定两节点是过度设计。
- **如果目标是与外部 Matrix 用户/房间互通**,则联邦是必经之路,至少要实现:`/.well-known/matrix/server`(或 SRV)发现、`/_matrix/key/v2/server` 发布公钥、`Authorization: X-Matrix` 请求签名、`/send` 事务、`make_join`/`send_join` 与 `/invite`、`/backfill` 等。
- 跨境场景额外注意:**TLS 证书**必须由两节点都信任的 CA 签发(建议走 OS 信任库,避免自签折腾),域名发现链(含 SRV/8448)要能跨墙解析;否则握手与回补都会失败。

### 媒体是否走联邦

- 联邦规范**确实提供了媒体端点**:`/_matrix/federation/v1/media/download/{mediaId}` 与 `/_matrix/federation/v1/media/thumbnail/{mediaId}`。也就是说,当房间跨服务器时,媒体可经"请求方 → 源服务器(或缓存服务器)"联邦通道下载。
- 但对 Babacom 这类自托管项目,媒体**不必**走联邦:可用独立媒体仓库/对象存储 + CDN,让客户端直连媒体 URL。是否走联邦取决于房间拓扑——只有联邦房间(跨服务器用户)才需要联邦媒体下载;单服务器或仅两节点的私有部署,媒体直接走自己的媒体仓库即可,反而避免媒体数据经过中继或依赖联邦缓存语义。

### 落地建议小结

- 短期(自托管、双节点):**先不做联邦**,只实现 C-S API + 媒体仓库,把房间/事件/媒体都控制在自有服务器上。
- 中期(要接 Matrix 生态):按需实现最小联邦子集(发现、密钥发布、请求签名、`/send`、join/invite、backfill、事件校验),可参考本页各节。
- 始终把**事件签名与哈希、auth_events、状态解析**当作正确性底线——它们是防篡改、防重放、防封禁规避的根基,即便不自建联邦,理解它们也有助于理解 Matrix 数据模型(尤其房间版本对事件格式/红改/哈希的影响)。

# Client-Server API(客户端-服务器 API)

> 原文:https://spec.matrix.org/v1.19/client-server-api/
> 规范版本:v1.19 · 类型:API 参考

## 一句话概述

Matrix Client-Server API 是客户端与 **homeserver(家服务器)** 之间通信的 REST + JSON 协议:客户端通过 `/_matrix/client/` 前缀的 HTTP 端点完成认证、收发房间事件、同步状态、上传/下载媒体、端到端加密密钥交换与 VoIP 信令等全部操作。整个 API 是"事件流(event stream)"驱动——服务器把最终一致的事件图线性化成一条事件序列,客户端靠 `/sync` 增量拉取。

## 核心概念

- **实体标识符**:`@localpart:domain`(user ID)、`!opaque:domain`(room ID)、`$opaque:domain`(event ID)、`#alias:domain`(房间别名)、`mxc://serverName/mediaId`(媒体内容 URI)。域名部分叫 **server name**。
- **事件(event)**:协议的基本数据单元,是只追加、不可变的历史记录,分 **state event(状态事件,有 `state_key`)** 与 **message event(消息事件,无 `state_key`)** 两类。
- **state resolution(状态解析)**:服务器用房间版本定义的算法,把可能冲突的并发状态事件收敛成唯一权威状态。
- **access_token**:认证凭证,通过 `Authorization: Bearer <token>` 传递(查询串 `?access_token=` 自 v1.11 起废弃)。
- **Transaction ID(`{txnId}`)**:客户端生成的幂等键,放在 `PUT .../send/{eventType}/{txnId}` 等路径里;同一路径重发相同 txnId 返回原响应,用于重试去重。作用域是"每设备、每端点"。
- **错误格式**:所有错误统一返回 JSON `{"errcode": "...", "error": "..."}`,客户端应优先信任 `errcode` 而非 HTTP 状态码;`M_UNKNOWN` 时才回退看状态码。
- **房间版本(room version)**:定义状态解析、事件授权、redaction 算法等底层规则;客户端通过 `m.room.create` 事件的 `room_version` 得知。
- **版本号**:端点带版本段(`v3`、`v1`)。规范整体版本见 `GET /_matrix/client/versions`。

## 主要端点

> 说明:方法列只标主要动词;`{...}` 为路径参数。URL 前缀大多为 `/_matrix/client/v3/`(下简称 `/c/v3`),v1.11+ 新增的认证媒体端点用 `/_matrix/client/v1/`(下简称 `/c/v1`),旧媒体端点在 `/_matrix/media/v3/`。

### 1) API 标准 / 发现

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/_matrix/client/versions` | 返回服务器支持的规范版本 | 响应:`versions[]`、`unstable_features{}` |
| GET | `/.well-known/matrix/client` | 服务器发现(delegation) | 响应:`m.homeserver.base_url` |

- 通用约定:JSON 必须 UTF-8;POST/PUT 需 JSON 对象体(媒体上传与 logout 除外);响应返回 JSON(媒体下载的 200 除外);Web 客户端下服务器应返回 CORS 头 `Access-Control-Allow-Origin: *` 等。
- 标准错误码(常见):`M_FORBIDDEN`(无权限/登录失败)、`M_UNKNOWN`、`M_UNKNOWN_TOKEN`(可带 `soft_logout`)、`M_MISSING_TOKEN`、`M_BAD_JSON` / `M_NOT_JSON`、`M_NOT_FOUND`、`M_LIMIT_EXCEEDED`(限流,429,可带 `retry_after_ms`)、`M_UNRECOGNIZED`(404=端点未实现 / 405=方法不对)、`M_RESOURCE_LIMIT_EXCEEDED`、`M_TOO_LARGE`、`M_INCOMPATIBLE_ROOM_VERSION`(带 `room_version`)。
- 限流:服务器应实现限流,429 + `Retry-After` 头,body 带 `M_LIMIT_EXCEEDED`。

### 2) 服务器发现

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/.well-known/matrix/client` | 从用户 server name 推导 homeserver | 返回 `m.homeserver.base_url`(可带尾 `/`),可选 `m.identity_server` |

- 机制:从 `@user:example.org` 取 `example.org`,请求 `https://example.org/.well-known/matrix/client`。此文件可由普通 Web 服务器托管,把客户端"委派"到另一个 base_url(即 delegation)。
- 失败语义:404 → `IGNORE`(放弃此机制,回退);非 200/空 body/JSON 解析失败/缺 `m.homeserver` → `FAIL_PROMPT`;`base_url` 不是合法 URL 或校验失败 → `FAIL_ERROR`。拿到 base_url 后应连 `/_matrix/client/versions` 校验确实是 homeserver。

### 3) 认证与登录

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/c/v3/login` | 发现支持的登录流 | 404+`M_UNRECOGNIZED` 表示 legacy API 不支持 |
| POST | `/c/v3/login` | 登录换取 token | `type`(`m.login.password`/`m.login.token`)、`identifier`(`m.id.user`/`m.id.thirdparty`)、`password`、`device_id`、`refresh_token`;返回 `user_id`/`access_token`/`device_id`/`refresh_token`/`expires_in_ms` |
| POST | `/c/v3/register` | 注册(UIA 流程) | 首次无 `auth` → 401 返回 `flows`/`params`/`session`,逐阶段提交 `auth` |
| GET | `/c/v3/register/available` | 检查用户名可用 | 200 可用;400 `M_USER_IN_USE`/`M_INVALID_USERNAME` |
| POST | `/c/v3/refresh` | 刷新 access_token(v1.3+) | `refresh_token`;返回新 `access_token`/可选 `refresh_token`/`expires_in_ms` |
| POST | `/c/v3/logout` | 登出当前 token(及 refresh token) | 空 body |
| POST | `/c/v3/logout/all` | 登出该用户全部 token | 空 body |
| GET | `/c/v1/auth_metadata` | OAuth 2.0 元数据发现(v1.15+) | 授权端点/token 端点/撤销端点等 |

- **UIA(User-Interactive Authentication)**:注册/改密等敏感操作的多阶段认证框架。认证类型含 `m.login.password`、`m.login.dummy`、`m.login.sso`、`m.login.recaptcha`、`m.login.email.identity`、`m.login.msisdn`、`m.login.registration_token`、`m.login.terms`、`m.oauth`。
- **OAuth 2.0(v1.15+)**:与 legacy API 并行,两者**互不兼容**——用哪个 API 拿的 token 就只能用哪个 API。授权方式:authorization code(有浏览器的客户端)、device code(受限输入设备,用 `device_code`/`user_code` 轮询)。grant types:`authorization_code`、`urn:ietf:params:oauth:grant-type:device_code`、`refresh_token`。scope:`urn:matrix:client:api:*`(全 API 访问)、`urn:matrix:device:allocation:<device_id>`。客户端需注册拿 `client_id`(静态或 Dynamic Client Registration)。

### 4) 事件模型相关端点

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/c/v3/rooms/{roomId}/messages` | 分页拉取房间历史 | `from`/`to`/`dir`(b/f)/`limit`/`filter`;返回 `chunk`/`start`/`end` |
| GET | `/c/v3/rooms/{roomId}/event/{eventId}` | 取单条事件 | |
| GET | `/c/v3/rooms/{roomId}/state/{eventType}/{stateKey}` | 取单个状态 | |
| GET | `/c/v3/rooms/{roomId}/state` | 取房间全部状态 | |
| PUT | `/c/v3/rooms/{roomId}/state/{eventType}/{stateKey}` | 发送状态事件 | `state_key` 缺省空串 |
| PUT | `/c/v3/rooms/{roomId}/send/{eventType}/{txnId}` | 发送消息事件(幂等) | |
| PUT | `/c/v3/rooms/{roomId}/redact/{eventId}/{txnId}` | 撤回(redact)事件 | body `reason`;不可逆 |
| GET | `/c/v1/rooms/{roomId}/relations/{eventId}` | 取某父事件的子事件 | `from`/`to`/`limit`/`dir`/`recurse` |
| GET | `/c/v1/rooms/{roomId}/relations/{eventId}/{relType}` | 按关系类型过滤 | |
| GET | `/c/v1/rooms/{roomId}/relations/{eventId}/{relType}/{eventType}` | 按关系类型+事件类型过滤 | |
| GET | `/c/v1/rooms/{roomId}/threads` | 查询房间线程(v1.4+) | |

### 5) 同步 / 过滤

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/c/v3/sync` | 首次快照 + 增量同步(长轮询) | `since`、`timeout`(ms)、`full_state`、`set_presence`、`filter`、`use_state_after`(v1.16+) |
| POST | `/c/v3/user/{userId}/filter` | 创建过滤器 | 返回 `filter_id` |
| GET | `/c/v3/user/{userId}/filter/{filterId}` | 下载过滤器 | |

### 6) 房间与成员

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| POST | `/c/v3/createRoom` | 建房 | `name`/`topic`/`preset`/`room_alias_name`/`visibility`/`room_version`/`invite`/`invite_3pid`/`is_direct`/`initial_state`/`power_level_content_override`/`creation_content`;返回 `room_id` |
| POST | `/c/v3/join/{roomIdOrAlias}` | 按 ID 或别名加入 | 可选 `via`(server names);返回 `room_id` |
| POST | `/c/v3/rooms/{roomId}/join` | 按 ID 加入 | |
| POST | `/c/v3/knock/{roomIdOrAlias}` | 敲门请求加入(v1.1+) | |
| POST | `/c/v3/rooms/{roomId}/invite` | 邀请用户 | `user_id`、可选 `reason` |
| POST | `/c/v3/rooms/{roomId}/leave` | 离开房间 | |
| POST | `/c/v3/rooms/{roomId}/forget` | 忘记房间 | |
| POST | `/c/v3/rooms/{roomId}/kick` | 踢人 | |
| POST | `/c/v3/rooms/{roomId}/ban` | 封禁 | `user_id`、可选 `reason` |
| POST | `/c/v3/rooms/{roomId}/unban` | 解封 | |
| PUT | `/c/v3/directory/room/{roomAlias}` | 创建/指派别名 | |
| GET | `/c/v3/directory/room/{roomAlias}` | 解析别名到 room_id | |
| DELETE | `/c/v3/directory/room/{roomAlias}` | 删除别名 | |
| GET | `/c/v3/rooms/{roomId}/aliases` | 列出房间别名 | |
| GET | `/c/v3/publicRooms` | 列出公共房间 | |
| POST | `/c/v3/publicRooms` | 按过滤条件查询公共房间 | |
| PUT | `/c/v3/directory/list/room/{roomId}` | 设置公共目录可见性 | |
| GET | `/c/v3/joined_rooms` | 列出我已加入的房间 | |
| GET | `/c/v3/rooms/{roomId}/joined_members` | 列出已加入成员 | |
| GET | `/c/v3/rooms/{roomId}/members` | 列出全部成员状态事件 | `at`/`membership`/`not_membership` |

- `createRoom` 的 `preset`:`private_chat`(join_rules=invite)、`trusted_private_chat`(受邀者获得与创建者同等的 power level)、`public_chat`(join_rules=public)。
- join_rules 取值:`public`、`invite`、`knock`、`restricted`(满足 `allow` 条件即可加入)、`knock_restricted`、`private`(保留)。

### 7) 即时交互(ephemeral)

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| PUT | `/c/v3/rooms/{roomId}/typing/{userId}` | 上报打字状态 | `typing`(bool)、`timeout`(ms) |
| POST | `/c/v3/rooms/{roomId}/receipt/{receiptType}/{eventId}` | 发已读回执 | receiptType=`m.read` / `m.read.private` |
| POST | `/c/v3/rooms/{roomId}/read_markers` | 设置已读标记 + 可选回执 | `m.fully_read`、`m.read`、`m.read.private` |
| GET | `/c/v3/presence/{userId}/status` | 查在线状态 | |
| PUT | `/c/v3/presence/{userId}/status` | 设在线状态 | `presence`(online/offline/unavailable)、`status_msg` |

### 8) 媒体(内容仓库)

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| POST | `/_matrix/media/v3/upload` | 上传(当前) | query `filename`,header `Content-Type`;返回 `content_uri`(mxc://) |
| GET | `/c/v1/media/config` | 上传限制配置(v1.11+) | 返回 `m.upload.size` |
| GET | `/c/v1/media/download/{serverName}/{mediaId}` | 下载(需认证,v1.11+) | `timeout_ms`、`allow_remote`;可能 307/308 重定向到 CDN |
| GET | `/c/v1/media/thumbnail/{serverName}/{mediaId}` | 缩略图(v1.11+) | `width`/`height`(必填)、`method`(`crop`/`scale`)、`animated` |
| GET | `/_matrix/media/v3/download/{serverName}/{mediaId}` | 旧下载端点 | **已废弃**(v1.11+) |
| GET | `/_matrix/media/v3/thumbnail/{serverName}/{mediaId}` | 旧缩略图端点 | **已废弃** |

- 媒体 URI 格式:`mxc://serverName/mediaId`,`media-id` 只允许 `[A-Za-z0-9_-]`。
- 下载语义:内容从**接收方本地** homeserver 下载,必要时本地服务器先从源服务器取回。

### 9) 端到端加密相关端点

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| POST | `/c/v3/keys/upload` | 上传设备公钥/一次性密钥 | `device_keys`、`one_time_keys`、`fallback_keys` |
| POST | `/c/v3/keys/query` | 查询用户设备密钥 | `device_keys`(按 user_id)、`timeout` |
| POST | `/c/v3/keys/claim` | 领取一次性密钥 | `one_time_keys`(按 user→device→alg) |
| POST | `/c/v3/keys/device_signing/upload` | 上传 cross-signing 密钥 | `master_key`/`self_signing_key`/`user_signing_key` + UIA |
| GET | `/c/v3/keys/changes` | 离线期间设备列表变更 | `from`/`to`(next_batch) |
| GET | `/c/v3/devices` | 列出我的设备 | |
| DELETE | `/c/v3/devices/{deviceId}` | 删除设备 | |
| PUT | `/c/v3/devices/{deviceId}` | 更新设备显示名 | |
| GET/POST | `/c/v3/room_keys/version` | 查询/创建 key backup 版本 | `algorithm`、`auth_data` |
| GET/PUT/DELETE | `/c/v3/room_keys/keys[/{roomId}[/{sessionId}]]` | 备份/取回/删除 Megolm 会话密钥 | |

### 10) VoIP / 呼叫

| 方法 | 端点 | 用途 | 关键参数 |
|---|---|---|---|
| GET | `/c/v3/voip/turnServer` | 取 TURN 服务器配置 | 返回 `username`/`password`/`uris`/`ttl` |

- 呼叫信令通过房间内 `m.call.*` **消息事件** 传递(基于 WebRTC 1.0,双人)。核心事件:`m.call.invite`(offer SDP + `lifetime`)、`m.call.candidates`(ICE 候选)、`m.call.answer`、`m.call.hangup`、`m.call.reject`、`m.call.negotiate`(重协商)、`m.call.select_answer`(多端应答时选定)。所有 call 事件公共字段:`call_id`、`version`、`party_id`。

## 事件模型

### 客户端可见的事件结构(ClientEvent)

服务器返回给客户端的事件核心字段:

| 字段 | 必填 | 说明 |
|---|---|---|
| `content` | 是 | 事件体,由发送方构造 |
| `event_id` | 是 | 全局唯一事件 ID |
| `origin_server_ts` | 是 | 源服务器时间戳(ms) |
| `room_id` | 是 | 所属房间 |
| `sender` | 是 | 发送者完整 user ID |
| `type` | 是 | 事件类型(标准类型以 `m.` 前缀) |
| `state_key` | 仅状态事件 | 使该状态在房间内唯一;常为空串;`@` 开头保留给 user ID |
| `unsigned` | 否 | 本地服务器附加的额外信息(见下) |

`unsigned` 内的关键字段:`age`(发送后经过的 ms)、`prev_content`(被替换的前一状态事件内容,v1.2 起移到 unsigned 内)、`redacted_because`(撤回此事件的 redaction 事件)、`replaces_state`(被替换状态事件的 event ID,v1.19 新增,不受 history visibility 影响)、`transaction_id`(原发送方的 txnId)、`membership`(请求者当时成员身份,v1.11+)。对 `m.room.member` 邀请事件,`unsigned.invite_room_state`/`knock_room_state` 里带 **stripped state**(仅含 `sender`/`type`/`state_key`/`content` 的精简状态,用于在未加入时预览房间)。

- **尺寸限制**:完整事件不得超过 **65536 字节**(federation 格式 + Canonical JSON)。`state_key`、`type` ≤ 255 字节。
- **State vs Message**:
  - State event:更新房间元数据,以 `(type, state_key)` 为键,同键新事件覆盖旧事件(需经过 state resolution)。
  - Message event:一次性"瞬态"活动,如发消息、VoIP 信令;按到达顺序排在 timeline 中。
- 自定义事件类型用 Java 包命名法,如 `com.example.game.score`。

### m.room.message 与 msgtype

`m.room.message` 是通用消息事件,`content` 必含 `body`(纯文本兜底)和 `msgtype`(消息类型)。msgtype:

| msgtype | 用途 | 特有字段 |
|---|---|---|
| `m.text` | 纯文本 | 可选 `format`/`formatted_body`(HTML) |
| `m.emote` | 动作(/me) | 同 m.text |
| `m.notice` | 机器人响应,永不自动回复 | 同 m.text |
| `m.image` | 图片 | `url`、`info`(w/h/mimetype/size/thumbnail_*)、`filename`(v1.10+)、`file`(加密) |
| `m.file` | 通用文件 | `url`、`filename`、`info`(mimetype/size) |
| `m.audio` | 音频 | `url`、`info`(duration/mimetype/size) |
| `m.video` | 视频 | 类似 image/audio 组合 |
| `m.key.verification.request` | SAS 验证请求 | 内嵌在 message 里 |

- HTML 支持:`format: "org.matrix.custom.html"` + `formatted_body`。客户端须做白名单渲染防 XSS;允许的标签列表(含 `span[data-mx-spoiler]` 等)规范里有完整定义。

### m.room.member(成员状态)

`m.room.member` 是状态事件,`state_key` = 成员 user ID。`content.membership` 取值:`invite`(已邀请未加入)、`join`(已加入)、`leave`(离开/被踢)、`ban`(被封禁)、`knock`(敲门中)。其他字段:`displayname`、`avatar_url`、`reason`(变更原因)、`is_direct`。成员状态迁移表(如 from join → to leave:state_key==sender 为主动离开,否则为被踢)是渲染与事件解释的关键。推荐用 join/invite/leave 等 API 而不是直接写状态(直接写会因授权规则失败,例如不能强制他人 join)。

### Redaction(撤回)

- 事件不能被删除,只能 **redact**:把事件里协议不需要的键剥掉(按房间版本定义的算法)。不可逆。
- `m.room.redaction` 事件(消息事件)的 `content.redacts` 指向被撤回事件(room version 11 起 `redacts` 在 content 里),可选 `reason`。
- 服务器在返回被撤回事件时,把 `m.room.redaction` 放进 `unsigned.redacted_because`。
- 权力规则:power level ≥ `m.room.redaction` 可撤回自己事件;≥ `redact` 可撤回他人事件。
- 被撤回的状态事件仍影响房间状态(如被撤回的 join 仍算已加入)。

### 关系与聚合(Relations / Aggregations)

- 事件通过子事件的 `content.m.relates_to` 指向父事件,形成父子结构:`{"event_id": 父事件ID, "rel_type": 关系类型}`。
- `m.relates_to` **必须放在明文部分**(加密事件也不能只放加密载荷里),因为服务器要靠它聚合。
- 服务器聚合(bundled aggregation):父事件被返回时,`unsigned.m.relations` 里按 `rel_type` 汇总子事件(在 `/messages`、`/event`、`/context`、`/relations`、`/sync`(limited 时)、`/search`、`/threads` 返回)。
- 三种标准关系:
  - **m.replace(编辑)**:替换事件含 `m.new_content`(新内容)+ `rel_type: m.replace` 指向原事件。客户端把原 `content` 整体替换为 `m.new_content`,但**保留原 `m.relates_to`**。只能编辑自己的消息,原事件本身不能是 replace。
  - **m.annotation(表情回应/reaction)**:`m.reaction` 事件,`m.relates_to` 里加 `key`(通常 emoji)。服务器**不**聚合 m.annotation(不放进 `m.relations`);同用户同 type+key 重复发会被服务器以 `M_DUPLICATE_ANNOTATION` 拒绝。不能对 edit/reaction 本身做 reaction。改表情 = 撤回旧的再发新的。
  - **m.thread(线程,v1.4+)**:所有线程内事件都以 `rel_type: m.thread` 指向 **线程根事件**(不是上一条)。线程不能嵌套。聚合在 `unsigned.m.relations.m.thread` 里含 `count`、`latest_event`、`current_server_participated`。
- 回复(rich reply)不使用 rel_type,而是用 `m.in_reply_to`(线程回退时会合并两套结构并加 `is_falling_back: true`)。

## 同步机制

`GET /_matrix/client/v3/sync` 是客户端状态的唯一权威入口:

- **首次同步**:不带 `since` 调用,返回每个房间最近事件 + 房间状态,以及 `next_batch`。
- **增量同步**:把上次 `next_batch` 作为 `since` 长轮询;配合 `timeout`(ms)让服务器短暂挂起等待新事件(只有 /sync 支持长轮询)。
- **响应结构**:
  - `next_batch`(必填,下次 `since` 用)
  - `rooms`:按 `join` / `invite`(带 `invite_state`) / `knock`(带 `knock_state`) / `leave` 分组,每房间含 `timeline`(events + `limited` + `prev_batch`)、`state`、`state_after`(v1.16+)、`ephemeral`(typing/receipt)、`account_data`、`summary`(`m.heroes`、`m.joined_member_count`、`m.invited_member_count`)、`unread_notifications`
  - `presence`、`account_data`、`to_device`(send-to-device 消息)、`device_lists`(E2EE 设备变更)、`device_one_time_keys_count`(一次性密钥余量)
- **limited 与 gap**:事件太多时只返回最近一部分(`timeline.limited: true`),中间形成 gap。用 `prev_batch` 作为 `/messages` 的 `from` 补拉历史。`state` 列表此时是 gap 起点的状态 delta;初始 sync 时 `state` = 房间在 timeline 起点处的完整状态。
- **prev_batch / next_batch** 关系:`prev_batch` 指向更早历史(供 `/messages` 回溯),`next_batch` 指向下一批新事件(供下次 sync)。
- **去重**:sync 按"到达服务器的时间"排序,与其他 API 的拓扑序可能冲突,客户端按 `event_id` 去重。
- **full_state=true**:返回所有已加入房间的完整状态(即使给了 since);忽略 timeout,立即返回。
- **set_presence**:sync 时是否顺带把用户标为 online/offline/unavailable。
- **过滤 filter**:`POST /c/v3/user/{userId}/filter` 创建,`/sync` 传 `filter` 参数(filter ID 或内联 JSON)。可过滤 `rooms`/`not_rooms`、`types`/`not_types`(支持 `*` 通配)、`senders`/`not_senders`、`limit`、`contains_url`、`event_fields`(点分路径只取部分字段)、`event_format`(client/federation)。
- **Lazy-loading members(懒加载成员)**:`lazy_load_members: true` 时只返回 timeline 事件 sender 的 member 事件;`include_redundant_members: true` 强制全量。适用于 `/sync`、`/messages`、`/context`。

## 认证

- **token 表示**:`Authorization: Bearer <token>`(推荐);查询串 `?access_token=` 自 v1.11 废弃,但服务器仍须支持。
- **登录**:POST `/c/v3/login`,标识符 `m.id.user`(user 或 localpart)或 `m.id.thirdparty`(medium + address)。返回 `access_token`、`device_id`、`user_id`,可选 `refresh_token`、`expires_in_ms`。
- **device 与 token 绑定**:token 绑定 `device_id`;登录/注册时未指定则自动生成;指定已有 device_id 会使该设备旧 token 全部失效。transaction ID 作用域也是按设备。
- **refresh token(v1.3+)**:POST `/c/v3/refresh` 换新 access_token;旧 refresh token 在"新 token 被使用"前仍有效,使用后吊销。
- **soft logout**:`M_UNKNOWN_TOKEN` 可带 `soft_logout: true` → 客户端可保留持久化状态(如加密密钥)并尝试刷新或重登;`false`/缺省 → 会话已销毁,状态不可复用。
- **注销**:`/logout`(当前)、`/logout/all`(全部)。
- **UIA**:注册/改密/传 cross-signing 密钥等敏感操作走 User-Interactive Authentication 多阶段流程。
- **OAuth 2.0(v1.15+)**:见上文端点表;与 legacy API 互斥,支持 code/device 两种授权与强制 refresh。

## 端到端加密(客户端侧)

### 密钥体系

- **设备密钥**:每设备一个 Ed25519 签名密钥(设备指纹,私钥永不出设备)+ (Olm v1 需要)一个 Curve25519 身份密钥。通过 `/keys/upload` 上传公钥。
- **一次性密钥(one-time key)**:`signed_curve25519` 类型,由设备 Ed25519 签名;用一次即弃,服务器保证只被领取一次。`fallback keys`(回退密钥)用后不被消费,防止离线时一次性密钥耗尽(但会话可能受重放攻击影响)。sync 的 `device_one_time_keys_count` 告知余量。
- **key 算法名**:`ed25519`、`curve25519`、`signed_curve25519`。
- **设备列表跟踪**:通过 `/keys/query` 获取;用 sync 的 `device_lists.changed`(及 `left`)感知变更,离线期间用 `/keys/changes?from=<next_batch>` 补查。

### 加密事件与算法

- **m.room.encrypted**:加密事件外壳(房间事件或 to-device 事件)。`content.algorithm` 取值:`m.olm.v1.curve25519-aes-sha2`(Olm,1:1)或 `m.megolm.v1.aes-sha2`(Megolm,群聊)。`ciphertext` 对 Megolm 是密文字符串,对 Olm 是 {接收者 Curve25519 键: 密文} 映射;Megolm 需 `session_id`。
- **m.room_key**:加密(用 Olm)后以 to-device 发送,交换 Megolm 会话密钥(含 `session_key`、`room_id`、`session_id`、`algorithm`)。`shared_history`(v1.19)表示会话是否可共享给新加入者。
- **m.room_key_request**:请求/取消请求密钥(to-device,明文)。
- **加密附件**:文件用单次 256-bit AES-CTR 加密(AES key + 64-bit IV),key 以 JWK 格式放进事件(`file`/`thumbnail_file` 替换 `url`/`thumbnail_url`),并附 `hashes.sha256` 防篡改。

### Key backup(服务端密钥备份)

- 设备把 Megolm 会话密钥加密后上传服务器,离线新设备无需其他设备在线即可取回。每用户一份,可替换。
- 版本管理:`POST /c/v3/room_keys/version` 创建(指定 `algorithm` + `auth_data`);`GET` 发现;密钥用 `PUT /c/v3/room_keys/keys` 写入(只能写最新版本),`GET` 取回,`DELETE` 删除。
- 备份算法 `m.megolm_backup.v1.curve25519-aes-sha2`:`auth_data.public_key`(Curve25519);解密密钥(曾叫 recovery key,现统一叫 backup decryption key)以 `m.megolm_backup.v1` 名义存 secret storage 或直接给用户。
- 上传密钥冲突时服务器按 `is_verified` → `first_message_index`(更小)→ `forwarded_count`(更小)决定保留哪个。

### Cross-signing(交叉签名)

- 目的:Alice 与 Bob 只需互验一次,即可信任双方所有设备。
- 三对 Ed25519 密钥:master signing key(MSK,用户身份根)、user-signing key(USK,签他人 MSK)、self-signing key(SSK,签自己设备)。上传端点 `POST /c/v3/keys/device_signing/upload`(通常需 UIA,幂等允许重传同套密钥)。
- 信任链:Alice MSK→USK→Bob MSK→Bob SSK→Bob 设备密钥。
- 安全要点:客户端必须按公钥引用密钥、验证开始时固定密钥、检测设备 ID 与 cross-signing 公钥碰撞并拒绝验证。

### SAS 验证(Short Authentication String)

- 用户友好验证框架,事件:`m.key.verification.request` → `m.key.verification.ready` → `m.key.verification.start`(含 `method: m.sas.v1`)→ `m.key.verification.accept` → `m.key.verification.key` → `m.key.verification.mac` → `m.key.verification.done`(或 `cancel`)。用户比对双方屏幕上的短字符串/emoji 完成验证。
- 推荐行为(v1.18+):验证应验 cross-signing 密钥而非单设备密钥;不默认向未 cross-signed 的设备发房间密钥(用 `m.room_key.withheld` code `m.unverified` 说明原因)。

## 易混淆点 / 笔记

- **state vs timeline 在 /sync 里**:`state` 列表里的状态事件**不要渲染进时间线**,它只是让客户端把本地状态模型对齐服务器(初始 sync 是完整状态,增量 sync 仅 limited 时才有 delta)。
- **state_key 为空串**:多数房间级状态(名字/话题/join_rules/create)的 `state_key` 都是 `""`;`m.room.member` 的 state_key 是成员 user ID。
- **`prev_content` 在 `unsigned` 里**(v1.2 起),不在顶层;且只在"客户端有权看到前一事件"时返回。
- **撤回 ≠ 删除**:redaction 只剥字段,事件仍在历史里;被撤回的状态事件仍影响状态。
- **m.fully_read(已读标记)≠ m.read(已读回执)**:fully_read 标记"已读完的第一段"边界,存在房间 account data;m.read 是"读到哪条为止"的回执;两者常一起更新(用 `/read_markers` 省一次请求)。`m.read.private`(v1.4+)是私密回执,只清通知、不向他人广播。
- **typing / receipt 是 ephemeral**:不进入 event graph、不参与 state resolution,只在 sync 的 `ephemeral` 数组下发。typing 每次是"完整名单"替换。
- **m.relates_to 必须明文**:加密事件里若载荷也含 m.relates_to,应忽略载荷里的、用明文的(与服务器聚合行为一致)。
- **线程 vs 回复**:线程内事件都指向根事件(可聚合);普通回复(rich reply)不设 rel_type、不用 `m.in_reply_to` 链,因此不能走 `/relations` 查询。线程事件可附 `is_falling_back` 的回复元数据以兼容老客户端。
- **编辑的限制**:m.replace 只能改自己的消息;`m.new_content` 替换时保留原 `m.relates_to`;reaction 不能被编辑。
- **媒体端点迁移(v1.11+)**:下载/缩略图从无认证的 `/_matrix/media/v3/*` 迁移到需认证的 `/_matrix/client/v1/media/*`;旧端点废弃(v1.12 起服务器可"冻结"旧端点)。上传仍是 `/_matrix/media/v3/upload`(未来迁到 `/_matrix/media/v1/create`)。
- **OAuth 2.0 与 legacy 不互通**:拿哪个 token 就用哪套 API,别混用。
- **VoIP 的现状**:v1.19 规范正文仍以 `m.call.*`(WebRTC 1.0 双人)为 VoIP 规范;规范未提 MatrixRTC。注(规范外上下文):较新的呼叫实现正迁向 MatrixRTC / MSC4143,此信息不在本规范正文中。
- **版本标记**:本文多处标注 `v1.x` 表示该字段/端点在对应规范版本新增,自托管实现若兼容旧 homeserver 需注意可用性(如 `use_state_after`、`state_after`、`shared_history`、`M_USER_LIMIT_EXCEEDED`、`M_UNKNOWN_DEVICE` 等)。

## 与自托管聊天项目(Babacom)的相关性

- **同步即客户端骨架**:`/sync`(since/next_batch/limited/prev_batch + timeout 长轮询)是自建客户端最核心的循环,建议先实现 initial sync + 增量 sync + `/messages` 补 gap,这是消息可靠投递的基础。
- **最小可行闭环**:登录(`/login` + Bearer token)→ 建房/加入(`createRoom`/`join`)→ 发消息(`PUT .../send/{type}/{txnId}`,借 txnId 做重试幂等)→ `/sync` 收消息 → `/messages` 翻历史。
- **事件模型是数据层**:Babacom 的消息/成员/房间元数据应直接映射到 event 结构(content/type/state_key),member 状态迁移表 + state resolution 语义决定"谁在房间、显示名是什么"。
- **撤回与编辑**:要实现"撤回消息""编辑消息""表情回应",需实现 redaction 与 m.replace/m.annotation(注意 `m.relates_to` 明文约束 + 聚合 `unsigned.m.relations`)。
- **已读/输入中**:typing(timeout 心跳)与 m.read / m.read.private / m.fully_read 是聊天体验必备;ephemeral 不占事件图,实现成本低。
- **媒体**:若做文件/图片,走 `/_matrix/media/v3/upload` 得 `mxc://`,优先用新认证下载端点 `/c/v1/media/*`(旧端点会被冻结)。
- **E2EE 是重头但可选**:自托管场景若要加密,客户端侧需 Olm/Megolm 库实现设备密钥 + 一次性密钥 + m.room.encrypted + key backup + cross-signing + SAS,工作量巨大;自托管若信住自有服务器,可先做明文,把加密作为后续里程碑。
- **认证**:自托管服务器端需实现 legacy login(至少 password + refresh token),长期看 OAuth 2.0(v1.15+)是方向,但两套 API 互斥,选型要提前定。
- **错误处理**:统一按 `errcode` 分支(尤其 `M_UNKNOWN_TOKEN` 的 soft_logout、`M_LIMIT_EXCEEDED` 的退避、`M_TOO_LARGE`/`M_FORBIDDEN`),比看 HTTP 状态码更可靠。

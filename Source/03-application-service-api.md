# Application Service API(应用服务 API)

> 原文:https://spec.matrix.org/v1.19/application-service-api/
> 规范版本:v1.19 · 类型:API 参考

## 一句话概述(它解决什么问题、谁用、何时需要)

Matrix 的 Client-Server / Server-Server API 只提供「自洽的联邦消息结构」,几乎没有为服务器端的自定义行为留口子。Application Service(应用服务,简称 AS)API 定义了一套与具体 homeserver 实现无关的标准扩展机制,用于在 homeserver 之外挂接网关、桥接器、机器人或增值服务(日志、搜索、监控)。典型场景:把 IRC / Slack / Telegram 等外部网络桥接进 Matrix、按命名空间独占管理虚拟用户/房间、以及向房间注入事件。

## 核心概念

- **被动角色(passive)**:AS 只能「观察」homeserver 推来的事件,并向自己参与的房间里「注入」事件;不能拦截事件、也不能篡改事件内容。
- **注册方式(configuration-based)**:早期支持通过 HTTP 注册,后因安全风险(被攻破的 AS 可重新注册全局 `*` 正则嗅探所有流量)被移除。现在 AS 通过 homeserver 的**配置文件**注册,便于管理员人工审查可疑正则。
- **注册对象字段**:
  - `as_token`(必填):AS 向 homeserver 认证用的密钥。
  - `hs_token`(必填):homeserver 向 AS 认证用的密钥。
  - `id`(必填):AS 唯一标识,用户自定义、永不改变。
  - `namespaces`(必填):AS 关心的命名空间(见下)。
  - `protocols`(字符串数组):提供的外部协议(如 IRC)。
  - `rate_limited`(布尔):被伪装(masquerade)用户的请求是否限流;发送方本身除外。
  - `receive_ephemeral`(布尔,默认 false,v1.13 加入):是否接收临时数据(在线状态、正在输入、已读回执)。
  - `sender_localpart`(必填):AS 关联用户的 localpart(如 `_irc_bot` → `@_irc_bot:example.org`)。当该用户是事件目标、或是事件发生房间的成员时,事件才推给 AS。
  - `url`(null 或字符串,必填):AS 的 URL;不需要流量时可填 `null`。
- **命名空间(namespaces)**:分为 `aliases`(房间别名正则)、`rooms`(房间 ID 正则)、`users`(用户 ID 正则)三类,每类是一组 `{exclusive, regex}`。
  - `exclusive`(布尔,必填):该命名空间是否由 AS 独占;独占后普通用户和其他 AS 不能在该空间内创建/删除实体。
  - `regex`(字符串,必填):POSIX 正则表达式,定义匹配的值。
  - 规则:`users` 只能声明对**本地**用户(localpart 结尾为本地 `server_name`)的兴趣;`rooms`/`aliases` 匹配到的房间内所有事件都会转发;独占的用户/别名命名空间建议以 sigil 后的下划线开头(如 `@_irc_.*`、`#_irc_bridge_.*`)避免碰撞;多个 AS 之间 `as_token` 和 `id` 必须唯一,homeserver 必须强制。
- **认证机制**:
  - homeserver → AS:自 v1.4 起必须在 `Authorization` 头里带上 `Bearer {hs_token}`;AS 必须校验,不匹配返回 403 `M_FORBIDDEN`。旧版用 `access_token` 查询参数,兼容期可同时发送,两者都在时 AS 应都校验。
  - AS → homeserver:在 Client-Server API 中把 `as_token` 放在本应放 `access_token` 的地方(查询串或 `Authorization` 头,优先用头避免泄漏日志)。要伪装成虚拟用户时加 `user_id` 查询参数(该用户必须落在 AS 的 `users` 命名空间内;省略时按 `sender_localpart` 身份行动)。v1.17 起还可加 `device_id` 查询参数(未知设备 ID 返回 400 `M_UNKNOWN_DEVICE`;不带 `device_id` 时,需要设备的操作如上传一次性密钥会失败)。
  - **时间戳改写**(v1.3):AS 可加 `ts` 查询参数来设定事件的 `origin_server_ts`,仅在 `PUT /rooms/{roomId}/send/{eventType}/{txnId}` 和 `PUT /rooms/{roomId}/state/{eventType}/{stateKey}` 上生效;只改显示时间,不改 DAG 排序。

## 主要端点 / 机制

### homeserver → AS 端点(事务/查询,`/_matrix/app/v1/...`)

| 方法 | 端点 | 用途 |
|---|---|---|
| PUT | `/transactions/{txnId}` | **核心事件推送**。向 AS 推送一批事件,`txnId` 由 homeserver 生成保证幂等。请求体:`events`(必填,ClientEvent 数组)、`ephemeral`(可选,v1.13)。成功返回 `200 {}`。重试时 homeserver 不得篡改事件内容。 |
| POST | `/ping`(v1.7) | homeserver 校验连接与 `hs_token`。请求体 `{"transaction_id": "..."}`,返回 `200 {}`。 |
| GET | `/users/{userId}` | 查询某用户 ID 是否在 AS 命名空间内(如邀请指向未知用户时)。`200` 存在(AS 应通过 Client-Server API 创建该用户)、`401`/`403`/`404` 不存在。 |
| GET | `/rooms/{roomAlias}` | 查询某房间别名是否在 AS 命名空间内(客户端尝试加入别名时)。响应同上。 |
| GET | `/thirdparty/location` | 按别名反查第三方位置。查询参数 `alias`。返回 `200`(Location 数组)或 `401`/`403`/`404`。 |
| GET | `/thirdparty/location/{protocol}` | 按协议 + 字段查第三方位置。路径 `protocol`,查询 `fields`(自定义键值)。返回 Location 数组(portal 房间)。 |
| GET | `/thirdparty/protocol/{protocol}` | 返回协议元数据 Protocol 对象(`user_fields`、`location_fields`、`field_types`、`instances`、`icon`)。 |
| GET | `/thirdparty/user` | 按 Matrix 用户 ID 查第三方用户。查询参数 `userid`。返回 User 数组。 |
| GET | `/thirdparty/user/{protocol}` | 按协议 + 字段查第三方用户。返回 User(Matrix 用户 ID)数组。 |

### AS 专用 Client-Server 扩展端点

| 方法 | 端点 | 用途 |
|---|---|---|
| POST | `/_matrix/client/v1/appservice/{appserviceId}/ping`(v1.7) | AS 主动发起 ping,由 homeserver 转调 AS 的 `/_matrix/app/v1/ping`。需 `as_token`,`appserviceId` 必须与 token 匹配。`200` 返回 `{"duration_ms": ...}`;错误含 `M_URL_NOT_SET`、`M_FORBIDDEN`、`M_BAD_STATUS`、`M_CONNECTION_FAILED`、`M_CONNECTION_TIMEOUT`。 |
| PUT | `/_matrix/client/v3/directory/list/appservice/{networkId}/{roomId}` | 更新房间在 AS 发布的第三方网络目录中的可见性。请求体 `{"visibility": "public" | "private"}`,返回 `200 {}`。 |

### AS 的服务器管理权限(通过 Client-Server API)

- 对命名空间内的用户/别名有完全控制权,可绕过验证码和密码。
- 创建用户:`POST /_matrix/client/v3/register`,登录类型 `m.login.application_service`。
- 登录(v1.2):`POST /_matrix/client/v3/login`,同样用 `m.login.application_service`。
- v1.17:不支持 Legacy Authentication API 的服务器上,AS 必须在 `/register` 设置 `"inhibit_login": true`,否则返回 400 `M_APPSERVICE_LOGIN_UNSUPPORTED`(登录同理)。
- 违反命名空间边界(双向)返回 `M_EXCLUSIVE`;`/register`/`/login` 缺 token 或 token 无效返回 401(`M_MISSING_TOKEN` / `M_UNKNOWN_TOKEN`)。
- 设备管理(v1.17):`PUT /_matrix/client/v3/devices/{deviceId}`;删除设备(`DELETE .../devices/{deviceId}`、`POST .../delete_devices`)无需 UIA。
- 跨签名(v1.17):`POST /_matrix/client/v3/keys/device_signing/upload` 对 AS 不要求 UIA,即使跨签名密钥已存在。

## 易混淆点 / 笔记

- **`as_token` 与 `hs_token` 方向相反**,别搞反:`as_token` 是 AS→homeserver 用,`hs_token` 是 homeserver→AS 用。
- **事务幂等靠 `txnId`**,homeserver 会以指数退避重试,故 AS 侧应保证幂等;重试内容不得变化。
- **Legacy 路径回退**:AS 对带版本路径返回非成功状态(404/500/501 等)时,homeserver 会回退到 legacy 路径(如 `/transactions/{txnId}`、`/users/{userId}`、`/rooms/{roomAlias}`、`/_matrix/app/unstable/thirdparty/...`),并周期性重试新版端点。
- **`/sync` 与 `/events`**:AS 想用时必须走虚拟用户(查询串带 `user_id`);推荐做法是依赖事务推送,而不是用 `sender_localpart` 用户去 sync。
- **临时事件(v1.13)**:`m.presence`(上下文相关)、`m.typing`(与普通事件同样的投递规则,顶层含 `room_id`)、`m.receipt`(同上;`m.read.private` 私密已读只发给落在 AS 命名空间内的用户)。
- **第三方消息溯源**:AS 应在事件 `content` 里加 `external_url` 指向来源(如 IRC 消息链接);客户端仅在 scheme 为 http/https 时访问,且需谨慎(其存在不代表一定来自 AS)。
- 错误约定:未知端点 404 `M_UNRECOGNIZED`;已知端点用错方法 405 `M_UNRECOGNIZED`。

## 与自托管聊天项目(Babacom)的相关性

**25 人封闭圈大概率用不到 Application Service**。AS API 是为「桥接外部网络(IRC/Slack/Telegram)」「大规模虚拟用户/机器人治理」「独占命名空间」设计的,需要改 homeserver 配置文件注册、实现一套对外 HTTP 端点并维护事务幂等,复杂度远高于封闭小圈子的实际需求。仅当 Babacom 未来要做「对接微信/Telegram/邮件网关注入消息」这类跨界桥接时才值得引入;若只是群内机器人/消息提醒,用普通 Matrix 账号 + Client-Server API 的 bot 方案即可,不必上 AS。

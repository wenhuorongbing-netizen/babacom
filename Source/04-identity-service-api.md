# Identity Service API(身份服务 API)

> 原文:https://spec.matrix.org/v1.19/identity-service-api/
> 规范版本:v1.19 · 类型:API 参考

## 一句话概述(它解决什么问题、谁用、何时需要)

Matrix 的 Client-Server / Server-Server API 基本只用 Matrix 用户 ID(MXID)。Identity Service API 解决的是「有时候需要用第三方标识符(3PID,如邮箱、手机号)来指代用户」的问题:定义如何建立、验证、使用「3PID ↔ MXID」的映射。身份服务器(identity server)扮演「可信预言机」角色,声称已验证关联并用私钥签名其回答;但规范明确指出,「判断某个身份服务器是否可信,是客户端自己的事」。仅当涉及邮箱/手机号邀请、按邮箱/手机号查找已绑定的 Matrix 账号、注册时验证地址归属、或暂存邀请待投递时才会用到。

## 核心概念

- **3PID(third-party identifier)**:第三方标识符,类型见 3PID Types 附录;本 API 实际只涉及 `email`(邮箱)和 `msisdn`(手机号)两种媒介。
- **Session(会话)**:关联的建立基于会话。流程:`requestToken` 发起 → 服务器向用户邮箱/短信发送 token → 客户端经 `submitToken` 提交 token → 客户端将 3PID 绑定(bind)到 MXID。会话自最后一次修改(创建或验证)起 **24 小时**后过期;验证 token 最多 255 个 Unicode 码点,客户端必须原样透传。
- **哈希查找(hashing)**:客户端与服务器都必须至少支持 `sha256`。`sha256` 算法:对 `<address> <medium> <pepper>` 串做 SHA-256,再用 URL-safe 无填充 Base64 编码。`none` 算法发送明文 `<address> <medium>`,一般因隐私原因不鼓励,但允许(LDAP 后端的身份服务器等)。`lookup_pepper` 从 `/hash_details` 获取,「服务器应经常轮换该字符串」。
- **隐私方向**:API 只允许「3PID → MXID」单向映射——不能从用户 ID 反查其所有 3PID,也不能从 3PID 查别的 3PID。哈希是为了加大恶意服务器批量收集地址(尤其手机号)的难度。
- **关联流向的注意点**:所有权只能单向证明——「用户可把任意 MXID 关联到其已验证的 3PID」,即你可声称自己拥有的邮箱属于别人的 MXID。
- **Terms of Service(服务条款)**:服务器几乎可在任何需认证的端点上返回 403 `M_TERMS_NOT_SIGNED`。客户端随后 `GET /terms`、与用户账号数据 `m.accepted_terms`(含 `accepted` URL 数组的 message 事件)比对、展示未接受的条款、再 `POST /terms` 提交接受。服务器不得假设所有条款被一次性接受。
- **认证**:类似 Client-Server API 的 access token 概念,但身份服务器 token **不能**用于 Client-Server API 请求。token 放 `Authorization: Bearer ...` 头;`access_token` 查询参数虽支持,但自 v1.11 起已废弃(易泄漏进日志)。缺失/无效凭证返回 401 `M_UNAUTHORIZED`。注册:`POST /_matrix/identity/v2/account/register` 用 homeserver 的 OpenID token(`/openid/request_token` 返回的值)换取身份服务器 access token。`GET /terms`、`GET /versions`、状态检查无需认证。

## 主要端点 / 机制

### 通用 / 版本

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| GET | `/_matrix/identity/versions` | 否 | 列出支持的规范版本(如 `vX.Y`,历史 `rX.Y.Z`)。v1.1 加入。 |
| GET | `/_matrix/identity/v2` | 否 | 健康检查/就绪探针,返回 `{}`。 |

### 账户 / 条款 / 密钥

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| GET | `/_matrix/identity/v2/account` | 是 | 返回持有该 access token 的 `user_id`。 |
| POST | `/_matrix/identity/v2/account/logout` | 是 | 使 access token 失效。 |
| POST | `/_matrix/identity/v2/account/register` | 否 | 用 homeserver 签发的 OpenID token 换身份服务器 token。请求体:`access_token`、`expires_in`、`matrix_server_name`、`token_type`("Bearer")。 |
| GET | `/_matrix/identity/v2/terms` | 否 | 返回 `policies`(policy ID → policy 对象,含 `version` 和按语言键控的 `{name, url}`)。 |
| POST | `/_matrix/identity/v2/terms` | 是 | 请求体 `user_accepts`(URL 数组),追加到已接受条款。 |
| GET | `/_matrix/identity/v2/pubkey/ephemeral/isvalid` | 否 | 查询 `public_key`(无填充 Base64),判断短期公钥是否有效(用于 store-invite 密钥)。 |
| GET | `/_matrix/identity/v2/pubkey/isvalid` | 否 | 查询 `public_key`,判断长期公钥是否存在。 |
| GET | `/_matrix/identity/v2/pubkey/{keyId}` | 否 | 路径 `keyId` 形如 `algorithm:identifier`,返回 `public_key`,找不到返回 404。 |

### 关联查找

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| GET | `/_matrix/identity/v2/hash_details` | 是 | 返回 `algorithms`(必须含 `sha256`)和 `lookup_pepper`。 |
| POST | `/_matrix/identity/v2/lookup` | 是 | 请求体 `addresses`(数组)、`algorithm`、`pepper`(即使 `none` 也必填)。返回 `mappings`(地址 → MXID)。pepper 被轮换时返回 400 `M_INVALID_PEPPER`。 |

### 建立关联 —— 会话流程(validate)

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| POST | `/_matrix/identity/v2/validate/email/requestToken` | 是 | 请求体 `client_secret`、`email`、`next_link`(可选)、`send_attempt`。发邮件,返回 `sid`。 |
| POST | `/_matrix/identity/v2/validate/msisdn/requestToken` | 是 | 请求体 `client_secret`、`country`(ISO-3166-1 alpha-2)、`phone_number`、`next_link`(可选)、`send_attempt`。发短信,返回 `sid`。 |
| GET | `/_matrix/identity/v2/validate/email/submitToken` | 是 | 查询 `client_secret`、`sid`、`token`。面向浏览器终端用户,可 3XX 重定向到 `next_link`。 |
| POST | `/_matrix/identity/v2/validate/email/submitToken` | 是 | 同字段放请求体,返回 `success`。 |
| GET | `/_matrix/identity/v2/validate/msisdn/submitToken` | 是 | 同 email 的 GET,面向手机;人类可读响应,可重定向。 |
| POST | `/_matrix/identity/v2/validate/msisdn/submitToken` | 是 | 同 email 的 POST,返回 `success`。 |

### 建立关联 —— 绑定 / 解绑

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| POST | `/_matrix/identity/v2/3pid/bind` | 是 | 请求体 `client_secret`、`sid`、`mxid`。发布关联,此后 `/lookup` 返回它。响应含 `address`、`medium`、`mxid`、`not_after`、`not_before`、`ts`、`signatures`。错误:`M_SESSION_NOT_VALIDATED`、`M_SESSION_EXPIRED`、`M_NO_VALID_SESSION`(404)。 |
| GET | `/_matrix/identity/v2/3pid/getValidated3pid` | 是 | 查询 `client_secret`、`sid`。若已验证,返回 `address`、`medium`、`validated_at`(毫秒时间戳)。 |
| POST | `/_matrix/identity/v2/3pid/unbind` | 是 | 请求体 `mxid`(必填)、`threepid`(`address`+`medium`,必填),可选 `sid`+`client_secret`。移除关联;两种认证方式:homeserver 签名请求,或会话证明。 |

### 邀请暂存 / 签名

| 方法 | 端点 | 认证 | 用途 |
|---|---|---|---|
| POST | `/_matrix/identity/v2/store-invite` | 是 | 请求体 `address`、`medium`(必须为 `email`)、`room_id`(必填)、`sender`(必填),可选 `room_alias`、`room_avatar_url`、`room_join_rules`、`room_name`、`room_type`、`sender_avatar_url`、`sender_display_name`。创建 token、临时密钥、脱敏后的 `display_name`,并发邮件。返回 `token`、`display_name`、`public_keys`(服务器长期密钥 + 临时密钥及有效性 URL)。错误:`M_THREEPID_IN_USE`(带 `mxid` 属性)、不支持媒介时 `M_UNRECOGNIZED`。 |
| POST | `/_matrix/identity/v2/sign-ed25519` | 是 | 请求体 `mxid`、`token`、`private_key`(无填充 Base64)。根据 store-invite 的 token 找到 sender 并签名,响应含 `mxid`、`sender`、`token`、`signatures`。token 未知返回 404 `M_UNRECOGNIZED`。 |

## 易混淆点 / 笔记

- **身份服务器 token 与 homeserver access token 不通用**,不可混用。
- **lookup 是单向的**:只能 3PID→MXID,不能反向枚举。
- **`pepper` 会轮换**:客户端必须先从 `/hash_details` 取最新 pepper 再 lookup;轮换期间可能遇到 400 `M_INVALID_PEPPER`。
- **绑定可绑任意 MXID**:验证的只是「3PID 归你」,不验证「MXID 归你」。
- **store-invite 与 sign-ed25519 是配套的**:先 store-invite 生成 token + 临时密钥,邀请方用私钥 sign-ed25519,用于「邮箱邀请→注册/进房」链路。
- 规范标准:HTTPS 必须;JSON over HTTP;所有 POST/PUT(历史上除 `POST .../account/logout`)都要求 JSON 请求体(可为空);全部 JSON 用 UTF-8;建议加 CORS 头(面向浏览器客户端)。
- 标准错误码:`M_EMAIL_SEND_ERROR`、`M_INVALID_ADDRESS`、`M_INVALID_EMAIL`、`M_INVALID_PARAM`、`M_MISSING_PARAMS`、`M_NO_VALID_SESSION`、`M_NOT_FOUND`、`M_SEND_ERROR`、`M_SESSION_EXPIRED`、`M_SESSION_NOT_VALIDATED`、`M_THREEPID_IN_USE`、`M_UNKNOWN`、`M_UNRECOGNIZED`,以及端点专有的 `M_UNAUTHORIZED`、`M_TERMS_NOT_SIGNED`、`M_INVALID_PEPPER`、`M_TOKEN_INCORRECT`。错误体含 `errcode` 和 `error` 键。
- 版本说明:v2 是当前身份服务器接口,旧 r0.x 已被取代;哈希查找与轮换 pepper 是为降低地址收集风险引入(背景见 MSC2134);废弃行为包括验证端点上的 form-urlencoded 请求体、token 放查询串(v1.11 起)。
- 关联绑定后,身份服务器可通过联邦 `/3pid/onbind` 端点通知 homeserver;homeserver 会代理部分身份端点(如 `/register/email/requestToken`)并附加「地址是否已注册」等检查。

## 与自托管聊天项目(Babacom)的相关性

**25 人封闭圈大概率用不到 Identity Service**。身份服务只服务于「邮箱/手机号 ↔ MXID」场景:邮箱邀请陌生人、按邮箱/手机号查号、注册时验证地址。封闭小圈子的成员由管理员直接创建账号、用 MXID 直接邀请即可,不需要部署或对接独立的 identity server(它本质是独立组件,还要签 OpenID、维护条款与轮换 pepper)。仅当 Babacom 未来要支持「用邮箱邀请圈外人自助注册/入圈」时,才需要评估自建 identity server(如 Sydent)或对接第三方身份服务。

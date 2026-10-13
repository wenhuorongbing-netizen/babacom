# Push Gateway API(推送网关 API)

> 原文:https://spec.matrix.org/v1.19/push-gateway-api/
> 规范版本:v1.19 · 类型:API 参考

## 一句话概述(它解决什么问题、谁用、何时需要)

当事件到达 homeserver 时,移动端/桌面客户端需要收到推送通知。homeserver 不直接对接各家厂商推送服务,而是先把事件数据通过本 API 交给一个**中间实体——Push Gateway(推送网关)**,由网关再投递给 APNS / GCM(现在多为 FCM)等推送服务商。调用链:homeserver → Push Gateway → Push Provider → 移动设备/客户端。仅在客户端注册了 HTTP pusher、需要离线推送/角标更新时才有意义。

## 核心概念

- **HTTP pusher / notify 端点**:homeserver 把事件信息转发给网关的机制。
- **pushkey**:创建 pusher 时给的标识,用于识别投递目标设备。
- **app_id**:创建 pusher 时设置的应用标识。
- **PusherData**:创建 pusher 时传入的额外数据(去掉 `url` 键),含 `format` 字段(发送通知所用的格式)。
- **Tweaks(微调)**:对通知呈现的自定义,由 push rules 附加(如声音)。
- **Counts / badge counts(未读数/角标)**:`/notify` 请求可携带未读数字,用于角标更新。
- **去重**:事件通知应依据 `event_id` 去重,因为 HTTP API 重试可能造成重复提醒;未读数的更新则应是幂等的(无需去重)。
- **pusher 创建**:客户端通过 Client-Server API 的 `POST /_matrix/client/v3/pushers/set` 配置 pusher 的完整 URI(即网关地址)。

## 主要端点 / 机制

| 方法 | 端点 | 用途 | 限流 | 认证 |
|---|---|---|---|---|
| POST | `/_matrix/push/v1/notify` | 通知网关一个事件,和/或更新某用户的未读数。 | 否 | 否 |

### 请求格式 —— `POST /_matrix/push/v1/notify`

顶层请求体必含 `notification` 对象。

**`notification` 对象字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `content` | EventContent | 事件的 `content` 字段(如有);pusher 可省略。 |
| `counts` | Counts | 当前未确认计数;零值应省略。 |
| `devices` | Device[] | **必填**。通知应送达的设备列表。 |
| `event_id` | string | 事件 ID;「若通知是关于某个具体 Matrix 事件则必填」,纯角标更新可省略。用于去重。 |
| `prio` | string | `high` 或 `low`,默认 `high`;让网关以更省电的方式投递低时效推送。 |
| `room_alias` | string | 房间别名(用于显示)。 |
| `room_id` | string | 房间 ID;「通知涉及具体事件时必填」。 |
| `room_name` | string | 房间名。 |
| `sender` | string | 事件发送者的 Matrix ID。 |
| `sender_display_name` | string | 发送者在房间内当前的显示名。 |
| `type` | string | 事件的 `type`。 |
| `user_is_target` | boolean | 接收用户是否为成员事件主体(即 `state_key` 等于该用户 MXID)时为 true。 |

**`counts` 对象字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `missed_calls` | integer | 用户所在所有房间未确认的未接来电数。 |
| `unread` | integer | 用户所在所有房间未读消息数。 |

**`device` 对象字段**

| 字段 | 类型 | 说明 |
|---|---|---|
| `app_id` | string | **必填**。创建 pusher 时设置。 |
| `data` | PusherData | pusher 专属额外数据,来自创建时(去掉 `url` 键)。 |
| `pushkey` | string | **必填**。创建 pusher 时设置。 |
| `pushkey_ts` | integer | pushkey 最近更新的 Unix 时间戳(秒)。 |
| `tweaks` | Tweaks | push rules 附加的呈现自定义。 |

**`PusherData` 字段**:`format`(string)——发送通知所用格式(如 `event_id_only`)。

### 响应格式

- **200**:返回被拒绝的 pushkey 列表。
  - `rejected`(string[],**必填**):请求中所有无效(已过期或从未有效)的 pushkey。homeserver「必须停止向这些 pushkey 发送通知并删除相应 pusher」。可能包含本次之外、此前通知里的 key;可为空数组。

## 易混淆点 / 笔记

- **Push Gateway 是独立部署组件**,不在 homeserver 内;homeserver 通过 Client-Server API 的 pusher 配置拿到网关 URL,再向网关发 `notify`。
- **homeserver 侧行为**:网关返回 HTTP 错误时,homeserver「应以指数退避重试合理时长」。规范文本确认了指数退避重试。
- **`format: "event_id_only"` 时**,只要求 `event_id`、`room_id`、`counts`、`devices` 四个字段,其余可省——这是省流/省电模式。
- **`rejected` 的语义是「删除」**:一旦某 pushkey 出现在 rejected 里,homeserver 必须停止推送并删掉对应 pusher。
- **认证/限流都没有**:端点公开,靠 pushkey 的私密性 + 网关自己校验 pushkey 有效性。
- 绝大多数 push 规则、计数、tweak 行为由 Client-Server API 的 **Push Module** 定义,本页只是「HTTP pusher 与网关之间的报文格式」。
- 错误约定:未知端点 404 `M_UNRECOGNIZED`;已知端点用错方法 405 `M_UNRECOGNIZED`。

## 与自托管聊天项目(Babacom)的相关性

**Push Gateway 只在需要移动端推送时才有意义**。纯自托管、Web/桌面端在线的 25 人封闭圈,通常直接靠长连接(Sync)实时收消息,不需要离线推送,也就用不到 Push Gateway。只有当 Babacom 出了手机 App、要求「App 被杀/在后台也能收到消息提醒、显示未读角标」时,才需要:要么自建一个实现本页 `POST /_matrix/push/v1/notify` 的网关去对接 APNS/FCM(如 matrix 生态的 sygnal),要么用支持推送的现成方案。注意它不是独立聊天协议的一部分,而是「homeserver 与厂商推送之间的报文约定」。

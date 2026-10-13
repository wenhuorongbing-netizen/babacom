# Room Versions(房间版本)

> 原文:https://spec.matrix.org/v1.19/rooms/
> 规范版本:v1.19 · 类型:协议机制

## 一句话概述

Room version(房间版本)决定了一个房间在协议层面的「规则集」:用什么状态解析算法(state resolution)、套用哪一套授权规则(auth rules)、事件的格式与 ID 怎么生成(事件格式 / event format)、如何执行 redaction 等。同一个 homeserver 可以同时托管不同 room version 的房间;版本一旦发布即不可变(immutable),版本之间没有隐含的先后或层级关系,房间可以在版本之间自由升级或降级。

## 演进总览表

| 版本 | 引入 / 变化 | 状态解析算法 | 关键特性 |
|---|---|---|---|
| v1 | 初始版本 | 原始算法(有已知 bug,导致状态重置) | 事件 ID `$opaque_id:domain`;redaction 是 auth Rule 11 |
| v2 | 引入 state resolution v2 | state resolution v2 | 修复 v1 状态重置类 bug,其余与 v1 相同 |
| v3 | 事件 ID 改为事件哈希 | state resolution v2(不变) | 事件 ID = reference hash(非 URL-safe Base64);redaction 移出 auth rules;federation 上不再传输 event_id |
| v4 | 事件 ID 改用 URL-safe Base64 | state resolution v2(不变) | 解决 v3 ID 中 `/` 等字符的兼容问题 |
| v5 | 强制签名密钥有效期 | state resolution v2(不变) | 校验 `valid_until_ts`;封顶 7 天 |
| v6 | 修改 auth rules;严格 Canonical JSON | state resolution v2(不变) | 移除 `m.room.aliases` 专用规则;`m.room.power_levels` 增加 `notifications`;float 不再允许 |
| v7 | 引入 knocking(knock) | state resolution v2(不变) | 新增 `knock` membership 与 `knock` join rule |
| v8 | 新增 `restricted` join rule | state resolution v2(不变) | 允许另一房间成员免邀请加入;已知 redaction 缺陷 |
| v9 | 修复 v8 的 redaction 缺陷 | state resolution v2(不变) | `m.room.member` redaction 保留 `join_authorised_via_users_server` |
| v10 | power levels 仅限整数;新增 `knock_restricted` | state resolution v2(不变) | 移除 string/float 兼容;`knock_restricted` = restricted + knock 组合 |
| v11 | 澄清 redaction 算法 | state resolution v2(不变) | `m.room.create` 去掉 `creator`;`redacts` 移入 `content`;redaction 保护键精简 |
| v12 | room ID 改为 create 事件哈希;creator 无限 power;迭代 state resolution | state resolution v2 的迭代版(3 处修改) | room ID = create 事件的哈希(`!` sigil);creator 正式化;新增 conflicted state subgraph |

## Room Version 1..12

以下每节只写「相对上一版的变化」;未列出的部分(如 redaction 键保留列表、PDU 结构、Canonical JSON 处理)沿袭上一版。

### Room Version 1

- 定义:Matrix 的第一个房间版本,是后续版本的基础构件;规范明确提示其存在「undesirable effects」与「inconsistencies」。
- 状态解析:使用**原始(第一代)算法**,已知会触发状态重置类 bug——例如成员被移除、moderator 掉权、被封禁用户重新加入、房间名/主题回退等。该问题在 v2 引入的 state resolution v2 中修复。
- 事件 ID:格式 `$opaque_id:domain`,`domain` 为创建 homeserver 的 server name,`opaque_id` 本地唯一;domain 仅用于命名空间,不代表事件仍可从该服务器获取。
- auth rules:共 11 条,其中 **Rule 11 处理 `m.room.redaction`**(发送者 power ≥ redact level,或两事件同 domain),即 redaction 是 auth rules 的一部分。
- redaction:收到 redaction 时,仅保留指定顶层键,并按事件类型保留少量 content 键(`m.room.member`→`membership`、`m.room.create`→`creator`、`m.room.join_rules`→`join_rule`、`m.room.power_levels`→`ban/events/events_default/kick/redact/state_default/users/users_default`、`m.room.aliases`→`aliases`、`m.room.history_visibility`→`history_visibility`)。
- 事件格式:PDU 结构,`auth_events`(≤10)、`depth`(< 2^63−1)、`prev_events`(≤20)等。
- Canonical JSON:服务器 MUST NOT 严格强制。

### Room Version 2

- 相对 v1 的变化:**仅状态解析算法**。引入 **state resolution v2**,其余(redaction、事件 ID、事件格式、auth rules)与 v1 相同,无客户端侧影响。
- state resolution v2 关键概念:power events(`m.room.power_levels`、`m.room.join_rules`,或 sender ≠ state_key 的 `m.room.member` leave/ban)、unconflicted state map / conflicted state set、auth chain、auth difference、full conflicted set、reverse topological power ordering、mainline ordering、iterative auth checks。
- 算法五步:① 取 full conflicted set 中的 power events 及其 auth chain 交集,按 reverse topological power ordering 排序;② 从 unconflicted state map 出发做 iterative auth checks;③ 其余事件按 mainline ordering 排序;④ 再做一次 iterative auth checks;⑤ 用 unconflicted state map 覆盖同键事件,得到最终状态。

### Room Version 3

- 相对 v2 的变化:**事件格式**。客户端基本无感(除事件 ID 格式),主要影响服务端实现。
- 事件 ID:改为**事件的 reference hash 用 Unpadded Base64 编码**,前缀 `$`,不再带 domain;示例 `$acR1l0raoZnm60CBwAVgqbZqoO/mYU81xysh1u7XcJk`(注意其中含 `/`)。
- federation 事件:不再包含 `event_id` 字段(由接收方自行计算);`auth_events` / `prev_events` 变为纯事件 ID 列表(不再是 `(event_id, hash)` 对)。
- redaction:从 auth rules 中移除(Rule 11 不复存在),`m.room.redaction` 像普通事件一样走 auth rules;是否真正执行 redaction 改由独立逻辑判断(发送者 power ≥ redact level,或两者 sender domain 相同)。
- auth rules 相应重排(remove 了 redaction 那条,规则从 11 条变 10 条,编号 1–10),核心语义不变。

### Room Version 4

- 相对 v3 的变化:**事件 ID 编码改为 URL-safe unpadded Base64**(解决 v3 中 `/` 等字符给客户端 URL 编码与反向代理带来的问题)。
- 事件 ID 仍为 reference hash,前缀 `$`,无 domain;示例 `$Rqnc-F-dvnEYJTyHq_iKxU2bZ1CI92-kuZq3a5lr5Zg`。
- 其余(auth rules、state resolution、redaction、事件格式)与 v3 完全相同。

### Room Version 5

- 相对 v4 的变化:**强制签名密钥有效期(enforce signing key validity periods)**。
- 校验事件签名时,必须确保密钥的 `valid_until_ts` ≥ 事件的 `origin_server_ts`;缺失密钥时须通过 `GET /_matrix/key/v2/server` 或 `POST /_matrix/key/v2/query` 获取,`/query` 时设置 `minimum_valid_until_ts`;评估有效性时取 `valid_until_ts` 与「未来 7 天」的较小者(避免攻击者发布长期有效、难以撤销的密钥)。
- 无客户端侧影响。其余与 v4 相同。

### Room Version 6

- 相对 v5 的变化:**修改授权规则 + 严格 Canonical JSON**。
- auth rules 变化:① 删除针对 `m.room.aliases` 的专用规则(原 Rule 4),此类事件仍需满足通用 state-event 检查;② `m.room.power_levels` 的规则纳入 `notifications` 属性(与 `events` 并列)。
- redaction:`m.room.aliases` 在 redaction 算法中的所有实质含义被移除(不再在 content 保留列表中)。
- 事件格式:严格 Canonical JSON 后,`depth` 上限被降低,**数值不再允许以 float 形式出现**。
- Canonical JSON:服务器 **MUST 严格强制**;违规在 Client-Server 端点返回 400 `M_BAD_JSON`,federation 上直接丢弃该事件。

### Room Version 7

- 相对 v6 的变化:**引入 knocking(knock)**。v7 是第一个完整支持 knocking 的版本。
- 新增 `knock` membership 规则:`join_rule` 必须恰为 `knock`;`sender` 必须等于 `state_key`(只能替自己 knock);当前 membership 不得为 `ban`/`invite`/`join`。
- join 规则扩展:`join_rule` 为 `invite` **或** `knock` 时,若当前 membership 为 `invite` 或 `join` 则允许 join。
- leave 规则扩展:匹配 `state_key` 的用户在当前 membership 为 `invite`、`join` **或** `knock` 时可 leave(拒绝邀请或撤回 knock)。

### Room Version 8

- 相对 v7 的变化:**新增 `restricted` join rule**,允许「另一房间的成员」免邀请加入本房间。
- `m.room.member` 相关规则:若 content 含 `join_authorised_via_users_server`,该事件必须由该 user ID 所指向的 homeserver 有效签名;加入 restricted 房间时,授权用户须「有 invite 权限」或「是该房间的已加入成员」。
- redaction 变化:`m.room.join_rules` 的 content 在 redaction 时额外保留 `allow`。
- 已知缺陷:规范明确提示 v8 存在与「member join 事件被 redact」相关的问题,建议新建房间时优先用 v9。

### Room Version 9

- 相对 v8 的变化:**修复 v8 的 redaction 缺陷**(仅此一处实质变化)。
- redaction 修复:`m.room.member` 事件被 redact 时,content 额外保留 `join_authorised_via_users_server`。缺少该键会导致 redacted join 事件在验证 auth chain 时失效,造成「同一用户在不同服务器视角下状态分裂(split-brain)」的问题(对应 GitHub issue #3373)。
- auth rules 与 v8 相同,无变化。

### Room Version 10

- 相对 v9 的变化:① **power levels 仅限整数**;② 新增 **`knock_restricted` join rule**。
- power levels:移除 v9 中「string/float 兼容」的向后兼容豁免;`users_default`、`events_default`、`state_default`、`ban`、`redact`、`kick`、`invite` 及 `events`/`notifications`/`users` 中的值若存在必须是整数,否则按 auth rules 拒绝。
- `knock_restricted`:restricted 与 knock 的组合——满足 restricted 条件或满足 knock 条件之一即可加入(此前二者无法同时使用)。
- knock 规则更新:`membership: knock` 要求 `join_rule` 为 `knock` **或** `knock_restricted`。
- redaction 语义与 v9 完全相同,无变化。

### Room Version 11

- 相对 v10 的变化:**澄清(精简)redaction 算法 + 若干事件结构调整**。
- redaction 保护键精简:顶层键 `origin`、`membership`、`prev_state` **不再被 redaction 保护**(会被剥离)。顶层保留键变为 `event_id`、`type`、`room_id`、`sender`、`state_key`、`content`、`hashes`、`signatures`、`depth`、`prev_events`、`auth_events`、`origin_server_ts`。
- content 保留键调整:`m.room.create` 保留全部 keys;`m.room.power_levels` 额外保留 `invite`;`m.room.member` 的 `third_party_invite` 仅保留嵌套 `signed` 键;`m.room.redaction` 保留 `redacts`。
- `m.room.create` 的 `content` 不再包含 `creator`(以前恒等于 sender),客户端应改用 `sender` 判断创建者。
- `m.room.redaction` 的 `redacts` 从顶层属性移入 `content`;兼容上,服务器经 Client-Server API 提供 v11 事件时应仍暴露顶层 `redacts`,提供旧版本事件时应补 `content.redacts`。
- knock 规则无 v11 变化(沿用 v10)。

### Room Version 12

- 相对 v11 的变化:**room ID 格式、creator 正式化、state resolution 迭代**。
- room ID:改为 **create 事件的哈希**,去掉 domain 后缀;sigil 用 `!` 代替 `$`(room ID 即 create 事件的事件 ID,但把 `$` 换成 `!`)。示例 `!Nhcu5BS-UMnFX7hBVfVSoXiD7OgH6iRT-xyIuqDnpYQ`。`m.room.create` 事件本身不再包含 `room_id` 字段(有则拒绝)。
- creator 正式化:creator = create 事件的 `sender` + `content.additional_creators` 中列出的用户;creator 拥有**无限大 power level**,不得出现在 `m.room.power_levels` 的 `users` 中,且创建后不可变更。
- auth rules 变化:create 事件若带 `room_id` 则拒绝;`additional_creators` 若非「通过与 sender 相同校验的用户 ID 字符串数组」则拒绝;事件 `room_id` 必须对应一个被接受(未被拒绝)的 create 事件;auth events 选择算法中 **`m.room.create` MUST NOT 被选中**;`m.room.power_levels` 的 `users` 含 create 事件 sender 或任何 additional_creators 则拒绝。
- state resolution:**仍是 v2 算法的演进**,三处修改:① iterative auth checks 从**空 state map**开始(而非 unconflicted state map);② 新增 **conflicted state subgraph** 定义(沿 auth_events 边连接 conflicted state set 中的事件);③ full conflicted set 定义扩展为「conflicted state set ∪ conflicted state subgraph ∪ auth difference」。
- redaction 保留键与 v11 相同。

## 默认版本与客户端兼容

- **默认版本**:规范要求服务器在创建新房间时 **SHOULD 使用 room version 12** 作为默认。
- **版本命名规范**:room version 必须非空、≤ 32 个 codepoint,仅包含 `a-z`、`0-9`、`.`、`-`;仅由数字和点组成的版本名保留给 Matrix 协议自身使用。
- **`M_UNSUPPORTED_ROOM_VERSION`**:客户端创建房间时使用了服务器不支持的 room version(对应 `POST /_matrix/client/v3/createRoom`)。
- **`M_INCOMPATIBLE_ROOM_VERSION`**:客户端尝试加入的房间版本服务器不支持(对应 `POST /_matrix/client/v3/join/{roomIdOrAlias}` 与 `POST /_matrix/client/v3/rooms/{roomId}/join`);错误响应的 `room_version` 字段会给出该房间的版本,客户端可据此提示升级或换服务器。

## 易混淆点 / 笔记

- 「state resolution v2」是**算法名**,不是 room version 号:v2 及以上到 v11 都在用这套算法,v12 是它的迭代版。不要把它和「room version 2」混为一谈。
- v3 的 redaction 变化经常被忽略:从 v3 起,redaction **不再是 auth rules 的一环**,auth 阶段不检查 redact level;是否真正执行 redaction 由独立的「power ≥ redact level 或同 domain」判断完成。
- v6 的 Canonical JSON 从「不强制」翻转为「强制」,这是服务端行为的分水岭:违规事件会直接失败(400 / 丢弃)。
- v8 是「过渡性」版本:规范自己提醒其 redaction 缺陷并建议用 v9,因此实际部署很少单独停留在 v8。
- 事件 ID 的演变是主线:v1/v2 带 domain(`$opaque_id:domain`)→ v3 去 domain、非 URL-safe 哈希 → v4 改为 URL-safe;客户端应始终把事件 ID 当**不透明标识符**处理。
- v11 起 `m.room.create` 不再有 `creator`,`redacts` 也移入 `content`;处理跨版本兼容(尤其新旧客户端并存)时需要做字段补齐。

## 与自托管聊天项目(Babacom)的相关性

- **自托管新房间应选哪个版本**:直接使用服务器默认(即 **v12**)即可。自托管场景下所有房间都由自己(或自己信任的服务器群)创建,不存在需要兼容远古旧客户端/旧服务器的历史包袱,选最新稳定版(v12)能拿到最完善的规则语义(creator 无限 power、更清晰的 redaction、更稳健的 state resolution)。
- **为什么通常用最新稳定版**:room version 之间没有层级/先后语义,但较新版本要么修复了旧版缺陷(v2 修 v1 的状态重置、v9 修 v8 的 redaction 缺陷),要么新增了现代特性(v7 knock、v8/v10 restricted/knock_restricted、v12 creator 机制)。对单机/小集群自托管,直接锁定默认版本最省心。
- **兼容性要点**:Babacom 若作为 homeserver 实现,至少要对「收到未知/过旧 room version 事件」与「创建房间时指定了不支持的 room_version」分别返回 `M_INCOMPATIBLE_ROOM_VERSION` / `M_UNSUPPORTED_ROOM_VERSION`;若加入外部联邦,还需按 room version 正确解析事件(尤其是 v3 起 federation 不再带 event_id、v6 起强制 Canonical JSON 这两处)。
- **受限与邀请类房间**:若 Babacom 后续做社区/空间(Space)或需要「凭另一房间成员身份加入」,需要 v8+ 的 `restricted`(或 v10+ 的 `knock_restricted`);需要敲门(knock)则至少 v7。这些都要求房间版本 ≥ 对应版本,旧版本房间无法直接使用这些 join rule。

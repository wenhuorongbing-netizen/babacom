# 附录(Appendices)

> 原文:https://spec.matrix.org/v1.19/appendices/
> 规范版本:v1.19 · 类型:附录

## 一句话概述

附录是一组跨 API 通用的基础规范,共 11 节:Unpadded Base64、Binary data、Signing JSON + Canonical JSON、Identifier Grammar、Cryptographic key representation、3PID Types、Glob-style matching、Dot-separated property paths、Security Threat Model、Cryptographic Test Vectors、Conventions。其中 **Canonical JSON / Signing JSON 是整个联邦信任的根基**(所有跨服务器事件靠它做确定性序列化与签名验证),**Identifier Grammar** 定义了用户/房间/事件/服务器名的精确格式,**Security Threat Model** 给出了攻击面分类。

## 核心内容(逐节)

### 1. Unpadded Base64

- 即标准 Base64(RFC 4648),但**去掉 `=` 填充**;
- 字母表同 RFC 4648:A–Z、a–z、0–9、`+`、`/`;
- 示例:`""→""`、`"f"→"Zg"`、`"fo"→"Zm8"`、`"foo"→"Zm9v"`、`"foobar"→"Zm9vYmFy"`;
- 解码时实现 SHOULD 接受「带/不带填充」的输入,以求最大互操作;
- **URL-safe 变体**:字符 62 用 `-`、字符 63 用 `_`(对应 RFC 4648 §5),其余同上(v1.19 新增明确规范)。

### 2. Binary data(二进制数据)

- JSON 无法安全承载原始二进制,因此所有二进制值(公钥、签名)在 JSON 中都编码为 unpadded Base64 字符串;
- 规范中提到「opaque byte / opaque Base64」值时,其「不透明」是**在 Base64 解码之后**而言,而非编码形态;
- 实现可在任意时刻校验 Base64 合法性并拒绝非法值,但这不是强制要求;
- 未来若出现不使用 JSON 的协议改造,可能完全跳过 Base64。

### 3. Signing JSON 与 Canonical JSON(重点)

#### Canonical JSON 规则

Canonical JSON 定义为 *"the shortest UTF-8 JSON encoding with dictionary keys lexicographically sorted by Unicode codepoint"*(最短 UTF-8 JSON 编码 + 字典键按 Unicode 码点字典序排序)。具体约束:

- 数字必须是整数,范围 `[-(2**53)+1, (2**53)-1]`;
- 数字不得有指数或小数点;
- **不允许负零(`-0`)**;
- 不允许 float;
- 键按 Unicode 码点字典序排序(如 `"日"` 排在 `"本"` 之前);
- 非 ASCII 字符用 UTF-8 编码,**不使用 `\u` 转义**;
- 无多余空白。

理由:UTF-8 到处可用;排序键保证一致顺序;整数范围正好匹配 IEEE 双精度浮点可精确表示的范围。文法从 RFC 7159 改写(ABNF),去掉了无意义空白、小数、指数与冗余字符转义;只允许少量转义序列:`\b`、`\t`、`\n`、`\f`、`\r`、`\"`、`\\`,以及 `\u000X`/`\u001X` 形式用于缺少专用转义的控制字符。

> 注意:room versions 1–5 的事件可能不完全满足这些限制(尤其是整数可能越界),服务器 SHOULD 尽量兼容处理这类 JSON。

Canonical JSON 示例:输入 `{"b":"2","a":"1"}` → 输出 `{"a":"1","b":"2"}`;含 `"-0"` 与 `"1e10"` 的输入 → 输出 `{"a":0,"b":10000000000}`。

#### 签名流程(Signing)

1. 从 JSON 中移除 `signatures` 与 `unsigned` 对象;
2. 对剩余 JSON 做 Canonical 编码;
3. 用签名算法(当前为 `ed25519`,由 NaCl 实现)对 Canonical 字节签名;
4. 对签名做(无填充)Base64 编码;
5. **签名密钥标识(signing key identifier)** = `签名算法 + ":" + 密钥标识`,例如 `ed25519:1`;
6. 把结果签名写进 `signatures` 对象、挂在签名实体名下,然后把 `signatures` 与 `unsigned` 放回原对象。

关键点:`unsigned` 与 `signatures` **都不被签名覆盖**,因此中间实体可以追加 unsigned 数据(如时间戳)与更多签名。规范给出 Python 伪码:`json.dumps` 用 `ensure_ascii=False`、`separators=(',',':')`、`sort_keys=True`,再 UTF-8 编码。

#### 验签流程(Verification)

1. 检查 `signatures` 里是否有该实体名的条目,没有则失败;
2. 剔除实现不认识的签名算法对应的密钥标识,若剩下为空则失败;
3. 为剩余密钥标识查找验证密钥(本地缓存或可信密钥服务器),找不到则失败;
4. Base64 解码签名,解码失败则失败;
5. 从对象中移除 `signatures` 与 `unsigned`;
6. 对其余部分做 Canonical 编码;
7. 用验证密钥对该编码对象验签。

> **为何它是联邦信任根基**:联邦上所有跨服务器事件都携带 `signatures`/`hashes`,接收方必须对同一份事件字节算出完全相同的 Canonical 形式才能验签。任何键排序、转义、整数表示、负零处理的偏差,都会导致「同一 JSON 在不同实现下字节不同 → 签名验证失败 → 联邦拒绝」,因此 Canonical JSON 是最容易踩坑、也必须严格一致的环节。

### 4. Identifier Grammar(标识符文法,重点)

#### 通用命名空间标识符(Common Namespaced Identifier,自 v1.2)

- 长度 1–255 字符;
- 必须以 `[a-z]` 开头,整体只由 `[a-z]`、`[0-9]`、`-`、`_`、`.` 组成;
- 以 `m.` 开头的标识符保留给官方 Matrix 规范;
- 非规范标识符 SHOULD 遵循 Java 包命名约定(reverse DNS,如 `com.example.identifier`)。

#### Server Name(服务器名)

ABNF 风格:

```
server_name = hostname [ ":" port ]
port        = 1*5DIGIT
hostname    = IPv4address / "[" IPv6address "]" / dns-name
```

- IPv4 字面量:四个 0–255 十进制数,点分隔;
- IPv6 字面量:按 RFC 3513 §2.2,放方括号内;
- 可选数字端口后缀;
- **服务器名区分大小写**:`@user:matrix.org` ≠ `@user:MATRIX.ORG`;
- 建议:完整服务器名 ≤ 230 字符,避免大写。

#### 通用标识符格式

形式 `&localpart:domain`,`&` 是 sigil(印记符号):`@` 用户、`!` 房间、`$` 事件、`#` 房间别名。`domain` 是分配该标识符的 homeserver 的 server name;`:` 读作 "on"。

#### User ID(用户 ID,v1.8 起变更)

格式 `@localpart:domain`:

- `localpart` MUST NOT 为空;允许字符:`a-z`、`0-9`、`.`、`_`、`=`、`-`、`/`、`+`;
- 总长(含 `@` 与 domain)MUST NOT 超过 255 字节;
- **禁止大写**,以防大小写冲突(因为 ID 会出现在 `m.room.member` 的 `state_key` 等大小写敏感场景);
- **禁止 `*`**,因为它在部分 API(如 filter)里用作通配符。

```
user_id = "@" user_id_localpart ":" server_name
user_id_localpart = 1*user_id_char
user_id_char = DIGIT / %x61-7A / "-" / "." / "=" / "_" / "/" / "+"
```

**历史 User ID**:旧版本允许更宽字符;实现 MUST 接受「localpart 由任意合法非代理 Unicode 码点(除 `:` 与 NUL)组成、含空串」的用户 ID。超出 U+0021–U+007E 或为空的 localpart 属「non-compliant」。服务器必须仍接受联邦上携带此类 ID 的事件,但 SHOULD 不把这类 ID 转发给事件上下文之外的客户端。该历史字符集已废弃(deprecated)。

**其他字符集映射算法(建议)**:UTF-8 编码 → A–Z 转小写(需区分大小写时把大写转义为 `_a`,真实 `_` 转义为 `__`)→ 其余不在允许集内的字节(以及 `=`)用 `=` 前缀做十六进制编码(例:`#`→`=23`;`á`→`=c3=a1`)。

#### Room ID(房间 ID,v1.16 起变更)

按 room version 区分:

- **带 domain(旧版本)**:`!opaque_id:domain`。localpart 可为任意合法非代理 Unicode 码点(除 `:` 与 NUL),但生成时 SHOULD 只用字母数字。总长(sigil + localpart + domain)≤ 255 字节。domain 只减少命名空间碰撞,不表示房间仍存在于该服务器;
- **不带 domain(新版本)**:room ID 就是 `m.room.create` 事件的 ID,把 sigil 从 `$` 换成 `!`,文法直接从 event ID 继承。

Room ID 区分大小写、不供人类阅读,客户端必须把它当不透明字符串处理。

#### Room Alias(房间别名)

格式 `#room_alias:domain`:

- `domain` 是创建该别名的 homeserver 的 server name,其他服务器联系它来查找别名;
- localpart 可为任意合法非代理 Unicode 码点(除 `:` 与 NUL);
- 总长(含 sigil 与 domain)≤ 255 字节。

#### Event ID(事件 ID)

格式 `$opaque_id`:

- 精确格式取决于 room version:早期版本含 `domain` 分量;新版本为 base64 编码的哈希、无 domain;
- 总长(含 sigil 与 domain,如存在)≤ 255 字节;
- 区分大小写、不供人类阅读,当不透明字符串处理。

#### URIs(统一资源标识符)

两类:`matrix:` URI scheme(v1.2 引入)与 matrix.to(较老的命名空间 URI)。

**matrix: URI scheme**(遵循 RFC 3986):

```
matrix:[//{authority}/]{type}/{id without sigil}[/{type}/{id without sigil}...][?{query}][#{fragment}]
```

类型映射:`r` = 房间别名、`u` = 用户、`roomid` = 房间 ID、`e` = 事件(仅能跟在 `roomid` 之后;跟在 `r` 之后自 v1.11 弃用)。旧类型 `user`/`room`/`event` MUST NOT 再产生,但可被解释为 `u`/`r`/`e`。`authority` 与 `fragment` 目前未使用/保留。查询参数:`action=join`(意图加入房间,客户端应提示确认)、`action=chat`(意图与用户开/进入 DM,优先复用已有规范 DM)、`via`(路由用服务器,可多个,房间 ID 建议提供)、自定义参数遵循通用命名空间标识符格式并需百分号编码。示例:`matrix:r/somewhere:example.org`、`matrix:roomid/somewhere:example.org?via=elsewhere.ca`、`matrix:u/alice:example.org?action=chat`。

**matrix.to 导航**:格式 `https://matrix.to/#/<identifier>/<extra parameter>?<additional arguments>`;identifier 为房间 ID、房间别名或用户 ID;extra parameter 用于事件 ID permalink;各分量 MUST 按 RFC 3986 百分号编码(历史客户端常未完全编码)。客户端不应依赖 Web 服务器,而应在应用内处理 URI。别名后的事件 ID 自 v1.11 弃用;历史「groups」URI 使用 `+` sigil(如 `%2Bexample%3Aexample.org`)。

#### Routing(路由)

Room ID 本身不可路由,需 `via` 参数提供至少一个服务器。推荐挑选 3 个不重复服务器:

1. 最高 power level 用户(≥50)的服务器;否则最热门服务器;
2. 按人口(成员数)次高的服务器;
3. 再次之。

绝不选择:被服务器 ACL 屏蔽的服务器、或 IP 地址服务器。若房间用户不足,只提供可用的即可。

#### Opaque Identifiers(不透明标识符)

- 允许字符:`[0-9]`、`[A-Z]`、`[a-z]`、`-`、`.`、`_`、`~`;
- 长度 1–255 字符(除非另有规定);
- 对应 RFC 3986 §2.3 的 unreserved 字符集。

### 5. Cryptographic key representation(密码学密钥表示)

用于在 UI 中展示私钥:

1. 构造字节数组:两个头字节 `0x8B`、`0x01`,后接原始密钥;
2. 把所有字节(含头字节)XOR 成一个奇偶校验字节,追加到末尾;
3. 用 base58 编码,字母表用比特币字母表:`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`;
4. 每 4 个字符后插入一个空格。

读取时逆向:去空白 → base58 解码 → 去掉校验字节 → 去掉 2 个头字节。

### 6. 3PID Types(第三方标识符类型)

第三方标识符是一个 `(medium, address)` 元组:`medium` 是命名空间字符串,`address` 是该命名空间内的**规范(canonical)字符串**——多个表示同一标识符的字符串中只采用一个。

- **E-Mail**:medium `email`;address 为原始 `user@domain` 形式,domain 小写;不含显示名、尖括号或 `mailto:` 前缀;应做 Unicode Caseless Matching(如 `Strauß@Example.com` 视作小写等价)。
- **PSTN 电话号码**:medium `msisdn`;address 为 E.164 形式的 MSISDN,**不带**前导 `+`。

### 7. Glob-style matching(通配符匹配)

- `*` 匹配 0 个或多个字符;
- `?` 匹配恰好 1 个字符。

### 8. Dot-separated property paths(点分隔属性路径)

- 属性路径用点连接名称(如 `content.body`);
- 属性名里的字面点与反斜杠必须用反斜杠转义:`m.relates_to`(位于 `content`)写作 `content.m\.relates_to`;名为 `m\foo` 的属性写作 `content.m\\foo`;
- 其他转义序列保持原样(如 `\x` 就是「反斜杠 + x」);
- 实现不应做冗余转义;其他序列保留(reserved)。

### 9. Security Threat Model(安全威胁模型,重点)

按攻击目标分类,共四大类(每类下列出具体攻击面):

#### Denial of Service(拒绝服务)

目标:破坏对手服务/营销、审查某讨论或参与者、进行破坏。

- **Resource Exhaustion(资源耗尽)**:耗尽受害服务器资源(TCP 连接、CPU、内存、磁盘);
- **Unrecoverable Consistency Violations(不可恢复的一致性破坏)**:制造「split-brain」状态,使服务器无法得出一致的房间状态;
- **Bad History(坏历史)**:让受害者接受非法消息,导致其他服务器拒绝受害者后续依赖该消息的消息;
- **Block Network Traffic(阻断网络流量)**:在受害者与其他房间服务器之间做流量封锁;
- **High Volume of Messages(海量消息)**:灌水使房间不可用;
- **Banning users without necessary authorisation(无权限封禁用户)**:在缺乏正当授权时尝试封禁用户。

#### Spoofing(伪造/冒充)

目标:冒充受害者从事非法活动或获取特权。

- **Altering Message Contents(篡改消息内容)**:修改受害者已有消息;
- **Fake Message "origin" Field(伪造消息 origin 字段)**:发送声称来自受害者的新消息,伪造 origin 字段。

#### Spamming(垃圾信息)

目标:寻找诈骗受害者、营销不想要的商品。

- **Unsolicited Messages(不请自来的消息)**:给不想要的受害者发消息;
- **Abusive Messages(辱骂/威胁消息)**:发送辱骂或威胁性消息。

#### Spying(间谍/窃听)

目标:获取敏感信息、通过消息中的凭证(如密码重置)冒充他人、发现受害者与谁在何时通话。

- **Disclosure during Transmission(传输中泄露)**:在服务器之间传输时暴露消息内容/元数据;
- **Disclosure to Servers Outside Chatroom(泄露给房间外服务器)**:诱使房间内服务器把消息发给未授权服务器;
- **Disclosure to Servers Within Chatroom(泄露给房间内服务器)**:攻陷房间内的某台服务器以暴露内容/元数据。

### 10. Cryptographic Test Vectors(密码学测试向量)

**签名密钥种子**(Base64 解码后为 32 字节 ed25519 seed):

```
"YJDBA9Xnr2sVqXD9Vj7XVUnmFZcZrlw8Md7kMW+3XA1"
```

服务器名 `domain`;密钥 ID `ed25519:1`。

- 空对象 `{}` 签名后产生:`{"signatures":{"domain":{"ed25519:1":"K8280/U9SSy9IVtjBuVeLr+HpOB4BQFWbg+UZaADMtTdGYI7Geitb76LTrr5QV/7Xg4ahLwYGYZzuHGZKM5ZAQ"}}}`
- `{"one":1,"two":"Two"}` 签名值:`KqmLSbO39/Bzb0QIYE82zqLwsA+PDzYIpIRA2sRQ4sL53+sN6/fpNSoqE7BP7vBZhG6kYdD13EIMJpvhJI+6Bw`
- 最小事件(room_id `!x:domain`、sender `@a:domain`、origin `domain`、空 content/prev_events/auth_events、depth 3、`origin_server_ts` 1000000):`"hashes":{"sha256":"5jM4wQpv6lnBo7CLIghJuHdW+s2CMBJPUOGOC89ncos"}`,签名 `KxwGjPSDEtvnFgU00fwFz+l6d2pJM6XBIaMEn81SXPTRl16AqLAYqfIReFGZlHi5KLjAWbOoMszkwsQma+lYAg`。
- 带可 redact 内容的消息(type `m.room.message`、body `"Here is the message content"`、event_id `$0:domain`):hash `onLKD1bGljeBWQhWZ1kaP9SorVmRQNdN5aM2JYU2n/g`,签名 `Wm+VzmOUOz08Ds+0NTWb1d4CZrVsJSikkeRxh6aCcUwu6pNC78FunoD7KNWzqFn241eYHYMGCA5McEiVPdhzBA`。

> 实现联邦签名时,可用这些向量做「Canonical JSON + ed25519」的端到端自测,确保编码结果与官方一致。

### 11. Conventions(Matrix API 约定)

- **HTTP 端点与 JSON 属性命名**:用下划线分隔单词(如 `/delete_devices`);历史例外如 `/createRoom` 存在,未来版本可能修正;
- **分页(Pagination)**:
  - 若还有更多结果,返回 `next_batch` 属性(字符串 token,用于请求下一页);没有更多结果时省略 `next_batch`;
  - 接受查询参数 `from`,置为上一页的 token;
  - 双向端点(如 `/messages`)还应返回 `prev_batch` 表示上一页,同样通过 `from` 传入;
  - 避免单独的「direction」参数——token 应编码足够信息让服务器知道返回哪一页。

## 易混淆点 / 笔记

- **Unpadded Base64 ≠ URL-safe Base64**:前者只是去填充(仍用 `+/`),后者换掉了第 62/63 个字符(`-/_`)。二者易混,spec 明确它们是不同概念。
- **「opaque」的基准是解码后**:二进制字段在 JSON 里是 Base64 字符串,但「不透明」指的是解码后的字节,编码形态不是不透明的。
- **Canonical JSON 的负零陷阱**:`-0` 必须规范化成 `0`,否则同值不同字节、验签必挂;整数必须在 ±(2^53−1) 内,float 一律禁止。
- **签名不含 `signatures`/`unsigned`**:所以要「先删后签、验签时也先删」,顺序错会直接失败。
- **Server name 大小写敏感,但 user ID localpart 禁大写**:`@user:matrix.org` 与 `@user:MATRIX.ORG` 不同;而 localpart 本身禁止大写,是为了避免在 `state_key` 等大小写敏感位置产生冲突。
- **Room ID 有 domain 与否由 room version 决定**:v1.16 起的新房间(room version 12)room ID 就是 create 事件的哈希(`!` sigil),不再带 domain——不要假设 room ID 一定以 `:domain` 结尾。

## 与自托管聊天项目(Babacom)的相关性

- **Canonical JSON 是必须精确实现的第一优先级**:Babacom 若要参与联邦(homeserver 或签名校验的 bridge),需先通过「Cryptographic Test Vectors」验证自己的 Canonical JSON + ed25519 实现;这直接决定能否被其他服务器接受。
- **Identifier Grammar 决定路由与校验逻辑**:用户/房间/事件/别名的解析、`via` 路由、`mxc://` 处理都依赖这些文法;localpart 长度按**字节**而非字符计算,处理多字节 Unicode 时要小心。
- **威胁模型是安全设计的清单**:DoS/Spoofing/Spamming/Spying 四类可直接映射到自托管部署的攻击面(资源限制、签名校验、spam 过滤、传输加密与访问控制),可作为 Babacom 的威胁建模基线。
- **Unpadded/URL-safe Base64 用于密钥与签名**:账户恢复密钥展示用「Cryptographic key representation」(base58 + 校验字节),与 07-olm.md 的密钥管理衔接。

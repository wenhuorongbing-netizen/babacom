# Olm: A Cryptographic Ratchet(双棘轮加密)

> 原文:https://spec.matrix.org/v1.19/olm-megolm/olm/
> 规范版本:v1.19 · 类型:加密协议

## 一句话概述

Olm 是 Matrix 团队对 **double ratchet(双棘轮)** 算法的一份全新实现,用于两方(一对一)端到端加密。该 ratchet 设计源自 Trevor Perrin 与 Moxie Marlinspike(即 Signal 协议文档中描述的设计);Olm 规范本身覆盖 ratchet 算法、协议流程、消息格式、认证加密方案与认证关注点,并置于公有领域(public domain)。

## 密码学原语

以规范原文为准,本页明确出现的原语如下:

| 原语 | 用途 |
| --- | --- |
| **Curve25519** | 所有 Diffie-Hellman 密钥:身份密钥(identity key)、一次性密钥(one-time key)、ratchet 密钥(ratchet key) |
| **HKDF-SHA-256** | 基于 HMAC 的密钥派生(HKDF,见 RFC 5869,底层 SHA-256 见 RFC 6234),用于派生 root key、chain key 以及 AES/HMAC 子密钥 |
| **HMAC-SHA-256** | 见 RFC 2104,用于推进 chain key 与生成 message key |
| **AES-256-CBC + PKCS#7 padding** | Olm 版本 1 的加密算法 |
| **HMAC-SHA-256 截断为 64 位(8 字节)** | 消息认证码(MAC) |

注意:**Ed25519 与 SHA-512 在本页并未出现**。Olm 自身不使用签名密钥(签名/身份验证属 Megolm 与上层应用的责任)。规范只覆盖 Olm 版本 1 的认证加密方案(AES-256-CBC + 截断 HMAC-SHA-256),未描述其他加密版本。

## 工作原理

Olm 是 **DH ratchet(密钥棘轮)+ 对称 ratchet(链棘轮)** 的双棘轮组合,另带 pre-key(前置密钥/一次性密钥)机制。

### 初始建立(Triple Diffie-Hellman)

初始建立接收 4 个 Curve25519 输入:Alice 与 Bob 的身份密钥 I_A、I_B,以及 Alice 与 Bob 的一次性密钥 E_A、E_B。通过三次 Diffie-Hellman 组合出共享秘密 S:

```
S = ECDH(I_A, E_B) ∥ ECDH(E_A, I_B) ∥ ECDH(E_A, E_B)
```

其中 ∥ 表示字符串拼接。随后用 HKDF-SHA-256(默认/零 salt、info 字符串 `"OLM_ROOT"`、请求 64 字节输出)派生:

```
R_0, C_{0,0} = HKDF(0, S, "OLM_ROOT", 64)
```

即 256 位的 root key R_0 与 256 位的 chain key C_{0,0}。

### 推进 Root Key(DH ratchet)

一次 root key 推进需要上一轮的 root key R_{i-1} 与两个 ratchet 密钥:上一轮 T_{i-1} 与当前轮 T_i。偶数下标的 ratchet 密钥由 Alice 生成,奇数下标由 Bob 生成。先对两个 ratchet 密钥做 Diffie-Hellman,再用 HKDF-SHA-256 派生下一轮 root key 与新的 chain key:

```
R_i, C_{i,0} = HKDF(R_{i-1}, ECDH(T_{i-1}, T_i), "OLM_RATCHET", 64)
```

这里以 R_{i-1} 作为 salt,info 字符串为 `"OLM_RATCHET"`。

### 推进 Chain Key(对称 ratchet)

```
C_{i,j+1} = HMAC-SHA-256(key = C_{i,j}, msg = "\x02")
```

即:下一把 chain key 是用上一把 chain key 作密钥、对单字节 `0x02` 做 HMAC-SHA-256。

### 生成 Message Key

```
M_{i,j} = HMAC-SHA-256(key = C_{i,j}, msg = "\x01")
```

message key 用当前 chain key 作密钥、对单字节 `0x01` 做 HMAC-SHA-256。偶数 i 的 message key 归 Alice 加密使用,奇数 i 归 Bob 使用。

### Pre-Key / 一次性密钥(One-Time Key)

Bob 公开其身份密钥 I_B 的公钥部分与一批**单次使用**的一次性密钥 E_B。Alice 下载其中一个 E_B,并生成自己的新一次性密钥 E_A。Bob 在成功解密第一条 pre-key 消息后,即**丢弃**对应 E_B 的私钥部分(保证一次性)。

### 出站会话(Alice 侧)

Alice 下载 Bob 的 I_B 与 E_B,生成一次性密钥 E_A,计算 R_0 与 C_{0,0},并生成新的 ratchet 密钥 T_0。对每条消息:计算 message key、推进自己的 chain key,用认证加密方案加密明文得到密文 X_{0,j},然后发送:

- Alice 身份密钥 I_A 的公钥部分
- Alice 一次性密钥 E_A 的公钥部分
- Bob 一次性密钥 E_B 的公钥部分
- 链下标 j
- Alice ratchet 密钥 T_0 的公钥部分
- 密文 X_{0,j}

在收到 Bob 的消息之前,Alice 持续发送这种 pre-key 消息。

### 入站会话(Bob 侧)

Bob 用自己一次性密钥 E_B 的私钥部分查表,由收到的密钥算出 R_0 与 C_{0,0},把 chain key 推进 j 次得到 C_{0,j},派生 M_{0,j} 并尝试解密。认证成功后,Bob **丢弃 E_B 的私钥部分**,并保留 Alice 的初始 ratchet 密钥 T_0。

### 正常消息

一旦双方各收到过对方一条消息,会话建立,改用更紧凑的格式。若发送方当前没有可用的 chain key,就生成新 ratchet 密钥 T_i,并用上一轮 ratchet 密钥计算新的 root key 与 chain key;否则直接从当前 chain key 派生 message key、推进 chain key、加密明文得到 X_{i,j}。正常消息只发送:链下标 j、当前 ratchet 密钥 T_i 的公钥部分、密文。

### 接收消息

接收方检查是否有与 ratchet 密钥 T_i 匹配的接收链(receiver chain);若没有,就用 R_{i-1}、T_{i-1} 与 T_i 计算新的 R_i 与接收链,并**丢弃自己当前的发送链**(下次发送时重建新链)。若消息的链下标 j 落后于接收方当前下标,只有当接收方存有该 message key 的副本时才能解密(用于乱序);否则接收方计算 C_{i,j}、派生 M_{i,j} 并尝试解密。成功后就更新 chain key 到 C_{i,j+1},并**存储被跳过的 message key** 供乱序消息解密。

### 消息格式

两种消息都以 1 字节版本字段开头,值为 `"\x03"`(0x03)。payload 由 key-value 对组成,key 用变长整数 tag 编码(最低 3 位表示类型:0 = integer、2 = string)。整数采用变长编码:除最后一个字节外,每字节最高位置 1,7 个低位按"最低有效位在前"承载整数的位。

- **正常消息**:Version Byte | Payload Bytes | MAC Bytes。payload 字段:
  - Ratchet-Key,tag `0x0A`(string 类型):ratchet 密钥 T_i 的公钥部分
  - Chain-Index,tag `0x10`(integer 类型):链下标 j
  - Cipher-Text,tag `0x22`(string 类型):密文 X_{i,j}
  - MAC 长度由认证加密算法决定(Olm v1 为 HMAC-SHA-256 截断 8 字节);MAC 覆盖其前所有字节。
- **Pre-Key 消息**:Version Byte | Payload Bytes(无独立 MAC,加密发生在内嵌消息内部)。payload 字段:
  - One-Time-Key,tag `0x0A`:Bob 一次性密钥 E_B 的公钥部分
  - Base-Key,tag `0x12`:Alice 一次性密钥 E_A 的公钥部分
  - Identity-Key,tag `0x1A`:Alice 身份密钥 I_A 的公钥部分
  - Message,tag `0x22`:一条内嵌的 Olm 消息(自带 version 与 MAC)

### 认证加密(版本 1)

用 HKDF-SHA-256(默认 salt、info `"OLM_KEYS"`、输出 80 字节)从 message key 派生三个子密钥:

```
AES_KEY_{i,j} ∥ HMAC_KEY_{i,j} ∥ AES_IV_{i,j} = HKDF(0, M_{i,j}, "OLM_KEYS", 80)
```

即 256 位 AES 密钥、256 位 HMAC 密钥、128 位 AES IV。明文用 AES-256-CBC 加密,随后对"版本字节 + payload"整体做 HMAC-SHA-256,取前 8 字节作为 MAC 追加。

## 在 Matrix 中的角色

> 说明:Olm/Megolm 规范页本身只聚焦 ratchet 算法。下面关于 to-device 消息、房间密钥、密钥备份的角色,来自 Matrix 端到端加密的总体设计(索引页只有一句概括:"Matrix uses the Olm and Megolm cryptographic ratchets for end-to-end encryption")。

在 Matrix 的实际端到端加密架构中,Olm 承担**两方(设备对设备)**的加密通道,典型用途包括:

- **传递 Megolm 房间密钥**:发送方设备用 Olm 会话把每个房间的 Megolm 会话密钥分别加密后,通过 `to-device` 消息点对点发给各接收设备。
- **to-device 消息**:设备之间一对一的敏感事件(如密钥协商、设备验证请求)由 Olm 加密。
- **密钥备份解密**:Matrix 的服务器端密钥备份(key backup)用设备各自的密钥加密,解密这些备份内容时同样涉及 Olm 会话的密钥体系。

一句话:**Olm 管"设备与设备之间的点对点密钥分发",Megolm 管"房间内消息本体"。**

## 安全性质与已知限制

- **未知密钥共享(unknown key-share)防护**:规范要求应用"必须在(至少)pre-key 消息的明文里包含发送方与接收方的标识信息"(如 user ID、电话号码,或用户已证明所有权的密钥对的公钥部分)。规范给出两类示例攻击:
  1. **冒充 Alice 的密钥**:Eve 把 Alice 的公钥 I_A 当作自己的公钥发布,Bob 因此把 I_A 与 Eve 关联。若 Alice 在 pre-key 明文里含自己的 user ID,Bob 能识破消息其实来自 Alice。
  2. **冒充 Bob 的密钥**:Eve 把 Bob 的公钥 I_B 当作自己的公钥发布,Alice 下载后把 I_B 误认作 Eve,想给 Eve 发消息。Eve 无法解密,但可转发给 Bob,Bob 误以为消息是发给自己的。若 Alice 在 pre-key 明文里写明"收件人是 Eve",即可避免。
- **乱序/丢包**:乱序消息需要接收方存储被跳过的 message key 才能解密,这会带来一定的状态与内存开销。
- **版本覆盖有限**:规范仅描述 Olm 版本 1 的认证加密;未描述其他加密版本。
- **依赖传输层区分消息类型**:规范依赖底层传输协议来区分"正常消息"与"pre-key 消息"。
- **一次性密钥用完即弃**:Bob 的 one-time key 私钥在首次解密后丢弃,是保证前向/一次性语义的关键,也意味着服务器必须持续提供充足的 one-time key 供应。

## 易混淆点 / 笔记

- **Olm vs 双棘轮**:Olm 是"double ratchet 的一个实现",double ratchet 是算法(源自 Signal);不要把"Matrix 的 Olm"当作协议名称与算法名称混为一谈。
- **DH ratchet 与对称 ratchet 分工**:DH ratchet(推进 R_i)提供前向保密与自愈,每次方向切换时发生;对称 ratchet(推进 C_{i,j})在同一方向内逐条消息推进,代价极低。偶数 i 归 Alice、奇数 i 归 Bob——下标奇偶决定了 message key 归属方。
- **`\x01` 与 `\x02` 的方向**:`\x01` 生成 message key,`\x02` 推进 chain key;二者都只是单字节 HMAC 输入,不要记反。
- **Pre-key 消息没有独立 MAC**:加密/认证发生在内嵌的 Message 字段内部(内嵌消息自带 version 与 MAC),外层 payload 本身不单独 MAC。
- **"Olm 传递房间密钥"这句话里有两层加密**:Megolm 房间密钥先被 Megolm 的 sharing 格式编码,再由 Olm 会话加密传输;Olm 自身不产生房间密钥。
- **Ed25519 不在 Olm 里**:身份签名/长期身份认证不是 Olm ratchet 页的内容,别把 Megolm 的 Ed25519 签名安到 Olm 头上。

## 与自托管聊天项目(Babacom)的相关性(25 人小群、跨境,是否值得开 E2EE、开销)

- **是否值得开**:值得。跨境场景下,消息经自托管服务器转发,服务器运营方(以及网络路径上的中间人)理论上可见明文;Olm/Megolm 是 Matrix 的标配 E2EE,开箱成本低,对隐私敏感内容(账号、凭证、私聊)有实质意义。
- **Olm 的开销**:仅在一对一密钥分发与 to-device 消息中使用,消息量小。每条 Olm 消息要 1 次 ECDH(仅 ratchet 切换时)+ 若干次 HMAC + 1 次 HKDF,单机开销可忽略;主要成本是 one-time key 的发布与下载、以及乱序时保存 skipped message key。
- **适用场景**:25 人小群中,Olm 负责"每个发送设备 → 每个接收设备"的点对点 room key 分发;人数少意味着每发一次房间密钥所需的 Olm 加密次数少,完全不是瓶颈。
- **需要额外处理的状态**:乱序/丢包需保存 skipped message key;一次性密钥耗尽会影响新会话建立(服务器需持续补充 one-time key)。若 Babacom 直接复用 Matrix 生态(Synapse/Dendrite + 客户端 SDK),这些细节由 SDK 处理,不必自己实现。
- **注意**:Olm 只解决两方点对点;群消息本体的加密与成员退群后的会话轮换要依赖 Megolm(见 08-megolm.md),两者要一起评估。

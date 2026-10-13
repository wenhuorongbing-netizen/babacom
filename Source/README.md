# Matrix 协议学习笔记索引

本目录是 Matrix 开放协议的**自学笔记**,逐篇对应官方规范 [spec.matrix.org](https://spec.matrix.org/) 的文档结构(基准版本 **v1.19**)。每篇 `.md` 均为中文,英文术语保留原名,严格基于规范原文整理,抓取不到的内容一律标注「未覆盖」而非臆测。

> 用途:为 Babacom 选型提供协议学习参考。保留 DigoYu 的原提交 `c7a29ea7` 与笔记；原引用 `communication-layer-notes.md` 和当时的根 PRD 未随该提交提供，不补造内容。
>
> 2026-10-13 合入后的当前入口：[迁移 PRD](../docs/PRD-matrix-migration.md)、[固定栈研究与适用差异](../docs/Matrix-protocol-research.md#版本与部署差异)。这些是后续整合入口，不冒充原作者当时引用。规范 v1.19、房间版本、组件版本和 MSC 支持分别核对；笔记不是已测试部署合同。

开发时按 Issue 只读相关章节；面向 homeserver/SDK 实现者的 sync/crypto 建议用于理解和核验上游，不要求本项目自研这些核心。下述顺序是自学路径，不是开工前必须读完整目录。
`Doc_Link_List.txt` 是动态查询入口；本目录研究基准为 [固定 v1.19](https://spec.matrix.org/v1.19/)，实际候选组合见上述固定栈研究。

## 文件清单

| 文件 | 对应规范页 | 一句话说明 |
|---|---|---|
| [00-overview.md](00-overview.md) | 规范总览 | Matrix 是什么、架构、CAP 取舍、核心概念(用户/设备/事件/DAG/房间/状态解析)、版本号规则 |
| [01-client-server-api.md](01-client-server-api.md) | Client-Server API | **最大一篇**。客户端如何用 homeserver:认证、sync、发事件、房间成员、typing/已读、媒体、E2EE、VoIP |
| [02-server-server-api.md](02-server-server-api.md) | Server-Server API | 联邦:PDU/EDU、请求与事件签名、接收校验 7 步、join/leave 握手、回补、信任模型 |
| [03-application-service-api.md](03-application-service-api.md) | Application Service API | 经典受信桥接 API；本项目 MatrixRTC 的 AS 接线例外见固定栈研究 |
| [04-identity-service-api.md](04-identity-service-api.md) | Identity Service API | 3PID(邮箱/手机)→ Matrix ID 的查找(可选组件) |
| [05-push-gateway-api.md](05-push-gateway-api.md) | Push Gateway API | 移动端离线推送(仅做移动端才有意义) |
| [06-room-versions.md](06-room-versions.md) | Room Versions v1–v12 | **房间版本演进**(每版一节 + 对比表):状态解析算法、auth rules、knock、restricted join、redaction 语义 |
| [07-olm.md](07-olm.md) | Olm 双棘轮 | 设备间点对点加密棘轮(传递房间密钥、to-device 消息) |
| [08-megolm.md](08-megolm.md) | Megolm 组棘轮 | 房间级广播加密棘轮(加密房间消息本体) |
| [09-appendices.md](09-appendices.md) | Appendices | Canonical JSON / Signing JSON、标识符语法、威胁模型、测试向量、API 约定 |
| [10-proposals.md](10-proposals.md) | MSC 提案机制 | 如何改规范:提案生命周期、编号体系、如何查未进规范的特性 |
| [11-changelog.md](11-changelog.md) | Changelog v1.0–v1.19 | 版本里程碑总览(OAuth、room version 演进等) |

## 建议阅读顺序

按「从整体到细节、从数据模型到协议机制」的路径:

1. **00-overview.md** —— 先建立心智模型(事件 / DAG / 房间 / 状态解析 / 联邦)。
2. **01-client-server-api.md** —— 客户端视角的完整用法,最贴近「用它搭应用」。
3. **06-room-versions.md** —— 理解「状态解析算法」这个去中心化一致性的核心,顺带看它怎么演进。
4. **02-server-server-api.md** —— 联邦层,看服务器之间怎么互信、复制、校验。
5. **07-olm.md → 08-megolm.md** —— E2EE 两层棘轮,配合 09-appendices.md 的 Signing JSON 一起看。
6. **09-appendices.md → 10-proposals.md → 11-changelog.md** —— 收尾:底层编码/签名细节、如何跟进未来特性、版本史。

其余三篇(03/04/05)按需查阅,通常不是理解 Matrix 主体的必经之路。

## 整理说明(几个取舍)

- **房间版本 v1–v12 合并进一个文件**:每版内容短、高度增量,合并后便于对照「每版相对上一版改了什么」,而不是翻 12 个小文件。
- **Changelog 合并成总览**:逐条 changelog 价值低,改为里程碑式 timeline(v1.0 → v1.19)。
- **MSC 只写「机制」而非逐条提案**:MSC 有数百上千个,且大多未进规范;想查具体某个,按 [10-proposals.md](10-proposals.md) 里的方式去 `matrix-org/matrix-spec-proposals` 查编号。
- **两个「未来特性」的边界要认清**(详见 11-changelog.md):Sliding Sync、MatrixRTC 在已发布的 v1.19 规范中**尚未落地**,仍是 MSC 状态,别当成已稳定特性依赖。

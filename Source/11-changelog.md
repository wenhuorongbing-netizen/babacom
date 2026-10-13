# 变更史总览(Changelog,v1.0 → v1.19)

> 原文:https://spec.matrix.org/v1.19/changelog/(索引页;各版本详见 /changelog/v1.x/)
> 规范版本:v1.19 · 类型:变更史

## 一句话概述

Matrix 规范从 2021 年的 v1.1(首次引入统一 `vX.Y` 版本化)演进到 2026 年的 v1.19,核心脉络是:先补强联邦与 E2EE 的地基(签名/加密/房间版本),再补齐「现代聊天」能力(线程、空间、认证媒体),近年则转向「Matrix 2.0」方向——OAuth 认证已分多步进入规范,而 Sliding Sync 与 MatrixRTC 截至 v1.19 仍停留在 MSC 阶段、尚未进入任何已发布版本。

## 版本清单(v1.0 – v1.19)

> 说明:v1.1 之前归入 changelog 索引的「Historical versions」链接,本文未抓取该历史页;v1.0 信息取自规范总览的「Legacy Versioning」一节。以下日期仅在抓取到的各版本 changelog 明确给出时标注。

| 版本 | 发布(仅已知时) | 一句话方向 |
|---|---|---|
| v1.0 | —(历史) | 追溯定义:由各 API 旧版本拼成(CS r0.5.0、SS r0.1.2、AS r0.1.1、IS r0.2.0、Push r0.1.0、Room Versions 1–5) |
| v1.1 | 2021-11-09 | 端点重版本 `r0`→`v3`;敲门(knock)、密钥备份、cross-signing、SSSS、SAS 验证大补强 |
| v1.2 | — | Room Version 8/9;`restricted` 房间;Spaces/hierarchy;fallback keys |
| v1.3 | — | Room Version 10(整数 power levels、`knock_restricted`);refresh tokens;事件关系(relations) |
| v1.4 | — | 线程(threads)、编辑(`m.replace`)、按线程回执;无新 room version |
| v1.5 | — | `m.reference` 关系;无新 room version |
| v1.6 | — | 默认 room version 升至 10;`timestamp_to_event`;SAS 新增 `hkdf-hmac-sha256.v2` |
| v1.7 | — | 异步媒体上传、媒体重定向;回应(reactions,`m.annotation`);@提及与推送规则 |
| v1.8 | — | Room Version 11(redaction 重构);user ID 允许 `+`;`matrix-fed` SRV 发现 |
| v1.9 | — | 仅小幅(新增 `m.rule.suppress_edits` 推送规则);无新 room version |
| v1.10 | 2024-03-22 | 多流 VoIP(MSC3077);relations 递归;大量 E2EE 澄清 |
| v1.11 | 2024-06-20 | 认证媒体(MSC3916);VoIP 静音;弃用 query-string 认证与旧媒体端点 |
| v1.12 | 2024-10-07 | 账户锁定;标记房间已读;无 room version 变更 |
| v1.13 | 2024-12-19 | 举报端点;ACL 作用于 EDU;无 room version 变更 |
| v1.14 | 2025-03-27 | 默认 room version 升至 11;无 Sliding Sync/MatrixRTC/OAuth |
| v1.15 | 2025-06-26 | **OAuth 2.0 认证 API(MSC3861)**;`auth_metadata`、`room_summary`;Olm 事件携带设备密钥 |
| v1.16 | 2025-09-17 | **Room Version 12**:新 room ID 格式、state resolution 重构、creator 正式化;默认升至 12 |
| v1.17 | 2025-12-18 | `m.oauth` UIA 类型(MSC4312);Appservice 设备伪装(MSC4326);Olm/Megolm 内联进主站 |
| v1.18 | 2026-03-25 | OAuth 账户管理(MSC4191)、OAuth-aware 客户端(MSC3824)、Device Grant(MSC4341);admin 挂起/锁定端点;Policy Servers |
| v1.19 | 2026-07-08 | `m.key_backup`(MSC4287)、加密历史共享(MSC4268)、表情包 image packs(MSC2545);无新 room version |

## 核心内容(按大方向,不逐条罗列)

### 方向一:OAuth 引入(分三步走)

Matrix 认证从「access_token 密码登录」逐步转向 OAuth 2.0,是近年最明确的长期方向,分多个版本推进:

- **v1.15**:引入 **OAuth 2.0 based authentication API(MSC3861)** 及其子提案,配套新增 `GET /auth_metadata`(MSC2965)与 `room_summary`(MSC3266);
- **v1.17**:新增 `m.oauth` 作为 User-Interactive Authentication(UIA)的认证类型(MSC4312),并加入 `m.login.terms`;
- **v1.18**:补齐 OAuth 生态——账户管理能力(MSC4191)、「OAuth 2.0 aware 客户端」(MSC3824)、以及按 RFC 8628 的 **Device Authorization Grant**(MSC4341)。

### 方向二:Sliding Sync —— 未覆盖(截至 v1.19 未进规范)

- 在 v1.0–v1.19 的**所有版本 changelog 中均未出现**「Sliding Sync」条目;
- 相关进展:其核心提案 MSC4186(Simplified Sliding Sync)于 2026 年 6 月底/7 月初刚被 Spec Core Team 接受核心部分,但因 E2EE 等扩展 MSC 仍在评审,**尚未落地到任何已发布规范版本**;规范主版本预计在 Sliding Sync / MatrixRTC 及其依赖合并后才会升到 2.0。
- 说明(外部来源):[Matrix 2.0 Is Here!](https://www2.matrix.org/blog/2024/10/29/matrix-2.0-is-here/)、[This Week in Matrix 2026-07-03](https://matrix.org/blog/2026/07/03/this-week-in-matrix-2026-07-03/)、[MSC4186 原文](https://raw.githubusercontent.com/matrix-org/matrix-spec-proposals/31d18c18a0e45776254f6a4ff1ee31f591eb2795/proposals/4186-simplified-sliding-sync.md)。

### 方向三:MatrixRTC —— 未覆盖(截至 v1.19 未进规范)

- 同样在 v1.0–v1.19 的所有 changelog 中**未出现**「MatrixRTC」;
- 相关 MSCs(如 MSC4143)截至 2026 年仍处于活跃开发、尚未接受/合并;VoIP 在已发布规范中的进展主要体现为增量项(v1.10 多流 VoIP MSC3077、v1.11 VoIP 静音 MSC3291 等),而非完整的 MatrixRTC 框架。
- 说明(外部来源):[This Week in Matrix 2025-12-12](https://www2.matrix.org/blog/2025/12/12/this-week-in-matrix-2025-12-12/)。

> 小结:用户若以「规范原文」为准,**Sliding Sync 与 MatrixRTC 目前不在 v1.19 规范内**,只能通过 MSC 仓库跟踪(见 10-proposals.md)。

### 方向四:Room Version 演进

房间版本沿「修复状态解析缺陷 → 引入新 join rule → 简化 redaction → 重定义 room ID」的脉络前进:

- **v1.0**:Room Versions 1–5(基线;v2 起引入 state resolution v2);
- **v1.2**:引入 **Room Version 8 / 9**,带来 `restricted` join rule(允许被授权房间的成员免邀请加入);
- **v1.3**:引入 **Room Version 10**(power levels 仅限整数,`knock_restricted` 组合规则);
- **v1.6 / v1.14**:默认 room version 依次升到 **10 → 11**;
- **v1.8**:引入 **Room Version 11**(`redacts` 移入 `content`、`creator` 移除、redaction 规则重构);
- **v1.16**:引入 **Room Version 12**——最大的一次结构性变更:**room ID 改为 create 事件的哈希(去掉 domain)**,state resolution 重构以减少「state reset」,creator 获得「无限 power」正式地位,默认 room version 升至 12。

### 方向五:E2EE 增强

- **v1.1(奠基)**:cross-signing、密钥备份(room_keys)、Secure Secret Storage and Sharing(SSSS)、SAS 验证方法更新(`curve25519-hkdf-sha256`),是 E2EE 能力最集中的一次;
- **v1.2**:fallback keys(一次性密钥耗尽后的备用密钥);
- **v1.6**:SAS 新增 MAC 方法 `hkdf-hmac-sha256.v2`;
- **v1.10**:大量加密细节澄清(SAS HKDF 用 base64 密钥、key backup MAC、一次性密钥类型等);
- **v1.15**:Olm 加密事件携带设备密钥(MSC4147);
- **v1.18**:建议加密会话排除未 cross-signed 的设备(MSC4153)、附件加密的密钥生成与哈希校验加强;
- **v1.19**:新增 `m.key_backup` 账户数据(MSC4287)与**加密历史共享(MSC4268)**。

### 其他值得注意的方向

- **媒体现代化**:v1.7 异步上传 → v1.11 认证媒体端点(MSC3916)并弃用旧 `/_matrix/media/*`;
- **消息高级特性**:v1.3–v1.5 关系(relations)→ v1.4 线程(threads)/编辑 → v1.7 回应(reactions)/@提及;
- **Spaces/层次**:v1.2 引入 Spaces 与 hierarchy API;
- **应用服务**:v1.17 设备伪装(MSC4326)、v1.18 Policy Servers(MSC4284);
- **弃用管理**:query-string 认证(v1.11)、旧媒体端点(v1.11)、别名后事件链接(v1.11)、旧联邦 `send_join/send_leave`(v1.18)等逐步退出。

## 易混淆点 / 笔记

- **「Matrix 2.0」≠「某个规范版本」**:Matrix 2.0 是官方围绕 OIDC / Sliding Sync / 原生 E2EE / MatrixRTC 提出的方向性品牌,而非已发布的 `v2.0`;截至 v1.19 规范版本仍停在 `v1.x`,OAuth 只是分步并入。
- **changelog 索引页本身没有内容**:`/changelog/` 只有指向各版本子页的导航链接,真正的变更明细在 `/changelog/v1.x/` 下;且每个子页按 API(CS/SS/AS/IS/Push/Room Versions/Olm-Megolm/Appendices)分区。
- **「无 room version 变更」很常见**:多个版本(v1.4/v1.5/v1.9/v1.12/v1.13/v1.19)完全没有新 room version;不要把「新规范版本」误当成「新房间版本」——二者是独立的节奏。
- **v1.0 不在 changelog 编号列表里**:v1.1 是第一个带编号的 changelog 条目;v1.0 需到「Historical versions」查找(本文未抓取该页,标注未覆盖)。

## 与自托管聊天项目(Babacom)的相关性

- **升级节奏参考**:约每季度一个版本(v1.14 起基本 3 个月一版),自托管 homeserver 可据此安排升级与兼容回归;
- **OAuth 是必须关注的认证迁移**:从密码/access_token 转向 OAuth 2.0 已明确,自托管部署若提供登录,应把 MSC3861 体系的 `auth_metadata`、Device Grant 等纳入路线图,避免长期依赖将被弃用的旧认证路径;
- **E2EE 与备份是自托管卖点**:`m.key_backup`、加密历史共享、SSSS、cross-signing 等直接关系到「数据可迁移、可恢复、多设备可用」,是自托管聊天项目区别于 SaaS 的核心体验;
- **Sliding Sync / MatrixRTC 需走 MSC 跟踪**:若 Babacom 想提前支持同步性能优化或现代通话,应查阅 `matrix-spec-proposals` 仓库的实验状态(见 10-proposals.md),并注意其尚未进入稳定规范。

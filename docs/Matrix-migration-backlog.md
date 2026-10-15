# Matrix 迁移 Sprint Backlog

关联 [PRD](PRD-matrix-migration.md) / [规格](Matrix-migration-spec.md) / [规划根票 #50](https://github.com/wenhuorongbing-netizen/babacom/issues/50)。本文件只维护排程、依赖摘要及映射；**逐票故事、AC、Allowed Files、Validation和实时状态以GitHub Issue为准**。

2026-10-13已逐条核对：原36票的182条候选AC均在对应Issue，无丢失后移除这里的副本；旧全文保留在[959ad74](https://github.com/wenhuorongbing-netizen/babacom/blob/959ad74d8fdbaf7cb29fc6ec2dbf0b5f04932aaa/docs/Matrix-migration-backlog.md)。36父票仍DRAFT；文档合并不批准实验运行或生产。签认和PO审查记录只维护[04](04-open-decisions.md#d16-matrix迁移2026-10-13)。

M01核对来源为24编号模块120条，加T1/T2/UI/docs清单19条，共139条未勾项，含流程模板；它们不是139个独立产品功能。Scope正文Must仍逐项核对，映射最终挂继任Issue，#60汇总例外，不再新建巨型流程副本。

## 1. Release、Sprint与依赖

一个Matrix Migration里程碑覆盖全部迁移需求，Epic仅作领域容器。实际1–2周Sprint承诺需知道可用工时/资源，不编造速度或日期；每次最多80%容量承诺，至少20%留给审查/故障。3个工作流是初始上限，不是必须并行3份实现；共享契约/锁/部署/物理设备单writer/串行。每票按实际范围拆成小PR，不整Epic长分支。

| 迭代候选 | 内容 | 出口 |
|---|---|---|
| S0 原版基线可验证 | M01与M04只读版本/许可并行；M02-E/M03-E #97；固定M04最小组合后M29-P #98与M05必要子集 | 需求出处/UNKNOWN影响、受限实验范围；两个合成账号标准客户端互通、私房权限、重启历史；不把最终生产政策作为实验前置 |
| S1 Windows关键证明 | M05；最小M29/M08/M09/M10/M12/M17/M18；M21/M22 | G1真实包游戏音频/独立音量/无回授/停采；未过停止扩大UI |
| S2 单一权威与Alpha宽度 | M06/M07/M11/M13/M19/M23/M24，M25/M26持续 | G2；私域权限、消息、设备恢复完整，不留双权威 |
| S3 运行与恢复 | M29–M32、M27、M35；必要附件留存M14 | G3；数据/备份/新写入回退、许可、升级、真实包 |
| S4 真实负载和切换 | M28/M36 | G4/G5；中德/真人/10人≥2h，再两周游戏夜观察 |
| S5 逐文件退役 | M33/M34 | G6；消费者零、继任覆盖、恢复基线、旧票处置 |
| 后续产品宽度 | M14/M15/M20为R03，M16为R04；已有上游能力优先验证 | 不挤掉R02稳定期；M14涉及迁移/备份的必要子集提前验证，社交扩展仍后置 |

上述是顺序/出口，不是固定6个Sprint工期；同票跨阶段只提前实验必需子集，拆分实施票时保留父AC与依赖。执行次序由有向依赖和Gate共同决定。**M35→M36（G5后消费者断接与M25覆盖交接）→M33→M34**，先切换观察、断接再删除；最终项目关闭必须M33/M34完成。若R03/R04项明确延期，需Jack逐项接受并记录，不能把仍未验收的全部票勾Done。

首Sprint只承诺“原版基线可验证”。[#97](https://github.com/wenhuorongbing-netizen/babacom/issues/97)是M02-E/M03-E独立docs范围合同，签认后才释放受限运行；[#98](https://github.com/wenhuorongbing-netizen/babacom/issues/98)是M29-P独立控制面proof，依赖#97与M04最小固定组合，不依赖M02全部生产政策。M05必要Windows包子集在运行前另拆有独立AC/依赖/精确范围的票。M01未访问到的远端资产记录UNKNOWN及影响，阻断真实导入/切换，不阻断纯合成隔离实验。#50只验收规划，不等待九Epic完成才释放盘点。

历史机器环境不作为当前执行条件。最新隔离 proof 进展见 [README 当前验收边界](../README.md#current-acceptance-boundary)及 [04](04-open-decisions.md)。每张后续实施票在 Ready 前重新核实其固定版本、端口、资源归属与实际前置；RTC、可信 TLS、双真实 Windows 和采集条件仍独立验证，HTTP 本机控制面 proof 不替代 G1。

## 2. Ready / Done

候选范围不是写权限。Ready前固定一个module/DRI/独立Reviewer、基线/版本、逐个文件、完整可执行Validation、依赖与资源/授权；扩范围先独立docs PR。当前父票默认Validation未冻结，不能全量标Ready。

Done需要全部AC与相应层级证据、独立review、范围/契约成立；失败或NOT_RUN如实保留，不改断言/期限。合成控制面、Windows包、真人设备/跨境分别验收。退役另需G5、消费者零、恢复验证。日常流程只维护[05](05-collaboration.md)。

## 3. Epics 与票目录

| Epic | 领域 | Gate | 票 |
|---|---|---|---|
| [E1 #51](https://github.com/wenhuorongbing-netizen/babacom/issues/51) | 需求、契约与迁移边界 | G0 | M01 / M02 / M03 |
| [E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52) | 上游 Windows 基线与最小定制 | G0/G1后定制 | M04 / M05 / M06 / M07 |
| [E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53) | 私人身份、权限与账号生命周期 | G1/G2 | M08 / M09 / M10 / M11 |
| [E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54) | 社区、文字与社交 | G2/R03/R04 | M12 / M13 / M14 / M15 / M16 |
| [E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55) | 语音、设备与摄像头 | G1/G2/R03 | M17 / M18 / M19 / M20 |
| [E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56) | 游戏画面、系统音频与观看 | G1/G4 | M21 / M22 / M23 / M24 |
| [E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57) | 测试转换、架构约束与可靠性 | 全阶段/G4 | M25 / M26 / M27 / M28 |
| [E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58) | 自托管运行与数据保障 | G1最小环境/G3 | M29 / M30 / M31 / M32 |
| [E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59) | 上游跟随、正式切换与旧栈退役 | G3/G5/G6 | M33 / M34 / M35 / M36 |

## 4. 36张候选票

下列依赖是排程快照；变更先更新对应Issue并同步受影响索引。U是待建立的固定版本Element fork，B是本仓库；候选目录和上级Epic不授予产品写权限。

### M01 需求与存量映射

[#60](https://github.com/wenhuorongbing-netizen/babacom/issues/60) · E1；类型：task；阶段：G0；依赖：#50。

### M02 Matrix权威与继任契约

[#61](https://github.com/wenhuorongbing-netizen/babacom/issues/61) · E1；类型：task；阶段：G0；依赖：M01。

### M03 分票与精确文件边界

[#62](https://github.com/wenhuorongbing-netizen/babacom/issues/62) · E1；类型：task；阶段：G0；依赖：M02-E #97；后续生产票另依赖M02最终政策。

### M04 固定兼容上游基线

[#63](https://github.com/wenhuorongbing-netizen/babacom/issues/63) · E2；类型：spike；阶段：G0；依赖：只读源码/许可与M01并行；运行子交付依赖M02-E/M03-E #97与已冻结下一批范围。

### M05 Windows安装包真实启动

[#64](https://github.com/wenhuorongbing-netizen/babacom/issues/64) · E2；类型：spike；阶段：G1；依赖：M04。

### M06 BabaCom品牌与中文

[#65](https://github.com/wenhuorongbing-netizen/babacom/issues/65) · E2；类型：story；阶段：G1后/R01；依赖：M05 / M22。

### M07 社区入口体验差距

[#66](https://github.com/wenhuorongbing-netizen/babacom/issues/66) · E2；类型：story；阶段：G2后/R01；依赖：M06 / M12 / M17。

### M08 邀请制入群

[#67](https://github.com/wenhuorongbing-netizen/babacom/issues/67) · E3；类型：story；阶段：G1最小/G2；依赖：M04 / M29。

### M09 账号设备与密钥恢复

[#68](https://github.com/wenhuorongbing-netizen/babacom/issues/68) · E3；类型：story；阶段：G1最小/G2；依赖：M08。

### M10 单一权限与RTC授权

[#69](https://github.com/wenhuorongbing-netizen/babacom/issues/69) · E3；类型：story；阶段：G1最小/G2；依赖：M09 / M29。

### M11 密码恢复与邮件交付

[#70](https://github.com/wenhuorongbing-netizen/babacom/issues/70) · E3；类型：story；阶段：R01；依赖：M09。

### M12 社区与频道结构

[#71](https://github.com/wenhuorongbing-netizen/babacom/issues/71) · E4；类型：story；阶段：G1最小/G2；依赖：M08 / M10。

### M13 消息核心与同步

[#72](https://github.com/wenhuorongbing-netizen/babacom/issues/72) · E4；类型：story；阶段：G2/R01；依赖：M12 / M09。

### M14 附件与留存

[#73](https://github.com/wenhuorongbing-netizen/babacom/issues/73) · E4；类型：story；阶段：R03/G3；依赖：M13 / M29。

### M15 DM通知与一致状态

[#74](https://github.com/wenhuorongbing-netizen/babacom/issues/74) · E4；类型：story；阶段：R03；依赖：M13 / M05。

### M16 线程与中英文搜索

[#75](https://github.com/wenhuorongbing-netizen/babacom/issues/75) · E4；类型：story；阶段：R04；依赖：M13 / M14。

### M17 持久语音频道闭麦入房

[#76](https://github.com/wenhuorongbing-netizen/babacom/issues/76) · E5；类型：story；阶段：G1最小/G2；依赖：M10 / M12 / M05。

### M18 明确开麦与安全退出

[#77](https://github.com/wenhuorongbing-netizen/babacom/issues/77) · E5；类型：story；阶段：G1/G2；依赖：M17。

### M19 游戏设备与快捷键

[#78](https://github.com/wenhuorongbing-netizen/babacom/issues/78) · E5；类型：story；阶段：R01/G4；依赖：M18 / M05。

### M20 摄像头与视频布局

[#79](https://github.com/wenhuorongbing-netizen/babacom/issues/79) · E5；类型：story；阶段：R03；依赖：M17 / M18。

### M21 Windows系统音频关键证明

[#80](https://github.com/wenhuorongbing-netizen/babacom/issues/80) · E6；类型：spike；阶段：G1；依赖：M05 / M17 / M18。

### M22 观看与独立音量

[#81](https://github.com/wenhuorongbing-netizen/babacom/issues/81) · E6；类型：spike；阶段：G1/R01；依赖：M21 / M18。

### M23 区域与网络质量

[#82](https://github.com/wenhuorongbing-netizen/babacom/issues/82) · E6；类型：story；阶段：R01/G4；依赖：M17 / M29 / M32。

### M24 单共享者与质量档位

[#83](https://github.com/wenhuorongbing-netizen/babacom/issues/83) · E6；类型：story；阶段：R01/G4；依赖：M21 / M22 / M10。

### M25 可重现验证与覆盖迁移

[#84](https://github.com/wenhuorongbing-netizen/babacom/issues/84) · E7；类型：task；阶段：全阶段；依赖：M05 / M02。

### M26 信任边界与依赖约束

[#85](https://github.com/wenhuorongbing-netizen/babacom/issues/85) · E7；类型：task；阶段：G2/G3；依赖：M09 / M10 / M17。

### M27 断线休眠与设备稳定

[#86](https://github.com/wenhuorongbing-netizen/babacom/issues/86) · E7；类型：story；阶段：G3/G4；依赖：M17 / M18 / M19 / M25。

### M28 真人中德与Alpha验收

[#87](https://github.com/wenhuorongbing-netizen/babacom/issues/87) · E7；类型：task；阶段：G4；依赖：M18 / M19 / M21 / M22 / M23 / M24 / M27 / M29。

### M29 受控自托管环境

[#88](https://github.com/wenhuorongbing-netizen/babacom/issues/88) · E8；类型：task；阶段：G1最小/G3；依赖：完整环境依赖M04 / M02最终政策；独立M29-P #98仅依赖#97与M04最小固定组合。

### M30 健康告警与数据政策

[#89](https://github.com/wenhuorongbing-netizen/babacom/issues/89) · E8；类型：task；阶段：G3；依赖：M29。

### M31 数据迁移备份恢复与回滚

[#90](https://github.com/wenhuorongbing-netizen/babacom/issues/90) · E8；类型：task；阶段：G3；依赖：M01 / M29 / M09 / M14。

### M32 中德节点与成本证据

[#91](https://github.com/wenhuorongbing-netizen/babacom/issues/91) · E8；类型：spike；阶段：G3/G4；依赖：M29。

### M33 退役重复后端权威

[#92](https://github.com/wenhuorongbing-netizen/babacom/issues/92) · E9；类型：task；阶段：G6；依赖：M10 / M17 / M25 / M31 / M36。

### M34 退役旧桌面与测试负担

[#93](https://github.com/wenhuorongbing-netizen/babacom/issues/93) · E9；类型：task；阶段：G6；依赖：M33 / M07 / M25 / M27。

### M35 上游升级与补丁预算

[#94](https://github.com/wenhuorongbing-netizen/babacom/issues/94) · E9；类型：task；阶段：G3；依赖：M07 / M26 / M27。

### M36 正式切换与两周观察

[#95](https://github.com/wenhuorongbing-netizen/babacom/issues/95) · E9；类型：task；阶段：G5；依赖：M28 / M30 / M31 / M35。

## 5. 旧Issue/PR/dirty处置

| 旧项 | 映射与真实处置 |
|---|---|
| [#1 T1](https://github.com/wenhuorongbing-netizen/babacom/issues/1) | M01/M02/M25/M33；保存历史交付，继任契约与替代证据成立后可superseded，不声称原全部验收补齐 |
| [#14 T2](https://github.com/wenhuorongbing-netizen/babacom/issues/14) | M02/M17–M28；执行架构待替代，原语音/设备/跨境目标保留 |
| [#18](https://github.com/wenhuorongbing-netizen/babacom/issues/18) | M18/M28；真人听音、物理设备释放、中德仍待做；Matrix或上游CI不替代 |
| [#31](https://github.com/wenhuorongbing-netizen/babacom/issues/31) / [#42](https://github.com/wenhuorongbing-netizen/babacom/issues/42) | M25/M27/M34；已有合并代码与部分历史证据；旧helper活动时继续履约，退役后才superseded，不伪造最终旧包PASS |
| [#40](https://github.com/wenhuorongbing-netizen/babacom/issues/40) | M25/M27/M34；暂停无关旧构建器投资，活动泄漏仍按原范围修复；确认退出后退役，历史临时目录不自动授权清理 |
| [#41](https://github.com/wenhuorongbing-netizen/babacom/issues/41) | M25/M27/M34；merge-main的playback.ts与microphone.e2e.ts两文件dirty保留；delta部分通过，不等于freshness≤1000ms/挂起到期已修。退役前可恢复保存 |
| [#48](https://github.com/wenhuorongbing-netizen/babacom/issues/48) / [PR49](https://github.com/wenhuorongbing-netizen/babacom/pull/49) | CLOSED/MERGED c9ec3cf；M06/M07继承设计目标，不重开或逐行移植旧六文件 |
| [#50](https://github.com/wenhuorongbing-netizen/babacom/issues/50) | 本规划票；产品/安装/部署/删除不属于本票 |

七个旧open票加迁移标签/里程碑并追加关系说明，保持打开；移除过时Ready标签不抹掉原验收。未来关闭必须记录resolved / superseded / not-planned及owner/证据，不能把“已计划迁移”写成“已修复”。

## 6. 原24模块完整归属

| 模块 | 迁移票 | 原则 |
|---|---|---|
| 1.1 基础设施 | M29 | 固定配置与真实运行 |
| 1.2 媒体运维 | M28/M32 | 跨境/负载真实测量 |
| 1.3 可观测与发布 | M30/M36 | 健康/告警/切换 |
| 2.1 邀请 | M08 | 私域邀请政策 |
| 2.2 账号会话 | M09/M11 | 稳定设备/恢复 |
| 2.3 角色权限 | M10 | 单一Matrix权威 |
| 3.1 语音频道 | M17/M27 | Call复用与恢复 |
| 3.2 音频设备 | M18/M19 | 显式采集/快捷键/设备 |
| 3.3 摄像头 | M20 | R03复用验证 |
| 4.1 共享发布 | M21/M24 | 系统音频/单共享强制 |
| 4.2 观看 | M22 | 独立音量/播放器生命周期 |
| 4.3 质量连接 | M23/M27 | 真实数据/低带宽 |
| 5.1 消息核心 | M13 | 同步/历史与后续消息项 |
| 5.2 附件媒体 | M14 | 鉴权/留存/引用 |
| 5.3 线程搜索 | M16 | 中英文/E2EE差异 |
| 6.1 外壳结构 | M07/M12 | 上游社区导航 |
| 6.2 外观语言 | M06 | 品牌/i18n/可访问 |
| 6.3 DM提醒 | M15 | 通知/presence |
| 7.1 实时网关 | M13/M25 | 不建并行消息WS |
| 7.2 令牌限流 | M10/M17/M26 | RTC授权/拒绝/秘密 |
| 7.3 任务邮件存储 | M11/M14 | 交付与留存真实运行 |
| 8.1 主机成本 | M32 | 实测与预算 |
| 8.2 韧性 | M31 | 数据/密钥/恢复 |
| 8.3 安全政策 | M26/M30/M35 | 许可/安全/升级 |

模块级覆盖24/24；**139条历史未勾AC的逐条KEEP/REWRITE/RETIRE清单尚待M01完成**，不能把本模块表当作139条已签收。原Must/Won't和R03/R04阶段见Scope v2，缺口逐项记录不静默取消。

## 7. 本轮验证与审查边界

本轮验证仅docs scope_guard、diff whitespace、计划数量/依赖DAG/模块覆盖/链接一致性及独立Standards/Spec审查。产品、安装包、数据迁移、部署、物理设备和中德测试NOT_RUN。原战略PO对e14d7e9给FIX后，实际读取464f71a对两项依赖修正限范围复核GO；此前附着失败保留为历史。首批为M01/M04只读、#97受限实验合同及#98控制面proof；Windows包必要子集另立范围，不批量开工36父票。

# 协作流程

本文件只维护多人日常开发与跨 fork 合并流程；产出规则见 [AGENTS](../AGENTS.md)，
代码与需求入口见[地图](../REPO_MAP.md)。
人和 Agent 使用相同交付边界；编辑器、模型和开发方法由各自选择。

## 1. 角色（一个人可以兼多个）

| 角色 | 每次交付负责什么 |
|---|---|
| Jack | 当前 fork 的最终裁定与已授权集成；实验、继任契约和生产条件分别签认 |
| PO | 优先级、范围和方向复审；建议不直接授予运行、权限或合并授权 |
| Integrator | 本次集成基线、共享改动顺序、最终 head、合并与恢复边界；当前 A 执行 Jack 已授权事项 |
| DRI | 每票恰好一人，对实现、实际 Validation 和限制负责 |
| Reviewer | 每 PR 至少一位非作者，检查规范及需求；独立审查不冒充 GitHub 人工批准 |

全局 D9 和团队扩大后的 Integrator 尚未任命，不因本指南自动指派。
认领 Issue 时写 DRI、Reviewer 和可用资源；不替未认领的人承诺工时。
Gemini 的既有美术分工不要求队友使用同一模型，也不自动扩大新客户端的修改范围。

## 2. 分支策略

### 集成仓库与权限

- 本次沿用 [wenhuorongbing-netizen/babacom](https://github.com/wenhuorongbing-netizen/babacom) 的 main 和 Issues；贡献者可从个人 fork 提 PR。共同组织归属仍由参与者确认。
- 2026-10-13 实查：Jack 为 ADMIN，DigoYu 已有 WRITE；本轮没有授予新权限。
- main **尚未启用分支保护**。required reviews、scope/secrets checks、禁止直接 push 是待负责人落实的设置；目前按同样规则人工把关，不声称已有技术拦截。
- CODEOWNERS 含原上游负责人及部分 Jack 路径。是否具备审查权限、保护规则是否启用须实际核对；不把文件里的账号当已接受的团队任命。
- 仓库未见 LICENSE。保留来源和作者，不擅自改许可或宣称可任意商业分发；许可清单按 M04/M32 核对。

### 日常短分支

一个分支解决一个小 Issue、一个 module。合并目标是上述集成仓 main，个人 fork 的 main 不成为第二个交付权威。
开工先确认工作树干净、票已 Ready；从最新 origin/main 新建短分支，固定 base SHA。
有无关 dirty 时换隔离工作副本，不自动 stash、reset 或 clean。worktree 是可选工具，已有 checkout 不被其他 Agent 共同写入。

操作顺序（分支名、模块和具体文件由 Ready 票提供）：

~~~powershell
git status --short
git fetch origin
git rev-parse origin/main
# 新建本票分支后实现；只暂存本票明确路径。
git diff --check
git diff --name-status
git diff --cached --name-status
~~~

确认整个暂存区属于本票后才 commit、push 自己的分支和提 PR。
共享分支不擅自 rebase/force-push。个人短分支同步主线后，重新验证受冲突影响的部分。
只有确认提交已被 main 保留、无未提交/未推送内容、worktree 归本任务后，才清理已合并分支；证据和数据不随分支删除。

### 本次 Digo 来源接收

双方共同祖先为 01a747d，Digo 固定 c7a29ea7 的独有变化是15份资料，没有第二套应用实现。
PR101先独立允许14个 Source 精确路径；#102在干净分支用真实 merge 接收原提交，第一提交15个 blob保持原样，后续注解单独提交。
合并保留作者和父提交，不用对方旧 README 覆盖当前应用入口，不通过搬目录绕过守卫。
最终 PR 使用保留提交历史的 merge 方式；若仓库策略不允许，先确定保全方案，不关闭保护规则。

## 3. 纵向切片优先于横向模块

Matrix 首批链路：两个合成账号 → 私房邀请/越权拒绝 → 收发消息 → 重启后历史仍在。
它只证明控制面。之后尽早证明真实 Windows 包的游戏画面、系统音频、独立麦克风与停采，G1未过不扩大 UI 重做。
跨模块切片仍须独立冻结精确范围，不能用“小 Issue”跨越模块清单。
首 Sprint 最多三条流，认领和工时明确后再承诺：

| 工作流 | 现有票 | 出口与停止条件 |
|---|---|---|
| 需求与资料 | #60；资料整合另为 #102 | 原条款/锚点挂到唯一继任 Issue，汇总例外；未知资产不写零，不再新建139行映射副本 |
| 原版兼容研究 | #63 | 固定组件/MSC/许可/镜像候选，给出 G1反证；只读可并行，不因有 flag 就报兼容 PASS |
| 实验合同 → proof | #97/PR99 → #98 | Jack 具体签认后才安装/运行；两个合成账号、私房权限与持久历史；不采集设备 |

共享文档由 A 串行集成，其他人给差异或 review；不重建9 Epics/36票，不把所有父票标 Ready。

## 4. Issue 模板

每票必须写清：用户结果与非目标、固定基线/版本、一个 module、DRI/Reviewer、逐文件 Allowed Files、
完整 Validation 命令/cwd/环境/退出与通过条件、依赖、资源归属、停止条件及可勾完成标准。
目录候选、UNKNOWN 和上级 Epic 不是写权限。新增依赖或换框架先在票中裁定。
扩模块 allowed-files 先独立 docs PR；产品 PR 不夹带扩范围。

类型按需用 Story、Spike、Bug、Task、Chore，不强制每个 Story 再拆前端/API/测试/日志四层。
Spike回答未知，不承诺其代码进入正式产品。已明确授权的范围无需反复索取同一批准；具体实验、数据或设备条件仍须成立。

## 5. PR 要求

- 使用[仓库模板](../.github/pull_request_template.md)，写机器读取的 Module 与一个 Issue；简述变化、实际证据、失败/NOT_RUN、风险和回退。
- 逐文件暂存并检查全暂存区；不混入无关 dirty、批量格式化、依赖或秘密。共享契约变化同步合同，不删断言换绿灯。
- 一个非作者 Reviewer 按固定 base…head 审查 Standards 与 Spec；修复后结论绑定新 head。获准的 Integrator 才合并。
- CI 内容以[工作流](../.github/workflows/)为准，只证明实际运行的检查。文档检查范围、链接、出处和语义；产品票按实际影响运行类型/lint/行为测试、真实服务或 Windows 包。
- 合成媒体、人耳、物理释放和中德负载是不同证据。保留原始失败，修复后重验相关部分；未变版本不无理由重跑全套。

已有旧桌面命令在 [package.json](../apps/desktop/package.json)，API环境在 [pyproject.toml](../apps/api/pyproject.toml)；
新 Element fork 的命令须从其固定版本读取，不能照搬旧 scripts 或虚构 CI。

## 6. 看板

只使用现有 Issues 的 Backlog → Ready → In Progress → Review → Done 语义，不再建第二份状态表。
Ready/Done完整条件见[迁移 Backlog](Matrix-migration-backlog.md#2-ready--done)。
Ready前固定范围、可执行验证、前置和资源；Done需要本票全部 AC 与相应证据、独立 review。
受阻写具体原因和责任人；规划发布不等于迁移完成，公开资料存在不等于部署可运行。

### 串行共享改动与冲突

schema/公共接口、lockfile、部署配置、数据库迁移、共享文档和同一真实设备，每次只有一个 writer；
独立模块实现、只读研究和审查可并行。变更这些共享资产前，由 Integrator 排顺序并通知依赖票。
数据库提案只写 `apps/api/migrations/_proposed/`，正式序列按仓库规则由负责人审查编号。

冲突先读双方差异及签认意图，检查是否影响范围、权限、数据和测试；不整文件选 ours/theirs。
超出本票范围或需要改签认契约时暂停该合并，单独处理必要范围/契约，其他独立工作继续。
解决后确认无 unmerged 状态、diff与暂存区准确，再运行受影响检查；共享分支不强推。
无法安全完成时保留可恢复状态并说明原因，不因工具或技能催促而暂存全部文件。

## 7. 文档层级

| 唯一职责 | 当前入口 |
|---|---|
| 开始使用、现状 | README；代码定位与禁扫区域在 REPO_MAP |
| 产出边界与验证 | AGENTS、目录规则、对应 .agents/modules 清单 |
| 产品结果 | Matrix PRD；Must/阶段及数值基准在 Scope/NFR |
| 架构、Gate、继任契约 | Matrix spec；决定与签认历史在04 |
| 排程和依赖导航 | Matrix Backlog；实时 AC/范围/依赖/状态仅在对应 GitHub Issue |
| 多人日常流程 | 本05；06只解释守卫维护，不复制流程 |
| 固定栈差异与 proof | Matrix protocol research；协议学习按需读 Source |
| 历史来源 | 00-review、07-proposal、scope.html、teams.html；退出默认新人阅读链，独有要求仍保留 |

不要把票正文、PO长回复或旧文档复制进新 archive/handoff。正常 Git 历史保存旧全文；当前入口链接唯一权威。
需求映射的最终落点是继任 Issue 的出处/锚点，#60汇总遗漏和例外；临时核对不是永久交付。

## 8. Epic 拆分示例

Epic只是领域容器；选择可独立验收的小切片，例如控制面 proof、固定 Windows 包或一项系统音频反证。
每个切片包含完成其验收所需实现和测试，按模块合同决定是否必须先拆范围票；不为凑层级创建四类子任务。
同一真实场景可能跨多个 Sprint，但提前部分必须单独有 AC/依赖，不把父票提前 Done。

### 多轮审查和退役

1. 来源/语义：作者、15文件、版本注解、链接、范围及精简前后去向；方向分歧交 PO。
2. 实现：唯一 Matrix 权威、权限负向、长期 crypto/短期媒体、真实 Windows/G1和一次相邻升级；DB恢复与设备密钥恢复分验。
3. G5/G6：保全切换后新写入并观察，M25覆盖交接 → M36在G5后断接 → M33/M34逐文件删除。源码 revert不等于数据库或新消息无损回滚。

七张旧票按证据标 resolved/superseded/not-planned及责任人，不以“迁移了”冒充修复。
旧失败证据、#41 dirty、真实数据和密钥不在文档清理范围内。

## 9. 七个必须先冻结的契约

下表保留原规划的七项接口类别，**不是 Matrix 新票的默认自研模板或自动签认**。
旧活动链仍按各自已签认 T1/T2及公共 schema 履约；新继任逐项按[规格§4](Matrix-migration-spec.md#4-契约转换与签认)和 M02独立签认。

| 原契约类别 | 当前边界 / Matrix继任方向 |
|---|---|
| DB schema / 单一迁移序列 | 原产品迁移守卫保留；不自行改 Synapse 内部 schema |
| 仓库布局 / CODEOWNERS | 独立 docs 范围 PR；角色与实际权限另核 |
| HTTP API | 旧准入合同有效；新身份/事件复用 Client-Server API，缺口才窄扩展 |
| WebSocket事件 | 原规划事件契约不等于已实现；Matrix同步/事件为新权威，不再建平行消息总线 |
| 设计令牌 / 组件库 | 保留体验目标；新 fork 最小补丁，不逐行迁移旧六文件 |
| can(user, action, channel) | 旧授权继续履约；新成员/power levels/join/history语义逐项验收 |
| LiveKit token claims | 旧T1/T2短期媒体合同继续有效；新RTC auth复用Matrix成员权威，撤销窗口须实测 |

团队提出变更，由相应合同签认者裁定；本表不替代具体值、模块 Allowed Files或正式验收。

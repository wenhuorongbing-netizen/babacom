# 提案机制(MSC,Matrix Spec Change)

> 原文:https://spec.matrix.org/proposals/(原 https://spec.matrix.org/v1.19/proposals/ 会 302 跳转到此地址)
> 规范版本:v1.19 · 类型:机制

## 一句话概述

MSC(Matrix Spec Change,矩阵规范变更提案)是修改 Matrix 规范的**正式提案流程**:绝大多数规范变更都必须先写一份 MSC,在外部 GitHub 仓库 `matrix-org/matrix-spec-proposals` 中经历「起草 → 讨论 → 最终评论期(FCP)→ 合并 → 落地到规范仓库 → 随版本发布」的生命周期;MSC 编号即其 GitHub Pull Request 编号,提案文件形如 `proposals/1234-my-new-proposal.md`。

## 核心内容

### 什么是 MSC

- 一份 MSC 是改变 Matrix 规范的正式提案;
- **大多数变更都需要 MSC**,但「bug 修复、错别字、对既有行为的澄清」不需要提案;
- 提案用 GitHub-flavored Markdown 书写,需说明问题、可能的解决方案与权衡。

### 生命周期(流程)

规范页面给出的完整流程如下:

1. **起草(Drafting)**:写 Markdown 提案,说明问题、方案与权衡;在拿到 PR ID 前用占位编号;
2. **提案 PR(Proposal PR)**:fork `matrix-spec-proposals` 仓库并开 PR。**PR 的 ID 成为永久 MSC 编号**;文件必须放在 `proposals/` 目录下,命名如 `1234-my-new-proposal.md`;
3. **收集反馈(Feedback)**:讨论主要在 Matrix 房间(主要是 `#matrix-spec:matrix.org`)与 PR 上进行;外部讨论应归纳到 PR 评论里;可选指派一位中立的 shepherd(引导人);
4. **评审 / 提出最终评论期(FCP)**:当 Spec Core Team 成员认为讨论已成熟、提案有「能工作的证据」时,提议进入 FCP,并给出处置(merge 合并 / close 关闭 / postpone 搁置);
5. **FCP 门槛**:只有 **75% 的 Spec Core Team 成员同意**、且所有关切都已解决,才开启 FCP;FCP 持续 **5 天**;
6. **实现证据**:在 FCP 被提出前,团队要求有「该 MSC 能工作」的证据,例如一份实现(不要求已发布或已合并);
7. **合并 MSC**:FCP 完成后执行处置;
8. **规范 PR(Spec PR)**:MSC 被接受后,再对主规范仓库 `matrix-org/matrix-spec` 提 PR;必须演示一份可工作的实现;重大变更需另开 MSC,微小变更必须记录在原提案中;
9. **规范发布**:规范 PR 合并、随某次规范发布后,实现可切换到稳定端点;过渡期约 **2 个月**。

### 生命周期状态(GitHub 标签)

| 状态 | GitHub 标签 |
|---|---|
| 起草与反馈 | draft PR,前缀 `[WIP]` |
| 提案评审中 | 无标签 |
| 提议最终评论期 | `proposed-final-comment-period` |
| 最终评论期 | `final-comment-period` |
| 最终评论期完成 | `finished-final-comment-period`(等待演示实现) |
| 缺规范 PR | `spec-pr-missing` |
| 规范 PR 评审中 | `spec-pr-in-review` |
| 规范 PR 已合并 | `merged` |
| 搁置 | `proposal-postponed` |
| 废弃 | `abandoned` |
| 过时 | `obsolete` |

另有 `needs-implementation` 标签(尚无实现时)。Spec Core Team 会给每个 MSC 分配类别,如 `kind:core`、`kind:feature`、`kind:maintenance`。

### 编号体系

- **MSC 编号取自 GitHub Pull Request 的 ID**;
- GitHub 有个怪癖:`https://github.com/matrix-org/matrix-spec-proposals/pull/$MSCID` 无论该 ID 最初来自 issue 还是 PR 都能解析;
- 提案文件名形如 `1234-my-new-proposal.md`(编号 + 短横线 + 简述)。

### 如何查阅(外部仓库)

- 所有提案都在外部 GitHub 仓库 **`matrix-org/matrix-spec-proposals`** 中跟踪;
- 跟踪页面把每个 MSC 链接到其 PR(如 `https://github.com/matrix-org/matrix-spec-proposals/pull/4545`);
- 跟踪页面由 GitHub 标签与 PR 描述中的元数据(MSC 编号、标题、`PRs: #1234`、`Date:`、`Author:`、`Shepherd:`)自动生成;
- 也就是说:想查某个 MSC 的原文,直接访问 `github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/<编号>-*.md`,或用 `pull/<编号>` 打开其 PR。

### 评审细节补充

- Spec Core Team 负责标签分诊(triage)并可变更提案状态;任一成员的关切都会阻止 FCP 开始或完成;
- FCP 期间若出现「反对该处置的充分理由」,关切可阻止完成;若解决需要大幅改动 MSC,FCP 可能被取消并重新提议;
- **占位 MSC(Placeholder MSC)**:某些安全敏感的提案可在工作中以占位形式存在;必须是 draft/WIP,打上 `proposal-placeholder`、`action-required`、`needs-implementation` 标签(但**不**打 `proposal`),且「理想情况下占位不超过 6–12 个月」。

## 易混淆点 / 笔记

- **MSC 合并 ≠ 进规范**:MSC 被 FCP 合并只是「提案通过」,还要另提一个对 `matrix-spec` 仓库的 Spec PR、合并后随版本发布,才真正进入规范(状态标签 `merged` 指的是规范 PR 已合并这一档)。这是最容易被误解的一步。
- **编号是 PR ID,不是人为顺序号**:同一个 MSC 的编号在开 PR 那一刻就固定,与最终进入规范的版本无关;编号大小也不代表时间顺序(PR 编号单调增,近似时间顺序)。
- **实验实现 ≠ 稳定**:在 `unstable_features` 下以 `org.matrix.mscXXXX` 前缀暴露的实现是实验性的;只有当 MSC 进入规范并随版本发布,才切到稳定的 `v*` 端点/`m.*` 命名。
- **澄清类变更豁免 MSC**:typo、bug 修复、澄清不需提案——判断「需不需要开 MSC」的边界就落在「是否改变行为/语义」上。

## 与自托管聊天项目(Babacom)的相关性

- **查阅未来特性的唯一权威渠道**:Babacom 想跟进尚未进规范的特性(如 Sliding Sync、MatrixRTC 等),要到 `matrix-spec-proposals` 仓库按编号查 MSC 原文与实现状态,而不是只看已发布规范。
- **实验特性用 `unstable_features` 协商**:自托管 homeserver/客户端若要提前尝鲜某 MSC,需要实现对应 `org.matrix.mscXXXX` 实验命名并做能力协商,这正是 MSC 机制给「尚未稳定」特性留出的路径。
- **稳定边界清晰**:FCP(75% 同意 + 5 天)+ 实现证据 + 约 2 个月过渡期,意味着 Babacom 在决定「何时把某特性当作稳定依赖」时,应等到该特性随正式版本发布,而非实验端点一出现就绑定。

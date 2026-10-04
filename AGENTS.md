# AGENTS.md — 仓库级铁律

> 适用于 Codex、Claude Code、DeepSeek、OpenCode 等所有在本仓库工作的 AI Agent，**以及使用它们的人**。
>
> 群里的担心是对的：**「全是 Agent 写的、把仓库污染了」**。
> 但解决办法不是禁止 Agent，而是**限制任务边界和合并权限**。
> Agent 写的代码和人写的代码走完全相同的 CI 与审查。
>
> 为什么这套东西提交进仓库而不是 gitignore：见 [`docs/06-agent-harness.md`](docs/06-agent-harness.md)。

---

## 这份文件约束什么，不约束什么

**队里每个人用不同的 AI、不同的编辑器、不同的思路 —— 这是好事，不要统一。**

不同模型的盲区不一样：Codex 漏掉的东西 Claude 容易发现，反过来也一样。
把所有人压成同一套流程，等于让所有人有同一套盲区。

所以这里只分两层：

| | 内容 | 性质 |
|---|---|---|
| **必须统一** | 什么能合并进 main | 不可协商，由 CI 强制 |
| **随你** | 你怎么把代码写出来 | 没人管，也没法管 |

**必须统一的只有四件事：**

1. 改动不越出 Issue 声明的模块边界（`scope_guard` 自动检查）
2. PR 正文如实填：改了什么、怎么验证、Validation 真实输出、已知限制
3. 公共接口与数据模型走契约，不各自定义
4. 不提交密钥

**完全不管的：**

用哪个 AI（Codex / Claude / DeepSeek / Cursor / 纯手写都行）· 用什么编辑器 ·
先写测试还是后写 · 用不用 worktree · 用不用下面那套 spec→build→review 循环 ·
怎么写自己的 prompt · 一个 Issue 分几次做完

> **判据：它影响的是产出还是过程？影响产出 → 统一；只影响过程 → 随你。**

---

## 开工前必读的四份文件

| 文件 | 什么时候读 |
|---|---|
| 本文件 | 每次 |
| [`REPO_MAP.md`](REPO_MAP.md) | 每次 —— **读地图，不要扫全库** |
| `.agents/modules/<你的模块>.md` | 每次 —— 你的边界、验证命令、完成标准 |
| `<你要碰的目录>/AGENTS.md` | 碰到该目录时自动加载 |

其他模块的规则**不需要读**。不是因为看不见，是因为没理由去读。

---

## 十条硬性规则

1. **不得直接修改 `main`。** 所有改动通过 PR。
2. **一次只处理一个 Issue。** Issue 号和模块 id 必须写在 PR 正文里。
3. **只修改模块清单 `allowed-files` 里列出的路径。** 越界由 CI 自动拒绝，不进入讨论。
4. **不得擅自更换框架、构建工具或依赖管理方式。** 需要换 → 开 Issue 提议，等裁决。
5. **不得修改公共接口而不同步更新契约。** 七个冻结契约见 [`docs/05-collaboration.md`](docs/05-collaboration.md)。
6. **不得提交任何密钥、令牌、证书、`.env`。** `.gitignore` 已覆盖常见形态，CI 另有密钥扫描。
7. **必须运行 Validation 命令**，并在 PR 中贴出真实输出。**测试失败就说失败** —— 不得隐瞒、不得声称「应该没问题」。
8. **不得为了让测试通过而修改或删除测试**，除非该 Issue 本身就是修测试。
9. **不得批量重构、批量格式化、批量重命名** —— 它们把 diff 变成不可审查的一团。
10. **不得新增依赖**，除非 Issue 明确要求；新增时说明为什么标准库或现有依赖不够。

---

## 数据库迁移：唯一一条特殊规则

**任何模块的 `allowed-files` 都不包含 `apps/api/migrations/`。**

需要迁移时，写到：

```
apps/api/migrations/_proposed/<模块id>-<简短描述>.sql
```

Tech Lead 审查后移入正式序列并编号。**单一迁移序列的所有权是技术上强制的，不靠约定。**

---

## 范围膨胀 —— 最常见的失败模式

Agent 最常见的问题不是写错代码，是**顺手多做**：

> 「我看到这里还有个问题就一起修了」
> 「顺便优化了一下」
> 「重构了一下更清晰」

在本仓库里这些一律视为越界，CI 会直接拒绝。

**发现顺手的问题 → 开一个新 Issue，不要写进当前 PR。**

---

## 推荐工作流程 —— 只是推荐，不用照做

下面是**其中一种**能跑通的做法。觉得顺手就用，有自己更习惯的流程就用自己的。

```
Issue → 写清楚要做什么 → 【跟人确认】 → 动手 → 自测 → PR
```

```bash
# 可选：一 Issue 一 worktree，几个任务同时跑不互相踩
git worktree add ../babacom-3.1 -b feat/voice-room-join

# 这条是必须的：提 PR 前自查边界（CI 也会跑，本地跑只是省得被打回）
git diff --name-only -z origin/main...HEAD | node .agents/scope_guard.mjs 3.1
```

唯一一条真正的建议：**先跟人确认要做什么，再动手写。**
在需求阶段改一个字，比在 PR 阶段改一百行便宜 —— 这条和你用不用 AI 无关。

`.claude/skills/` 里会放一套 spec→build→review 的循环，**是给想用的人用的，不是规定**。

---

## PR 正文格式

见 [`.github/pull_request_template.md`](.github/pull_request_template.md)。
其中 `Module:` 一行是**机器读取的**，CI 用它决定检查哪份边界清单，写错会直接失败。

**「已知限制」不能写「无」而实际上有。隐瞒限制比留下限制严重得多。**

---

## 给人类审查者

审 Agent 的 PR 时，先看三件事再看代码：

1. `scope_guard` 过了吗（diff 里有没有模块范围之外的文件）
2. 「已知限制」是不是写了「无」
3. 测试是真跑了，还是只贴了一段**看起来像**输出的文本

这三条任何一条不对，直接打回，不用读代码。

## Agent skills

### Issue tracker

创建、读取或发布 Issue 时，按 GitHub 配置执行：
`docs/agents/issue-tracker.md`。

### Triage labels

标记 Issue 或运行 triage 时，读取默认五角色映射：
`docs/agents/triage-labels.md`。

### Domain docs

术语、规格和架构工作采用 single-context：
`docs/agents/domain.md`。

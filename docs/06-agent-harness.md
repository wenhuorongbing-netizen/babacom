# Agent Harness — 为什么它必须进仓库

> 回答一个具体问题：**多人 + 多 Agent 开发时，agent 的 skill / role / 规则应该放哪里？**
> 结论：**绝大部分必须提交到仓库，而不是 gitignore 掉。**

---

## 1. 先分清两个被混在一起的问题

| | 问题 | 正确手段 | 错误手段 |
|---|---|---|---|
| **上下文经济** | agent 不该**加载**无关内容（context 膨胀、跑偏、顺手改） | 就近作用域 + 任务 brief + `REPO_MAP.md` | 隐藏文件 |
| **访问控制** | agent 不该**改动**不属于它的东西 | CI 边界检查 + CODEOWNERS + 分支保护 | 隐藏文件 |

隐藏对第一个问题只是弱手段，对第二个问题**完全无效**——有文件系统权限的 agent 藏不住。

所以本仓库的原则是：

> **所有 agent 都能读，但严格限制什么能合并进 main。**

这也是大型组织的实际做法。Google 的 OWNERS、Meta 的 codeowners + presubmit，
没有一家靠「不让开发者看到代码」保证质量，全部是**读取开放、写入设卡**。

---

## 2. 为什么 harness 不能 gitignore

如果 A 的 agent 遵守一套规则、B 的 agent 遵守另一套，那么：

- Tech Lead 在 review 一个 PR 时，**无法知道它是在什么约束下生成的**
- 同一个 Issue 换个人跑，产出结构完全不同
- 「为什么这个 PR 改了 infra」变成一个考古问题，而不是一条可查的规则

这叫**规则漂移**，是多人多 agent 场景下最贵的一种不一致。

**判据只有一条：**

> 这个文件如果换个人跑，会导致 PR 结果不同吗？
> **会 → 提交。不会 → 忽略。**

### 但这不等于统一开发流程 —— 这是两件事

很容易从上面一段滑到一个错误结论：「那大家都用同一套 AI、同一套流程好了」。**不要这样。**

队里每个人用不同的 AI、不同的编辑器、不同的思路，**这是优势不是问题**：

- **不同模型的盲区不一样。** Codex 漏掉的东西 Claude 容易发现，反过来也一样。
  统一流程 = 让所有人有同一套盲区，最该被交叉发现的问题反而没人发现。
- **过程根本管不住。** 你没法检查队友是不是真的按某个流程走的。
  写在文档里但无法验证的规则，只会被绕过，然后让文档整体失去可信度。
- **强推流程会赶走人。** 三个业余开发者、晚上和周末写代码，
  多加一道他不认同的手续，结果不是他照做，是他不做了。

所以正确的划分是：

| | 内容 | 手段 |
|---|---|---|
| **约束产出** | 什么能合并进 main | CI 强制，不可协商 |
| **不约束过程** | 你怎么把代码写出来 | 不管 |

类比：队里不会规定谁用 VSCode 谁用 Vim，但会规定代码必须过 lint 和测试。
**harness 提交进仓库，是为了让想用的人能用到同一套边界定义，不是为了规定所有人怎么干活。**

`.claude/skills/` 里的 spec→build→review 循环属于**可选工具**，
提交它是因为「模块边界清单」这种东西大家需要共享，不是因为每个人都得跑那套循环。

---

## 3. 三层划分

### ① 提交 —— 团队共享，决定产出

```
AGENTS.md                     仓库级铁律
REPO_MAP.md                   一页纸仓库地图（agent 读地图，不扫全库）
apps/*/AGENTS.md              目录作用域规则
infra/AGENTS.md
.agents/modules/*.md          24 个模块的 Allowed Files / Validation / Owner
.agents/scope_guard.mjs        边界检查器
.claude/settings.json         权限与 hooks
.claude/skills/               dev-spec / dev-build / dev-review 循环
.github/CODEOWNERS
.github/pull_request_template.md
.github/workflows/
```

> **`.claude/skills/` 提交进来是为了「想用的人能拿到」，不是「所有人必须用」。**
> 里面真正需要共享的是模块边界清单和验证命令 —— 那是产出契约；
> spec→build→review 那套循环是可选工具，用不用随你。

### ② 忽略 —— 个人偏好，不影响正确性

```gitignore
.claude/settings.local.json
.claude/projects/
.claude/history.jsonl
*.local.md
```

模型选择、输出详略、编辑器集成、个人快捷键 —— 换个人跑不会改变 PR 内容，忽略。

### ③ 忽略 —— 机器产物

```gitignore
.agent-cache/
transcripts/
*.worktree/
```

---

## 4. 「每个 agent 读不同的东西」怎么实现

不是隐藏，是**就近作用域**。Claude Code 会自动加载被修改文件所在目录树上的
`AGENTS.md` / `CLAUDE.md`，skill 也可以按目录挂载。

一个语音 agent 拿到 Issue 3.1 时，实际进入 context 的是：

```
AGENTS.md                              仓库铁律
REPO_MAP.md                            地图
.agents/modules/3.1-voice-channels.md  这个模块的边界、验证、完成标准
apps/desktop/AGENTS.md                 前端约定（因为它要碰这棵树）
```

消息模块的规则它根本不会加载 —— **不是因为看不见，是因为没理由去读。**

`REPO_MAP.md` 是这里最省钱的一环：agent 读一页地图，而不是扫全库。
用 `dev-map` skill 生成和刷新它。

---

## 5. 唯一真正有效的强制层

作用域是软的，下面这三条是硬的。

### 5.1 边界检查（`.agents/scope_guard.mjs`）

每个 PR 声明自己属于哪个模块，CI 把 `git diff --name-only` 和该模块的
Allowed Files 比对，越界直接失败。

```bash
git diff --name-only origin/main...HEAD | node .agents/scope_guard.mjs 3.1
```

这条让 `AGENTS.md` 里「越界的文件改动直接拒绝」**从靠自觉变成技术上进不了 main**。

### 5.2 CODEOWNERS

碰 `infra/`、`apps/api/migrations/`、`packages/contracts/` 时自动请求 Tech Lead review。

### 5.3 分支保护

main 禁止直接 push；required status checks + 至少 1 人 review；合并后删分支。

---

## 6. 数据库迁移的特殊处理

`teams.html` 要求「团队提议迁移，coordinator 合并并编号」。落地方式：

- **任何模块的 Allowed Files 都不包含 `apps/api/migrations/`**
- 模块把迁移写到 `apps/api/migrations/_proposed/<module>-<描述>.sql`
- Tech Lead 审查后移入正式序列并编号

这样单一迁移序列的所有权是**技术上强制的**，不是靠约定。

---

## 7. 一 Issue 一 worktree

每个 agent 任务在独立 git worktree 里跑：

```bash
git worktree add ../babacom-3.1 -b feat/voice-room-join
```

好处：物理隔离、几个 agent 同时跑不互相踩、做完 `git worktree remove` 即清干净。

---

## 8. 真正的瓶颈不是这些

你可以让 100 个 agent 同时产出，但**合并吞吐等于 Tech Lead 的 review 带宽**。

三个业余开发者、晚上和周末，一个人一晚认真读 3–5 个 PR 顶天了。
开 20 个 agent 只会得到一个 40 个 PR 的队列，和一个放弃审查、开始盲目 merge 的 Tech Lead ——
**那一刻仓库才真的被污染了，原因不是 agent 写得差，是审查崩了。**

> **并行 agent 数 ≤ 每周可审 PR 数 ÷ 2。起步 3–4 个。**

这条写进了 [`04-open-decisions.md`](04-open-decisions.md) 的 D10。

---

## 9. 一个任务的完整流程

```
Issue (含验收标准和非目标)
   ↓ dev-spec
spec：Allowed Files / Validation / Completion Criteria
   ↓ 人类确认 spec（这一步不能跳）
   ↓ git worktree add
   ↓ dev-build（只碰 Allowed Files，跑 Validation，落盘证据）
   ↓ dev-review（独立评审：逐条核对 spec、重跑 Validation、查越界）
PR → scope_guard CI → CODEOWNERS review → merge → 删分支 → 删 worktree
```

**「人类确认 spec」是整条流程里唯一不能省的人工步骤。**
在 spec 阶段改一个字，比在 PR 阶段改一百行便宜。

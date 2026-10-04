# REPO_MAP — 一页纸仓库地图

> **Agent 读这份地图，不要扫全库。** 需要细节时再按下面的指引打开具体文件。
> 结构变化后用 `dev-map` skill 刷新本文件。
>
> 最后更新：2026-08-29 · 状态：**规划阶段，尚无应用代码**

---

## 现在仓库里有什么

```
babacom/
├─ index.html scope.html teams.html   规划文档（英文，静态站，可 GitHub Pages 发布）
├─ README.md                          入口
├─ REPO_MAP.md                        本文件
├─ AGENTS.md                          ← 所有 agent 必读
├─ docs/                              工程评审与修订（中文）
├─ .agents/                           共享 harness：边界清单 + 检查器
├─ .claude/settings.json              权限与 hooks
├─ .github/                           CODEOWNERS · PR 模板 · workflows
├─ apps/desktop/AGENTS.md             ← 目录规则（代码尚未落地）
├─ apps/api/AGENTS.md                 ← 目录规则（代码尚未落地）
└─ infra/AGENTS.md                    ← 目录规则（代码尚未落地）
```

## 计划中的完整结构

```
apps/desktop/     Electron + React + TypeScript + Vite
apps/api/         FastAPI + SQLAlchemy + Alembic + PostgreSQL
packages/contracts/   共享 schema 与常量 —— Tech Lead 所有
packages/ui/          设计令牌与共享组件 —— 6.2 所有
infra/            两节点部署、LiveKit、TURN、监控、备份
```

---

## 我该读哪份文件

| 你要做的事 | 读这个 |
|---|---|
| 第一次进这个仓库 | `AGENTS.md` → 本文件 → `docs/00-review-plan01.md` |
| 认领一个模块 | `.agents/modules/<id>-*.md` |
| 想知道某功能做不做、什么时候做 | `docs/01-scope-v2.md` |
| 想知道某个待决归谁 | `docs/04-open-decisions.md` |
| 想知道分支 / PR 怎么走 | `docs/05-collaboration.md` |
| 想知道 harness 为什么要提交 | `docs/06-agent-harness.md` |
| 算流量或成本 | `docs/03-cost-model.md` |
| 平台支持什么 / 验收标准 | `docs/02-platform-nfr.md` |
| 原始功能勾选与模块划分 | `scope.html` · `teams.html`（英文） |

---

## 24 个模块速查

| 域 | 模块 | 阶段 |
|---|---|---|
| 1 Platform | 1.1 基础设施 · 1.2 媒体运维 · 1.3 可观测性与发布 | R00 · R00 · R01 |
| 2 Identity | 2.1 邀请 · 2.2 账号会话 · 2.3 角色权限 | R01 · R01 · R01/R03/R04 |
| 3 Voice | 3.1 语音频道 · 3.2 音频设备 · 3.3 摄像头布局 | R01 · R01 · R03 |
| 4 Streaming | 4.1 共享发布 · 4.2 共享观看 · 4.3 质量与连接 | R01 · R01 · R01/R02 |
| 5 Messaging | 5.1 消息核心 · 5.2 文件媒体 · 5.3 线程搜索 | R01/R03/R04 · R03/R04 · **R04** |
| 6 Experience | 6.1 外壳结构 · 6.2 外观语言 · 6.3 私信提醒 | R01 · **R00/R01**（后续 R03/R04） · R03 |
| 7 Backend | 7.1 实时网关 · 7.2 令牌限流 · 7.3 任务邮件存储 | **R00** · R01 · R01/R03/R04 |
| 8 Ops | 8.1 主机成本 · 8.2 韧性 · 8.3 安全数据政策 | R00 · **R02** · R03 |

**wave 0 只开这几个：1.1 · 1.2 · 6.2 · 7.1 · 8.1** —— 并行度上限见 D10。

---

## 三条最容易踩的规则

1. **`apps/api/migrations/versions/` 任何模块都不能改** —— 迁移写进 `_proposed/`。
2. **`features/` 之间不得互相 import** —— 需要共享就提到 `packages/`，走 Tech Lead。
3. **提 PR 前自查边界：**
   ```bash
    git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs <模块id>
   ```

---

## 当前最大的阻塞

**Tech Lead 尚未指派（D9）。** 七个冻结契约都需要一个最终所有者，
在此之前不应该开始多模块并行开发。

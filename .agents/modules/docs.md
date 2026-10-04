# docs — 文档与 harness 伪模块

| | |
|---|---|
| Domain | 无 |
| Release | 任何时候 |
| Owner | PO / Tech Lead |
| Depends on | 无 |

## 什么时候用 `Module: docs`

- 改规划文档（`docs/`、`scope.html`、`teams.html`、`README.md`）
- 改 harness 本身（`AGENTS.md`、`.agents/`、`.github/`）
- **扩某个模块的 allowed-files** —— 必须是单独一个 PR，不能混进功能 PR

## Allowed files

<!-- allowed-files:start -->
docs/**
.agents/**
.github/**
.claude/**
*.md
*.html
.gitignore
**/AGENTS.md
<!-- allowed-files:end -->

## 明确不允许

- 任何 `apps/`、`packages/`、`infra/` 下的文件，**除了 `AGENTS.md`**
  —— 目录级 `AGENTS.md` 是 harness 不是代码，它规定该目录怎么被改，本身不参与构建
- **在同一个 PR 里既改文档又改代码**

## Validation

```bash
node .agents/scope_guard.mjs docs --files <改动的文件>   # 自检
```

## 完成标准

- [ ] 改动的文档之间**没有互相矛盾**（这是唯一真正重要的一条）
- [ ] 涉及裁决的改动同步更新了 `docs/04-open-decisions.md` 的状态总表
- [ ] 改了 allowed-files 的话，已 @ Tech Lead

## 备注

`.agents/` 和 `.github/` 都在 CODEOWNERS 里指向 Tech Lead，
所以扩边界的 PR 一定会走到他手上 —— **这是有意的**。

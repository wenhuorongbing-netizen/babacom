# `.agents/` — 范围守卫

[模块清单](modules/)维护 Allowed Files、Validation 和完成条件；按 Issue 的 Module 与具体签认选择，不在本页复制模块数量或状态。
[scope_guard.mjs](scope_guard.mjs)检查文件范围，[scope_guard.test.mjs](scope_guard.test.mjs)覆盖 CLI 与真实 Git 文件列表。
共享配置的版本控制理由见 [06](../docs/06-agent-harness.md)，产出规则见 [AGENTS](../AGENTS.md)，日常协作见 [05](../docs/05-collaboration.md)。

## 模块清单格式

每个 `modules/<id>-<slug>.md` 必须包含一个机器可读的 allowed-files 块：

```markdown
<!-- allowed-files:start -->
apps/desktop/src/features/voice/**
apps/api/app/voice/**
<!-- allowed-files:end -->
```

`**` 跨目录匹配，`*` 只在单层内匹配。

## 本地自查

使用 Issue 指定的模块 id；以下以 `3.1` 为例：

```bash
git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs 3.1
```

Git 文件列表必须使用 `-z`，保留中文、空白与 NUL 路径边界；`--no-renames`使改名前后两端都接受检查。
手工逐行输入普通路径或使用 `--files` 仍受支持。

修改检查器后运行回归测试（CI 也会运行）：

```bash
node --test .agents/scope_guard.test.mjs
```

## 使用边界

扩模块范围按 [docs 模块](modules/docs.md)独立提交文档 PR，不能在功能 PR 内自行放宽。
本地检查与 CI 的可信基线规则见 [AGENTS](../AGENTS.md)；实际检查项以[工作流](../.github/workflows/)为准，范围通过不代表产品、设备或跨境验收通过。
模块与发布阶段见[范围](../docs/01-scope-v2.md)；模块清单存在不代表已实现或已获准开工。

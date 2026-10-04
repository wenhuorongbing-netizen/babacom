# `.agents/` — 共享 harness

**这个目录必须提交。** 它决定 PR 的产出结果，换个人跑会得到不同结果的东西都属于这里。
详见 [`../docs/06-agent-harness.md`](../docs/06-agent-harness.md)。

```
.agents/
├─ README.md            本文件
├─ scope_guard.mjs       边界检查器，CI 和本地自查都用它
├─ scope_guard.test.mjs  检查器的 CLI 回归测试，使用真实 Git 文件列表
└─ modules/             24 个模块 + docs 伪模块的边界清单
```

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

提 PR 前跑一次，省得被 CI 打回：

```bash
git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs 3.1
```

`-z` 输出未经转义、以 NUL 分隔的路径，检查器逐个解析，保留中文和路径中的空白。
`--no-renames` 将改名显示为旧路径删除和新路径新增，两端都检查边界。
手工逐行输入普通路径或使用 `--files` 仍受支持；Git 文件列表必须使用 `-z`。

修改检查器后运行回归测试（CI 也会运行）：

```bash
node --test .agents/scope_guard.test.mjs
```

## 改动边界清单的规则

**模块自己不能扩自己的边界。** 需要扩时：单独开一个 PR 只改清单文件，
`Module: docs`，@ Tech Lead。混在功能 PR 里一起改会被打回。

## 模块与发布阶段的对应

见 [`../docs/01-scope-v2.md`](../docs/01-scope-v2.md) 末尾的表。
**不要因为一个模块「还没人做」就去做它** —— 开工顺序由发布阶段决定，不由空闲决定。

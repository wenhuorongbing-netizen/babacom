# 协作指南

本仓库保留旧原型、验证 harness 和迁移要求。客户端开发走 [Element fork 的 `babacom/main`](https://github.com/wenhuorongbing-netizen/babacom-element-web/tree/babacom/main)，该分支受保护并要求 CI 检查通过。
本仓库的开发以 PR 合入 `main`。实时进度、阻塞、负责人和里程碑只维护在 GitHub Issues 与 milestones。

## 从 Issue 到合并

1. 在 Issue 写清用户结果、完成条件、固定基线、一个模块、逐个允许改动的文件、依赖和可执行检查。指定负责交付的人和非作者审查人。实验、设备、数据及部署按对应授权执行。
2. 从目标分支的已知基线开短分支。用干净工作副本隔离无关改动，逐文件暂存。共享契约、锁文件、迁移序列、部署配置和独占设备由集成负责人协调单一写入者。
3. 按 [PR 模板](.github/pull_request_template.md) 写 `Module: <id>` 和 `Closes #编号`。模块 id 使用当前清单，例如 `Module: docs`。如实写改动和已知限制，包含相关失败或未验证项。自动检查结果留在 CI。
4. 非作者审查实现是否符合 Issue、模块边界、公共契约和测试意图。改动 head 后重新检查受影响部分。获准的集成负责人在审查与规定检查通过后合并。共享分支的冲突先核对双方意图和契约，逐处解决并重跑受影响的检查。

## 文件边界与范围变更

[模块清单](.agents/modules/) 的 `allowed-files:start` 与 `allowed-files:end` 注释之间每行一个路径模式。`*` 匹配单层路径，`**` 可跨目录。改名的源和目的地均受检查。

```bash
git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs docs
node .agents/scope_guard.mjs docs --files README.md CONTRIBUTING.md
```

用 Issue 的模块 id 替换示例。Git 列表用 `-z` 保留路径边界。CI 从 PR 的可信目标分支 SHA 加载守卫和清单，用候选提交的 Git 差异核对范围。候选测试在独立的低权限任务中运行。
普通范围调整可随同 PR 提交。更新 Issue 的逐文件边界，在清单中写明最小路径并请 Tech Lead 审查。当前 PR 的全部路径仍须通过可信 base 的规则。若某个文件超出可信 base，先使相应范围获批并进入目标分支，再提交依赖该范围的改动。
CI 给出检查结果。GitHub 对合并的强制以目标分支实际配置的 required checks 和 reviews 为准。

## 公共契约与共享配置

变更数据库结构、仓库布局及所有权、HTTP API、WS 事件、设计令牌及组件、房间权限或媒体令牌时，核对相应的公共契约与负责人。旧活动路径仍遵循 [T1](docs/T1-spec.md)、[T2](docs/T2-spec.md) 和共享 schema，Matrix 继任按 [迁移规格 §4](docs/Matrix-migration-spec.md#4-契约转换与签认)。迁移 SQL 提案放在 `apps/api/migrations/_proposed/`，由负责人审查后编号。
共享守卫、模块清单和工作流随仓库审查。保留外部资料的作者、许可和原始历史，参见 [README](README.md#reference-and-provenance)。

## 两层验证

- **每 PR 自动检查**包括 `scope_guard`、Gitleaks、受影响代码的类型检查、lint、单元测试及现有 Windows 回归 CI。正常代码审查继续执行。PR 正文无需粘贴检查输出，无需逐 PR 请 Jack 签认或追加决策记录。
- **发布候选**以固定提交哈希执行 [发布检查表](docs/RELEASE-CHECKLIST.md)，按项目提交对应的实机、网络、权限、恢复与升级证据。切换观察及退役按各自里程碑验收。

旧桌面命令见 [package.json](apps/desktop/package.json)，API 环境见 [pyproject.toml](apps/api/pyproject.toml)。Element 的命令以该 fork 固定版本的 scripts 和 CI 为准。只有决策发生变化时更新 [DECISIONS.md](docs/DECISIONS.md)。

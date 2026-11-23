# AGENTS.md

开工先读 [仓库地图](REPO_MAP.md)、Issue 对应的 [模块清单](.agents/modules/) 和目标目录的 AGENTS.md。
分支、审查和范围变更流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
人和 Agent 走同一套 PR 规则，开发工具和方法自选。

## 四条合并规则

1. **守住范围。** 每个 PR 对应一个 Issue 和一个模块。改动须同时符合 Issue 声明和可信目标分支的 allowed-files，由 `scope_guard` 检查。
2. **如实填写 PR。** 按 [模板](.github/pull_request_template.md) 填写 `Module:`、关联 Issue、实际改动和已知限制。有已知限制时如实写明。
3. **同步公共契约。** 公共接口、schema 或数据模型变更时同步更新相应契约。迁移提案放在 `apps/api/migrations/_proposed/`，正式序列由负责人编号。
4. **保护秘密。** 密钥、令牌、私有证书和 `.env` 不得入仓。

## 两层验证

- **每个 PR** 走快速自动检查：范围守卫、Gitleaks、受影响代码的类型检查、lint、单元测试，以及现有 Windows 回归 CI。保留正常代码审查。
- **发布候选** 只对固定的 RC 提交哈希执行 [发布检查表](docs/RELEASE-CHECKLIST.md)。G5 切换观察和 G6 退役随后分别验收。

提交 PR 前的范围自查示例（按 Issue 替换模块 id）：

```bash
git diff --name-only --no-renames -z origin/main...HEAD | node .agents/scope_guard.mjs docs
```

## 按任务查阅

- 产品与迁移要求见 [PRD](docs/PRD-matrix-migration.md) 和 [技术规格](docs/Matrix-migration-spec.md)。
- 决策变更同步更新 [DECISIONS.md](docs/DECISIONS.md)。实时状态只在 [GitHub Issues](https://github.com/wenhuorongbing-netizen/babacom/issues) 和 [里程碑](https://github.com/wenhuorongbing-netizen/babacom/milestones) 维护。
- 创建、读取或发布 Issue 前查阅 [Issue tracker](docs/agents/issue-tracker.md)。
- 标记 Issue 或 triage 前查阅 [标签配置](docs/agents/triage-labels.md)。
- 术语、规格及架构变更查阅 [领域文档规则](docs/agents/domain.md)。

# Agent Harness — 为什么它必须进仓库

共享的是产出边界与检查入口；模型、编辑器和个人工作方法由开发者选择。
日常流程只维护[协作指南](05-collaboration.md)，硬性规则只维护[AGENTS](../AGENTS.md)。

## 提交什么

| 路径 | 作用 |
|---|---|
| REPO_MAP.md、目录 AGENTS | 按任务定位与就近规则，避免扫全库 |
| .agents/modules/、scope_guard.mjs | 模块路径、验证和完成条件；检查 diff是否越界 |
| .github/ | PR模板、实际CI和CODEOWNERS |
| .claude/settings.json | 已跟踪的共享配置；不是完整开发工具链 |

当前仓库没有跟踪 .claude/skills/ 或 dev-map/dev-spec/dev-build/dev-review。
这些可以是个人可选工具，不能当新人已安装的必经命令。
个人偏好、本地会话、缓存与秘密不成为共享 harness；忽略文件不授予删除权限。

## 检查能保证什么

scope_guard检查模块与文件范围；各 CI 的内容以[工作流](../.github/workflows/)为准，不从范围检查推导产品、真实设备或跨境验收。
机器格式与命令在 [.agents/README](../.agents/README.md)，模块扩范围必须独立 docs PR。
CODEOWNERS声明候选审查者，实际权限和分支保护须核实；当前main未启用保护，不声称守卫技术上杜绝所有直接写入。
数据库迁移仍遵守根规则：模块提出 migrations/_proposed，正式序列由负责人审查编号。

## 使用边界

先地图、根规则、相关目录规则及本票模块，再读与验收有关的代码；不因可读取就加载全部资料。
并行、单一 writer 与工作副本保护见[协作指南](05-collaboration.md#日常短分支)。
签认要求来自具体合同与授权；推荐开发流程不额外制造每一步人工确认。
真实运行、数据、设备和生产条件仍按对应票落实；Agent工具不能代替这些条件。

独立审查能力决定并行容量；先有可审查的小票，再增加Builder，不能用更多Agent挤掉review。
当前规模与例外查看 [.agents/modules](../.agents/modules/) 和 [04决策](04-open-decisions.md)，不在此复制另一份状态表。

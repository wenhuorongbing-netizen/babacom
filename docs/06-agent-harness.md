# Agent Harness — 为什么它必须进仓库

共享的产出边界与检查配置纳入版本控制，供团队维护、审查和追溯；模型、编辑器和个人工作方法由开发者选择。
共享文件包括 REPO_MAP.md、各级 AGENTS、.agents/、.github/ 和 .claude/settings.json。个人偏好、本地会话、缓存和秘密不属于共享配置；忽略文件不授予删除权限。

当前仓库没有跟踪 .claude/skills/ 或 dev-map/dev-spec/dev-build/dev-review。
这些可以是个人可选工具，不能当新人已安装的必经命令。

模块格式、检查命令、扩范围与守卫保证范围只维护在 [.agents/README](../.agents/README.md)。
硬性规则与迁移所有权见 [AGENTS](../AGENTS.md)，定位与禁扫区域见[地图](../REPO_MAP.md)，协作、实际权限和分支保护见[05](05-collaboration.md)。

签认要求来自具体合同与授权；推荐开发流程不额外制造每一步人工确认。
真实运行、数据、设备和生产条件仍按对应票落实；Agent工具不能代替这些条件。
独立审查能力决定并行容量；先有可审查的小票，再增加Builder，不能用更多Agent挤掉review。

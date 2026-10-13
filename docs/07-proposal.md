# Babacom 协作方案

本文件保留早期工程评审的摘要和来源，**不再作为当前开工顺序或第二份多人指南**。
原全文可从[迁移规划基线](https://github.com/wenhuorongbing-netizen/babacom/blob/959ad74d8fdbaf7cb29fc6ec2dbf0b5f04932aaa/docs/07-proposal.md)恢复。
当前入口是[Matrix PRD](PRD-matrix-migration.md)、[规格](Matrix-migration-spec.md)、[Backlog](Matrix-migration-backlog.md)与[协作指南](05-collaboration.md)。

## 一、我解决了什么问题

| 原评审主题 | 保留的要求与当前出处 |
|---|---|
| Web only与游戏音频/全局操作冲突 | Windows优先；[平台NFR](02-platform-nfr.md)与G1实际验收 |
| 回声消除被列为排除 | 默认保留处理能力；[Scope](01-scope-v2.md)与设备/无回授用例 |
| 高清共享成本与排期混淆 | [成本模型](03-cost-model.md)保留估算假设；1440p60仍为远期，实测决定采购 |
| 稳定期被新功能挤掉 | R02及G5观察独立，保留两周游戏夜目标 |
| 模块先各做一座孤岛 | 小纵切片先贯通，仍遵守精确模块边界 |
| 两地服务器等于自动优化混合房间 | 房间归属与中德链路须实测；不能据旧示意图承诺性能 |
| 运维最小集与域名采购 | 撤销/恢复/升级/诊断/TURN仍需验收；不用昂贵品牌域名替代网络质量 |

详细历史理由在 [00工程评审](00-review-plan01.md)、scope.html和teams.html；
其中独有Must及排除项仍是需求来源，不因退出新人默认阅读链而删除。

## 二、多人 + 多 AI 怎么协作

只维护 [05协作指南](05-collaboration.md)。根AGENTS、模块清单、共享契约和真实验证约束产出；不统一所有人的模型、编辑器或测试方法。
守卫维护见 [06 harness](06-agent-harness.md)，实际模块列表见 [.agents/README](../.agents/README.md)。

## 三、需要拍板的事

当前决定、未签事项及历史出处在 [04待决表](04-open-decisions.md)。
本fork的Jack裁定范围与全局D9任命分别处理；公开fork不自动赋予新成员权限或分发许可。
运行、数据、设备和正式发布条件不得从本历史摘要推导。

## 四、下一步

当前顺序以迁移Backlog的依赖和Gate为准：原版受限proof → Windows关键音频 → 产品/恢复 → 真人中德 → 观察/退役。
早期“先全部网络实测再写第一行产品”的顺序不是本轮合成隔离proof前置；真实网络与设备出口仍必须完成。

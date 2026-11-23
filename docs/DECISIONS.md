# 仍生效的决策

- **2026-10-04 / 2026-10-06**　旧活动路径继续遵守现有 T1 准入、T2 语音及采集契约，继任见迁移规格 §4。来源：[T1](T1-spec.md)、[T2](T2-spec.md) 和[历史签认](archive/04-open-decisions.md)。
- **2026-10-13**　[#50](https://github.com/wenhuorongbing-netizen/babacom/issues/50) 采用标准 Matrix，优先选择维护中的 Element，以最小定制保留单一权威及可升级性。来源：[D16](archive/04-open-decisions.md#d16-matrix迁移2026-10-13) 和 [PRD §7](PRD-matrix-migration.md#7-解决方案与迁移约束)。
- **2026-11-22**　PO 流程重置 Q1–Q4：每 PR 只走快速自动门和正常 review，普通扩范围可同 PR 提交且仍由可信 base 裁决。发布验证集中到固定 RC，G5/G6 单独验收。文档合并，实时状态只维护在 GitHub Issues 和里程碑。暂停 R0 / N1–N5 逐项审批链。[M24 #83](https://github.com/wenhuorongbing-netizen/babacom/issues/83) 的服务端强制仍是宣称「PRD 完成」的前置。来源：2026-11-22 PO 裁决。
- **2026-11-23**　[Element fork](https://github.com/wenhuorongbing-netizen/babacom-element-web/tree/babacom/main) 的 `babacom/main` 是产品线，受保护并有必需 CI 检查。`babacom-base/v1.12.30` 锁定为未改动的上游参考，升级跟随上游稳定 tag。允许带标识与校验和的未签名 Windows 内测包，签名在 RC 验收。来源：2026-11-23 PO 裁决。

旧裁决、签认和证据出处见 [docs/archive/04-open-decisions.md](archive/04-open-decisions.md)。

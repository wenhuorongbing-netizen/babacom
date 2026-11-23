# 发布检查表

每个发布候选以客户端 RC 的完整提交哈希为验收对象。随证据记录制品哈希、服务端组件与配置版本、测试环境、操作者、日期、结果和限制。提交哈希变更时，确认受影响的证据并对新 RC 补验。里程碑的实时状态和证据链接只更新到 GitHub Issues 与里程碑。
未签名 Windows 内测候选从 [Element fork 的 BabaCom 工作流](https://github.com/wenhuorongbing-netizen/babacom-element-web/actions) 下载 `babacom-windows-unsigned`，核对校验和以及 `UNSIGNED INTERNAL TEST CANDIDATE` 标识。Windows 制品签名与信任校验属于 RC。

静态与单元、真实服务、客户端旅程、打包与原生、真人网络及运维恢复分别留证。按实际结果记录失败、阻塞和未运行项。合成音频、VM 与 CI 用于各自的检查，真人听音和物理释放须有实物证据。[规格 §8](Matrix-migration-spec.md#8-测试转换与证据层级)

## G0 契约和资产

- [ ] M01 逐项核对 Must、旧断言与数据资产的去向、归属和未查明影响。M02-E 固定受限实验契约，M03 核对精确范围与实验票条件，M04 固定上游和服务版本、来源与许可。资产未查明时暂缓真实导入与切换。[范围](01-scope-v2.md)、[规格 §4–5](Matrix-migration-spec.md#4-契约转换与签认)

## G1 Windows 游戏关键证明

- [ ] 在两台真实 Windows 设备用同一 RC 安装包验证窗口与整屏游戏画面、系统声、独立麦克风、接收端分别调节游戏声和人声，以及无数字回授。验证权限拒绝、迟到授权、停止共享、退出及崩溃后的采集和物理设备释放。未通过时暂停扩大界面定制，保留缺口和维护代价。[PRD §7](PRD-matrix-migration.md#7-解决方案与迁移约束)、[规格 §5、§8](Matrix-migration-spec.md#5-gate-与失败处理)

## G2 单一权威纵切片

- [ ] 用真实 homeserver、auth 与 SFU 验证邀请、稳定账号、频道、消息同步与重启历史、闭麦入房、显式开麦、离开和重入。单独验证成员移除后新请求拒绝及通话内撤销，依据已签认政策核对最大撤销窗口。[规格 §4–5、§8](Matrix-migration-spec.md#4-契约转换与签认)
- [ ] 以直接 API 和标准客户端测试无授权、无效/重放凭据、跨房间访问、限流 `429` 与撤销。设备/密钥恢复须验证新设备、历史解密、丢钥提示、退出清除本地秘密和重新登录。[规格 §4、§6、§8](Matrix-migration-spec.md#4-契约转换与签认)、[决策](DECISIONS.md)

## G3 可运行、可恢复

- [ ] 核对 RC 的签名、校验和、固定组件/镜像、补丁、许可与归属。用干净 Windows Sandbox 验证真实安装、安装版本和交互界面，从 `File → Quit` 退出，确认只释放本次的应用、更新进程和 Sandbox。加测权限拒绝、热插拔、睡眠、崩溃和重启。[规格 §5、§8–9](Matrix-migration-spec.md#8-测试转换与证据层级)、[Sandbox 验证入口](../.agents/modules/matrix-windows-install.md)
- [ ] M25 为旧断言逐条记录 KEEP / REWRITE / RETIRE、继任测试、契约依据和负责人。Chrome/Edge 访客走邀请、登录、消息、闭麦语音、收听/观看、权限拒绝和关页退出，明示平台差异。[规格 §8](Matrix-migration-spec.md#8-测试转换与证据层级)
- [ ] 每日备份数据库、媒体、配置及服务身份，核验异地副本、恢复点和访问控制。隔离演练迁移、恢复及回退，验证新写入保全，实测 RPO ≤24 小时、RTO ≤4 小时，并安排每季度恢复演练。单独验收用户设备和密钥恢复。[PRD §4](PRD-matrix-migration.md#4-目标与可衡量结果)、[规格 §6](Matrix-migration-spec.md#6-数据密钥切换与回滚)、[NFR §3.3](02-platform-nfr.md#33-数据与备份)
- [ ] M27 验证获准更新源、签名/哈希、坏包拒绝、安全失败与重启后账号、密钥、历史保全。M35 实际演练一次相邻上游稳定版本升级及兼容回退，记录补丁和维护成本。[PRD §4](PRD-matrix-migration.md#4-目标与可衡量结果)、[PRD §7](PRD-matrix-migration.md#7-解决方案与迁移约束)、[规格 §5、§8](Matrix-migration-spec.md#8-测试转换与证据层级)
- [ ] 检查健康、成本、留存及告警。流量配额到 80% 告警，日志留存 14 天，附件 90 天后自动清理。[规格 §5、§9](Matrix-migration-spec.md#9-运行许可与维护成本)、[NFR §3.3](02-platform-nfr.md#33-数据与备份)、[NFR §3.5](02-platform-nfr.md#35-可运维性)

## G4 真实 Alpha

- [ ] 在 25 名注册成员、1 个社区的 Alpha 基线上，以 Windows 11 x64 和 Chrome/Edge 访客完成适用旅程。真人同时 10 人语音、1 路共享、最多 9 人观看，持续至少 2 小时不掉线。两设备短句每方向至少 19/20 可懂，正常入房至少 9/10。中德链路单独实测，覆盖高峰及强制中继，保留听音、物理释放和负载证据。[PRD §4](PRD-matrix-migration.md#4-目标与可衡量结果)、[规格 §5、§8](Matrix-migration-spec.md#5-gate-与失败处理)、[NFR §2](02-platform-nfr.md#2-验收负载alpha)
- [ ] 语音单向延迟同区域目标 <150 ms、>300 ms 不合格，中德目标 <300 ms、>500 ms 不合格。网络抖动后 ≤10 秒内恢复或明确报错，睡眠后自动入房，USB/蓝牙热插拔切换或提示且不崩溃。记录每 10 分钟可察觉卡顿 ≤1 次，并在固定组合实测校准语音丢包 15%（Opus RED/FEC）和视频 6% 的 NFR 基线。[NFR §3.1–3.2](02-platform-nfr.md#31-音视频质量)、[规格 §8](Matrix-migration-spec.md#8-测试转换与证据层级)
- [ ] RC 签认引用固定哈希及适用 Must 的证据。保留失败及未验证项，Jack 记录明确接受的未做项。有发布阻断时保持待处理。M24 单共享者策略须验证服务端强制及绕过负向，是「PRD 完成」的前置。现场切换与退役仍按下面两个里程碑验收。[PRD §8](PRD-matrix-migration.md#8-发布节奏与完成定义)、[决策](DECISIONS.md)

## G5 切换与两周观察

- [ ] M36 冻结旧入口写入，核对迁移，演练切换及保留新写入的回退或前向修复。连续两周真实游戏夜无人因质量回退后，由 owner 单独签收。之后按授权断开旧消费者并办理 M25 覆盖交接，保留可恢复基线。[PRD §4](PRD-matrix-migration.md#4-目标与可衡量结果)、[规格 §5–7](Matrix-migration-spec.md#5-gate-与失败处理)

## G6 退役与关闭

- [ ] 在 G5 及覆盖交接后，M33/M34 按顺序逐文件核对消费者为零、继任覆盖、归属与恢复基线。独立审查后按范围退役并复验构建、测试、安装及升级，保留数据和历史证据。旧票逐项记录真实处置、证据和负责人，核对整体完成条件。[规格 §5、§7](Matrix-migration-spec.md#7-技术债与删除契约)、[PRD §8](PRD-matrix-migration.md#8-发布节奏与完成定义)

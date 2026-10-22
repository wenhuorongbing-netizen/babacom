# BabaCom：当前实现基线

本文回答“现有软件实际做什么”，基线为 `f4c092b8cd30db46086c3bf0f482c6168cdb4381`；它不是新产品裁决，不替代 [Matrix 迁移目标 PRD](docs/PRD-matrix-migration.md)、T1/T2 已签认规格或实验合同。源码存在、回归通过、真实运行、真人验收分别判断。

## 产品和使用者

当前产品是供私人游戏群使用的 Windows Electron 语音原型；Matrix 是独立验证中的迁移方向。当前没有 Matrix 测试发行版，安装旧 BabaCom 包不代表迁移完成。客户端只接受 `127.0.0.1` API 和 `ws://127.0.0.1` SFU，普通 API 入口也只监听本机；直接配置远端服务接入尚未实现（[启动校验](apps/desktop/src/main/main.ts)、[API 入口](apps/api/app/main.py)）。

| 使用者 | 当前可执行的任务 | 边界 |
|---|---|---|
| 获准成员 | 在受控启动会话中填昵称、申请房间准入、连接语音、选择开麦及播放 | 昵称不是账号；用户不能自行获得授权 |
| 主机集成者 | 注入认证、房间授权及服务配置 | 没有真实 provider 时 API 拒绝普通启动 |
| 实验操作者 | 执行隔离控制面、Windows 包、RTC 信令证明 | 合成账号和隔离环境不能替代真实用户验收 |

依据：[准入页面](apps/desktop/src/shell/AdmissionPage.tsx)、[API 入口](apps/api/app/main.py)、[认证接口](apps/api/app/auth/provider.py)。

## 当前功能矩阵

| 能力 | 源码中的行为 | 证据与限制 |
|---|---|---|
| 昵称与准入 | 校验昵称，发起准备请求，显示准入摘要、过期和重试状态 | 已实现；[AdmissionPage](apps/desktop/src/shell/AdmissionPage.tsx) |
| 身份与房间权限 | Bearer 会话交认证 provider，房间交权限策略，再签 LiveKit token | 已实现接口与校验；没有完整产品账号注册/恢复服务；[routes](apps/api/app/tokens/routes.py) |
| 单房间语音 | 一次会话绑定房间与参与者，LiveKit SDK 连接、成员更新、麦克风与播放控制 | 已实现；真人双设备听音、物理释放及跨境验收仍独立；[session](apps/desktop/src/features/voice/session.ts) |
| 社区导航 | 一个服务器标记、一个语音频道和状态展示 | UI 外壳，不能视为多社区/频道管理；[DesktopShell](apps/desktop/src/shell/DesktopShell.tsx) |
| 文字、邀请与历史 | 独立 Matrix 控制面验证标准接口 | 非当前 Electron 产品功能；[control proof](infra/staging/matrix-proof/proof.mjs) |
| Element Windows 安装 | 固定包核验、Sandbox 安装、欢迎页、退出、VM 清理 | 只覆盖包生命周期，不证明账号/语音/游戏音频；[runtime](infra/staging/matrix-windows-proof/runtime.mjs) |
| Matrix RTC | OpenID、房间成员、SFU 签票、LiveKit 零轨道信令及拒绝用例 | 验证器已实现；完整 R0 未签收，不含真实媒体；[RTC proof](infra/staging/matrix-rtc-proof/proof.mjs) |

## 核心旅程

1. 主进程读取受控启动配置，经 preload 暴露窄接口；渲染页面不能直接访问 Node 或铸造 token。
2. 用户填昵称，主进程向 `/api/v1/tokens/media` 请求准入；API 验证会话、输入、房间权限和限流。
3. API 返回短期媒体凭据；主进程保留敏感信息，向 UI 返回摘要。用户加入后创建独立媒体上下文，用 LiveKit SDK 连接固定房间。
4. 连接默认闭麦；开麦需要当前会话同意，播放有独立控制。离开、失败和销毁进入清理状态。

依据：[main](apps/desktop/src/main/main.ts)、[MediaSession](apps/desktop/src/main/media-session.ts)、[voice](apps/desktop/src/features/voice/session.ts)。

## 数据、状态与阈值

| 对象或约束 | 当前定义 |
|---|---|
| 身份 | `User.subject_id` 来自受信认证适配器；显示昵称不授予身份或权限 |
| 房间与凭据 | roomName、参与者身份、LiveKit URL、短期 token；共享契约定义请求、响应与媒体状态 |
| 准入 UI | idle / processing / ready / failure；取消及过期使准备状态失效 |
| 媒体状态 | idle / connecting / connected / leaving / failed / cleanup-failed；状态随 sessionId 隔离 |
| 昵称 | 原始最多 256 code points；NFC、去两端 U+0020 后 1–32；拒绝控制字符、代理字符及契约列出的不可见/方向字符 |
| 准入额度 | 60 秒滚动窗：每 IP 120、每主体 20、每主体与房间 6；超限返回 429 和 Retry-After |
| 请求和 token | 请求体上限 4096 bytes；token TTL 120 秒，仅允许麦克风发布、禁止数据发布 |
| 语音生命周期 | 连接总计时 30 秒；清理等待 5 秒；SDK 无自动重连，连接错误不静默重试 |
| API 部署 | 单 worker，进程内限流；不宣称具备多实例共享限流 |
| 实验期限 | Windows Sandbox 总预算 360 秒/清理 30 秒；RTC 单次 120 秒/共享清理 60 秒，二者不是产品 SLA |

权威细节见 [admission schema](packages/contracts/admission.schema.json)、[token schema](packages/contracts/token-claims.schema.json)、[限流器](apps/api/app/ratelimit/limiter.py)、[API factory](apps/api/app/factory.py)。

## 验收和未实现边界

- 测试 fixture、进程工厂注入和合成 peer 是回归接缝，不是生产身份、授权或真实听音证据。
- Matrix 控制面证明、Windows 安装证明和 RTC 证明各自独立；任一成功不能累计推定产品切换成功。
- 本次文档没有重跑测试或云端；源码具备 READY/VERIFIED 状态不构成真实 R0 或发布通过证据。
- 当前缺少完成证据：Matrix 产品接线、邀请注册与恢复、产品文字频道、游戏画面/系统音频分轨、独立音量、10 人两小时、中德链路、密钥与历史恢复、升级/回滚及两周真实观察。
- 旧链退役必须等待替代和切换验收；历史证据、旧实验及未合并工作不是垃圾。

后续需求和阶段出口继续以 [迁移规格](docs/Matrix-migration-spec.md)、[现有 Backlog](docs/Matrix-migration-backlog.md) 及各票验收为准，不在本文建立第二份动态状态表。

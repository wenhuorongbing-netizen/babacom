# 待决清单

> 合并 `scope.html` 的 2 项、`teams.html` 的 6 项、`plan01.md` 新提出的 3 项。
> 规则：每一项必须落入 **DECIDED / SPIKE / PARKED** 三类之一。**不允许留「大家之后再看看」。**

---

## 已建议裁决（等 PO 确认即可关闭）

### D0 平台形态 —— Windows-first
**建议：DECIDED.** Windows 客户端为完整体验，Web 为访客入口。
理由与能力边界见 [`02-platform-nfr.md`](02-platform-nfr.md) 的平台矩阵。
**连带关闭 D2。**

### D2 全局快捷键怎么做
原问题：浏览器标签在全屏游戏时看不到键盘。备选是 Chrome 扩展 / 托盘小程序 / 只在标签聚焦时生效。
**建议：DECIDED —— D0 一旦确定 Windows-first，此问题消失**，Electron 的 `globalShortcut` 直接可用。
Web 访客版接受「仅标签页聚焦时生效」，并在 UI 上明说。
Owner: 3.2

### D4 谁可以创建邀请码
`scope.html` 里「仅管理员」和「任何成员」被同时勾选，互相矛盾。
**建议：DECIDED —— 做成设置项，默认仅管理员。**
Owner: 2.1

### D7 回声消除
**建议：DECIDED —— 从「排除」移回「必选」，默认开启可关闭。**
理由见 [`00-review-plan01.md`](00-review-plan01.md) A2。
Owner: 3.2

### D8 域名
**建议：DECIDED —— 不买 `baba.vip`（一年 ¥40000），用现有域名加子域。**
WebRTC 生产部署需要的是可信域名 + 有效 TLS 证书，不是品牌域名。
Owner: 1.1

---

## 必须靠实验回答（SPIKE）

### D1 租哪台机器
$11 的东京便宜机 vs $35 的优质回国线路。
**这不是偏好问题，由 R00 的 21:00 北京时间测量决定。**
判据：UDP 直连成功率、21:00 丢包率、抖动、连续 2 小时稳定性。
Owner: 8.1 · 阻塞：1.2、所有码率默认值

### D6 一个房间还是两个 —— **架构级，优先级最高**
问题：一个中德混合语音房，究竟由**哪一台**媒体服务器承载？

必须先接受的事实：LiveKit 多区域部署可以让**不同房间**落在不同节点，
但**一个房间必须完整落在一个节点上**。加一台欧洲服务器不会自动把同一个房间
切成「国内一半在亚洲、欧洲一半在欧洲」。

三个备选：

| 方案 | 说明 | 代价 |
|---|---|---|
| A 单亚洲节点 | 所有房间落亚洲，欧洲用户接受更高延迟 | 最简单，欧洲体验待测 |
| B 房间级区域选择 | 建房时选「亚洲 / 欧洲」，频道上显示区域标签 | 混合房仍需选一边 |
| C 跨区级联 | 两节点间中继同一房间 | **PARKED** —— 项目性质会变 |

**建议：R01 走 B（含区域标签，UI 已在 scope 里），但第一轮只部署亚洲节点。**
最终由 R00 测量的欧洲→亚洲延迟决定 B 是否够用。
Owner: 1.2 · 阻塞：3.1、4.x、8.1

### D3 什么邮箱能进中国收件箱
密码找回需要投递到 QQ 邮箱和 163。境外发件方常被直接判为垃圾邮件。
**SPIKE：** 实测 2–3 家服务商向 QQ/163 的到达率。
备选兜底：管理员手动重置密码（Alpha 25 人规模完全可行）。
Owner: 7.3

### D5 搜索用什么
Postgres 全文检索免费且在此规模足够；独立索引更快但多一个要运维的东西。
**中文分词是独立难题**，Postgres 默认不带中文分词器。
**建议：PARKED 到 R04**，届时再 spike。
Owner: 5.3

---

## 新增待决（`plan01.md` 提出，原文档没有）

### D9 谁是 Tech Lead / Integrator
**这是当前最大的项目风险，且和技术无关。**
必须有且只有一个人：拥有架构与接口、决定合并、阻止不兼容实现进入 main、保证 main 随时可构建。
这个人不必是代码能力最强的，但必须愿意读每一个 PR，并且**敢说「不合」**。
状态：原规划的全局 D9 **未指派**；本 fork T1 已固定 Jack，T2 提议沿用 Jack、待书面规格与范围 PR 明确审阅 · 阻塞：原规划全局并行及未签认的 T2 实现

### D10 并行度上限
`teams.html` 假设 24 模块 / 105 agents，但契约与 review 全部收敛到 1 个人。
**建议：DECIDED —— wave 0 并行度压到 3–4 个模块**，纵切片打通后按 review 实际吞吐再放大。
Owner: D9 指派后的 Tech Lead

### D11 韩国现有服务器的定位
现在同时跑着梯子和几个网站。
**建议：DECIDED —— 只作为 R00 实验环境，不预先认定为最终节点。**
不要把 VPN、网站、数据库、API 和实时媒体堆在同一台低配机器上：
普通网站慢几秒可以接受，实时媒体对丢包、抖动和 CPU 抢占极其敏感。
Owner: 8.1

---

## 状态总表

| ID | 事项 | 状态 | Owner | 阻塞 |
|---|---|---|---|---|
| D0 | Windows-first | 待 PO 确认 | PO | 平台矩阵、D2 |
| D1 | 租哪台机器 | **SPIKE (R00)** | 8.1 | 码率默认值 |
| D2 | 全局快捷键 | 随 D0 关闭 | 3.2 | — |
| D3 | 邮件到达率 | **SPIKE** | 7.3 | 密码找回 |
| D4 | 谁能建邀请码 | 待 PO 确认 | 2.1 | — |
| D5 | 搜索基础设施 | **PARKED → R04** | 5.3 | — |
| D6 | 一个房间还是两个 | **SPIKE (R00)** | 1.2 | 3.1 / 4.x |
| D7 | 回声消除 | 待 PO 确认 | 3.2 | — |
| D8 | 域名 | 待 PO 确认 | 1.1 | TLS 部署 |
| D9 | **Tech Lead 人选** | 全局未指派；T1固定；T2 Owner已由PR15签认 | 全局：PO；T1/T2：Jack | 全局并行；T2-C2范围修订等具体docs PR签认 |
| D10 | 并行度上限 | 待 Tech Lead 确认 | TL | wave 规划 |
| D11 | 韩国服务器定位 | 待 PO 确认 | 8.1 | — |
| D12 | 本 fork T2 媒体执行与凭据边界 | **T2-C2修订待签认；兼容SPIKE** | T2 Owner：Jack（PR15已签认） | 修订PR合并前#16 BLOCKED；后续真实SDK/SFU验证 |

**本 fork 发布阶段校准：DECIDED（2026-10-04，用户授权修正并合并基线 PR）。**
沿用 [01-scope-v2.md](01-scope-v2.md) 的既有 R04 范围：完整每频道权限、
自定义表情、链接预览、每用户强调色、投票与斜杠命令。对应模块和仓库地图
已同步阶段，所有 allowed-files 块保持原样；本次不提前任何功能。

## 本 fork 的 T1 契约决策（2026-10-04）

适用范围仅为 wenhuorongbing-netizen/babacom 的 T1；原仓库、T2/T3 以及全局并行开发不由此获得签认或实施授权。完整契约与逐文件范围见 [T1-spec.md](T1-spec.md)。

| 项目 | T1 决策 | 状态/责任 |
|---|---|---|
| 契约 Owner | Jack 是 T1 唯一最终签认者与集成裁决者；Codex A 起草、验证及执行已授权的串行 Issue | 角色固定；具体代码/边界 PR 以 Jack 的逐次审查与合并为准 |
| 测试边界 | 实际 Windows 应用旅程 + 完整 HTTP 准入接口 | 固定；产品检查 NOT_RUN |
| 昵称 | NFC；首尾 U+0020 去除；1–32 个 Unicode 码点；原始最多 256；禁止控制/代理项与列明的不可见或双向控制符 | 固定；完整字符规则见规格 |
| 媒体凭据 | 初始 TTL 120 秒；限定房间、订阅、microphone；无 data/admin/共享能力 | 固定；签发/兼容测试 NOT_RUN |
| 准入限流 | 滚动 60 秒：IP 120 次、主体 20 次、获准主体/房间 6 次；单 worker | 固定；并发/边界测试 NOT_RUN |
| 最小 UI | 一页准入、Button、TextInput、状态反馈、设计令牌和中文 t() 入口 | T1 范围固定，不代表完整 6.1/6.2 已完成 |
| fixture 与普通入口 | 独立回环测试启动器；普通入口缺 provider 即拒绝启动，不能回退 fixture | 固定；实际启动安全检查 NOT_RUN |
| 源文件边界 | [t1 模块清单](../.agents/modules/t1.md) 精确列明规格的 44 个产品文件；实施 Issue/PR 逐个声明实际子集 | #3 具体 docs PR 经 Jack 审查合并前，产品实现受阻塞；表外文件先走独立 docs 范围 PR |
| T1 所有权 | CODEOWNERS 为 44 个产品文件及 T1 治理文件逐个补充 @wenhuorongbing-netizen（Jack） | 仅本 fork T1；原规划全局规则、D9 和并行安排保持独立 |
| 数据库检查 | 没有 ORM/数据库/迁移变化，alembic check 为 NOT_APPLICABLE | t1 清单已落实适用条款，说明无数据库变化而非 PASS；其他模块验证规则不变 |

[#3](https://github.com/wenhuorongbing-netizen/babacom/issues/3) 的独立 `Module: docs` PR 仅落实 `.agents/modules/t1.md`、`.github/CODEOWNERS` 与本文件：新增 T1 精确边界和所有权，25 份既有模块清单保持原样，不夹带产品实现。

该具体 PR 由 Jack 审查合并后才解除 T1 产品任务阻塞；清单存在、角色指定、Agent 复审和 CI 通过不代替签认。后续实施使用 `Module: t1`，保持单 worker、最小 UI、共享 schema、真实 provider 与隔离 fixture 的规格边界。产品检查仍为 NOT_RUN；前置边界验证、具体 PR 签认与实际产品验收分别以真实证据判断。

## 本 fork 的 T2 契约修订（2026-10-06）

原T2-C规格已由Jack签认并在[PR15](https://github.com/wenhuorongbing-netizen/babacom/pull/15)合并。
T2-01诊断使同窗口执行、零设备枚举与JWT信令URL例外受阻；本节修订为T2-C2，
完整规格见[T2-spec.md](T2-spec.md)，逐文件范围见[t2清单](../.agents/modules/t2.md)。
Jack已确认修订方向；具体Module: docs修订PR待其审阅合并后生效，#16保持BLOCKED。
不关闭T1父票、不扩展全局D9；方向确认、文档签认和产品/设备验收分别判断。

### D12 媒体执行与凭据边界 —— 修订待签认，实际兼容仍为SPIKE

main仅在明确join后创建专用隐藏BrowserWindow，使用全新非持久partition、静态页面与隔离沙箱媒体preload。
业务UI和媒体域使用不同webContents；UI只获得有限命令和快照，不能请求或借用媒体认证头。
初始JWT留main，SDK连接使用非秘密无效占位值；main只为当前媒体webContents、批准主frame/页面、
当前代次、GET及批准SFU的四条精确路径添加原生认证头。UI、外来/旧frame、未知路径及重定向均拒绝。
初始连接事务完成、取消或失败时撤销认证头并清除初始JWT；整个事务限30秒，包含协议协商与HTTP validate。

SFU可能给SDK刷新token；它可留专用隔离媒体域，因此不宣称所有renderer零JWT。
撤销原PR15真实JWT信令URL例外；刷新后失败同样不能产生携带真实token的URL、错误或诊断。
应用会话留main、secret留后端，UI/日志/存储均不持有票据；Chromium原生网络错误也纳入脱敏。
不放宽sandbox/contextIsolation/webSecurity/nodeIntegration、网页导航/子窗或网络白名单。
若锁定SDK刷新后失败仍泄漏票据则BLOCKED；要求所有renderer零JWT时此SDK路线仍HOLD。

SDK被动枚举仅允许在当前媒体上下文生存期间发生，不申请权限、不默认采集或预热，
应用不主动枚举、不向UI交付设备清单；启动/prepare和退出完成后的枚举均须为零。
退出/取消/致命错误须在5秒总预算内销毁媒体webContents、撤销旧认证并停止自有媒体；
不依赖Room断连或GC证明SDK监听销毁。超时进入cleanup-failed隔离，不自动允许重入。
通用可访问成员列表加入共享UI导出，只接收稳定键与展示内容，不依赖媒体schema。

| 项目 | T2-C2修订 | 当前状态/解除条件 |
|---|---|---|
| 签认者与集成 | 本fork T2唯一Owner为Jack；A起草/验证并串行处理获准Issue | PR15已签认；修订方向已确认，具体修订PR待Jack审阅合并 |
| 测试主边界 | 实际Windows应用→HTTP准入→真实SFU；复用既有provider与can | RECORDED旧诊断9例4通过5失败；独立上下文实际修复/打包及刷新后失败验证NOT_RUN |
| 凭据与交接 | 初始main认证头、专用媒体域接收SFU刷新、原子消费、UI认证隔离 | 不允许真实JWT URL或诊断；专用沙箱preload/锁定SDK兼容SPIKE仍限约一个有效工作日 |
| 枚举与退出 | 有限SDK被动枚举、默认采集零、销毁上下文阻止旧回调 | 旧诊断枚举1→2而采集0；新销毁、失败/超时和重入路径须实际验证 |
| 不变值 | T1昵称、120秒初始媒体TTL、grants、IP120/主体20/主体房间6每60秒、单worker | 保留；初始TTL不挂断已连接通话 |
| 非fixture提供者 | 真正的有限会话注册表和房间动作映射；沿用AuthenticationProvider与PermissionPolicy.can | 256位随机会话、摘要/到期/撤销、3600秒寿命已随PR15签认，产品实现独立验证 |
| 普通入口 | 没有显式provider继续拒绝，测试启动器分别构造适配器 | 不导入/回退fixture；不声明完整账号或即时媒体撤销 |
| 票序 | T2-C→T2-C2→T2-01闭麦入房→T2-02受控真实准入→T2-03显式开麦/双设备 | 本轮仅四文件docs修订；#16合并前BLOCKED，合并后先同步26路径子集 |
| 文件与所有权 | 原31路径只加media.html、media-preload.ts、packages/ui/src/index.tsx成为34；CODEOWNERS逐个指向Jack | 修订PR合并才生效；表外变更仍先独立docs范围PR |
| 数据与验证 | 不引入ORM/数据库/迁移；DB NOT_APPLICABLE | 不伪造alembic PASS；独立域播放激活、物理设备、人耳和跨境NOT_RUN，无中德证据不签收M0 |

T1历史段落中的NOT_RUN是2026-10-04规划检查点，不作为当前工程状态。
T1已在[PR13](https://github.com/wenhuorongbing-netizen/babacom/pull/13)合并；
本修订基线为PR15的cb0fd0c71c4a4b99796fc1e37370b6b91fe4fd25，T1最终真人/产品签认仍独立。
T2不签收完整R01或Alpha，10语音/1共享/9观看/至少2小时目标保持原样。

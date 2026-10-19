# 待决清单

> 合并 `scope.html` 的 2 项、`teams.html` 的 6 项、`plan01.md` 新提出的 3 项。
> 规则：每一项必须落入 **DECIDED / SPIKE / PARKED** 三类之一。**不允许留「大家之后再看看」。**

> 当前校准（2026-10-13）：Matrix方向见D16；本文件后续T1/T2与旧PR的NOT_RUN/待审文字是各历史检查点。
> 当前main为c9ec3cf，测试基础设施PR34/35/37/38与PR45均已合并，UI PR49已合并；未结票和实际验收见迁移Backlog。
> 不以迁移规划追认历史PASS，也不在继任契约签认前解除活动旧代码义务。

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
状态：原规划的全局 D9 **未指派**；本 fork T1 已固定 Jack，T2 Owner 已由 PR15 签认 Jack · 阻塞：原规划全局并行；本 fork 各票仍按已签认契约与精确范围执行

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
| D9 | **Tech Lead 人选** | 全局未指派；本fork T1/T2固定Jack | 全局：PO；T1/T2：Jack | 原规划全局并行；本fork不因此扩范围 |
| D10 | 并行度上限 | 待 Tech Lead 确认 | TL | wave 规划 |
| D11 | 韩国服务器定位 | 待 PO 确认 | 8.1 | — |
| D12 | 本 fork T2 媒体执行与凭据边界 | **DECIDED：PR20已合并；实现PR23/24/25已合并** | T2 Owner：Jack（PR15已签认） | #18真人双设备/物理释放/中德验收未完成 |
| D13 | T2打包资源断言的最小例外 | **DECIDED：PR22已合并，#21/#16已关闭** | T2 Owner：Jack | 原#16打包阻塞已解除；后续测试基础设施PR仍独立待审 |
| D14 | #42 Sandbox共享准入与创建后归属 | **DECIDED：独立docs PR44与实现PR45已合并** | T2 Owner：Jack | #42剩余验收与M25/M27/M34退役处置独立，不追认全PASS |
| D15 | Discord 熟悉布局的首个 UI 外壳片 | **DECIDED：范围PR47与产品PR49已合并，#48已关闭** | Jack 签认；A 协调 | 新客户端设计映射M06/M07，旧六文件授权不迁移为新范围 |
| D16 | 标准Matrix迁移Release | **DECIDED方向/规划；客户端与部署组合SPIKE** | Jack最终裁定；A协调；原战略PO顾问 | PO对464f71a两项依赖修正限范围GO；用户授权隔离部署准备，PR99/#97合同待签认；G1/生产/退役独立 |
| D17 | Digo 资料整合与多人工作入口 | **DECIDED 文档整合；运行/组织/许可独立** | Jack 授权本轮；A 串行集成；独立 Reviewer | #102 精确 24 路径；原提交保全、05 唯一指南、逐票 AC 归 GitHub；不变更权限/契约/产品 |
| D16-E | 原版 Matrix 隔离实验执行 | **DECIDED 签认；PR99 审查合并后生效** | Jack 授权；A 实施；独立 Reviewer | 更新 D16/下文历史待签认状态；#98 四文件、本机回环、合成数据；运行结果待实测 |
| D16-G1 | Windows 产物与隔离安装启动 | **PR107/108 已合并，#105/#106 已关闭；#109 安装启动精确范围待签认** | Jack 最终签认；A 协调；子代理研究/独立审查 | 只读核验已通过；下一批仅新 Sandbox 离线 install/start/Quit；运行 NOT_RUN，G1 仍未通过 |
| D16-RTC | 标准 Matrix RTC 最小链路 | **PR119/125已合并；资源核算修订Jack已签认，独立审查/可信合并后生效；真实R0 NOT_RUN** | Jack最终裁定；A协调；独立Reviewer | [现有模块](../.agents/modules/matrix-rtc-proof.md#标准组件精简修订已签认可信合并后生效)；#126草稿未合并，#124旧候选保留，运行细节仍HOLD |

**本 fork 发布阶段校准：DECIDED（2026-10-04，用户授权修正并合并基线 PR）。**
沿用 [01-scope-v2.md](01-scope-v2.md) 的既有 R04 范围：完整每频道权限、
自定义表情、链接预览、每用户强调色、投票与斜杠命令。对应模块和仓库地图
已同步阶段，所有 allowed-files 块保持原样；本次不提前任何功能。

## D16 Matrix迁移（2026-10-13）

用户授权为项目建立全面迁移PRD、spec、9 Epics/36候选票与Sprint计划，包含化解技术债、
无用/冗余代码退役、测试转换、数据/密钥恢复、升级、运行与切换回退。规划票为
[#50](https://github.com/wenhuorongbing-netizen/babacom/issues/50)。

- **DECIDED：** 标准Matrix方向，复用成熟生态；不继续无关的旧自建核心扩展。当前产品仍为旧原型。
- **SPIKE：** stock Synapse + Element Web/Desktop最小定制是首选候选，实际版本兼容、
  Windows系统音频/独立音量/无回授与退出释放、上游升级和许可实验通过才采纳；不fork协议/加密核心。
- **保留：** 产品Must/Won't、真人/物理/中德和负载验收；历史证据只追加。旧T1/T2活动路径
  在逐项继任契约独立审查签认与切换前仍履约；不照搬短会话/一次性密钥库假设。
- **PARKED：** 未知新依赖、生产部署、公开联邦/注册、数据转换工具、实际删除与发布；
  仅在对应票Ready且所需授权具备后执行。不能一票授权整个目录或整个Epic。
- **本轮PO复审：已审FIX（固定e14d7e9）。** 此前Edge附着两次超时、未发送是历史检查点；后续同一原对话已恢复，新包单次发送并完整回收。PO实际读取核心三文档及入口、抽核部分票；45票同步/本地测试仍按A回报，不冒充其运行。
- **修订复核GO（固定464f71a）：** PO实际读取规格§4/§7与Backlog对应条款，两项逻辑修正均GO，无该范围遗留阻断。M02拆出先签认的受限实验契约#97，最终生产政策等实验后签认；M25准备覆盖交接，M36在G5后明确消费者断接，M33/M34再删除。M01正文Must映射仍待完成，不称全覆盖；这不是全PR/实验/部署批准。
- **后续用户授权：** 准备Matrix协议资料、部署项目、调整Sprint/计划；当前落实为本机隔离原版proof，#97精确合同与#98部署票。WSL2.6.3已装但无发行版，尚未安装Linux/容器或部署服务；不自动批准生产、采购、采集或真实导入。

文档入口：[PRD](PRD-matrix-migration.md)、[规格](Matrix-migration-spec.md)、
[Backlog及旧票映射](Matrix-migration-backlog.md)、[协议资料](Matrix-protocol-research.md)。规划/协议资料仍属docs；#97独立docs PR审查实验合同/模块边界，不混入部署产品PR。
原全局D9保持未指派，Jack是本fork迁移最终裁定者。现有UI六文件授权不自动迁入新客户端。

### D16-E 受限原版实验合同（#97）

精确合同见[四文件matrix-proof模块](../.agents/modules/matrix-proof.md)，本PR只新增该清单并追加本段，独立于PR96规划修订与后续#98产品PR。状态：**PROPOSED，待独立审查/Jack签认**。仅专用WSL与官方容器、本机loopback、合成账号/数据；不运行媒体、不开放生产、不动旧原型与dirty。签认后供M03/M04运行及M29-P引用，不把M02全票提前Done。生产TTL/额度/撤销/联邦政策仍待实验后另签。

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
Jack已批准并合并具体T2-C2修订[PR20](https://github.com/wenhuorongbing-netizen/babacom/pull/20)，该契约前置已完成。
#16的T1打包资源清单阻塞已由T2-C3/PR22及实现PR23解除；历史冲突与例外见D13。
不关闭T1父票、不扩展全局D9；方案签认、具体文档PR合并和产品/设备验收分别判断。

### D12 媒体执行与凭据边界 —— PR20已签认，本地兼容有证据

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

以下表格为2026-10-06的T2-C2修订检查点，PR20已合并；其中旧NOT_RUN不代表2026-10-07产品运行状态，当前证据与阻塞见D13。

| 项目 | T2-C2修订 | 2026-10-06状态/解除条件 |
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

### D13 打包资源断言例外 —— PR22已合并，原#16阻塞已解除

当前状态核对（2026-10-11）：[PR22](https://github.com/wenhuorongbing-netizen/babacom/pull/22)
已合并本节三文件范围；[PR23](https://github.com/wenhuorongbing-netizen/babacom/pull/23)
已合并#16实现，#21/#16已关闭。PR24/#17与PR25代码也已合并；#18仍独立等待真人/物理/中德验收。
PR34/35/37/38是未合并的测试基础设施候选，其结果不能代替main或设备验收。
以下保留2026-10-07签认时的生效条件及修订前实验记录，不作为当前BLOCKED状态。

用户已签认独立契约/测试修订票[#21](https://github.com/wenhuorongbing-netizen/babacom/issues/21)的最小方案。
权威测试边界见[T2规格的T2-C3打包资源断言例外](T2-spec.md)，文件上界见[t2清单](../.agents/modules/t2.md)。
只授权后续#16的分发资源用例增加两项必需媒体文件的存在性检查与精确白名单；
其他原断言、其他T1测试及辅助函数保持原样，不能把提前失败后的秘密扫描写成PASS。

具体Module: docs PR仅改本文件、T2规格与t2清单三份文档，不夹带产品或测试。
相对已合并PR20，总上界34→35仅增加`tests/shell/admission.e2e.ts`；
具体PR经Jack审阅合并后，先同步#16的26→27路径与明确测试修复例外，再继续其产品分支。
该路径既有CODEOWNERS已指向Jack，无需改所有权文件；#17/#18不获得此测试路径权限。
方案签认、文档校验或Issue关闭单独不解除#16；#14与M0/R01/Alpha继续独立验收。

RECORDED修订前实际证据（产品代码树`59875dfb3b6c5a0f670aee934cf96b6de70cc0d2`）：
开发52 passed / 3 packaged-only skipped (11.6m)，exit 0；
EXE54 passed / 1 failed (9.7m)，exit 1，32条T2媒体用例全部通过。
失败断言为`Only bundled application resources`（Expected true，Received false）；
ASAR实际新增`dist/main/media-preload.cjs`与`dist/media/media.html`，
该用例后续分发资源秘密扫描NOT_RUN。本轮docs未重跑产品，不签收#16；
后续必须完整开发/EXE回归0 failed且秘密扫描实际执行。物理设备、人耳与中德仍NOT_RUN/HOLD。

### D14 Sandbox共享准入与创建后归属 —— 方案已批准，独立审查待完成（2026-10-12）

Jack批准[#42](https://github.com/wenhuorongbing-netizen/babacom/issues/42)的具体方案与两文件文档范围，
授权独立审查通过后实施。权威行为、状态与验收见[T2-V2](T2-spec.md#t2-v2sandbox-跨进程准入与创建后归属42)。
本docs变更仅修改本文件和`docs/T2-spec.md`，不夹带实现或扩大`t2`模块清单。
后续实现仅修改`apps/desktop/scripts/dev.mjs`和`tests/voice/session.e2e.ts`。

采用同机跨进程/工作区的临时命名管道准入，占用立即非成功BUSY，不排队、不重试；
人工或陌生Sandbox仍可能在查询后出现，必须保留实际CLI结果且不终止它。
实际发出创建请求但归属未确认时，清理报告`UNKNOWN/OWNERSHIP_UNVERIFIED`并保留原失败原因；
只有基线、创建返回ID和后续查询共同确认归属后才可连接和清理精确ID。
最终摘要写入失败单独报告，保留已有主失败；既有摘要字节不得覆盖，guest成功也不能掩盖证据缺失。
准入未取得或创建调用前失败保留`NOT_OWNED`，已确认但未释放保留`NOT_RELEASED`。
新增回归包含两个真实进程和先产生创建副作用再报错的顺序；期限、安全和旧验收均保留。

方案批准不代表文档已审查、PR已合并或修复已验证。PR34→35→37→38及#42的最终代码、
完整development/packaged回归与一次获准串行原生验收仍待独立完成；#18真人双设备、
物理设备释放和跨境验收继续NOT_RUN/HOLD。本变更不授予新的合并权限。

### D15 单社区、单房间 UI 外壳 —— 范围已签认（2026-10-12）

Jack 已要求采用 Discord 桌面布局和交互习惯，并由多个 Antigravity / Gemini 3.8 High
代理进行美术设计与修改。实查模型为 `gemini-3.8-flash-high`，CLI 已更新至 1.3.3。
原战略 PO 本轮补齐设计方向；这不是此前已经签认的完整 Discord 功能规格。

拟定六文件上界、冻结行为、代理单 writer 分工、实际验证入口与完成条件，见
[discord-ui 清单](../.agents/modules/discord-ui.md)。本轮仅准备该清单与本文件的文档草稿，
不修改产品、既有模块清单、历史证据或其他工作副本；既有 T1/T2 授权不能用于该 UI 片。

现有 6.1 / 6.2 未覆盖 renderer 接线和 Playwright 发现配置，因此需独立 docs PR。
Jack 已明确回复“签认并授权上述流程”，授权建票、发布和审查合并独立范围文档 PR，
再由单一 Gemini Builder 实施六文件并提交产品 PR；产品 PR 合并仍留给 Jack 裁定。
范围文档票为 [#46](https://github.com/wenhuorongbing-netizen/babacom/issues/46)；
审查合并后，才在另建的明确产品 Issue 下实施六文件。
拟定跨模块范围和共享 token 变更只适用于本片，不表示完整 6.1 / 6.2 已冻结或完成。
实现不更改准入/媒体契约，不新增聊天、共享、摄像头、说话电平或假遥测。

本项从 PARKED 草稿更新为 DECIDED 范围，独立 docs PR 的审查合并前提仍未完成。
PO 的设计 GO、代理报告、文档校验或 CLI 更新均不单独构成范围生效、代码合并或产品验收。
#18、#31、#40、#41、#42 仍分别处理，
真人听音、设备释放和跨境证据不得由视觉截图替代。

## D17 Digo 资料整合与多人协作（2026-10-13）

Jack 要求审阅 DigoYu/babacom、先合并正确文档、建立多人工作指南并清理过度描写。
[#102](https://github.com/wenhuorongbing-netizen/babacom/issues/102) 固定 24 个文档路径；独立范围 PR101 已合并为 `9fa7de5`，规划 PR96 已合并为 `099f62f`。
Digo 原提交 `c7a29ea7` 作为祖先接入；初始接收提交 `7e29d45` 的 15/15 新文件与原 blob 相同。
后续注解和精简另提交；只调整 Source 索引与历史比较的适用入口，另 13 个导入文件保留原字节。

原战略 PO 在同一对话以 GPT-6 Pro 深度审阅，完整回收结论为：合并方向 GO，直接拼接成部署规范需 FIX，实验运行、组织权限与正式发布条件 HOLD。
实际读取双方入口、核心迁移材料及 Source 的 Client-Server/AS/Changelog 关键段落；未逐条审核全部 12 章、139 条来源要求或全部 Issue，也未运行本地测试。
本地树、Git/CI、权限与脏文件情况由 A 提供；集中修订版本、注册/房间邀请、联邦、E2EE/AS、候选维护及工作量差异，不追认全项目 PASS。

[05](05-collaboration.md) 是唯一多人工作指南；Backlog 保留索引、依赖和退役顺序，36 父票的 182 条候选 AC 已核对在 GitHub，具体范围与实时状态由各 Issue 维护。
139 条来源要求（120 编号条款、19 其他要求）及 Scope Must 的完整映射仍由 M01 处理：原条款/锚点进入唯一继任 Issue，#60 汇总缺口，不再新增巨型重复映射文档，也不声称映射已完成。

当前 fork 已有 Jack ADMIN、DigoYu WRITE；main 未启用 branch protection。本轮不改变权限或规则，原全局 D9 不冒充已指派；仓库 LICENSE 仍未选定。
产品、测试、T1/T2、NFR、历史证据、用户数据/密钥及其他工作副本保持；PR99/#97 的具体实验合同待签认，隔离服务、真人/物理与中德验收仍 NOT_RUN。

### D16-E 隔离部署执行授权（2026-10-13）

Jack明确要求“继续推进 Matrix 迁移，先把隔离部署和测试跑通”，授权按PR99/#97既有四文件实验合同实施#98。独立范围审查合并后执行；专用WSL、固定digest、loopback、合成数据与留存边界保持。此记录更新前述待签认状态，不授予生产切换、真实数据导入、设备采集或旧代码删除权限；运行与UI结果仍以实际验证为准。

### D16-G1 Windows 产物与 RTC 前置（2026-10-14）

#98 已由 PR104 合并（main `14e87005`），控制面/API/双账号 UI/注销证明及停止留存已通过；不扩其四文件与无媒体边界。Jack 本轮授权“推进G1，开启子代理逐步完成”。三个只读子代理分别核定 Windows 产物、RTC 组合与分层验收；当前精确范围见 [matrix-windows-proof](../.agents/modules/matrix-windows-proof.md)。#105 的独立 docs PR 待 Jack 签认合并后，#106 才实施两个只读校验器文件；G1/M04/M05/M29 父票仍打开。

官方 1.12.30 Windows x64 安装器已下载到本轮自有实验目录，实测 208730288 字节、Authenticode Valid、ELEMENT CREATIONS LIMITED，SHA-256 与证书指纹固定于清单。未找到上游公布的安装器 SHA-256；未安装或启动，不能追认为包验收、许可清单或系统声通过。既有历史材料保留，不批量清理副本。

RTC 研究修正（**候选，运行 NOT_RUN**）：[lk-jwt-service v0.9.0](https://github.com/element-hq/lk-jwt-service/releases/tag/v0.9.0) 为固定 Call 的旧 `/sfu/get`、直接 `/get_token` 路径补充成员检查，但要求 AS 配置及单一关联 homeserver；新版 homeserver-mediated 字段与 SDK43 不同，不能混称兼容。其 3600 秒 SFU JWT 不是主动撤销窗口证明；踢出后新票、旧票重用与已连接参与者需分别验证。固定 Call 开发配置的 LiveKit 1.13.4 只是来源关联候选，镜像 digest/真实联调仍 UNKNOWN。客户端版本和传递依赖保持，不将此次研究升格为新依赖授权。

后续顺序：独立 RTC 范围与固定摘要/可信 TLS/媒体专机 → 最小私房身份与闭麦通话 → 合成轨道/取消晚到/独立音量 → 同一实际包的双真实 Windows 游戏声音、独立麦克风与物理释放。当前回环 WSL 不作为媒体专机；缺节点、可信证书或真实测试者时相应运行 HOLD，继续独立自动层。旧 T1/T2、#18 真人标准、G4 中德/负载、G5 观察切换与 G6 逐文件退役均保持；无采购、生产切换或删除授权。

### D16-G1-P2 隔离安装启动范围（2026-10-14，PROPOSED）

更新上文历史待签认状态：Jack 已签认 PR107；本轮按其指示合并 PR108（main `86da409`），#105/#106 已关闭。两个只读核验器交付，44/44 自测及实际安装包核验通过；这些证据不包含安装启动。Jack 继续要求“推进 G1 的隔离安装和启动验收”。

下一精确合同见 [matrix-windows-install](../.agents/modules/matrix-windows-install.md)，范围票 #109：独立 docs PR 只改该清单与本文件，经独立审查、Jack 签认合并后，另票实施三个新脚本。已核实本机 Sandbox 启用、官方 CLI 0.8.107.0 及当前空实例清单；不需修改宿主功能或管理员提权。安装/启动/退出仍 **NOT_RUN**。

运行固定官方 1.12.30 安装包，限新建自有 Sandbox；只读输入及 UUID 专属可写输出，禁网/麦克风/摄像头/剪贴板/打印机/vGPU，启用 ProtectedClient。安装期仅 VM 默认 profile，预置安全配置，随后独占 profile、固定本地 config 与 `--no-update`；真实欢迎页、实际安装版本与 File→Quit 正常退出均须观察。保持 D14 的跨进程立即 BUSY、确认归属后操作、创建后未确认则 cleanup=UNKNOWN 且禁止猜测 stop；总期限与失败断言写入清单。输出保留，旧材料不清理；无 host 安装、RTC、真实账号、采集或生产权限，Sandbox 结果不替代双实机 G1 与其他 release gates。

### D16-G1-P2 进展校准（2026-10-15）

本条更新前文历史检查点的当前性，不改写原有签认、NOT_RUN或失败记录。PR110范围已签认合并，#98控制面 proof 已由PR104合并；正式产品仍为旧原型。最新入口摘要维护于 [README](../README.md#current-acceptance-boundary)。

协调者记录A报告：PR112 head `754dd4832c29c5f5629c5c65f8fc296bbc7e42d5` 的170项 runtime/artifact测试通过；自有Sandbox运行 `a1290bdc-26ea-4861-84b5-c4267f5292bd` 完成实际安装、欢迎页观察、File→Quit正常退出及自有VM清理，终端exit 0。本文档审查未重新执行这些检查，也不将协调者报告冒充本次独立运行证据。PR112仍为Draft、未合并。

此结果仅属于G1-P2隔离安装启动子交付，不证明全G1、双实机游戏媒体、真人听音、物理释放、中德负载、E2EE恢复、生产切换或完整Matrix迁移。已有签认AC、Allowed Files、期限、旧活动链义务及其他release gates保持；本次校准不新增运行、采集、删除或合并授权。

<a id="matrix-quality-review-2026-10-15"></a>

### D16 工程质量实际复审（2026-10-15）

已向“ez的游戏”中的[战略 PO](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ac2188a-8b8c-83ee-ab67-968c584fe99f)实际发送材料，并新建[CEO｜架构与工程质量审查](https://chatgpt.com/g/g-p-6a4aab478af48191b7e4c5e4e3dfcb4d-ezde-you-xi/c/6ad0feda-23f8-83ed-a370-16ccce0ba320)，两份 GPT-6 Pro 回答均已实际回收。结论一致：六文档状态校准 GO，治理与CI FIX，完整G1、产品迁移及release HOLD；这些是独立咨询结论，不是Jack签认、GitHub批准或新的执行授权。

协调者于19:00 UTC复查：main=`db23ac65de6631b5f7f3b814de448ee5dda47c2b`，PR112仍OPEN/Draft、未合并，head=`754dd4832c29c5f5629c5c65f8fc296bbc7e42d5`；main `protected=false`，rulesets为空。上文170项与Sandbox PASS仍仅为执行者回报，本轮未重跑。PO指出候选 `host-final.json` 可仍记录UNKNOWN/PENDING_AT_SERIALIZATION，最终回报来自终端JSON与退出状态，不能凭该文件单独判定PASS或FAIL。

| 优先级 | 已发现不足及证据边界 | 对应现有工作 |
|---|---|---|
| P1 | `scope-guard.yml` 执行候选守卫并读取候选清单，候选可以参与放宽自己的边界；静态机制确认，未执行绕过实验或发现历史滥用 | M03 #62 / M26 #85：工作流、守卫、政策均取可信base，head只提供差异数据 |
| P1 | main无平台合并保护；根规则的“CI强制”表述过强，CODEOWNERS还需核定实际负责人接受与有效权限 | 治理独立小片；检查、负责人及平台强制分别验收，不擅改权限或任命 |
| P1 | 当前scope/secrets CI不运行Matrix Windows回归；本地通过不能代替持续验证 | M25 #84：Windows托管runner执行真实170项，不调用安装/启动入口 |
| P2/P3 | feature禁止互相导入缺少自动断言；生产build依赖测试peer构建。未确认现有非法跨feature导入，也未证明peer进入安装包；main多职责只是后续拆分候选 | M26 #85 / M25 #84：正反例约束、消费者清单和最小拆分，避免大重构 |
| P1 | 固定源码构建来源、完整发货许可与品牌义务、上游升级/回退尚未闭合；不否定已有官方包隔离核验 | M04 #63 / M05 #64 / M35 #94，分别补证据 |

下一步按三个独立小片推进：①本次只校准README、地图、PRD、spec、Backlog和04，04历史保持字节前缀；②另行冻结可信守卫三文件候选（`.github/workflows/scope-guard.yml`、`.agents/scope_guard.test.mjs`、`AGENTS.md`），验证head扩清单/替换守卫仍不能自授权、中文/NUL/重命名两端及base缺失失败，不在可信事件执行候选代码；③PR112形成独立获准的受审测试基线后，仅新增 `.github/workflows/matrix-windows-regression.yml`，运行runtime/artifact测试，预期170 PASS、零失败/取消/跳过/todo，不下载或执行Element、不启动Sandbox、不采集设备。每片仍需精确范围、实际Validation与最终head两轴审查；此处记录候选计划，不提前合并PR112或改变父票状态。

架构沿用现有spec：Matrix账号/设备/密钥长期所有权与通话/轨道短期生命周期分开，UI投影不成为第二权限权威，停止后晚到回调不能重新发布。完成上述小片后继续固定RTC组合与游戏音频G1，不扩大UI；M25覆盖与消费者核对、M36切换观察及独立断接、M33/M34退役按原出口推进。05仍是唯一协作指南，不新增CEO规范、平行看板或重复巨型报告，也不因本审查删除旧代码或证据。

<a id="matrix-rtc-e1-2026-10-15"></a>

### D16 RTC-E1 固定候选与隔离契约草稿（2026-10-15，PROPOSED）

Jack要求“先固定 RTC 兼容版本和隔离实验契约，再跑通隔离测试”。本片仅修改 `docs/Matrix-protocol-research.md` 与本文件；不增加实现文件或依赖。版本来源与请求边界见[研究 §3–4](Matrix-protocol-research.md#3-固定候选版本尚不是兼容组合签收)，这份草稿仍需独立审查及最终签认，不能据此把父票 #63/#69/#88 或整个 G1 标为 Ready/Done。

更新前述历史状态：PR115可信守卫、PR113六文档、PR112安装/退出脚本和PR117 Windows CI均已合并，基线为 `75abf3cf3bb4f230c4d9b16807fecf942fcf0a55`。PR117首次托管失败为短TEMP路径与实际进程路径不一致，保留失败/诊断记录，仅在测试步骤绑定runner临时目录后，PR及main两次实际170/170、零失败/取消/跳过/todo。未修改产品归属守卫或测试断言；本片不重跑或追认实物 G1。

| 约定 | RTC-E1 候选、证据与停止条件 |
|---|---|
| 组合 | 固定 Element1.12.30、顶层SDK43、Call0.26及其锁内SDK42.2、Synapse1.162、auth0.9、LiveKit1.13.4；源码commit与auth/SFU平台digest已核对，完整构建来源/许可和运行兼容尚未签收。首轮选compatibility `/sfu/get`，不静默切到字段不兼容的新 C-S模式，不fork协议/crypto。 |
| 主机与网络 | 腾讯云为用户提供的候选，允许只读控制台盘点；实例/负载/地区/规格、可控域名/可信TLS、访问方/精确端口尚待核定。媒体与控制面/网站/VPN分主机，WSL另开容器不算媒体专机；无资源证据不启动SFU/TURN，不购买、重启或停既有服务。 |
| 实现范围 | 本片新的RTC实现 Allowed Files为 **none**；现有matrix-proof四文件仍无RTC/SFU/TURN。资源核定后，另列控制面/auth/媒体/TLS配置、验证器及测试的逐文件清单；模块扩围走独立docs PR，不在本片改代码或秘密。 |
| 权限与身份 | 仅本次合成账号/私房，无真实用户或旧数据导入；Matrix成员状态为唯一权威。AS与 `LIVEKIT_FULL_ACCESS_HOMESERVERS` 绑定同一个测试homeserver，拒绝通配/多homeserver及无法核定成员的签票。验证错房、未加入、仅受邀、错主体和被踢后的新请求。 |
| 凭据与存储 | 新实验秘密随机生成，运行前核对精确目录归属与最小ACL；本轮不创建秘密。JWT/密码/私钥不入Git、URL、截图或日志，只保留脱敏HTTP/errcode/身份映射。上游3600秒JWT仅为待测临时行为，不替代主动撤销；旧票重用与已连接参与者独立观测，生产TTL/额度/撤销窗口实验后另签。 |
| 期限与冲突 | 候选脚本每次验证总预算120秒、单HTTP≤10秒，清理≤60秒；不改已有安装/退出或T1/T2期限。部署准备及闭麦/合成媒体阶段的精确命令/预算须随实施范围固定，当前未建立RTC运行入口。端口冲突立即FAIL/BUSY，不杀占用者、不自动换端口、不重置超时或无限重试。 |
| 留存与归属 | 部署前绑定具体主机、compose项目、目录/卷、镜像和本次run ID；仅确认归属后操作。创建后归属不明即UNKNOWN，禁止猜测stop；正常退出只停自有资源，保留合成DB/卷/秘密与追加证据，不全局shutdown/down、不删历史。临时实验权限仅供该次已签认run，结束即停止服务，不升格为生产。 |
| 分层出口 | R0实际身份/签票正反例 → R1固定包双端闭麦/WSS/SFU身份一致 → R2获准合成轨道、强制relay、独立音量与晚到取消/退出 → R3双真实Windows游戏声/独立麦克风/物理释放。每层分别PASS/FAIL/NOT_RUN，不以静态字段检查、health或合成音频替代后层。 |

本轮实际执行 `node infra/staging/matrix-proof/proof.mjs self-test`：11/11 PASS、零失败/取消/跳过/todo、exit0；涵盖既有配置隔离、ACL、超时、logout与清理，仅属控制面守卫自动层。该分支没有启动WSL/Docker或RTC，也没有运行会检查/创建秘密的 `config`。RTC联调 **NOT_RUN**，运行门槛为独立审查、Jack对具体契约/范围的最终裁定、主机/TLS/精确入口核定；缺项即HOLD，不降低G1/G4，也不解除旧活动链和退役门槛。

#### 2026-10-15 腾讯云资源实查与RTC部署阻塞

Jack已登录并授权检查服务器/域名、继续隔离部署和测试。本次通过当前Edge控制台及该实例已有TAT免密入口，以ubuntu仅执行容量、架构、运行服务及监听端口查询；没有改变云资源、DNS、防火墙、权限或服务。诊断结束实际显示“0个会话已连接／远程会话已断开”。以下为本次观测，不代表后续时刻状态。

| 资源 | 实际结果及影响 |
|---|---|
| 实例与容量 | 控制台显示CVM0台、轻量1台，首尔二区，2核/4GB、60GB SSD、1536GB/月／30Mbps峰值，Ubuntu Server24.04 LTS64bit；实际架构x86_64，根盘59G／已用56G／仅余743MiB（99%），可用内存约2246MiB。峰值带宽不是保证吞吐或跨境验收。 |
| 实际用途 | systemd确认其他项目的控制面、门户及VPN相关服务正在运行；80/443、VPN和其他测试端口已有监听。媒体分机条件不成立，且磁盘不足以承担新增镜像/数据。没有停止它们、清理磁盘或重装；Docker列表查询因当前ubuntu无socket权限失败，未提权重试，具体容器清单UNKNOWN。 |
| 域名与DNS | `beidi.games`、`buffjo.top`服务状态正常，DNSPod可管理，分别到期于2027-06-27、2027-03-19；前者5条、后者2条当前记录均指向该混用实例。没有RTC专用记录；保留现有根域、www及其他项目记录。后续可申请独立实验子域名，但本次未创建或改指向。 |
| TLS | 腾讯云SSL证书列表0条，仅代表该控制台清单；不推断服务器没有其他来源证书。实际默认校验的`curl.exe --head --connect-timeout 5 --max-time 10`：beidi.games返回HTTP200、TLS_VERIFY=0；buffjo.top失败，`curl:(60) SEC_E_WRONG_PRINCIPAL`、HTTP000，证书名称不匹配，未跳过校验。现有网站通过不代表RTC子域名证书已就绪。 |
| 入口约束 | 固定LiveKit1.13.4向客户端发布TURN/TLS443；与HTTPS/WSS同IP时须单列L4/SNI或另一入口，不能仅开5349。auth还需可达的Matrix OpenID federation验证入口；普通客户端登录不是替代证据。固定源码依据见研究§3–4。 |

**媒体部署HOLD；RTC R0–R3均NOT_RUN。** 当前没有合规的独立媒体节点，本轮不下单；此前11/11仅是既有控制面守卫自测。下一片优先准备无需SFU的真实R0成员授权测试，先核对上游测试是否能在既有隔离运行时安全复用，再冻结逐文件范围、TLS/秘密/命令及期限并独立签认；若依赖跳过身份或证书校验则不运行。实际媒体阶段仍需现成独立主机或完成获准测量后另行采购，不能挪用其他项目资源。

随后Jack确认“暂无，先完成部署和测试准备”。**补充源码核查纠正上一段的“无需SFU的真实R0”提议：** 正向成员签票实际依赖LiveKit RoomService；上游信令测试虽不协商媒体，仍启动LiveKit，且原fixture有浮动镜像、开放注册和跳过TLS校验，不能直接采用。固定来源和待执行测试矩阵已并入研究§4；本轮仍仅修改既定两文档，RTC实现Allowed Files为none。安全TLS、独立范围及相应运行契约未落实前，不执行R0或媒体测试，不采购或挪用混用主机；11/11不升级为RTC结果。

<a id="matrix-rtc-e1-same-host-2026-10-16"></a>

#### 2026-10-16 同机 RTC 授权与零媒体 R0 范围候选（PROPOSED）

Jack 已直接允许现有实例 `lhins-af0ntal8` 承载 RTC，覆盖此前针对该主机的分机阻塞；本候选先限定为临时零媒体 R0，不放宽默认分机规则或生产验收。规则指针见 [infra/AGENTS.md](../infra/AGENTS.md)，逐文件范围与运行合同见 [matrix-rtc-proof](../.agents/modules/matrix-rtc-proof.md)。新的范围、TLS/DNS/端口细节仍未签认；须独立 docs PR 审查签认并可信合并后才实施，现有四文件控制面 proof 不扩围。

本次清理仅删除已冻结的旧 Docker 构建缓存，退出码0、回收18.32GB；随后根盘使用率69%、可用约18GiB。新只读资源快照：MemAvailable2265MiB／总3659MiB、swap已用573MiB、load0.09／0.12／0.15；这是当次观测，不证明RTC容量。原8个容器、21个映像、4个卷及最终运行服务/监听端口保持；录制归档传输尚未完成，本候选不删除或挂载其文件。

候选运行归属为 `/opt/babacom-matrix-rtc-e1`、Compose项目 `babacom-matrix-rtc-e1`；全新数据/秘密、独立Docker网络，无旧业务挂载、host模式或privileged。合计上限1 CPU与1.5GiB内存须实查cgroups生效；超限、OOM或旧服务基线异常时只停自有实验，保留数据/证据，绝不停旧服务。总验证120秒、HTTP≤10秒、清理≤60秒及其他既定期限保持。

R0要求可信TLS、真实OpenID/成员正反例、JWT身份/房间/grants与实际LiveKit信令，初始和全程零媒体轨道；不跳过证书校验，不启用TURN或新增公网端口。域名、loopback端口、证书取得方式、TLS代理摘要及访问方尚待核定，缺项HOLD；用户同机授权不等于这些细节已批准。RTC实现仍未开始，R0–R3均NOT_RUN，G1/G4及旧活动链义务保持。

#### 2026-10-16 四文件范围签认

Jack已签认上述四文件范围候选，并明确授权推送到本fork、创建独立范围PR及托管检查通过后合入main。签认仅覆盖 `infra/AGENTS.md`、`.agents/modules/matrix-rtc-proof.md`、`docs/Matrix-protocol-research.md` 与本文件；独立规格/规范审查及本地范围守卫已通过。此处记录授权，不预报PR或托管检查结果；具体TLS/DNS/端口与运行细节仍待核定，七文件实现与RTC运行尚未开始，R0–R3仍为NOT_RUN。

#### 2026-10-16 凭据边界复核（修订候选，合并HOLD）

范围票[#118](https://github.com/wenhuorongbing-netizen/babacom/issues/118)与独立范围[PR119](https://github.com/wenhuorongbing-netizen/babacom/pull/119)已发布；原head `97331a7` 托管检查通过，但最终协议复核发现绝对URL禁令与标准OpenID query冲突，Synapse必要认证状态也会写入合成DB。独立Reviewer据此撤回此前对该凭据条款的PASS；CI通过不替代契约正确性，尚未合并。

协调者在既定四文件范围内准备[最小修订](../.agents/modules/matrix-rtc-proof.md#r0-凭据传输与日志准入修订候选待签认)，源码依据见[研究](Matrix-protocol-research.md#r0-凭据边界修订候选)。仅新R0拟替代上文RTC-E1“JWT/密码/私钥不入URL”中的OpenID传输限制及新模块“token仅验证进程内存”：唯一可信HTTPS homeserver的标准OpenID query可承载合成OpenID token；验证器不额外落盘，固定Synapse必要状态限受保护自有DB/事务文件。原T1/T2、既有控制面proof及其他秘密的禁令保持，不授予R1或真实账号例外。历史字节保留；修订尚待独立审查和Jack最终裁定，不冒记新的签认。

原始日志控制、写盘前脱敏、安全事件留存与哨兵负例仍是运行前置HOLD；不能只关闭access log就声称全链无泄漏。TLS/DNS/端口等缺项、七文件未实施及R0–R3 NOT_RUN的边界保持；未启动服务或修改宿主/旧业务监控。

#### 2026-10-16 标准 R0 精简候选（待签认）

PR119已合并；#124原实现 `ff4cd0933950dfb8e3afb8bef8b5d5eb7e9684e8` 完整保留于 `feat/matrix-rtc-r0-proof`，不合并或删除。Jack要求收缩到最简单标准链路、不新增治理文档；本候选只修改既有模块、本文件及协议研究。以四个固定官方服务、标准systemd/Compose生命周期和Node内置WebSocket替代自建代理/监管/握手代码；不增加验证SDK、Kubernetes或新虚拟化平台。

需独立裁定的精确差异只在[模块修订表](../.agents/modules/matrix-rtc-proof.md#标准组件精简修订已签认可信合并后生效)维护：保留客户端HTTP≤10秒和实验120秒/清理60秒，允许固定上游内部期限；合成凭据可能进入受保护OS swap/core，原始stderr仅可暂存在受信管道内存，禁止持久日志和外传。拟用 `rtc-r0.beidi.games:18443` 与新独立可信证书、仅新增本次DNS验证TXT；均未签认，不冒记为原memory-only/内部10秒验收通过。

实际swap/core保护路径、权限/主体、日志旁路、标准生命周期正反例、TLS及主机止损阈值未核定即HOLD；仅在上述先决条件及可信合并完成后才运行。当前Edge腾讯云终端连续两次无法附着，本轮未发云命令或启动RTC；R0及迁移未完成。原历史字节、旧服务/数据和未合并工作保留。

2026-10-18续接：此前从同一Edge连接上的实例控制台新开OrcaTerm后已成功登录，旧终端附着失败不能代表整个连接失效。随后仅做只读检查：根盘约18GiB可用、MemAvailable约2281MiB、18443无监听、实验目录不存在；这些是此前快照，今日腾讯云登录已过期，未重新核定容量。`/swap.img` 为root:root/0600，Apport启用且`/var/crash`为3777；实际崩溃文件及其访问主体仍未核定，不能宣称已满足“受保护core”。普通ubuntu调用Docker元数据报permission denied，不等于Docker不可用；先前`sudo -n docker ps`可读。没有启动RTC或改旧服务。

本机Node临时假令牌fixture因lean-ctx误拆PowerShell here-string而整条拒绝执行（`lean-ctx split your command line wrongly`），标记NOT_RUN；未启动listener、没有Bearer/TLS/退出运行证据，不以源码核对或旧测试替代。三文件候选仍待签认，未推送；原实现`ff4cd093`保持。

2026-10-18签认：Jack明确回复“签认候选，授权文档PR检查通过后合并及七文件实施”，对象为本地`ef6e143`三文件候选及其中明确列出的期限、合成凭据OS持久化/受信管道内存例外和TLS候选。授权推送本fork、独立文档PR托管检查通过后合并，再实施原七文件；产品PR合并另行裁定。此前“待签认”记录保留为历史；实际权限、TLS、日志和退出负例未核定仍HOLD，签认不等于真实R0通过。

2026-10-18资源核算签认：精简文档PR125已合并（`b22786123641fba52a99dbb8b5c31e7688372356`）；七文件候选`a3291804`通过37/37本地测试及独立规格/规范审查，Jack授权推送并建立草稿产品PR126，保持未合并。共享Docker的shim无法证明从创建起受实验cgroup硬限额约束，Jack因此明确签认并授权仅本文件与现有模块的最小资源修订，经独立文档PR审查和托管检查后合并，再按原七文件调整。四容器与Node/CLI仍合计硬限≤1 CPU/≤1.5GiB；共享Docker/containerd及shim开销另测、按冻结基线门槛止损，具体规则只在[模块修订表](../.agents/modules/matrix-rtc-proof.md#标准组件精简修订已签认可信合并后生效)维护。未合并前不以新口径运行；其余运行条件及产品合并裁定不变，真实R0仍HOLD/NOT_RUN，历史证据、旧服务与原分支保留。

#### 2026-10-19 Caddy 执行权限根因与最小修复签认

PR126–128已合并；真实R0启动FAIL，原四实验容器保持停止。新独立诊断实际validate退出126、OOM=false，内存错误分类为OPERATION_NOT_PERMITTED，文件能力为`cap_net_bind_service=ep`且CapBnd全零；第二阶段run按条件NOT_RUN。旧8个业务容器、5个原生服务与36条监听基线核对一致。该结果证明新诊断的exec权限冲突；原直接入口255高置信符合相同机制，修复尚未实测通过。证据只追加于服务器既有`events/caddy-startup-diagnostic-20261019.jsonl`，不追改历史或复用旧FAIL状态。

Jack签认并授权[模块中的窄修订](../.agents/modules/matrix-rtc-proof.md#标准组件精简修订已签认可信合并后生效)：仅Caddy增加且仅增加NET_BIND_SERVICE，保留drop ALL、NNP、只读及全部原隔离限制，其他三服务不得增加能力。先本文件与现有模块独立文档PR审查、托管检查通过后合并，再修复既有compose.yaml、proof.mjs、proof.test.mjs，覆盖缺失/额外能力及其他服务越权，独立审查和托管检查通过后合并。之后按模块中已签认的两个全新Caddy条件式诊断复测；不新增治理文档、不重启原实验，不以诊断或CI替代完整RTC验收。

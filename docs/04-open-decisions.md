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

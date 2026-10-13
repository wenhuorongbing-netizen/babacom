# Matrix 迁移 Sprint Backlog

关联 [PRD](PRD-matrix-migration.md) / [技术规格](Matrix-migration-spec.md) / [规划票 #50](https://github.com/wenhuorongbing-netizen/babacom/issues/50)。2026-10-13，基线 `c9ec3cf`。用户授权发布计划，后续授权准备资料与隔离部署；**9 Epics / 36父候选票仍DRAFT**，另拆两张首Sprint实验票。原战略PO先审e14d7e9给FIX，再实际读取464f71a对两项依赖修正复核GO，无该范围遗留阻断；不是全PR/实验/部署批准。具体代码/依赖/实验契约仍独立冻结，不以大计划授权生产或删除。

GitHub里程碑：[Matrix Migration](https://github.com/wenhuorongbing-netizen/babacom/milestone/1)。规划根票[#50](https://github.com/wenhuorongbing-netizen/babacom/issues/50)链接下列Epic。

## 1. Release、Sprint与依赖

一个Matrix Migration里程碑覆盖全部迁移需求，Epic仅作领域容器。实际1–2周Sprint承诺需知道可用工时/资源，不编造速度或日期；每次最多80%容量承诺，至少20%留给审查/故障。3个工作流是初始上限，不是必须并行3份实现；共享契约/锁/部署/物理设备单writer/串行。每票按实际范围拆成小PR，不整Epic长分支。

| 迭代候选 | 内容 | 出口 |
|---|---|---|
| S0 原版基线可验证 | M01与M04只读版本/许可并行；M02-E/M03-E #97；固定M04最小组合后M29-P #98与M05必要子集 | 需求出处/UNKNOWN影响、受限实验范围；两个合成账号标准客户端互通、私房权限、重启历史；不把最终生产政策作为实验前置 |
| S1 Windows关键证明 | M05；最小M29/M08/M09/M10/M12/M17/M18；M21/M22 | G1真实包游戏音频/独立音量/无回授/停采；未过停止扩大UI |
| S2 单一权威与Alpha宽度 | M06/M07/M11/M13/M19/M23/M24，M25/M26持续 | G2；私域权限、消息、设备恢复完整，不留双权威 |
| S3 运行与恢复 | M29–M32、M27、M35；必要附件留存M14 | G3；数据/备份/新写入回退、许可、升级、真实包 |
| S4 真实负载和切换 | M28/M36 | G4/G5；中德/真人/10人≥2h，再两周游戏夜观察 |
| S5 逐文件退役 | M33/M34 | G6；消费者零、继任覆盖、恢复基线、旧票处置 |
| 后续产品宽度 | M14/M15/M20为R03，M16为R04；已有上游能力优先验证 | 不挤掉R02稳定期；M14涉及迁移/备份的必要子集提前验证，社交扩展仍后置 |

上述是顺序/出口，不是固定6个Sprint工期；同票跨阶段只提前实验必需子集，拆分实施票时保留父AC与依赖。执行次序由有向依赖和Gate共同决定。**M35→M36（G5后消费者断接与M25覆盖交接）→M33→M34**，先切换观察、断接再删除；最终项目关闭必须M33/M34完成。若R03/R04项明确延期，需Jack逐项接受并记录，不能把仍未验收的全部票勾Done。

首Sprint只承诺“原版基线可验证”。[#97](https://github.com/wenhuorongbing-netizen/babacom/issues/97)是M02-E/M03-E独立docs范围合同，签认后才释放受限运行；[#98](https://github.com/wenhuorongbing-netizen/babacom/issues/98)是M29-P独立控制面proof，依赖#97与M04最小固定组合，不依赖M02全部生产政策。M05必要Windows包子集在运行前另拆有独立AC/依赖/精确范围的票。M01未访问到的远端资产记录UNKNOWN及影响，阻断真实导入/切换，不阻断纯合成隔离实验。#50只验收规划，不等待九Epic完成才释放盘点。

当前环境核实：WSL2.6.3/内核6.6.87.2已安装，但没有Linux发行版；未发现Docker/Podman。#98拟使用专用Ubuntu WSL+Docker Engine，仅loopback控制面，不采购或改其他服务器。运行前核实端口、镜像摘要、临时秘密与资源归属；当前尚未部署。RTC与可信TLS、两台Windows及采集同意在后续独立交付，不用HTTP本机proof冒充G1。

## 2. Ready / Done

Ready必须具备：一个module、一个DRI和独立Reviewer；固定源HEAD/上游版本；**逐个具体路径**的Allowed Files；公共契约及扩模块范围已独立docs PR审查签认；新增依赖/框架方案已裁定；可执行完整Validation命令/cwd/环境/退出与通过条件；数据/设备/节点/秘密归属和授权；依赖/停止条件；继任测试和旧消费者去向。候选目录或UNKNOWN不是写权限；不能全量贴ready-for-agent。

Done必须具备：本票AC真实证据、正确层级的测试/包/真人结果、失败和NOT_RUN如实记录、独立审查、无超范围文件；必要契约/部署/数据签认和上游升级影响已落实。退役另须G5完成、精确消费者零与恢复验证。受阻标HOLD/BLOCKED+原因与owner，不靠删断言/改期限通过。规划发布/文档审查不是36票Done。

## 3. Epics 与票目录

| Epic | 领域 | Gate | 票 |
|---|---|---|---|
| [E1 #51](https://github.com/wenhuorongbing-netizen/babacom/issues/51) | 需求、契约与迁移边界 | G0 | M01 / M02 / M03 |
| [E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52) | 上游 Windows 基线与最小定制 | G0/G1后定制 | M04 / M05 / M06 / M07 |
| [E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53) | 私人身份、权限与账号生命周期 | G1/G2 | M08 / M09 / M10 / M11 |
| [E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54) | 社区、文字与社交 | G2/R03/R04 | M12 / M13 / M14 / M15 / M16 |
| [E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55) | 语音、设备与摄像头 | G1/G2/R03 | M17 / M18 / M19 / M20 |
| [E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56) | 游戏画面、系统音频与观看 | G1/G4 | M21 / M22 / M23 / M24 |
| [E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57) | 测试转换、架构约束与可靠性 | 全阶段/G4 | M25 / M26 / M27 / M28 |
| [E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58) | 自托管运行与数据保障 | G1最小环境/G3 | M29 / M30 / M31 / M32 |
| [E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59) | 上游跟随、正式切换与旧栈退役 | G3/G5/G6 | M33 / M34 / M35 / M36 |

## 4. 36张候选票

**所有票状态：DRAFT，DRI/Reviewer待Ready时指定。U＝尚待建立的固定版本Element fork；B＝本仓库。以下scope只是盘点候选，Allowed Files目前为空，不能据此写产品。** GitHub票沿用同一ID与AC，实际票号如下；状态在各票核对。

### M01 需求与存量映射

GitHub：[#60](https://github.com/wenhuorongbing-netizen/babacom/issues/60)；Parent：[E1 #51](https://github.com/wenhuorongbing-netizen/babacom/issues/51)。

- Epic：E1；类型：task；阶段：G0；依赖：#50。
- 用户故事：作为Jack，我希望每个旧需求与数据有明确去向，避免迁移遗漏或重复建设。
- 验收：
  - [ ] 24模块、139项未勾验收及Scope v2正文Must逐条映射复用/配置/扩展/验收/明确不做，保存出处；密码登录→M09，入房前成员/电平/本地静音→M17/M19，网络诊断面板→M23逐项核对，标题不计覆盖
  - [ ] 7旧open票、PR49和#41 dirty记录真实状态
  - [ ] 账号/房间/消息/附件/密钥按归属统计，未知不写零
- 范围候选：B：本次PRD/spec/backlog、docs/01-scope-v2.md；资产只读盘点入口待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：只读需求与数据清单；不读取无关秘密、不导入或删除。

### M02 Matrix权威与继任契约

GitHub：[#61](https://github.com/wenhuorongbing-netizen/babacom/issues/61)；Parent：[E1 #51](https://github.com/wenhuorongbing-netizen/babacom/issues/51)。

- Epic：E1；类型：task；阶段：G0；依赖：M01。
- 用户故事：作为维护者，我希望只有一套身份、房间和权限事实。
- 验收：
  - [ ] 冻结身份/设备/密钥/房间/RTC语义与存储owner
  - [ ] M02-E/M03-E #97独立冻结受限实验契约与精确范围，作为下一批原版运行前置，不把M02全票标Done
  - [ ] 兼容性实验后、G2/G3及生产使用前逐项填实并签认邀请/昵称/TTL/额度/撤销窗口/联邦/共享仲裁政策表；实验临时值不自动成为生产政策
  - [ ] T1/T2逐项保留或替代并独立签认
  - [ ] 保留真人验收
- 范围候选：B：docs/Matrix-migration-spec.md、docs/04-open-decisions.md；必要T1/T2/NFR修改另立精确范围。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：签认者Jack；原PO固定e14d7e9已审FIX与后续复核分别记录；不默认改协议。

### M03 分票与精确文件边界

GitHub：[#62](https://github.com/wenhuorongbing-netizen/babacom/issues/62)；Parent：[E1 #51](https://github.com/wenhuorongbing-netizen/babacom/issues/51)。

- Epic：E1；类型：task；阶段：G0；依赖：M02-E #97；后续生产票另依赖M02最终政策。
- 用户故事：作为Builder，我希望每票有明确范围与成功条件。
- 验收：
  - [ ] 建立36票逐票DoR机制并仅冻结下一批实验票的module/DRI/reviewer、精确文件、可执行Validation、资源/授权与停止条件
  - [ ] 基线未知处先用明确受限的只读研究/实验范围，M04及G1结果产生后滚动完善后续票，不要求36票同时Ready
  - [ ] 扩模块范围先独立docs PR，缺少条件的未来票继续DRAFT
- 范围候选：B：docs/Matrix-migration-backlog.md；实际新模块清单逐个裁决。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不批量标Ready，不一次授权整个Epic或src目录。

### M04 固定兼容上游基线

GitHub：[#63](https://github.com/wenhuorongbing-netizen/babacom/issues/63)；Parent：[E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52)。

- Epic：E2；类型：spike；阶段：G0；依赖：只读源码/许可与M01并行；运行子交付依赖M02-E/M03-E #97与已冻结下一批范围。
- 用户故事：作为维护者，我希望构建可重现并可追溯到上游。
- 验收：
  - [ ] 记录client/Call/SDK/homeserver/auth/SFU/TURN兼容版本与提交/镜像摘要/锁文件
  - [ ] 实际许可与源码分发义务清单
  - [ ] 独立fork/checkout，旧仓库和dirty完整保留
  - [ ] 不可拼接未经联调的最新版
- 范围候选：U：待建立Element fork；固定版本/兼容记录路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：客户端只是候选；无深fork、无默认依赖安装授权。

### M05 Windows安装包真实启动

GitHub：[#64](https://github.com/wenhuorongbing-netizen/babacom/issues/64)；Parent：[E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52)。

- Epic：E2；类型：spike；阶段：G1；依赖：M04。
- 用户故事：作为朋友群成员，我希望不用开发工具即可打开自己的客户端。
- 验收：
  - [ ] 干净Windows x64实际构建产物启动/关闭
  - [ ] 无Node/npm开发环境可安装运行
  - [ ] 秘密不打包
  - [ ] 产物哈希/来源/许可可追溯
  - [ ] 权限与失败状态可观察
- 范围候选：U：apps/desktop/package.json及实际构建配置/入口精确子集待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：固定上游scripts后实跑；开发模式不替代真实包。

### M06 BabaCom品牌与中文

GitHub：[#65](https://github.com/wenhuorongbing-netizen/babacom/issues/65)；Parent：[E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52)。

- Epic：E2；类型：story；阶段：G1后/R01；依赖：M05 / M22。
- 用户故事：作为成员，我希望获得一致可读的中文游戏社区界面。
- 验收：
  - [ ] G1技术GO后优先上游branding/theme/i18n
  - [ ] 两窗口尺寸、100/125/150%缩放关键控件可用
  - [ ] 键盘焦点/对比度/中文校对通过
  - [ ] 每项定制有回归与升级owner
- 范围候选：U：实际config.json、品牌资源及翻译路径待固定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不逐行移植旧六文件；未过游戏音频证明不扩美术。

### M07 社区入口体验差距

GitHub：[#66](https://github.com/wenhuorongbing-netizen/babacom/issues/66)；Parent：[E2 #52](https://github.com/wenhuorongbing-netizen/babacom/issues/52)。

- Epic：E2；类型：story；阶段：G2后/R01；依赖：M06 / M12 / M17。
- 用户故事：作为成员，我希望直接找到文字和语音频道。
- 验收：
  - [ ] 实测Spaces/房间导航与游戏频道工作流
  - [ ] 差距清单有用户行为反证
  - [ ] 优先配置，确需才用实际支持的扩展接口
  - [ ] 不改协议/加密核心
  - [ ] 每补丁有回归和owner
- 范围候选：U：固定版本模块扩展入口及对应测试，当前UNKNOWN。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：新module-api与旧API不能混用；不造第二套shell状态。

### M08 邀请制入群

GitHub：[#67](https://github.com/wenhuorongbing-netizen/babacom/issues/67)；Parent：[E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53)。

- Epic：E3；类型：story；阶段：G1最小/G2；依赖：M04 / M29。
- 用户故事：作为管理员，我希望仅受邀朋友能进入社区。
- 验收：
  - [ ] 公开注册/目录默认关闭，管理员邀请流程实测
  - [ ] 签认的有效期/次数/撤销生效
  - [ ] 非成员直接请求拒绝
  - [ ] 不必填身份证/手机号/真实姓名
  - [ ] 联邦策略明确
- 范围候选：服务端：实际身份/邀请配置与负向测试路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：按M02签认政策；不默认另造邀请后端。

### M09 账号设备与密钥恢复

GitHub：[#68](https://github.com/wenhuorongbing-netizen/babacom/issues/68)；Parent：[E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53)。

- Epic：E3；类型：story；阶段：G1最小/G2；依赖：M08。
- 用户故事：作为成员，我希望重启和换设备仍能安全使用账号与历史。
- 验收：
  - [ ] 稳定ID不以昵称代替
  - [ ] 持久设备/crypto恢复，同库单MatrixClient
  - [ ] 新设备验证、历史解密、损坏/丢钥处理
  - [ ] 登出清秘密
  - [ ] 账号/crypto不随离房销毁
  - [ ] 秘密不进入DOM/URL/日志
- 范围候选：U：已有账号/crypto集成、配置与恢复测试，精确路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：设备密钥恢复与服务器备份是两项独立验收。

### M10 单一权限与RTC授权

GitHub：[#69](https://github.com/wenhuorongbing-netizen/babacom/issues/69)；Parent：[E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53)。

- Epic：E3；类型：story；阶段：G1最小/G2；依赖：M09 / M29。
- 用户故事：作为管理员，我希望文字与通话执行同一成员权限。
- 验收：
  - [ ] 直接Matrix/RTC API越权/错房/缺能力拒绝
  - [ ] identity/room映射核对
  - [ ] 移除后的新请求拒绝及已在通话的签认撤销窗口实测
  - [ ] 旧RoomAccess/can/API不得旁路
- 范围候选：服务端：homeserver/RTC auth配置与负向测试，精确子集待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不默认改上游auth；客户端禁按钮不是授权。

### M11 密码恢复与邮件交付

GitHub：[#70](https://github.com/wenhuorongbing-netizen/babacom/issues/70)；Parent：[E3 #53](https://github.com/wenhuorongbing-netizen/babacom/issues/53)。

- Epic：E3；类型：story；阶段：R01；依赖：M09。
- 用户故事：作为成员，我希望能恢复账号而不泄露账号信息。
- 验收：
  - [ ] 恢复流程、TTL/限流/错误语义按M02签认验证
  - [ ] 获准测试地址实际收件，保留QQ/163交付验收
  - [ ] 无邮件配置时明确不可用或经裁定管理员恢复
  - [ ] 不假称发送成功
- 范围候选：服务端：身份/邮件配置与测试路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：真实外发需要届时明确授权；不读取无关邮箱。

### M12 社区与频道结构

GitHub：[#71](https://github.com/wenhuorongbing-netizen/babacom/issues/71)；Parent：[E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54)。

- Epic：E4；类型：story；阶段：G1最小/G2；依赖：M08 / M10。
- 用户故事：作为成员，我希望在一个社区找到多个文字和语音频道。
- 验收：
  - [ ] Spaces/房间/分类/角色/可见性符合私域要求
  - [ ] 标准客户端行为核对
  - [ ] 真实成员不填假在线
  - [ ] 频道持续存在且访问权限一致
  - [ ] 优先上游配置
- 范围候选：U/服务端：房间模板、配置和导航测试待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：无平行房间模型，无开放创建旁路。

### M13 消息核心与同步

GitHub：[#72](https://github.com/wenhuorongbing-netizen/babacom/issues/72)；Parent：[E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54)。

- Epic：E4；类型：story；阶段：G2/R01；依赖：M12 / M09。
- 用户故事：作为成员，我希望可靠发消息并找到未读位置。
- 验收：
  - [ ] 发送/编辑/自删/管理员删除、回复/@/Markdown、分页/未读真实行为
  - [ ] 重连不丢不重
  - [ ] 角色变化一致
  - [ ] 反应/置顶/自定义表情/投票/斜杠等原R03/R04项由M01逐条标复用/延期/不做
- 范围候选：U：上游消息配置、必要窄扩展及行为测试；精确路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不自建并行WebSocket或消息模型。

### M14 附件与留存

GitHub：[#73](https://github.com/wenhuorongbing-netizen/babacom/issues/73)；Parent：[E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54)。

- Epic：E4；类型：story；阶段：R03/G3；依赖：M13 / M29。
- 用户故事：作为成员，我希望安全发附件且不耗尽磁盘。
- 验收：
  - [ ] 大小/类型/访问鉴权与未授权拒绝
  - [ ] 90天清理和容量阈值实际运行
  - [ ] 加密媒体保留/过期说明
  - [ ] 链接预览与媒体处理差距按原阶段明确处置
  - [ ] 数据迁移核对媒体引用
- 范围候选：服务端：存储/留存任务与测试，精确路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：旧历史证据和真实用户数据不当垃圾；清理须精确归属。

### M15 DM通知与一致状态

GitHub：[#74](https://github.com/wenhuorongbing-netizen/babacom/issues/74)；Parent：[E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54)。

- Epic：E4；类型：story；阶段：R03；依赖：M13 / M05。
- 用户故事：作为成员，我希望私信未读和桌面提醒一致。
- 验收：
  - [ ] DM/群DM、频道通知级别、托盘/最小化提醒与presence实测
  - [ ] 无第三方遥测/录音策略核对
  - [ ] 可访问失败状态
  - [ ] 上游提供不代表自动签收
- 范围候选：U：通知/presence配置及desktop集成必要子集待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不建立第二套在线状态；通知外发按适用授权。

### M16 线程与中英文搜索

GitHub：[#75](https://github.com/wenhuorongbing-netizen/babacom/issues/75)；Parent：[E4 #54](https://github.com/wenhuorongbing-netizen/babacom/issues/54)。

- Epic：E4；类型：story；阶段：R04；依赖：M13 / M14。
- 用户故事：作为成员，我希望找到线程与历史讨论。
- 验收：
  - [ ] 线程未读/通知语义
  - [ ] 中英文搜索/分页/结果上限实测
  - [ ] 加密与服务端搜索限制清楚
  - [ ] R04高成本项逐条决策
  - [ ] 不能以按钮存在签收
- 范围候选：U/服务端：实际线程/搜索配置和测试待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不默认新搜索服务；R04不挤掉R02稳定期。

### M17 持久语音频道闭麦入房

GitHub：[#76](https://github.com/wenhuorongbing-netizen/babacom/issues/76)；Parent：[E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55)。

- Epic：E5；类型：story；阶段：G1最小/G2；依赖：M10 / M12 / M05。
- 用户故事：作为成员，我希望点击频道闭麦加入并看到真实参与者。
- 验收：
  - [ ] 空频道/无振铃策略明确
  - [ ] 实际MatrixRTC/SFU入房/成员/取消/失败/离开/重入成立
  - [ ] 默认闭麦且无默认采集
  - [ ] 重复点击不重复session
- 范围候选：U：Call/频道配置、窄接线与行为回归路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不直接复制旧voice/session或媒体桥。

### M18 明确开麦与安全退出

GitHub：[#77](https://github.com/wenhuorongbing-netizen/babacom/issues/77)；Parent：[E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55)。

- Epic：E5；类型：story；阶段：G1/G2；依赖：M17。
- 用户故事：作为成员，我希望明确操作才采集且退出真正释放。
- 验收：
  - [ ] 拒绝仍可收听
  - [ ] 晚授权/轨道不publish
  - [ ] 静音实效
  - [ ] 退出自有轨道/播放器/回调释放且保留签认期限
  - [ ] 重入默认闭麦
  - [ ] 崩溃/取消/权限晚到真实验证
  - [ ] #18物理条件保留
- 范围候选：U：实际权限/媒体生命周期入口与测试精确子集待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：真实开麦需当前会话同意；合成或VM不替代人耳/物理。

### M19 游戏设备与快捷键

GitHub：[#78](https://github.com/wenhuorongbing-netizen/babacom/issues/78)；Parent：[E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55)。

- Epic：E5；类型：story；阶段：R01/G4；依赖：M18 / M05。
- 用户故事：作为玩家，我希望全屏游戏时控制声音与设备。
- 验收：
  - [ ] 全局静音/闭音键实测
  - [ ] 设备选择/测试电平/说话指示/每用户音量/本地静音
  - [ ] USB/BT变化
  - [ ] AEC/NS/AGC默认开可关并测回声
  - [ ] 设备变化不得隐蔽重采
- 范围候选：U：desktop快捷键/Call设备配置及窄扩展待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不扩大到Won't按键发言等功能。

### M20 摄像头与视频布局

GitHub：[#79](https://github.com/wenhuorongbing-netizen/babacom/issues/79)；Parent：[E5 #55](https://github.com/wenhuorongbing-netizen/babacom/issues/55)。

- Epic：E5；类型：story；阶段：R03；依赖：M17 / M18。
- 用户故事：作为成员，我希望选择摄像头并安全停止视频。
- 验收：
  - [ ] 视频不影响麦克风
  - [ ] 多设备/布局/停采实测
  - [ ] 拒绝权限仍可用
  - [ ] 真实设备退出释放
  - [ ] R03能力不提前宣称Alpha完成
- 范围候选：U：上游视频配置与测试，缺口路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不增加录制/背景虚化等Won't功能。

### M21 Windows系统音频关键证明

GitHub：[#80](https://github.com/wenhuorongbing-netizen/babacom/issues/80)；Parent：[E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56)。

- Epic：E6；类型：spike；阶段：G1；依赖：M05 / M17 / M18。
- 用户故事：作为玩家，我希望共享游戏声音而不靠麦克风拾音。
- 验收：
  - [ ] 真实Windows包/两个真实设备
  - [ ] 游戏窗口与整屏的画面/系统声远端收到
  - [ ] 与麦克风独立音轨
  - [ ] 无数字回授
  - [ ] 拒绝/晚到/停止/退出/崩溃停采
  - [ ] 逐路径记录失败与补丁成本
  - [ ] 失败阻止扩大定制
- 范围候选：U候选：apps/desktop/src/ipc.ts、electron-main.ts；Call必要入口先核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：浏览器标签音频不替代Windows系统声；不能凭源码猜PASS。

### M22 观看与独立音量

GitHub：[#81](https://github.com/wenhuorongbing-netizen/babacom/issues/81)；Parent：[E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56)。

- Epic：E6；类型：spike；阶段：G1/R01；依赖：M21 / M18。
- 用户故事：作为观看者，我希望分别调节说话与游戏声音。
- 验收：
  - [ ] 两个独立音轨与接收音量实测，静音一路不影响另一路
  - [ ] 无混成一路假双滑杆
  - [ ] 全屏/弹出/中断状态
  - [ ] 闭音/停看无播放器残留
  - [ ] 通过G1后才解除M06前置
- 范围候选：U：观看/音轨入口与测试精确路径当前UNKNOWN。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：G1技术GO由证据裁决，不以两滑杆截图通过。

### M23 区域与网络质量

GitHub：[#82](https://github.com/wenhuorongbing-netizen/babacom/issues/82)；Parent：[E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56)。

- Epic：E6；类型：story；阶段：R01/G4；依赖：M17 / M29 / M32。
- 用户故事：作为跨境成员，我希望理解连接状态并降低带宽。
- 验收：
  - [ ] 亚洲/欧洲标签与质量取真实连接
  - [ ] 低带宽策略
  - [ ] 强制TURN/UDP失败及断线恢复/报错实测
  - [ ] 延迟按NFR
  - [ ] 无区域假数据
  - [ ] 上游差距有具体裁决
- 范围候选：U/服务端：RTC质量入口/区域配置和测量测试待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：Matrix不等于跨境优化，不实施跨SFU级联。

### M24 单共享者与质量档位

GitHub：[#83](https://github.com/wenhuorongbing-netizen/babacom/issues/83)；Parent：[E6 #56](https://github.com/wenhuorongbing-netizen/babacom/issues/56)。

- Epic：E6；类型：story；阶段：R01/G4；依赖：M21 / M22 / M10。
- 用户故事：作为成员，我希望共享冲突有明确结果且画面稳定。
- 验收：
  - [ ] 并发抢共享仅一有效者，停止后可接管
  - [ ] 标准客户端绕过边界与服务侧策略按M02签认并负向验证
  - [ ] 720p30/1080p30、实验1080p60实测
  - [ ] 不以禁用按钮冒充强制
- 范围候选：U/RTC：共享仲裁/质量配置及测试，是否需auth扩展先裁决。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：核心大改则重评方案；不降Must求GO。

### M25 可重现验证与覆盖迁移

GitHub：[#84](https://github.com/wenhuorongbing-netizen/babacom/issues/84)；Parent：[E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57)。

- Epic：E7；类型：task；阶段：全阶段；依赖：M05 / M02。
- 用户故事：作为审查者，我希望知道新测试覆盖哪些旧要求。
- 验收：
  - [ ] T1/T2每断言KEEP/REWRITE/RETIRE+继任测试/签认理由
  - [ ] 上游单测/服务/桌面包/原生/真人分层
  - [ ] CI实际命令冻结执行
  - [ ] 失败不改skip/期限
  - [ ] 旧工具仍活动则保持契约
  - [ ] G5前完成旧运行/构建/配置/CI消费者清单和逐断言继任覆盖，交M36在G5后执行获准断接；移交M33零消费者证据，保留旧文件/恢复基线，不skip换绿
  - [ ] Chrome与Edge Web访客实际邀请/登录/消息/闭麦语音/收听与观看/授权拒绝/关页退出旅程，明示快捷键和系统音频等平台限制，不冒充Windows完整体验
- 范围候选：U：固定版本现有CI/测试精确子集；B：旧测试退役另签。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不伪造test:matrix或用旧npm命令签收Element。

### M26 信任边界与依赖约束

GitHub：[#85](https://github.com/wenhuorongbing-netizen/babacom/issues/85)；Parent：[E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57)。

- Epic：E7；类型：task；阶段：G2/G3；依赖：M09 / M10 / M17。
- 用户故事：作为维护者，我希望定制不破坏隔离或积累耦合。
- 验收：
  - [ ] Electron隔离/批准IPC/导航/秘密/采集负向测试
  - [ ] 唯一账号/权限owner
  - [ ] 无跨featureimport/重复媒体引擎
  - [ ] 镜像依赖固定/扫描，秘密轮换验证
  - [ ] 真实license/NOTICE/source/品牌义务
- 范围候选：U/服务端：安全测试、现有lint/CI及配置，按票精确冻结。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不通过关闭安全检查修复，不fork加密核心。

### M27 断线休眠与设备稳定

GitHub：[#86](https://github.com/wenhuorongbing-netizen/babacom/issues/86)；Parent：[E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57)。

- Epic：E7；类型：story；阶段：G3/G4；依赖：M17 / M18 / M19 / M25。
- 用户故事：作为玩家，我希望网络设备变化后继续使用。
- 验收：
  - [ ] 抖动后≤10s恢复或明确报错
  - [ ] 睡眠/热插拔/重复进出资源基线稳定
  - [ ] 不隐蔽重新采集
  - [ ] generation与后台归属、失败后清理期限实测
  - [ ] 当前收包不能由累计字节推断
  - [ ] Windows终端自动更新：获准更新源、签名/哈希与坏包拒绝、失败保持可启动版本、重启后账号/密钥/历史保全和退出释放；开发侧上游升级不能替代
  - [ ] 崩溃诊断默认本地脱敏并有留存边界，外发须明确选择且不含秘密/原始音频；恢复状态可理解
- 范围候选：U：最小恢复/清理缺口与故障测试路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不再建一套恢复框架；未知实例不能清理。

### M28 真人中德与Alpha验收

GitHub：[#87](https://github.com/wenhuorongbing-netizen/babacom/issues/87)；Parent：[E7 #57](https://github.com/wenhuorongbing-netizen/babacom/issues/57)。

- Epic：E7；类型：task；阶段：G4；依赖：M18 / M19 / M21 / M22 / M23 / M24 / M27 / M29。
- 用户故事：作为朋友群成员，我希望真实游戏夜稳定可用。
- 验收：
  - [ ] 两真实Windows且各当前会话同意
  - [ ] 20分钟每方向≥19/20可懂，入房≥9/10
  - [ ] 获准中德条件/高峰/强制中继
  - [ ] 10语音/1共享/≤9观看≥2h
  - [ ] 物理停采/退出
  - [ ] 条件不足HOLD
- 范围候选：实际设备/节点与只追加证据位置，运行配置另签。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：无源码范围默认授权；不拿CI/VM替代真实跨境。

### M29 受控自托管环境

GitHub：[#88](https://github.com/wenhuorongbing-netizen/babacom/issues/88)；Parent：[E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58)。

- Epic：E8；类型：task；阶段：G1最小/G3；依赖：完整环境依赖M04 / M02最终政策；独立M29-P #98仅依赖#97与M04最小固定组合。
- 用户故事：作为运营者，我希望以明确配置运行完整私有链路。
- 验收：
  - [ ] staging homeserver/DB/媒体/RTC auth/SFU/TURN/TLS/发现兼容
  - [ ] 无默认公开注册/开放创建
  - [ ] 测试秘密隔离
  - [ ] 获准资源与退出/费用边界
  - [ ] 固定版本组合联调
  - [ ] M29-P #98独立交付本机控制面互通/私房拒绝/重启历史，不当完整RTC/TLS/运行环境通过；父票其余AC保持打开
- 范围候选：独立部署配置位置及逐文件范围先裁决；不自动改现有infra。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：配置存在不等于已部署；无资源时HOLD。

### M30 健康告警与数据政策

GitHub：[#89](https://github.com/wenhuorongbing-netizen/babacom/issues/89)；Parent：[E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58)。

- Epic：E8；类型：task；阶段：G3；依赖：M29。
- 用户故事：作为运营者，我希望及时发现故障并最小化数据。
- 验收：
  - [ ] 控制/媒体健康与真实人数/带宽/丢包/CPU
  - [ ] 80%配额告警触发
  - [ ] 日志≤14天/附件90天
  - [ ] 无第三方遥测录音
  - [ ] 实际外发/可见性/风险说明核对
  - [ ] 国内可访问状态页与IP被墙/证书过期/磁盘满/数据库故障/流量超额五类事故步骤、owner和演练证据；状态页不暴露私有成员或秘密
- 范围候选：现成监测/告警/留存配置与测试路径待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不另造复杂控制面；秘密不入监测。

### M31 数据迁移备份恢复与回滚

GitHub：[#90](https://github.com/wenhuorongbing-netizen/babacom/issues/90)；Parent：[E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58)。

- Epic：E8；类型：task；阶段：G3；依赖：M01 / M29 / M09 / M14。
- 用户故事：作为运营者，我希望迁移和故障时保住成员历史与密钥。
- 验收：
  - [ ] 先资产/稳定ID映射，隔离幂等试迁移/中断续跑/数量哈希可读性权限核对
  - [ ] 每日异地备份
  - [ ] 隔离恢复RPO≤24h/RTO≤4h
  - [ ] 设备密钥另测
  - [ ] 切换后新写入保全/兼容回滚或前向修复演练
  - [ ] 获准备用IP/域名与客户端端点切换演练，保持Matrix server_name/身份/密钥/TLS信任；不能把改域名假称身份迁移；季度恢复演练有owner与排期
- 范围候选：部署备份/数据转换配置脚本逐文件裁决；迁移仅_proposed/。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：无真实数据也须盘点证明；旧快照不是无损回滚；不假定DB降级；M14依赖只需存储/迁移必要子集，Ready时拆出有独立验收/链接的实施票再替换依赖，未拆前保守维持全票依赖，不旁路。

### M32 中德节点与成本证据

GitHub：[#91](https://github.com/wenhuorongbing-netizen/babacom/issues/91)；Parent：[E8 #58](https://github.com/wenhuorongbing-netizen/babacom/issues/58)。

- Epic：E8；类型：spike；阶段：G3/G4；依赖：M29。
- 用户故事：作为Jack，我希望据实测选择节点质量与预算。
- 验收：
  - [ ] 获准候选北京时间21点RTT/抖动/丢包/UDP/TURN/CPU/带宽
  - [ ] 2/6/10人共享档位复现
  - [ ] 计算DB/SFU/TURN/存储/备份/CI签名/邮件/升级成本
  - [ ] 不把旧FEC百分比当通用事实
- 范围候选：获准测量入口、docs/03-cost-model.md必要更新另签范围。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不擅自租机采购，未测不许宣称中德可用。

### M33 退役重复后端权威

GitHub：[#92](https://github.com/wenhuorongbing-netizen/babacom/issues/92)；Parent：[E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59)。

- Epic：E9；类型：task；阶段：G6；依赖：M10 / M17 / M25 / M31 / M36。
- 用户故事：作为维护者，我希望只维护Matrix身份与授权。
- 验收：
  - [ ] G5切换观察通过
  - [ ] 新链不调用旧FastAPI/session/provider/can/token
  - [ ] 接收M25覆盖交接和M36在G5后获准断接的运行/构建/动态配置/CI消费者零证据；先保留文件/恢复基线再删除，不等待M34反向提供断接
  - [ ] 精确删除名单/owner/恢复基线审查
  - [ ] 旧票如实superseded，历史证据保留
- 范围候选：B候选：apps/api/app/main.py、factory.py、auth/session.py、permissions和tokens具体文件另签。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不能因仍用LiveKit删除所需RTC auth；不目录清扫。

### M34 退役旧桌面与测试负担

GitHub：[#93](https://github.com/wenhuorongbing-netizen/babacom/issues/93)；Parent：[E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59)。

- Epic：E9；类型：task；阶段：G6；依赖：M33 / M07 / M25 / M27。
- 用户故事：作为维护者，我希望不再同时维护两套客户端与状态。
- 验收：
  - [ ] 旧desktop/媒体桥/构建helper退出活动链
  - [ ] 每移除断言有继任覆盖或签认淘汰理由
  - [ ] #41 dirty先可恢复保存并校验
  - [ ] 删除后构建测试安装升级复验
  - [ ] 历史Sandbox产物证据不删
- 范围候选：B旧desktop/build/dev/helper/tests/manifest锁文件的逐文件删除名单另签。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不reset覆盖dirty，不整目录删除，非目标副本保持。

### M35 上游升级与补丁预算

GitHub：[#94](https://github.com/wenhuorongbing-netizen/babacom/issues/94)；Parent：[E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59)。

- Epic：E9；类型：task；阶段：G3；依赖：M07 / M26 / M27。
- 用户故事：作为维护者，我希望能持续吸收上游安全修复。
- 验收：
  - [ ] 固定基线→一次相邻稳定版本升级
  - [ ] 补丁审查重放，类型构建关键旅程包通过
  - [ ] 兼容回退/数据保护实测
  - [ ] 每补丁有需求/owner/回归/维护成本
  - [ ] 零协议加密核心fork
- 范围候选：U：实际锁文件/补丁/升级CI精确子集待核定。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：不顺手升级所有组件；失败则阻止采纳/切换。

### M36 正式切换与两周观察

GitHub：[#95](https://github.com/wenhuorongbing-netizen/babacom/issues/95)；Parent：[E9 #59](https://github.com/wenhuorongbing-netizen/babacom/issues/59)。

- Epic：E9；类型：task；阶段：G5；依赖：M28 / M30 / M31 / M35。
- 用户故事：作为Jack，我希望根据真实使用完成受控切换。
- 验收：
  - [ ] 先冻结旧写入/备份增量核对再切路由，仅一权威
  - [ ] 实际切换与新写入保护回退演练
  - [ ] 两周真实游戏夜无人因质量回退
  - [ ] owner签收/阻断项逐条处置
  - [ ] G5通过后按独立精确范围断接旧运行入口/构建/配置/CI消费者，核对M25继任覆盖并将零消费者证据交M33；保留旧文件与可恢复基线，此交付不删除旧桌面/测试
  - [ ] 然后才允许M33/M34，整个项目仍待G6退役后关闭
- 范围候选：发布/路由配置及既有Issue验收字段精确冻结；实际资源/发布另有适用授权。
- Validation：DRAFT未冻结；Ready前从固定HEAD录入实际完整命令、环境和通过条件，并满足规格中的相应证据层级。
- 停止/非目标：本票不提前删旧代码、不以切换完成冒称全部Issue已结。

## 5. 旧Issue/PR/dirty处置

| 旧项 | 映射与真实处置 |
|---|---|
| [#1 T1](https://github.com/wenhuorongbing-netizen/babacom/issues/1) | M01/M02/M25/M33；保存历史交付，继任契约与替代证据成立后可superseded，不声称原全部验收补齐 |
| [#14 T2](https://github.com/wenhuorongbing-netizen/babacom/issues/14) | M02/M17–M28；执行架构待替代，原语音/设备/跨境目标保留 |
| [#18](https://github.com/wenhuorongbing-netizen/babacom/issues/18) | M18/M28；真人听音、物理设备释放、中德仍待做；Matrix或上游CI不替代 |
| [#31](https://github.com/wenhuorongbing-netizen/babacom/issues/31) / [#42](https://github.com/wenhuorongbing-netizen/babacom/issues/42) | M25/M27/M34；已有合并代码与部分历史证据；旧helper活动时继续履约，退役后才superseded，不伪造最终旧包PASS |
| [#40](https://github.com/wenhuorongbing-netizen/babacom/issues/40) | M25/M27/M34；暂停无关旧构建器投资，活动泄漏仍按原范围修复；确认退出后退役，历史临时目录不自动授权清理 |
| [#41](https://github.com/wenhuorongbing-netizen/babacom/issues/41) | M25/M27/M34；merge-main的playback.ts与microphone.e2e.ts两文件dirty保留；delta部分通过，不等于freshness≤1000ms/挂起到期已修。退役前可恢复保存 |
| [#48](https://github.com/wenhuorongbing-netizen/babacom/issues/48) / [PR49](https://github.com/wenhuorongbing-netizen/babacom/pull/49) | CLOSED/MERGED c9ec3cf；M06/M07继承设计目标，不重开或逐行移植旧六文件 |
| [#50](https://github.com/wenhuorongbing-netizen/babacom/issues/50) | 本规划票；产品/安装/部署/删除不属于本票 |

七个旧open票加迁移标签/里程碑并追加关系说明，保持打开；移除过时Ready标签不抹掉原验收。未来关闭必须记录resolved / superseded / not-planned及owner/证据，不能把“已计划迁移”写成“已修复”。

## 6. 原24模块完整归属

| 模块 | 迁移票 | 原则 |
|---|---|---|
| 1.1 基础设施 | M29 | 固定配置与真实运行 |
| 1.2 媒体运维 | M28/M32 | 跨境/负载真实测量 |
| 1.3 可观测与发布 | M30/M36 | 健康/告警/切换 |
| 2.1 邀请 | M08 | 私域邀请政策 |
| 2.2 账号会话 | M09/M11 | 稳定设备/恢复 |
| 2.3 角色权限 | M10 | 单一Matrix权威 |
| 3.1 语音频道 | M17/M27 | Call复用与恢复 |
| 3.2 音频设备 | M18/M19 | 显式采集/快捷键/设备 |
| 3.3 摄像头 | M20 | R03复用验证 |
| 4.1 共享发布 | M21/M24 | 系统音频/单共享强制 |
| 4.2 观看 | M22 | 独立音量/播放器生命周期 |
| 4.3 质量连接 | M23/M27 | 真实数据/低带宽 |
| 5.1 消息核心 | M13 | 同步/历史与后续消息项 |
| 5.2 附件媒体 | M14 | 鉴权/留存/引用 |
| 5.3 线程搜索 | M16 | 中英文/E2EE差异 |
| 6.1 外壳结构 | M07/M12 | 上游社区导航 |
| 6.2 外观语言 | M06 | 品牌/i18n/可访问 |
| 6.3 DM提醒 | M15 | 通知/presence |
| 7.1 实时网关 | M13/M25 | 不建并行消息WS |
| 7.2 令牌限流 | M10/M17/M26 | RTC授权/拒绝/秘密 |
| 7.3 任务邮件存储 | M11/M14 | 交付与留存真实运行 |
| 8.1 主机成本 | M32 | 实测与预算 |
| 8.2 韧性 | M31 | 数据/密钥/恢复 |
| 8.3 安全政策 | M26/M30/M35 | 许可/安全/升级 |

模块级覆盖24/24；**139条历史未勾AC的逐条KEEP/REWRITE/RETIRE清单尚待M01完成**，不能把本模块表当作139条已签收。原Must/Won't和R03/R04阶段见Scope v2，缺口逐项记录不静默取消。

## 7. 本轮验证与审查边界

本轮验证仅docs scope_guard、diff whitespace、计划数量/依赖DAG/模块覆盖/链接一致性及独立Standards/Spec审查。产品、安装包、数据迁移、部署、物理设备和中德测试NOT_RUN。原战略PO对e14d7e9给FIX后，实际读取464f71a对两项依赖修正限范围复核GO；此前附着失败保留为历史。首批为M01/M04只读、#97受限实验合同及#98控制面proof；Windows包必要子集另立范围，不批量开工36父票。

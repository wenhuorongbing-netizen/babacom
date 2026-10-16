# matrix-rtc-proof — 同机零媒体 R0 候选

状态：**PROPOSED／未实施**。Jack 已允许指定腾讯云主机进行 RTC；精确范围和运行合同须独立 docs PR 审查、Jack 签认及可信合并后生效。关联 M04 #63、M10 #69、M29 #88；窄实施票与范围 PR 尚未建立。DRI：Codex协调者；Reviewer须独立于Builder。

## 目标与范围

仅证明真实 Matrix 身份/私房成员授权、SFU签票及LiveKit信令，初始和全程零媒体轨道；不以health或伪造token代替。沿用[固定版本/摘要与接口](../../docs/Matrix-protocol-research.md#3-固定候选版本尚不是兼容组合签收)，首轮compatibility `/sfu/get`，AS与full-access只绑定同一个测试homeserver。新TLS代理镜像及完整构建来源仍须核定，缺项HOLD。

## Allowed Files（未来实施候选）

<!-- allowed-files:start -->
infra/staging/matrix-rtc-proof/compose.yaml
infra/staging/matrix-rtc-proof/homeserver.yaml.example
infra/staging/matrix-rtc-proof/appservice-registration.yaml.example
infra/staging/matrix-rtc-proof/livekit.yaml.example
infra/staging/matrix-rtc-proof/Caddyfile
infra/staging/matrix-rtc-proof/proof.mjs
infra/staging/matrix-rtc-proof/proof.test.mjs
<!-- allowed-files:end -->

仅以上七个未来源码/配置文件；本轮不创建它们，不改现有matrix-proof、产品、依赖manifest或旧业务配置。宿主秘密、证书和运行数据不入Git。

## 候选运行合同

| 边界 | 约定与必须检查的事实 |
|---|---|
| 主机例外 | 仅 `lhins-af0ntal8` 的临时R0；授权与资源快照见[04](../../docs/04-open-decisions.md#matrix-rtc-e1-same-host-2026-10-16)，默认规则见[infra/AGENTS](../../infra/AGENTS.md)。不据此签收生产或媒体共置。 |
| 归属 | 仅 `/opt/babacom-matrix-rtc-e1`，Compose项目 `babacom-matrix-rtc-e1`；创建前核对目录不存在或归属明确，绑定主机/项目/镜像/run ID。全新合成DB、卷、秘密；独立Docker网络，无旧业务挂载、host网络或privileged。 |
| 容量 | 本次实验进程/容器合计CPU quota/period≤1，memory限制总和≤1610612736字节；验证辅助进程也纳入预算。实查实际cgroups，不以Compose文本代替。启动前复核空间/内存/负载及旧服务基线；主机止损阈值须随运行细节冻结，未冻结即HOLD。 |
| 故障/退出 | 超限、实验OOM或旧服务基线异常即停止本次自有实验；未知归属为UNKNOWN。只停确认归属的资源，保留合成DB/卷/秘密及追加证据；不停止旧服务、不全局down或删除卷。 |
| TLS/入口 | 所有发布入口仅loopback，实际域名、精确端口、可信证书/取得方式、TLS代理平台摘要及访问方均待核定；缺项拒绝运行。严格验证证书链和主机名，另实测auth的OpenID入口；无跳过校验或安装自签CA，不改旧DNS/代理/防火墙，不新增公网端口。 |
| 身份/秘密 | 仅新合成账号rtc-a/rtc-b/rtc-outsider和新私房，Matrix成员为唯一权威。秘密运行前随机生成并核对精确目录/文件最小权限；不覆盖旧秘密，不进Git/URL/日志/截图，token仅验证进程内存。 |
| 媒体 | LiveKit仅供API和信令；TURN关闭，不协商音视频轨道，不采集设备；任何媒体轨道使R0失败。R1–R3另定范围，强制relay/真人/中德不由R0代替。 |
| 期限 | 单次验证总预算120秒、单HTTP≤10秒，清理≤60秒；保留T1/T2及安装/退出期限。冲突即FAIL/BUSY，不杀占用者、不自动换端口、不重置预算。 |
| 准入 | 上述缺项、摘要/平台不符、权限不明、通配/多homeserver或无法读取成员状态均拒绝；不退回浮动tag、无成员校验或不可信TLS。 |

录制归档传输期间不并行性能验收；录制备份/删除不属于本模块。保留现有生产入口、证书、业务数据及服务。

## Validation（未来接口，当前均未实现/未执行）

仓库根执行范围与自测：
```powershell
node .agents/scope_guard.mjs matrix-rtc-proof --files infra/staging/matrix-rtc-proof/compose.yaml infra/staging/matrix-rtc-proof/homeserver.yaml.example infra/staging/matrix-rtc-proof/appservice-registration.yaml.example infra/staging/matrix-rtc-proof/livekit.yaml.example infra/staging/matrix-rtc-proof/Caddyfile infra/staging/matrix-rtc-proof/proof.mjs infra/staging/matrix-rtc-proof/proof.test.mjs
node --test infra/staging/matrix-rtc-proof/proof.test.mjs
git diff --check
```

范围生效、精确运行细节签认后，Linux宿主按序执行未来接口：
```bash
node /opt/babacom-matrix-rtc-e1/proof.mjs preflight
node /opt/babacom-matrix-rtc-e1/proof.mjs config
node /opt/babacom-matrix-rtc-e1/proof.mjs up
node /opt/babacom-matrix-rtc-e1/proof.mjs verify
node /opt/babacom-matrix-rtc-e1/proof.mjs stop
```

`preflight/config`必须证明归属、秘密权限、固定摘要/平台、TLS/精确loopback入口与拟定资源限制；`up`≤120秒，创建容器后、就绪验收和验证请求前实查实际cgroups，不符即停自有实验。`verify`执行上述预算，任何失败非零退出；`stop`≤60秒且保留数据。当前缺失的域名/端口/证书/代理摘要/止损阈值须作为拒绝用例，不以默认值运行。

## Completion Criteria

- [ ] 范围/具体运行合同获独立审查、Jack签认及可信合并；没有以候选清单自授权。
- [ ] 真实OpenID、已加入私房签票200；JWT身份/房间/最小grants匹配，LiveKit实际接受对应信令且轨道始终为0。
- [ ] 未加入/仅受邀/无权的已存在私房、错主体及踢出后新请求拒绝且无JWT/参与者；旧JWT重连与既有参与者撤销另记，不以网络错误当权限证据。
- [ ] 可信TLS、成员配置、摘要、入口、资源限制及失败关闭正反例通过；秘密无输出，运行期限符合合同。
- [ ] 退出仅停止自有实验，数据/证据保留；旧容器身份/映像/状态/挂载、服务与入口基线保持。失败/HOLD/NOT_RUN逐层记录；G1/G4与旧契约不降级。

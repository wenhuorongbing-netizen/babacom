# matrix-proof — 受限原版 Matrix 控制面实验

Issue: [#97 M02-E/M03-E](https://github.com/wenhuorongbing-netizen/babacom/issues/97)；实施票 [#98 M29-P](https://github.com/wenhuorongbing-netizen/babacom/issues/98)。
状态：**Jack已于2026-10-13授权继续隔离部署和测试；独立范围PR审查合并后生效，本PR不实施部署**。DRI：Codex协调者；独立Reviewer：与Builder不同的代理；本fork最终签认者：Jack。父M02/M03/M04/M05/M29不因子交付通过而全部Done。

## 目标与前置

首Sprint只证明原版控制面可运行、标准Matrix账号/私房消息互通和重启历史；不是完整G0/G1、RTC、E2EE恢复或生产验收。
用户已授权Matrix资料、部署项目与Sprint调整；此合同把下一批范围具体化。独立docs PR审查及Jack签认生效后，才按#98实施。最终生产政策由M02在实验后另签。

运行前固定Synapse v1.162.0、Element Web v1.12.30、兼容PostgreSQL镜像到实际digest和来源/许可；客户端内嵌SDK43.0.0/Call0.26.0不替换。读取M04源码/许可可与M01并行；缺少digest/环境则HOLD，不用:latest或任意拼版本。
新增运行依赖理由：stock Synapse负责标准Matrix状态，PostgreSQL负责持久化，stock Element负责标准客户端UI；当前FastAPI/LiveKit不能替代Matrix homeserver/同步。不向旧npm/Python manifest增加依赖。

## Allowed Files

<!-- allowed-files:start -->
infra/staging/matrix-proof/compose.yaml
infra/staging/matrix-proof/homeserver.yaml.example
infra/staging/matrix-proof/element-config.json
infra/staging/matrix-proof/proof.mjs
<!-- allowed-files:end -->

仅以上四个源码/配置文件；无目录通配。目录级infra/AGENTS.md继续适用，尤其digest固定、媒体不与其他服务混跑、不得采购和秘密不提交。此proof不运行媒体服务。

## 实验资源、临时政策与边界

| 项目 | 固定实验约定 |
|---|---|
| Linux环境 | 专用WSL2 `BabaCom-Matrix-Proof`，虚拟磁盘仅 `D:/Code/babacom/.matrix-runtime/wsl/ext4.vhdx`；官方Ubuntu发行版与Docker Engine；不使用其他发行版/服务器，不改全局WSL/防火墙设置 |
| 启动 | 仅本次签认覆盖的官方Linux/容器安装；遇机器级提权或重启要求即停止并一次性报告，不循环弹UAC，不修改执行策略 |
| 运行owner | Docker项目 `babacom-matrix-proof`，只操作其容器和命名卷；不停止未知实例，不运行全局WSL shutdown |
| 外部入口 | Windows和WSL均只允许loopback；`127.0.0.1:18008` Synapse、`127.0.0.1:18080` Element；冲突即FAIL/BUSY，不杀占用者、不自动换端口 |
| 测试身份 | 专用server_name `proof.babacom.test`，合成账号proof-a/proof-b/proof-outsider；昵称不是身份，不连接真实Matrix账号/旧FastAPI |
| 数据 | 只建立新合成私房/事件；DB/媒体在本项目命名卷，不导入旧数据；保留重启历史证据；禁止volume删除/WSL unregister |
| 秘密 | 运行前随机生成；宿主仅 `D:/Code/babacom/.matrix-runtime/secrets/homeserver.yaml`、`D:/Code/babacom/.matrix-runtime/secrets/postgres.env`、`D:/Code/babacom/.matrix-runtime/secrets/test-users.json`；创建前/运行前实查父secrets目录与三个文件Windows ACL只许当前用户、SYSTEM、Administrators，不许Users/Everyone/Authenticated Users读取。仅本次新建自有目录可最小收紧，已有秘密不覆盖；Linux读权限另验，chmod不能代替NTFS ACL。无法证明则HOLD。仅供本次自有服务/验证，不入Git/URL/日志/快照输出；不向普通可见DOM放令牌/服务秘密 |
| 注册/联邦 | 关闭公开注册、公开目录/探索/访客与外部集成；创建测试账号仅容器内本机管理命令；私房设置 `m.federate=false`；禁止出站联邦与外部URL预览，不只删除监听器 |
| 临时会话 | Node验证access token仅内存，单次验证总预算120秒，finally执行logout并验证失效；stock Element UI另用本次独占loopback origin，允许合成凭据进入受限密码框及该客户端官方同源IndexedDB/localStorage，按固定版本核实其设备/会话存储并单独记录。完成后UI logout且核对本次旧会话失效；禁止快照/日志/URL导出，不把客户端长期crypto存储假写成“仅内存”，不清除其他站点/profile。账号/DB保留用于重启证明。120秒是脚本期限，不是生产TTL/限流/撤销承诺 |
| 留存/退出 | 本轮不自动清除合成数据；stop只停自有容器，保留卷和秘密。后续清理必须独立核定目标/恢复边界，不把测试数据当全目录删除许可 |
| 非目标 | 无RTC/SFU/TURN、无麦克风/摄像头/屏幕采集、无自签CA、无公网DNS/证书/端口、无采购/真实邮件/旧数据导入/生产切换/旧代码删除 |

WSL2.6.3/内核6.6.87.2与“无已安装发行版”已只读核实；Docker/Podman未发现，端口/虚拟化运行条件待启动前实查。安装前先核对该WSL版本的官方`--help`与发行版来源；不猜参数。此合同不授权升级WSL或改变其他任务配置。

## Validation

实施脚本还未存在；以下是#98必须交付的固定命令接口，cwd为仓库根，Windows使用Node≥22.12。

```powershell
node .agents/scope_guard.mjs matrix-proof --files infra/staging/matrix-proof/compose.yaml infra/staging/matrix-proof/homeserver.yaml.example infra/staging/matrix-proof/element-config.json infra/staging/matrix-proof/proof.mjs
node infra/staging/matrix-proof/proof.mjs config
node infra/staging/matrix-proof/proof.mjs up
node infra/staging/matrix-proof/proof.mjs verify
node infra/staging/matrix-proof/proof.mjs stop
git diff --check
```

`config`必须检查实际镜像digest、秘密引用/权限与仅loopback发布；`up`就绪总预算120秒；`verify`总预算120秒、单HTTP请求≤10秒，超时/错误非零退出、输出仅脱敏断言结果。`stop`60秒内停止本项目且保留数据；不得stop/down全局资源或加`-v`。配置语法/health通过不等于业务验证通过。

## Completion Criteria

- [ ] 精确范围、固定依赖/许可和实验契约独立审查签认；source不改stock核心。
- [ ] 配置与实际监听验证仅loopback，未开放公网/联邦/注册/遥测/外部集成；秘密无输出/提交。
- [ ] Matrix versions、login/whoami；A建私房，未受邀B不能join；invite/join后B能sync到A同一event/sender/body；同txn无重复事件。
- [ ] outsider读/发私房拒绝，B越权改状态拒绝，kick后发送拒绝，logout旧token拒绝。
- [ ] 重启仅自有Synapse/Postgres后原账号/room/event/历史仍可读取；不得重建空库冒充持久化。
- [ ] stock Element实际加载固定构建，UI登录并观察双账号同一消息，单列UI证据；API脚本不能代替UI/E2EE/原生。
- [ ] Scope与命令exit0、独立代码review无实质阻断；失败/HOLD/NOT_RUN如实附原始输出。
- [ ] stop后自有服务退出且卷/秘密仍在；无无主后台、他人实例操作或旧代码/dirty改动。

任何隔离失败、秘密暴露风险、来源/digest不匹配、未知资源归属或需协议/加密核心fork立即停止。物理Windows系统声/独立音量/无数字回授与中德验收仍按G1/G4，不降低Must。

# T2-03 验收办法调研

调研日期：2026-10-08（Europe/Berlin）。关联 [Issue #18](https://github.com/wenhuorongbing-netizen/babacom/issues/18)；Module: docs。本文件记录调研结论，不修改既有规格、验收标准、Allowed Files 或产品代码，也不把补测视作签认。

## 推荐办法

先用本机已有 Windows Sandbox CLI 查清沙盒是否真正启动、用户会话是否就绪、guest 命令是否执行和结果是否回传。基础设施可用后，在**同一个沙盒内运行两个打包客户端及同一个本地 API/SFU**，补测干净 Windows 环境中的双客户端行为。最后安排两位测试者、两台真实 Windows 完成真实听音与设备释放；跨设备前还需独立批准非回环/TLS 启动配置和会话发放路径。

这是基于当前实现边界的推荐，不是已经跑通的结果。主机与 VM 分别连接共同服务的路线目前不能仅靠开放端口实现：客户端 API 与 SFU 都强制回环地址，跨设备配置也是规格明确保留的另行条件。来源：[main.ts](../apps/desktop/src/main/main.ts) 231–246 行；[T2-spec.md](T2-spec.md) 119–127、181–188、333–341 行。

## 已确认与未确认

本次主任务的只读环境检查确认 Windows 11 Pro `10.0.26200` / build `26200`，Sandbox Windows 功能已启用，`MicrosoftWindows.WindowsSandbox` 应用包版本为 `0.8.107.0`，状态 `Ok`。`wsb --version` 同样为 `0.8.107.0`。`wsb --help` 与 `wsb list --raw` 均 exit 0；后者返回一个现存实例，但归属尚未确认。本文件不记录实例 ID，也不认为它由先前 runner 创建；不得对未知归属实例执行 connect、exec、share 或 stop。

先前 `npm run dev --workspace apps/desktop -- --sandbox-acceptance` 在 120 秒内没有收到实际 guest `result.json`，结果为 `NOT_RUN`。这不证明 Sandbox 不可用，也不能据此判断是网络、脚本、权限或应用问题。当前 runner 只等待结果文件，没有保存独立的沙盒就绪、命令执行与回传状态；它只复制 T1 fixture，并关闭网络、音频输入等功能，不能用于 T2 通话验收。来源：[dev.mjs](../apps/desktop/scripts/dev.mjs) 343–399 行。

当前 runner 以 `WindowsSandbox` / `WindowsSandboxClient` 进程名判断占用，最后尝试终止启动器子进程。实际 CLI 仍列出现存实例，说明仅凭该进程检查不能可靠证明 guest 不存在或已释放；是否存在清理缺陷需后续用归属明确的实例验证，不能由本次观察直接确定。来源：[dev.mjs](../apps/desktop/scripts/dev.mjs) 345–347、375–397 行及上述只读 CLI 检查。

## Sandbox 的能力与边界

微软提供的 `wsb` CLI 支持 start、list、exec、share、connect、ip、stop，`--raw` 返回 JSON；文档标明从 Windows 11 24H2 起提供。`exec` 返回退出码，但该文档明确不转发进程输入输出；以登录用户执行还要求活动用户会话。应使用 CLI 状态和限定的映射输出文件分辨故障，不再只等待一份最终 JSON。[Microsoft：Windows Sandbox CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)（更新 2025-01-24，核实 2026-10-08）。

`.wsb` 的 Networking 启用虚拟网卡/交换机；MappedFolders 可限定共享路径与只读权限；LogonCommand 在启动后执行命令；AudioInput 共享**主机麦克风输入**。后者不会创造另一台独立物理声卡。默认网络、音频输入均启用，补测必须显式配置所需能力；软件补测可保持 AudioInput Disable，只有获得当前会话的设备同意后才考虑转接。[Microsoft：Use and configure Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)（更新 2026-03-29，核实 2026-10-08）。

## 可执行的诊断顺序

以下前两条已在主任务运行，exit 0。其他是候选步骤，未运行；命令中的 ID 必须替换为**已确认属于本次测试**的实例，不得复制 list 中未知归属的实例直接操作。只读检查可先做：

```powershell
wsb --help
wsb list --raw
```

拥有本次独立实例后，记录启动返回的 ID 与退出码，用 list 确认状态；只在需要网络诊断时查询 IP。再连接用户桌面，用 ExistingLogin 而非 System 检查用户应用环境。`System` 执行成功不能证明桌面客户端、音频输入或用户同意链路成功。

```powershell
wsb list --raw
wsb ip --id <owned-instance-id> --raw
wsb connect --id <owned-instance-id>
wsb exec --help
```

本机 `wsb start --help` 和 `wsb exec --help` 已核实，均 exit 0；前者接受 XML 配置字符串，后者提供 command、working-directory 和 run-as 选项，但本次没有执行 guest 命令或核实完整命令参数转发。不要直接启动无参数的交互式 PowerShell 充当探针。guest 检查脚本应写入本次独有映射输出目录，以退出码与不含凭据的结果文件报告阶段：guest-started、fixture-ready、client-started、result-written。只追加当前运行结果；输入只读、输出仅限本次目录。`.wsb` 的可用配置值以当前配置文档和本机帮助为准，不机械复制 CLI 文档中的 XML 示例。来源：[微软 CLI 文档](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)、[微软配置文档](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)。

不要因一次 120 秒超时就重启系统、重装功能、关闭安全设置或停止其他人的沙盒。必要停止时，先取回本次结果，再仅停止本次已确认拥有的实例。

## 同一 guest 内双客户端补测

建议作为后续独立测试任务，先明确精确 Allowed Files 与断言；本次仅调研，没有实现。

1. 使用同一份已验证打包产物，复制 T2 的实际服务、锁定 SFU 与必要运行依赖；保留产物和依赖摘要校验。
2. API 与 SFU 均在 guest 的 `127.0.0.1`，两个 EXE 连接同一 API/SFU/房间，各通过现有受控命名管道注入自己的会话。无需改变跨主机网络边界。
3. 将测试 fixture 扩为两个不同且稳定的主体；分别经现有 `SessionRegistry` 发会话、`RoomAccess` 授权。当前 registry fixture 仅有一个主体，合成 peer 不等于第二个稳定真人主体。只扩测试环境，保持认证与授权实现。来源：[local_media_service.py](../tests/voice/local_media_service.py) 152–167、225–232 行。
4. 先禁用物理输入，验证真实双客户端身份、进房、成员显示、合成媒体发布/接收、静音状态、取消/退出和迟到回调清理；不得将合成媒体统计写成人耳听音通过。
5. 若后续取得设备同意，再单独验证重定向麦克风的显式授权与退出。由于输入由主机转接，guest track 停止只能证明该进程/重定向路径的行为；主机物理设备是否释放仍需独立观察。

推断：同 guest 双客户端可以避免当前跨设备地址限制，并提高干净 Windows 中的集成覆盖；它尚未实现或运行，不保证 Sandbox 中 SDK、音频重定向与 EXE 启动器均能正常工作。若只需查软件双端逻辑，也可先在主机上运行同样两稳定主体，定位完成后再搬入 guest。

## 替代平台比较

| 方案 | 官方能力 | 本项目适用性与成本前提 |
|---|---|---|
| 已有 Windows Sandbox | 一次性 Windows guest，CLI、映射文件、可选麦克风输入 | 优先用于干净系统补测；已有安装，先诊断现存状态，不安装另一套虚拟化软件。仍需 T2 测试启动器适配。 |
| 持久 Hyper-V Windows VM | VMConnect 增强会话通过 RDP 提供音频播放及麦克风转接；guest 需要启用 Remote Desktop | 长期保留镜像、调试环境时再考虑。需合法 Windows guest、存储/内存、VM 管理功能与音频设置；主机 hypervisor 已存在不等于这些条件全部就绪。[微软增强会话文档](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/enhanced-session-mode)（更新 2026-01-21）。 |
| VirtualBox | 虚拟音频控制器，独立音频输入/输出选项、虚拟网卡 | 当前常见安装路径未发现，不优先新增安装、Windows guest 与音频配置；虚拟控制器仍不代表第二实机。来源：[Oracle VirtualBox 7.2：Working with VMs](https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/working-with-vms.html)（页面未显示更新日，核实 2026-10-08）。 |
| VMware Workstation | 官方支持文档说明 VM 连接音频设备及主机/guest 音频设置 | 当前常见安装路径未发现，现成 guest 尚未确认。查到的音频支持文章覆盖较旧版本，不能据此承诺当前版本在此机可用；不为该问题安装或更改 Hyper-V/VBS。来源：[Broadcom KB 338289](https://knowledge.broadcom.com/external/article/338289/audio-video-or-skype-is-not-working-in-a.html)（更新日期未显示，环境列 Workstation 6–15，核实 2026-10-08）。 |
| 两台真实 Windows | 各自独立物理采集/播放设备与使用者 | 完成 #18 最终本地听音的必要路线；借用现有电脑即可，不需要先买硬件。需两位同意参与的测试者及已批准服务配置。 |

另有微软 `winapp --on sandbox` 自动化，支持 guest UI 检查、执行命令与转发输出，但准备环境会加入 guest agent、Developer Mode 和入站防火墙规则。本次未安装或使用，已有 `wsb` 应先利用；若未来确需该工具，须独立评估上述环境改动与版本条件。[Microsoft：Windows Sandbox execution](https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/sandbox-execution)（更新 2026-10-01，核实 2026-10-08）。

## 真实双设备验收之前缺少的工程条件

需要独立、可审阅的前置任务：明确获准 HTTPS API 与 WSS SFU、地址和端口边界、证书信任、有限 RTC 路径、服务端与客户端严格匹配、跨设备会话的私下发放路径。再同步启动契约与拒绝异常地址/路径/重定向的测试，保持初始票据及应用会话不出现在 UI、日志、URL 或命令行；不能临时关闭隔离、允许任意地址或绕过认证。来源：[T2-spec.md](T2-spec.md) 116–127、176–188、333–341 行；[main.ts](../apps/desktop/src/main/main.ts) 231–246 行。

限制也在旧 T1 启动 schema 内：`apiBase` 正则固定为 `http://127.0.0.1:端口`，main 的 SFU 信令规则当前只接受 `ws:` / `http:`。因此不能仅放宽 main 或开放端口。未来须另立并签认外部配置契约，例如版本化启动配置或独立受控配置，具体设计尚未决定；保持 #18 对旧 T1 schema 与正常 T1 测试的零 diff，不用隧道伪装回环地址完成验收。来源：[admission.schema.json](../packages/contracts/admission.schema.json) 229–231 行；[main.ts](../apps/desktop/src/main/main.ts) 102–108 行；[T2-spec.md](T2-spec.md) 127、339–341 行。

这些工作超出目前 #18 的执行范围，不在本次调研中修改。批准配置具备后，安排两台真实 Windows、两个稳定主体与两位测试者，各自在当前会话明确同意开麦，用独立耳机完成 20 分钟双向听音；各方向至少 19/20 可懂句，正常加入至少 9/10，退出后 5 秒内检查物理采集及播放器释放；6 次/60 秒限流和故意触发 429 分开记录。跨境验收须另有获准节点、两端和时间窗口；资源不足继续 HOLD。来源：[Issue #18](https://github.com/wenhuorongbing-netizen/babacom/issues/18)。

## 证据结论

- VERIFIED：官方 Sandbox/Hyper-V 音频和 CLI 能力；本机 CLI 可列出实例；当前源代码强制回环地址、Sandbox runner 只复制 T1 fixture；测试 fixture 尚非两个稳定主体。
- NOT_RUN：已有 runner 未返回实际 guest 结果；Sandbox 双 EXE/T2 补测、麦克风转接、真人双设备听音、物理释放与跨境验收均未完成。
- HOLD：跨设备安全启动配置、批准的节点/发放路径，以及两位测试者/两实机条件。

本报告没有安装软件、启用系统功能、修改网络/防火墙、启动麦克风、操作未知归属的 Sandbox、使用外部账号/服务器、修改产品源码、发布或变更 Issue。最终是否签认 #18/T2/M0 由 Jack 依据相应证据裁决。

## 本次验证记录

| 命令 / 检查 | 真实结果 | 能证明什么 |
|---|---|---|
| `wsb --help` | exit 0，列出 start/list/exec/share/stop/connect/ip | 本机 CLI 可调用，非 guest 测试通过。 |
| `wsb --version` | exit 0，`0.8.107.0` | CLI 版本。 |
| `wsb list --raw` | exit 0，返回现存实例 | 管理接口可列实例；归属未知，不说明客体应用状态。 |
| 系统版本、Sandbox feature、Appx 只读核实 | 主任务确认上述 OS/build、feature enabled、Appx Status Ok | 已有安装条件，不证明用户桌面或 guest 脚本执行。 |
| 前次 `npm run dev --workspace apps/desktop -- --sandbox-acceptance` | exit 1；`NOT_RUN`，未收到实际 guest 结果 | 未完成该次沙盒验收，不能改写成 PASS 或推定故障原因。 |
| `wsb start --help` / `wsb exec --help` | 两条均 exit 0 | 本机参数帮助可读取；未启动新实例、未执行 guest 命令。 |
| `node .agents/scope_guard.mjs docs --files docs/T2-03-acceptance-research.md` | exit 0，1 个文件全部在界内 | 仅证明本报告属于 docs 模块。 |
| `git diff --no-index --check -- /dev/null docs/T2-03-acceptance-research.md` | exit 1，输出 `LF will be replaced by CRLF the next time Git touches it`；未将此命令记为 PASS | 保留该命令的真实结果；本报告另经下面的显式文本扫描。 |
| `Select-String -LiteralPath 'docs/T2-03-acceptance-research.md' -Pattern '[ \t]+$'`，结果经 `Measure-Object` 计数 | exit 0，Count 0 | 新建报告没有行尾空格或制表符。 |
| `git diff --check` | exit 0 | 已跟踪文件无空白差异；新建报告仍未跟踪，其空白由上一项检查。 |
| `git status --short` | 仅 `?? docs/T2-03-acceptance-research.md` | 本次只新增报告，没有源码或既有契约改动。 |

本次调研仅新建这一份 Markdown；后续代码任务、测试启动器适配与契约设计均未执行。

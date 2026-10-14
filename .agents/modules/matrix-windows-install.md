# matrix-windows-install — G1-P2 隔离安装、离线启动与真实退出

范围票 [#109](https://github.com/wenhuorongbing-netizen/babacom/issues/109)，为 M04/#63、M05/#64 的下一子交付。
状态：**PROPOSED；独立 docs PR 经独立审查、Jack 签认并合并后生效**。Jack 已要求合并 #108 并推进隔离安装启动；本清单将新增运行边界具体化，不把尚未执行的检查写成 PASS。
DRI：Codex Builder；Reviewer：不同于 Builder 的代理；本 fork 最终签认者：Jack。范围生效后另开实施票与 PR，不在本 docs PR 安装或写运行代码。

## Allowed files

<!-- allowed-files:start -->
infra/staging/matrix-windows-proof/runtime.mjs
infra/staging/matrix-windows-proof/runtime.test.mjs
infra/staging/matrix-windows-proof/guest.ps1
<!-- allowed-files:end -->

仅上述三个新文件。复用已合并的 `artifact.mjs`，不改它及其测试；只用 Node 内置模块、已有 Windows PowerShell 与官方 Windows Sandbox CLI。无新增依赖、锁文件、构建配置、旧验收修改或通用编排框架；`infra/AGENTS.md` 继续适用。

## 固定输入与宿主边界

- 唯一安装包仍是 [matrix-windows-proof](matrix-windows-proof.md) 固定的 `D:/Code/babacom/.matrix-runtime/g1/windows/Element Setup 1.12.30.exe`：208730288 字节、SHA-256 `b9ac9617acfa667eb5470e67e5db744d3b595b35c285100a53ad17719f7cc6d3`、既定发布者/证书/时间戳，源码关联 `f19cfd9030429240a4209bf5175b372175cf0464`。取得准入后、安装前完整调用只读核验，不重下载或替换版本。
- 宿主为 Windows 11 Pro x64，Sandbox 已启用；固定 CLI `C:/Users/Jack/AppData/Local/Microsoft/WindowsApps/wsb.exe`，实测版本 `0.8.107.0`。只调用已核实的 `--version`、`list --raw`、`start --id <UUID> --config <XML> --raw`、`connect --id <UUID>`、`exec --id <UUID> --run-as ExistingLogin --command <固定命令> --raw`、`stop --id <UUID> --raw`。不猜测 create/run/status 子命令。
- 产品 CLI 只接受 `preflight`、`run`；不接受任意路径、URL、脚本、命令、环境或既有 VM ID。`preflight` 只读，不创建目录/VM、不安装。`run` 每次生成全新 UUID；已有目录、reparse、版本不符或权限不足均失败，不修宿主环境。
- 宿主只新建 `D:/Code/babacom/.matrix-runtime/g1/windows-install/<UUID>/input` 与同级 `output`；该 UUID 目录必须此前不存在，所有父目录须无 symlink/junction/reparse。`input` 仅含固定安装包的完整副本、当前 `guest.ps1` 副本与生成的 `element-config.json`。复制后完整核对安装包哈希及路径身份，映射前后检查未改变；原安装包只读保留。
- `input` 只读映射为 `C:\G1Input`；唯一可写宿主映射为本轮新建、初始为空的 `output` → `C:\G1Output`。不映射仓库、父目录、宿主用户目录、秘密或历史材料。不覆盖已有输出；本轮结果只追加 JSON/PNG，保留失败证据，不删除原件或旧实验目录。
- WSB XML 固定 `Networking`、`AudioInput`、`VideoInput`、`ClipboardRedirection`、`PrinterRedirection`、`vGPU` 为 `Disable`，`ProtectedClient` 为 `Enable`。没有 AudioOutput 的已核实 XML 开关，不声称禁用了系统声输出。无端口、账户、RTC、设备采集或连接 homeserver；不启动既有 WSL。
- 不安装宿主软件，不启用功能、不改宿主执行策略/注册表/防火墙/证书，不请求 Windows UAC 或重启。宿主辅助 PowerShell 用 `-NoProfile`；仅 guest 的固定 PowerShell 进程可用 `-ExecutionPolicy Bypass`，不改持久策略。除持有准入管道、签名/路径检查和官方 CLI 外，不运行其他宿主辅助命令。

## 归属、期限与失败

- 复用 [D14/T2-V2](../../docs/T2-spec.md) 的同机跨进程/工作区固定准入端点 `\\.\pipe\babacom-sandbox-admission-v1`，与旧 runner 互斥，不另设 Matrix 专用锁。使用 Windows 首实例排他语义；取得准入先于核验、目录创建及任何 Sandbox CLI，占用立即 `FAIL/ADMISSION/BUSY`、`cleanup=NOT_OWNED`，零 CLI 调用，不等待、连接既有端点或重试。
- 准入保持到归属处理和清理结束，在 finally 中有界释放；释放失败阻止 PASS，另记 admissionCleanup，保留既有主错误。先纳入释放结果，再以 create-new/`wx` 写唯一最终摘要，不能先落盘 PASS。异常退出由 OS 释放管道，不建持久服务/锁文件。必须由不同工作目录的两个真实进程验证排他、正常释放及异常退出后可重新取得，含一个旧 runner 契约端点持有者与新 runner 的争用。
- 创建前记录已有 Sandbox ID，生成的新 UUID 必须不在其中。只有 `start` 成功、原生响应 ID 与请求 UUID 相符，**且创建后成功 list 包含该 ID**，才确认归属；不能仅凭 list 补办失败创建的归属证明。确认后才 connect、exec、stop，不操作已有或他人新建实例。确认查询失败/超时/取消、无效响应或缺 ID 均归属 UNKNOWN，禁止后续操作。
- 创建请求发出后若失败、超时、响应格式错误或归属未确认：保留原始错误码，报告 `cleanup=UNKNOWN`，禁止停止猜测的实例。已确认归属的 VM 即使应用失败也应在 finally 中停止，但不得将强制拆除 VM 算作应用正常退出。
- 从 run 开始使用同一绝对截止时间 **360 秒**，最后 **30 秒**保留给已归属 VM 的 stop/消失确认及准入释放。原产物核验仍保留其 60 秒总预算、签名 30 秒预算；其他单次 CLI/宿主辅助进程最多 15 秒并受剩余总预算约束。connect 可保留交互连接进程，须跟踪其错误并在退出时关闭本轮连接，不误停其他连接。本票只复用 D14 的准入/归属语义；新安装阶段预算不修改旧 T2 runner 的 180 秒整轮、120 秒 guest、15 秒清理或既有断言。
- exec 在连接的登录会话中启动固定 guest 脚本，后台辅助窗口隐藏；CLI 的 exit 0 只是请求已执行，不能代替 guest 结果。guest 安装收敛最多 120 秒、欢迎页最多 60 秒、正常 Quit 最多 15 秒，均不重置外层截止时间。结果缺失/无效、连接断开、阶段超时或版本漂移均非零退出，保留已完成阶段及原始错误并脱敏，不重试安装、不自动降级隔离。

## Guest 安装与可观察结果

- 只在全新 Sandbox 安装。确认 Windows x64、无独立 Node/npm 开发环境；嵌入 Electron 的 Node 不混作开发工具。安装前预置 `%APPDATA%\Element\config.json` 与 `C:\G1Profile\config.json` 为下述相同配置；该 VM 的默认 Element profile 仅供安装 hooks/可能早启，最终受控启动只用 `C:\G1Profile`。
- 通过固定 `--silent` 启动安装器，不依赖未经核实的 `--no-launch`。[Squirrel 2.0.1 安装 hooks](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Squirrel/UpdateManager.ApplyReleases.cs#L401-L446) 与 [引导器](https://github.com/Squirrel/Squirrel.Windows/blob/2.0.1/src/Setup/winmain.cpp#L111-L125) 表明可能早启、经 Explorer 重启并丢失环境变量；Element 所用补丁工具集的字节对应尚未证明。安全边界依靠禁网与 VM 内预置配置，不以环境继承或引导器 exit 0 作证明。不得请求额外提权；意外 UAC/安装交互则失败并清理自有 VM。
- 只允许 guest 的 `%LOCALAPPDATA%\element-desktop` 安装、上述两个 profile，以及 installer 正常创建的 guest 快捷方式/卸载记录/协议关联；全部随自有 VM 销毁。安装返回及路径/版本实际收敛均须满足，禁止读或改宿主 profile。
- 若安装期出现本轮 Element UI，先核实进程路径/创建时间/归属，通过其实际 File→Quit/Exit 关闭，并确认安装期 Element/Update 进程退出；不能带着早启实例直接进入下一步。无法正常退出则本次失败，不把杀进程当通过。
- 受控启动直接执行 `%LOCALAPPDATA%\element-desktop\app-1.12.30\Element.exe --no-update --profile-dir C:\G1Profile --config C:\G1Input\element-config.json`。环境变量 `ELEMENT_DESKTOP_CONFIG_JSON` 若设置，其值也是 JSON 文件路径。不得使用 `--no-sandbox`、关闭 web security、远程调试端口或自动更新。
- 核对实际安装的 `Element.exe` ProductVersion（允许规范化 `1.12.30.0`）及本轮 HKCU 卸载记录 DisplayVersion=`1.12.30`。不采用 installer/Squirrel FileVersionInfo 证明应用版本；退出后再次核对安装版本未漂移。
- 在连接的 guest 交互会话用 Windows UI Automation 核实自有主窗口及真实欢迎页控件，保存该自有窗口 PNG 和脱敏控件摘要；进程/window 存在或源码中的 `.mx_Welcome` 本身不能替代 UI 观察。无可读 UIA 控件、黑屏、错误页或离线欢迎页打不开则失败，不补称 PASS。
- 使用真实 File 菜单的 Quit/Exit 动作退出受控应用，记录主进程正常 exit 0，并核对本轮 Element/Update 进程全部消失。CloseMainWindow/Alt+F4、退托盘或 VM stop 均不足以证明正常退出。

固定配置是一个平铺 JSON，供 desktop 与 web 共用；配置文件路径、profile 参数和默认路径依据 [固定 args.ts](https://github.com/element-hq/element-web/blob/f19cfd9030429240a4209bf5175b372175cf0464/apps/desktop/src/args.ts#L93-L161)、[config.ts](https://github.com/element-hq/element-web/blob/f19cfd9030429240a4209bf5175b372175cf0464/apps/desktop/src/config.ts#L23-L83) 与 [desktop README](https://github.com/element-hq/element-web/blob/f19cfd9030429240a4209bf5175b372175cf0464/apps/desktop/README.md#L124-L137)。本轮没有监听 18008，loopback 地址只防止选中公共服务器：

```json
{
  "update_base_url": "",
  "default_server_config": {"m.homeserver": {"base_url": "http://127.0.0.1:18008"}},
  "disable_custom_urls": true,
  "disable_guests": true,
  "enable_client_well_known_lookups": false,
  "integrations_ui_url": null,
  "integrations_rest_url": null,
  "integrations_widgets_urls": null,
  "room_directory": {"servers": []},
  "bug_report_endpoint_url": "local",
  "sentry": {},
  "posthog": {}
}
```

关窗与退出区别见 [window-close.ts](https://github.com/element-hq/element-web/blob/f19cfd9030429240a4209bf5175b372175cf0464/apps/desktop/src/window-close.ts#L18-L35) 和 [File 菜单](https://github.com/element-hq/element-web/blob/f19cfd9030429240a4209bf5175b372175cf0464/apps/desktop/src/vectormenu.ts#L231-L245)。WSB 边界依据 [Microsoft CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli) 与 [WSB XML](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)。这些源事实不替代当前包的真实运行验证。

## Validation

下列 runtime/guest 脚本为**后续实施接口，当前尚不存在，运行 NOT_RUN**。cwd 为 BabaCom 仓库根；宿主 Node >=22.12；guest 无需开发工具。

```powershell
node --test infra/staging/matrix-windows-proof/runtime.test.mjs
node infra/staging/matrix-windows-proof/runtime.mjs preflight
node infra/staging/matrix-windows-proof/runtime.mjs run
node .agents/scope_guard.mjs matrix-windows-install --files infra/staging/matrix-windows-proof/runtime.mjs infra/staging/matrix-windows-proof/runtime.test.mjs infra/staging/matrix-windows-proof/guest.ps1
git diff --check
```

自测只使用本轮自有临时小文件、注入 CLI/时钟和合成结果，不运行真实 installer/VM、不读取凭据；清理仅这些测试临时文件。断言覆盖固定输入/配置/映射、reparse/复制哈希、上述新旧契约端点真实双进程 BUSY、释放失败阻止 PASS、先实际创建再报错/确认查询失败/超时/取消的 UNKNOWN 与零后续操作、错误或冲突 ID/响应、其他实例保留、全部阶段超时/取消、错误脱敏、错误版本/欢迎页缺失/退托盘不退出必失败，以及归属后失败仍清理。

真实 run 只有以下全部满足才 exit 0：核验与副本哈希通过；新 VM 内实际安装双版本证据匹配；受控欢迎页 UIA/PNG 已观察；真实 Quit 正常 exit 0 且无本轮残留应用；自有 VM 停止并从清单消失，已有及他人实例均未操作；只读输入未变、准入成功释放、最终摘要已唯一落盘、本轮输出保留。其他情况必须非零并分阶段报告 `PASS/FAIL/UNKNOWN/NOT_RUN` 与 cleanup 状态，不能降低断言或期限让其变绿。

## 完成边界

- [ ] 独立范围 PR 审查、Jack 签认并合并；后续实施只改上述三文件。
- [ ] 自测、preflight、一次真实隔离 install/start/Quit/stop、scope/diff 检查完成，并如实报告失败和未验证项；独立 Spec/Standards 审查无实质阻断。
- [ ] 安装包/既有实验/秘密/其他 worktree 保留；不把 Sandbox 结论写成双实机、媒体设备、构建或许可结论。

G1、#63/#64 仍打开。本票不交付客户端 fork/源码构建/完整许可证清单，不启 RTC/网络/真实账号/采集；双实际 Windows 游戏声音与独立麦克风/物理释放、G4 中德与负载、G5 两周稳定与切换、G6 逐文件退役继续独立验收。需要额外文件、依赖、主机权限或隔离降级时停止并说明，不临时绕过。

# matrix-windows-proof — G1-P1 Windows 产物只读核验

范围票 [#105](https://github.com/wenhuorongbing-netizen/babacom/issues/105)；实施票 [#106](https://github.com/wenhuorongbing-netizen/babacom/issues/106)，仅为 M04/M05 的子交付。
状态：**PROPOSED；独立 docs PR 审查、Jack 签认及合并后生效**。2026-10-14 Jack 已授权推进 G1 并使用子代理；这不是对尚未审阅的新运行边界的追认。
DRI：Codex Builder；Reviewer：与 Builder 不同的代理；本 fork 最终签认者：Jack。

## 目标与精确边界

把已手动核验的官方安装器变为可重复的只读检查；本票不安装或启动 Element，不建立新的客户端 fork。

<!-- allowed-files:start -->
infra/staging/matrix-windows-proof/artifact.mjs
infra/staging/matrix-windows-proof/artifact.test.mjs
<!-- allowed-files:end -->

只允许上述两个新文件。使用 Node 内置模块及现有 Windows PowerShell `Get-AuthenticodeSignature`；不新增 npm/Python 依赖，不改旧代码、测试、构建或锁文件。`infra/AGENTS.md` 继续适用；本票不运行媒体服务。

## 固定输入与来源

| 项目 | 固定值 / 证据 |
|---|---|
| 上游 | Element Web/Desktop v1.12.30；源码 `f19cfd9030429240a4209bf5175b372175cf0464`；顶层 SDK 43.0.0 / embedded Call 0.26.0 保持原锁定，不手动 dedupe Call 的传递依赖 |
| 官方来源 | [Windows 安装器](https://packages.element.io/desktop/install/win32/x64/Element%20Setup%201.12.30.exe)；[同 HEAD 的官方发布工作流](https://github.com/element-hq/element-web/actions/runs/36573707260) 的 x64 build/test/deploy 成功 |
| 唯一输入文件 | `D:/Code/babacom/.matrix-runtime/g1/windows/Element Setup 1.12.30.exe`；仅此公开二进制，不读取秘密、真实账号、profile 或其他文件 |
| 大小 / 实测 SHA-256 | `208730288` 字节；`b9ac9617acfa667eb5470e67e5db744d3b595b35c285100a53ad17719f7cc6d3` |
| Windows 签名 | `Status=Valid`；签名者 CN/O 为 `ELEMENT CREATIONS LIMITED`；证书 thumbprint `0166C56D35C7F22F78D870D0C1BCF729F2CAA3E9`；issuer 为 SSL.com EV Code Signing Intermediate CA RSA R3 |
| 时间戳 | DigiCert SHA256 RSA4096 Timestamp Responder 2026 1；thumbprint `51D9ABDA034973D84F4266ACA48248E6B369C439`，不可缺失 |

以上大小、哈希、签名在 2026-10-14 由本机实测。上游安装器 SHA-256 未找到，不能称为“与上游公布摘要一致”；ETag 不是 SHA-256，当前 RELEASES 的 1.12.31 NUPKG SHA-1 不能替代。官方工作流是来源关联证据，不证明本机可重复构建或字节级源码对应。Squirrel 引导器 FileVersionInfo 不作为应用版本证明。

## 实施约定与停止条件

- CLI 只接受 `verify`；输入路径和基线固定，不接受 URL、任意脚本、任意文件或下载/安装参数。实现不发网络请求、写产物、解包、启动安装器/应用、创建 profile、自动更新或采集设备。
- 实查输入及父目录无 symlink/junction/reparse、输入为普通文件；检查大小和完整 SHA-256，随后读取 Windows Authenticode。异常、缺失或错误签名/发布者/证书/时间戳均非零退出；不得仅打印警告后继续。
- Windows 签名命令自身可能使用系统信任验证；不禁用证书校验或扩大浏览器/防火墙权限，不把此原生检查称为完全离线。
- 签名子进程总预算 30 秒，验证总预算 60 秒；失败/超时保留原始错误并脱敏输出。只有签名读取命令可以作为子进程，绝不执行被检查的 EXE。
- 输入在读取期间被替换/修改应失败；至少以打开文件句柄读取哈希，并在签名检查后重新检查文件及全部父目录无 symlink/junction/reparse，再核对同一路径文件身份、元数据与完整哈希。父目录在检查期间变成 junction，即使仍指向相同文件也须失败。成功后报告固定来源、字节数、实测哈希、签名与时间戳；不报告不存在的安装/音频结果。
- 测试仅在本轮自有系统临时目录创建小型合成文件，执行后清理这些测试临时文件；不复制真实安装器，不操作历史 evidence/artifacts，不读取凭据。测试传入的假签名/短文件仅供导出的纯验证边界，生产 CLI 不提供绕过参数。
- 来源/摘要/证书不匹配、文件归属或隔离未知、需额外路径/依赖/安装权限时停止，不自动替换版本、下载或清理原文件。

## Validation

下列是 #106 待交付的接口，当前脚本尚不存在；cwd 为 BabaCom 仓库根，Windows + Node >=22.12，当前本机 Node 24.13.0。

```powershell
node --test infra/staging/matrix-windows-proof/artifact.test.mjs
node infra/staging/matrix-windows-proof/artifact.mjs verify
node .agents/scope_guard.mjs matrix-windows-proof --files infra/staging/matrix-windows-proof/artifact.mjs infra/staging/matrix-windows-proof/artifact.test.mjs
git diff --check
```

通过条件：自测与真实文件 verify 均 exit 0，输出匹配上述实测基线；wrong path/length/hash、截断、文件替换、父目录晚变 junction、签名缺失/无效、错误签名者/证书/时间戳、子进程失败/超时均有会失败的断言；原文件核验前后相同，scope/diff 检查通过，独立 Spec/Standards 审查无实质阻断。

## 完成边界

- [ ] 独立范围 PR 审查签认合并，实施仅上述两文件。
- [ ] 验证器自测与本机真实安装器核验通过，所有失败出口保持非零；无安装/启动/采集等副作用。
- [ ] 真实结果、未验证项及许可限制进入实施 PR；不能把发布工作流、签名或哈希核验当作许可清单或源码分发义务已完成。
- [ ] M04/M05/G1 父票保持打开；后续独立 checkout/构建、干净 Windows 安装启动、RTC、双实机音频及物理释放各走下一批精确范围。

G1 通过前保持默认上游 UI；本票不批准 MatrixRTC 新依赖/运行节点、TLS/DNS/端口、真实账号或媒体采集。以后启动固定桌面包还须审查独占 profile、本地配置和 `--no-update`，不能让官方默认更新把 1.12.30 换成新版本。

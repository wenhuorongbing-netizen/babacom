# REPO_MAP — 一页仓库地图

> 先读地图，再按任务定位；不要扫全库。
> 实时状态见 [GitHub Issues](https://github.com/wenhuorongbing-netizen/babacom/issues) 和 [里程碑](https://github.com/wenhuorongbing-netizen/babacom/milestones)。

## 原型与验证入口

Matrix 客户端开发见 [Element fork 的 `babacom/main`](https://github.com/wenhuorongbing-netizen/babacom-element-web/tree/babacom/main)。

| 路径 | 职责 |
|---|---|
| `apps/desktop/src/main/` | 主窗口、受限 IPC、准入凭据与独立媒体上下文 |
| `apps/desktop/src/shell/AdmissionPage.tsx` | 准入页面组合 |
| `apps/desktop/src/features/voice/`、`src/features/audio/` | 房间、麦克风与播放状态；feature 不互相 import |
| `apps/desktop/src/i18n/`、`src/styles/tokens.css` | 中文文案与设计令牌 |
| `apps/desktop/scripts/build.mjs` | 类型检查、lint、构建、打包与桌面测试入口 |
| `apps/desktop/scripts/dev.mjs` | 旧开发/测试启动与 Sandbox 验收入口 |
| `apps/api/app/` | 认证主体、房间授权、准入路由、签发与限流；普通入口无 provider 拒绝启动 |
| `packages/contracts/`、`packages/ui/` | 共享 schema 与 UI 原语 |
| `tests/shell/`、`tests/voice/`、`tests/audio/` | 真实 Electron 旅程、SFU/合成 peer 与生命周期回归 |
| `tests/accounts/`、`tests/permissions/`、`tests/tokens/`、`tests/ratelimit/` | HTTP/会话/权限/限流测试 |
| `.agents/modules/`、`.github/`、`.claude/` | 文件边界、检查器、CODEOWNERS、CI 与共享 harness |
| `infra/AGENTS.md` | 基础设施规则；存在规划不代表已部署 |
| `infra/staging/matrix-proof/` | 隔离 Matrix 控制面 proof |
| `infra/staging/matrix-windows-proof/` | Windows 安装包只读核验、隔离安装/启动/退出与 Sandbox 回归 |
| [历史档案](docs/archive/README.md) | 原始范围、团队规划、决策依据、协作记录与旧调研 |

## 按任务阅读

| 任务 | 入口 |
|---|---|
| 开工与改动边界 | [AGENTS.md](AGENTS.md) → 对应目录 AGENTS → `.agents/modules/<id>.md` |
| Matrix迁移主线 | [PRD](docs/PRD-matrix-migration.md) → [规格](docs/Matrix-migration-spec.md) → [Backlog](docs/Matrix-migration-backlog.md)；实时 AC/范围/状态归 GitHub Issue |
| 协议选版/学习 | [固定栈研究](docs/Matrix-protocol-research.md)、[Digo 学习索引](Source/README.md)；按需读取，学习笔记不作部署合同 |
| T1 桌面与准入 | [T1 规格](docs/T1-spec.md)、[t1 清单](.agents/modules/t1.md) |
| T2 语音与采集 | [T2 规格](docs/T2-spec.md)、[t2 清单](.agents/modules/t2.md) |
| 启动/清理自动化 | [自动化规格](docs/testing-automation-spec.md)；实施票另列精确子集 |
| 设备验收与测试方法 | [发布检查表](docs/RELEASE-CHECKLIST.md)、[历史 T2-03 研究](docs/archive/T2-03-acceptance-research.md) |
| 决策与签认出处 | [决策](docs/DECISIONS.md)、[历史记录](docs/archive/04-open-decisions.md) |
| 长期范围/阶段 | [范围](docs/01-scope-v2.md)、[平台标准](docs/02-platform-nfr.md) |
| 多人工作与守卫维护 | [协作指南](CONTRIBUTING.md) |
| GitHub 操作 | [Issue tracker](docs/agents/issue-tracker.md)；只操作本 fork |

## 不要读或清理的地方

- 不遍历 `node_modules/`、`.venv/`、构建二进制和缓存来理解源代码。
- `apps/desktop/build/` 含历史 Sandbox 验收目录、失败材料和当前 Windows 包，
  **不是整目录垃圾**。证据只读 README/summary 与必要元数据，不读原始大日志；历史证据不删不改。
- 不扫描 `.git/`、会话记录、个人凭据或其他任务的 worktree。
- `.gitignore` 只定义版本控制忽略，不授予删除权限。临时生成副本须逐项验证用途、归属和恢复副本。

## 验证与红线

桌面命令在 [package.json](apps/desktop/package.json)，API 环境在
[pyproject.toml](apps/api/pyproject.toml)。各票执行对应模块 Validation；文档票使用：

```powershell
node .agents/scope_guard.mjs docs --files <本票精确文件>
git diff --check
```

不得直接改 main；一次一 Issue、一模块。`apps/api/migrations/` 不得直接改，迁移写 `_proposed/`。
公共接口变化同步契约；正常 T1 测试仅按已合并的狭窄例外修改。自动化、打包启动、
合成媒体、真人听音和跨境证据分别判断；CI 结论只覆盖实际运行的检查。

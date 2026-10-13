# Babacom — private gaming community / Matrix migration

An invite-only, self-hosted desktop voice project for a small private group
split between mainland China and Europe. The repository contains an Electron
client, a FastAPI admission service, shared contracts and automated tests.
Video, screen sharing and the wider release plan remain separate work.

The problem it solves: Discord is blocked in mainland China, and the available
alternatives either charge for video streaming or require every user to upload
government ID. The intended deployment uses two rented servers, with no ID
collection and no per-seat fees; that deployment is not accepted by the local
prototype tests.

## Matrix migration planning

As of 2026-10-13, the user has authorized a comprehensive migration plan to
standard Matrix. The current code is still the custom prototype described
below; Element/Synapse adoption is conditional on Windows game audio, security,
recovery, maintenance and real-network evidence.

- [Migration PRD](docs/PRD-matrix-migration.md): product outcomes and debt retirement.
- [Migration specification](docs/Matrix-migration-spec.md): architecture, contracts, tests, data and gates.
- [Migration backlog](docs/Matrix-migration-backlog.md): 9 Epics, 36 DRAFT tickets, dependencies and legacy issue mapping.
- [Planning issue #50](https://github.com/wenhuorongbing-netizen/babacom/issues/50): this documentation scope only.

Planning does not approve production deployment, delete old code or establish
product acceptance. The original PO's current review is pending because its
Edge connection could not attach; independent review is recorded separately.

## Implementation and acceptance

At the current `c9ec3cf` baseline, T1 desktop admission and T2-01/02 voice/admission
code are merged. T2-03 microphone and exit code is also merged in
[PR25](https://github.com/wenhuorongbing-netizen/babacom/pull/25), while
[#18](https://github.com/wenhuorongbing-netizen/babacom/issues/18) remains open
for real two-device listening, physical device release and China–Germany
acceptance. These are not established by synthetic media or Sandbox tests.

Startup/Sandbox/test-fixture PR34 → PR35 → PR37 → PR38 and the later PR45 are
merged. PR49 merged the first familiar community UI shell. Those merges do not
settles the remaining #31/#40/#41/#42 acceptance and maintenance decisions.
Passing scope/secrets CI is not product acceptance. Migration replaces the old
implementation order; signed T1/T2 contracts still govern any active old path.

| Entry | Purpose |
|---|---|
| [`apps/desktop/package.json`](apps/desktop/package.json) | Desktop development, build, Windows package and test commands |
| [`apps/api/pyproject.toml`](apps/api/pyproject.toml) | Python environment and admission API tests |
| [`docs/T1-spec.md`](docs/T1-spec.md) | Signed desktop/admission contract |
| [`docs/T2-spec.md`](docs/T2-spec.md) | Signed voice/media contract and acceptance boundaries |
| [`docs/testing-automation-spec.md`](docs/testing-automation-spec.md) | Startup/cleanup automation contract |
| [`REPO_MAP.md`](REPO_MAP.md) | Source, test and governance navigation |

## Local checks

Use Node >=22.12.0 and Python >=3.12,<3.14. From the repository root:

```powershell
npm ci
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
```

From `apps/api`, use `uv sync`, then `uv run python -m pytest ../../tests -q`.
Desktop journeys use `npm run test --workspace apps/desktop` (development) and
`npm run test:e2e --workspace apps/desktop` (packaged); media/Sandbox prerequisites
and the evidence required for completion are defined in the relevant specs.
The ordinary API requires approved authentication/authorization providers;
isolated test fixtures are not a production login or deployment configuration.

## Documents

| File | What it covers |
|---|---|
| [`scope.html`](scope.html) | Every feature selected, everything ruled out, and a three-release build order |
| [`teams.html`](teams.html) | The scope cut into 24 independently-ownable modules across eight domains, plus the shared contracts that must be frozen before parallel work starts |

### Engineering review (`docs/`, 中文)

对上面两份文档的工程可行性评审与修订。`scope.html` 与 `teams.html` 描述**打算做什么**，
`docs/` 描述**在这个团队规模下实际能做成什么**，以及两者的差距。

| File | What it covers |
|---|---|
| [`docs/00-review-plan01.md`](docs/00-review-plan01.md) | 12 条冲突与缺口，每条附建议裁决 —— **先读这份** |
| [`docs/01-scope-v2.md`](docs/01-scope-v2.md) | 修订后的范围与五阶段发布顺序（新增独立的「稳定 Alpha」阶段） |
| [`docs/02-platform-nfr.md`](docs/02-platform-nfr.md) | 平台能力矩阵、验收负载、非功能需求 |
| [`docs/03-cost-model.md`](docs/03-cost-model.md) | 成本模型 —— 补上 `scope.html` 承诺但未给出的部分 |
| [`docs/04-open-decisions.md`](docs/04-open-decisions.md) | 12 项待决，含 owner 与阻塞关系 |
| [`docs/05-collaboration.md`](docs/05-collaboration.md) | 分支、PR、Issue、角色与契约所有权 |
| [`docs/06-agent-harness.md`](docs/06-agent-harness.md) | 多人 + 多 Agent 开发：harness 为什么必须提交而不是 gitignore |
| [`docs/07-proposal.md`](docs/07-proposal.md) | 方案总览：解决了哪些问题 + 多人多 AI 怎么协作 —— **给团队看的一份** |
| [`REPO_MAP.md`](REPO_MAP.md) | 一页纸仓库地图 —— **agent 读地图，不扫全库** |
| [`AGENTS.md`](AGENTS.md) | AI Agent 的工作边界与 PR 要求 |

三条最重要的结论：**Windows-first 而非 web-only**；**回声消除必须从「排除」移回「必选」**；
**Release 01 与 02 之间必须插入一个不许塞新功能的稳定性阶段**。

`scope.html` and `teams.html` are self-contained single files — no build step, no dependencies. Open
them directly in a browser, or serve the folder with any static file server.

## Design constraints behind these documents

The original planning used three network hypotheses. They remain historical
inputs requiring current primary-source research and deployment measurements;
the loss percentages below are not universal guarantees or acceptance results:

1. **The Great Firewall is not the main obstacle.** It does not blanket-throttle
   UDP. Nearly all China-to-overseas packet loss is ordinary carrier congestion
   on the international backbone, worst between 20:00 and 23:00 China time.
2. **No WebRTC media server implements working video forward error correction.**
   Above roughly 6% sustained packet loss, video degrades no matter what the
   software does. Network path quality is therefore the load-bearing decision,
   not a tuning detail.
3. **Audio is recoverable where video is not.** Opus with redundancy and inband
   FEC holds up to roughly 15-22% loss, so the design is audio-first with video
   as an explicit opt-in.

The resulting shape is two servers — one in East Asia on a China-optimised
route, one in Europe — with each room pinned to a region and the region shown
in the interface.

## Publishing

These render as a static site. To serve them on GitHub Pages:
Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
`index.html` links both documents.

## Status

Implemented custom local prototype with independent acceptance still open.
The Matrix PRD/spec/backlog govern migration planning; signed T1/T2 still govern
active old code until explicitly superseded. HTML scope/team pages are historical
requirements inputs. Do not infer R01, M0, Alpha, Matrix adoption or cross-border
readiness from merged code or a published migration plan.

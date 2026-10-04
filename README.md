# Babacom — planning documents

Design and scope documents for a self-hosted, Discord-style voice, video and
screen-sharing app for a small private group split between mainland China and
Europe.

The problem it solves: Discord is blocked in mainland China, and the available
alternatives either charge for video streaming or require every user to upload
government ID. This is an invite-only replacement, self-hosted on two rented
servers, with no ID collection and no per-seat fees.

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

The architecture is shaped by three findings from measurement and research:

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

Planning only. No application code in this repository yet.

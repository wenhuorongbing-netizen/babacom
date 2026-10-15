# BabaCom — private gaming community

A desktop voice project for a small private gaming group in mainland China and Europe.
This fork contains an Electron client, FastAPI admission service, shared contracts and tests.
The current product remains the custom prototype. Matrix migration progress and its limits are recorded in the [current acceptance boundary](#current-acceptance-boundary).

## Start here

- [Source map](REPO_MAP.md): code, tests and areas to avoid scanning.
- [Contributor rules](AGENTS.md) → [team workflow](docs/05-collaboration.md) → the Issue's module manifest.
- [Matrix PRD](docs/PRD-matrix-migration.md): product outcomes.
- [Migration specification](docs/Matrix-migration-spec.md): architecture, contracts and acceptance gates.
- [Backlog index](docs/Matrix-migration-backlog.md): Epics, sprint order and links; live AC and status belong to GitHub Issues.
- [Fixed-stack research](docs/Matrix-protocol-research.md) and [DigoYu's protocol notes](Source/README.md): read relevant sections as needed.
- [Decisions](docs/04-open-decisions.md): signoffs, review scope and remaining conditions.

## Current acceptance boundary

The isolated Matrix control-plane proof was merged in [PR104](https://github.com/wenhuorongbing-netizen/babacom/pull/104).
For G1-P2, the coordinator reports a passing local Sandbox install/start/File→Quit/VM-cleanup run at
[PR112](https://github.com/wenhuorongbing-netizen/babacom/pull/112) head `754dd483`; that PR remains draft and unmerged.
This document review did not rerun that acceptance. Full G1, product cutover, Matrix migration and release acceptance remain incomplete.
Evidence provenance, the actual PO/CEO review and the next small improvements are recorded in [the decisions](docs/04-open-decisions.md#matrix-quality-review-2026-10-15).

T1 admission, T2 voice code and the first community UI shell are merged.
[#18](https://github.com/wenhuorongbing-netizen/babacom/issues/18) still requires real two-device listening,
physical release and China–Germany acceptance. Scope/secrets CI and synthetic media do not establish them.
The seven legacy issues and #41's preserved local work are tracked in the Backlog.
Signed [T1](docs/T1-spec.md), [T2](docs/T2-spec.md) and [automation](docs/testing-automation-spec.md)
contracts still govern active old paths. Candidate Element/Synapse compatibility, game audio,
E2EE recovery and production cutover require their own evidence and approvals.

## Local prototype checks

Use Node >=22.12.0 and Python >=3.12,<3.14. From the repository root:

~~~powershell
npm ci
npm run typecheck --workspace apps/desktop
npm run lint --workspace apps/desktop
npm run build --workspace apps/desktop
npm run package:win --workspace apps/desktop
~~~

From apps/api: uv sync, then uv run python -m pytest ../../tests -q.
Desktop development journeys use npm run test --workspace apps/desktop; packaged journeys use
npm run test:e2e --workspace apps/desktop. Prerequisites and evidence levels are in the relevant specs.
The ordinary API refuses startup without approved authentication/authorization providers;
isolated fixtures do not configure production access. New upstream clients use their own fixed-version scripts.

## Reference and provenance

[Scope](docs/01-scope-v2.md), [platform NFR](docs/02-platform-nfr.md) and [cost model](docs/03-cost-model.md)
retain product requirements and numeric acceptance baselines.
The original scope.html, teams.html and [engineering review](docs/00-review-plan01.md) remain historical inputs;
their estimates and network hypotheses are not measured deployment results.

DigoYu's [c7a29ea7](https://github.com/DigoYu/babacom/commit/c7a29ea7fcc629f94aa75190e000c971ea1e5c61)
contribution is retained with original history: Source/ plus the [dated comparison](matrix-vs-custom-comparison.md).
Our implementation notes annotate applicability; they do not replace the author's research.
No project LICENSE has been selected here. Public visibility is not a claim of unrestricted redistribution rights.

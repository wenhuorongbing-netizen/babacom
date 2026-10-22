# BabaCom — private gaming community

A desktop voice project for a small private gaming group in mainland China and Europe.
This fork contains an Electron client, FastAPI admission service, shared contracts and tests.
The current product remains the custom prototype. Matrix migration progress and its limits are recorded in the [current acceptance boundary](#current-acceptance-boundary).

## Start here

- Development: [source map](REPO_MAP.md) → [contributor rules](AGENTS.md) → [team workflow](docs/05-collaboration.md) and the Issue's module manifest.
- Migration: [PRD](docs/PRD-matrix-migration.md) → [specification](docs/Matrix-migration-spec.md) → [backlog index](docs/Matrix-migration-backlog.md). Live acceptance criteria and status belong to GitHub Issues.
- Signoffs and evidence provenance: [decisions](docs/04-open-decisions.md).

## Current acceptance boundary

The isolated Matrix control-plane proof ([PR104](https://github.com/wenhuorongbing-netizen/babacom/pull/104)),
Windows Sandbox install/start/File→Quit/VM-cleanup scripts ([PR112](https://github.com/wenhuorongbing-netizen/babacom/pull/112))
and Windows regression CI ([PR117](https://github.com/wenhuorongbing-netizen/babacom/pull/117)) are merged.
The reported local G1-P2 run and its review are recorded in [the decisions](docs/04-open-decisions.md#matrix-quality-review-2026-10-15);
this documentation change did not rerun it. Full G1, product cutover, Matrix migration and release acceptance remain incomplete.

T1 admission, T2 voice code and the first community UI shell are merged.
[#18](https://github.com/wenhuorongbing-netizen/babacom/issues/18) still requires real two-device listening,
physical release and China–Germany acceptance. CI and synthetic media do not establish them.
The seven legacy issues and #41's preserved local work are tracked in the Backlog.
Signed [T1](docs/T1-spec.md), [T2](docs/T2-spec.md) and [automation](docs/testing-automation-spec.md)
contracts still govern active old paths. Candidate Element/Synapse compatibility, game audio,
E2EE recovery and production cutover require their own evidence and approvals.

The next delivery is a Matrix internal test build. Follow the [existing execution queue](docs/Matrix-migration-backlog.md#next-test-build) for its prerequisites and acceptance evidence.
The existing BabaCom-T1 package is the legacy prototype, not a Matrix build. No Matrix test release has been published.

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

[Fixed-stack research](docs/Matrix-protocol-research.md) and [DigoYu's protocol notes](Source/README.md)
are references to consult for the relevant task.
[Scope](docs/01-scope-v2.md), [platform NFR](docs/02-platform-nfr.md) and [cost model](docs/03-cost-model.md)
retain product requirements and numeric acceptance baselines.
The original scope.html, teams.html and [engineering review](docs/00-review-plan01.md) remain historical inputs;
their estimates and network hypotheses are not measured deployment results.

DigoYu's [c7a29ea7](https://github.com/DigoYu/babacom/commit/c7a29ea7fcc629f94aa75190e000c971ea1e5c61)
contribution is retained with original history: Source/ plus the [dated comparison](matrix-vs-custom-comparison.md).
Our implementation notes annotate applicability; they do not replace the author's research.
No project LICENSE has been selected here. Public visibility is not a claim of unrestricted redistribution rights.

# BabaCom — private gaming community

BabaCom is a desktop voice project for a private gaming group in mainland China and Europe. This repository keeps the legacy Electron/FastAPI prototype, proof harnesses, and product and migration requirements.
The Matrix client lives in the [Element fork, `babacom/main`](https://github.com/wenhuorongbing-netizen/babacom-element-web/tree/babacom/main).

## Start here

- [Repository map](REPO_MAP.md) for source, tests, and proof harnesses.
- [Contributor rules](AGENTS.md) and [contributing guide](CONTRIBUTING.md) for module boundaries and pull requests.
- [Migration PRD](docs/PRD-matrix-migration.md), [technical specification](docs/Matrix-migration-spec.md), and [issue index](docs/Matrix-migration-backlog.md) for requirements and dependencies.
- [Release checklist](docs/RELEASE-CHECKLIST.md) and [decisions](docs/DECISIONS.md) for release evidence and standing decisions.
- Follow [GitHub Issues](https://github.com/wenhuorongbing-netizen/babacom/issues) and [milestones](https://github.com/wenhuorongbing-netizen/babacom/milestones) for live migration and release status.

## Reference and provenance

[Fixed-stack research](docs/Matrix-protocol-research.md) and [DigoYu's protocol notes](Source/README.md) are references to consult for the relevant task.
[Scope](docs/01-scope-v2.md), [platform NFR](docs/02-platform-nfr.md) and [cost model](docs/03-cost-model.md) retain product requirements and numeric acceptance baselines.
The original [scope](docs/archive/scope.html), [team plan](docs/archive/teams.html) and [engineering review](docs/archive/00-review-plan01.md) remain historical inputs. Their estimates and network hypotheses are not measured deployment results.

DigoYu's [c7a29ea7](https://github.com/DigoYu/babacom/commit/c7a29ea7fcc629f94aa75190e000c971ea1e5c61) contribution is retained with original history in `Source/` and the [dated comparison](docs/archive/matrix-vs-custom-comparison.md).
Our implementation notes annotate applicability. They do not replace the author's research.
No project LICENSE has been selected here. Public visibility is not a claim of unrestricted redistribution rights.

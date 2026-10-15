# pi-nobash

Opt-in Pi package that takes general execution (bash) away from the agent and replaces it with
typed, bounded tools. See [`README.md`](./README.md) for the toolset.

Work is planned and tracked with the engineering skills (Matt Pocock's set); the live queue is
GitHub Issues. There is no roadmap/TODO document — the queue is the tracker and the history is
git.

## Agent skills

### Issue tracker

Work is planned and tracked as GitHub issues via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each label string equal to its role name
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

## Execution

- **Plan and track** with the engineering skills: `/wayfinder` (map a too-big effort as decision
  tickets), `/to-spec` + `/to-tickets` (spec and tracer-bullet tickets on the tracker),
  `/triage` (move issues through the five roles and write agent briefs), `/implement` and
  `/implement-spec` (execute, with `tdd` at the seams), `/code-review`, `/handoff`, `/retro`.
- **Or run the multi-agent orchestrator** for an effort that benefits from parallel work or an
  independent check. A run is configured by `.mypi/<task>/session.yaml` and launched with
  `mypi-run`, then `/mypi-multi-agent <task>`. It runs several peers in parallel in
  non-overlapping, single-writer roles and designates one **attester**: a read-only reviewer that
  independently re-verifies every Definition-of-Done criterion, whose verbatim verdict block
  gates the run's exit. Size the roster and budgets to the effort and keep the reviewer separate
  and cheap.

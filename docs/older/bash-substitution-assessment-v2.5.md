# Bash Tool Substitution Assessment (pi) — v2.5

**Status:** standalone architecture assessment and decision reference. Covers observed bash workloads, replacement capability design, performance-aware dispatch, three security layers, Pi integration, opt-in distribution, and implementation/validation plan.

**Date:** 2026-10-08

**Goal:** determine how far to reduce or remove model-facing `bash` from pi-based custom agents without materially degrading engineering capability; define how to preserve efficient search, JSON/JSONL analysis, git, testing, and other process-oriented workflows; and establish a layered safety model against accidental or malicious destructive commands.

---

## 1. Executive summary

The original usage data still supports the same high-level conclusion, but the preferred endpoint is now clearer:

> **Do not try to make arbitrary shell strings safe. Stop making arbitrary shell strings the normal model-facing interface.**

The target architecture should be:

1. **Built-in purpose-specific tools** for repository inspection (`read`, `grep`, `find`, `ls`) and editing (`edit`, `write`).
2. **Codemode** for bounded, ad-hoc glue logic and small/medium JSON transformations.
3. **Structured custom tools** for git, validation, model probes, static analysis, Herdr operations, filesystem lifecycle operations, rendering, and repeated structured-data analysis.
4. **A restricted execution escape hatch** only for operations that do not yet have a structured tool.
5. **OS/container/VM isolation** for execution agents even after raw bash is removed.

This is not an attempt to eliminate process execution. A useful engineering agent still needs compilers, test runners, formatters, linters, git, build systems, and project-specific tools.

The objective is narrower:

> **Eliminate LLM-controlled arbitrary process construction as the default capability.**

The original session data indicates that this is realistic:

- ~41% of bash usage was already replaceable with built-in read/search/navigation tools.
- ~32% maps cleanly to a small number of structured wrappers.
- ~26% was mostly throwaway Python used for JSON/JSONL analysis.
- actual filesystem `cp`/`mv`/`rm` usage was only ~0.7%.

A second principle should now be added:

> **The substitute must not merely be safer; it should also select the cheapest and fastest implementation appropriate to the task.**

Examples:

- fixed-string search → Pi `grep` with `literal: true` (ripgrep `--fixed-strings`), not regex search;
- regex search → Pi `grep` in regex mode;
- small JSON → direct parse in codemode is acceptable;
- large JSONL or repeated artifact queries → dedicated streaming `query_jsonl` / `json_query` tool;
- tests/typechecks → fixed validation capability, not arbitrary `bash`;
- git → structured operation + argv, never free-form command text.

---

## 2. Method and observed data

Counts come from the actual session transcripts used in the original assessment.

| Session | Source | Tool calls | bash | bash % |
|---|---|---:|---:|---:|
| **Peers** (`task-optimize-first`) | `task-optimize-first/tool-calls.jsonl` | 133 | 0 | **0%** |
| **Supervisor** (PM pi session) | pi session `.jsonl` | 146 | 87 | **59.6%** |
| **Review/authoring session** | pi session `.jsonl` | 550 | 324 | **58.9%** |
| Combined | | 829 | 411 | ~50% |

Two important facts:

- **Read-only peers used no bash.** Their toolset was `read` / `grep` / `ls` / `find` / `web_fetch`, demonstrating that substantial agent work can already happen without shell access.
- **Where bash was available, it became the default adapter.** Around 59% of calls in shell-enabled sessions used it.

This is behavioral evidence that model-facing bash usage is driven heavily by convenience and affordance, not by an unavoidable need for arbitrary shell execution.

---

## 3. What bash was actually used for

| # | Use | Count | Share |
|---:|---|---:|---:|
| 1 | **Python inline scripts** (mostly JSON processing) | 109 | 26.5% |
| 2 | **grep / rg** | 91 | 22.1% |
| 3 | **cat / sed / head / tail** | 72 | 17.5% |
| 4 | **test / typecheck** | 55 | 13.3% |
| 5 | **git** | 54 | 13.1% |
| 6 | **pi CLI** probes/checks | 15 | 3.6% |
| 7 | `ls` | 5 | 1.2% |
| 8 | filesystem (`cp` / `mv` / `rm`) | 3 | 0.7% |
| 9 | `fallow` | 3 | 0.7% |
| 10 | `herdr` | 2 | 0.5% |
| 11 | `qlmanage` / `sips` | 2 | 0.5% |
| 12 | other | 3 | 0.7% |

### Interpretation

The threat is not primarily that agents constantly want to delete files.

The larger architectural problem is that **bash has become the universal adapter for:**

- search;
- reading;
- parsing;
- aggregation;
- test execution;
- git;
- model checks;
- project tooling;
- occasional filesystem mutation.

Therefore a denylist centered on `rm -rf` treats the symptom rather than the cause.

---

## 4. Current pi capability relevant to this effort

As of this assessment, current pi exposes built-in tools including:

- `read`
- `bash`
- `powershell`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

`codemode` and `tool_search` can also be enabled through `defaultTools`.

Pi's current settings support additive/removal syntax such as:

```json
{
  "defaultTools": [
    "-bash",
    "+grep",
    "+find",
    "+ls",
    "+codemode"
  ]
}
```

A list containing only `+name` / `-name` entries modifies the inherited selection. CLI options can override tool selection for a run.

Pi also exposes extension-level tool interception and custom tool registration, including nested tool execution APIs. That makes it possible to:

- block direct bash calls;
- replace bash with structured tools;
- route nested tool calls through central policy;
- expose some tools directly and others only through codemode.

### Important boundary

Pi's tool-selection settings answer:

> **Which tools can the model call?**

They do **not** provide a native declarative setting for:

> **Which arbitrary shell command strings may bash execute?**

Command-level restriction therefore belongs in an extension/policy layer or, preferably, in replacement structured tools.

---

## 5. Performance-aware tool selection

Safety should not produce slower or more expensive agents. The tool surface should guide the model toward the cheapest correct primitive.

### 5.1 Search: fixed string before regex

The older `fgrep` command name should **not** be the target API. GNU grep treats `fgrep` as obsolete; the modern equivalent is:

```bash
grep -F
```

In pi, there is an even better path: the built-in `grep` tool already uses **ripgrep** and supports:

```json
{
  "pattern": "literal text",
  "literal": true
}
```

Pi translates `literal: true` to ripgrep's:

```text
--fixed-strings
```

Therefore the preferred search policy is:

| Need | Preferred operation |
|---|---|
| exact/fixed text | Pi `grep(..., literal: true)` |
| regex | Pi `grep(..., literal: false/default)` |
| filename discovery | `find` |
| directory inspection | `ls` |
| known file/range | `read` |

Agent guidance should explicitly say:

> Use `literal: true` whenever regex semantics are not required.

This avoids regex interpretation and makes intent unambiguous. Ripgrep also performs substantial literal optimization internally, so the goal is not to micro-manage every search algorithm but to express the correct search semantics.

### 5.2 Avoid unnecessary context reads

Pi's grep implementation streams ripgrep's JSON output, but when context lines are requested it may need to read matching files to reconstruct context.

Therefore:

- search first with zero/minimal context;
- use `read` on the relevant range after locating the hit;
- do not request broad grep context by default on large logs/files.

This also reduces model-context usage.

### 5.3 Prefer bounded output

Every search/query tool should expose:

- result limit;
- maximum bytes;
- optional field projection;
- optional time range;
- optional file/path restriction.

Returning 20 relevant records is better than returning 20,000 records and asking the LLM to filter them.

---

## 6. JSON and JSONL: fastest/most efficient strategy

The original data shows that the single largest bash category was inline Python, with most of it used to parse JSON or JSONL.

That does **not** mean the replacement should always be codemode.

### 6.1 Small or one-off JSON: codemode

For small/medium artifacts and one-off transformations:

```js
const raw = await tools.read({ path: "artifact.json" });
const data = JSON.parse(raw);
// filter / count / aggregate
text(JSON.stringify(result));
```

This is a good replacement for:

```bash
python3 -c 'import json; ...'
```

because the script does not inherently get filesystem, process, or shell access.

### 6.2 Do not use codemode for heavy computation by default

Pi's codemode documentation explicitly notes that QuickJS is an **interpreter** and heavy computation is slower than V8.

Therefore:

> **Codemode is the general-purpose glue layer, not the high-performance data engine.**

Use it when the work is modest and irregular.

Do not repeatedly load and parse a 100 MB JSONL file in model-written QuickJS just because it is safer than Python.

### 6.3 Large JSONL: stream it

For large line-oriented artifacts such as:

- `conversation.jsonl`
- `tool-calls.jsonl`
- pi session logs
- telemetry streams

prefer a custom structured tool such as:

```text
query_jsonl({
  path,
  where?,
  select?,
  groupBy?,
  count?,
  limit?,
  sort?,
  timeRange?
})
```

Implementation should:

1. open the file once;
2. stream line-by-line;
3. parse one JSON object at a time;
4. apply predicates immediately;
5. retain only the requested aggregate/results;
6. return bounded output.

This avoids:

- loading the whole file into memory;
- transferring the whole file into codemode;
- reparsing irrelevant records;
- emitting unnecessary data into LLM context.

### 6.4 Repeated queries: avoid repeated parsing

If the same large session artifact is queried repeatedly during a run, use one of:

- process-local cache keyed by path + mtime/size;
- precomputed summary/index;
- SQLite/DuckDB-style temporary index for sufficiently large/repeated workloads.

Do this only when measurements justify it.

The first implementation should normally be a streaming parser with bounded aggregation because it is simpler and already removes most waste.

### 6.5 JSON query hierarchy

Recommended dispatch:

```text
Need one known value from a small JSON file?
    -> read + codemode / dedicated config reader

Need one-off filter/aggregation over modest JSON?
    -> codemode

Need to scan large JSONL once?
    -> query_jsonl streaming tool

Need repeated/complex queries over the same large corpus?
    -> indexed/query engine behind a structured tool
```

### 6.6 Why not expose `python`, `jq`, or `node` directly?

Those can be efficient implementations, but they should be implementation details rather than model-facing arbitrary interpreters.

For example, a `json_query` tool may internally use:

- native Node/V8 `JSON.parse`;
- a streaming parser;
- `jq`;
- SQLite;
- another optimized engine.

The model should request:

```text
"count tool calls grouped by tool name"
```

through a typed operation.

It should not need to decide:

```text
python vs jq vs node vs awk
```

unless the task itself is specifically about those runtimes.

This produces both better safety and more consistent performance.

---

## 7. Replacement tiers

### T0 — use existing pi tools

Approximate original share: **~41%**

Replace:

- `grep` / `rg` → Pi `grep`
- `cat` / `sed` / `head` / `tail` → `read`
- `ls` → `ls`
- file discovery → `find`

No new wrapper code is required.

Add performance guidance:

- fixed search → `grep(... literal: true)`;
- regex only when needed;
- locate first, then `read` exact ranges;
- avoid unnecessarily large context/output.

### T1 — structured wrapper tools

Approximate original share: **~32%**

Recommended tools:

| Need | Tool | Shape |
|---|---|---|
| validation | `run_validation` | named configured checks only |
| git | `git` | typed operation + structured args |
| model probe | `check_model` | model id + bounded probe |
| static analysis | `fallow` | enumerated operations |
| pane/session ops | `herdr` | typed list/read/close operations |
| deletion | `delete` | workspace-scoped, policy-controlled |
| SVG/image conversion | `render_svg` | fixed conversion API |
| common structured analysis | `query_jsonl` / `json_query` | bounded query |

### T2 — codemode

Approximate original Python share: **~26%**

Use codemode for:

- irregular small/medium JSON transforms;
- joining results from several safe tools;
- short aggregation/filtering;
- glue logic whose shape is not common enough to deserve a fixed tool.

Do not make codemode the default for:

- heavy numeric work;
- huge files;
- repeated full scans;
- operations better represented by a stable typed API.

### T3 — restricted execution escape hatch

Use only for genuinely unsupported process operations.

It should not accept arbitrary shell syntax if avoidable.

Prefer:

```text
restricted_exec({
  program,
  args,
  cwd
})
```

with:

- enumerated executable allowlist;
- `shell: false`;
- argv array;
- workspace-contained cwd;
- filtered environment;
- time limit;
- output limit;
- audit logging.

---

## 8. Structured tools instead of shell-string allowlisting

A command-string allowlist is useful during migration, but it should not be the final architecture.

Instead of:

```text
bash({
  command: "git diff -- src/foo.ts"
})
```

prefer:

```text
git({
  operation: "diff",
  paths: ["src/foo.ts"]
})
```

Internally:

```ts
spawn("git", ["diff", "--", ...paths], {
  shell: false
});
```

The security problem becomes:

> Are these arguments legal for this operation?

instead of:

> Is this arbitrary shell program safe?

### Do not recreate bash accidentally

Avoid wrappers shaped like:

```text
git({ command: "..." })
run_validation({ command: "..." })
exec({ command: "..." })
```

Those are shell-string interfaces under different names.

Use enumerated operations and typed parameters.

---

## 9. The three security layers

These layers solve different problems and should be used together.

### Layer 1 — capability design

Do not expose dangerous general primitives when a narrow capability will do.

Preferred model-facing surface:

```text
read
grep
find
ls
edit
write
codemode
git
run_validation
query_jsonl
check_model
fallow
herdr
render_svg
delete
restricted_exec (rare)
```

This is the primary prevention layer.

### Layer 2 — policy enforcement

Centralize enforcement for all tool calls, including nested calls.

Validate:

- operation is permitted;
- path is inside allowed workspace;
- cwd is allowed;
- executable is allowlisted;
- args match the operation;
- environment is filtered;
- timeout is bounded;
- output is bounded;
- destructive operations meet stricter policy.

For a temporary bash compatibility layer, fail closed:

```text
not explicitly allowed
    -> block
```

Do not rely on a denylist alone.

### Layer 3 — OS/container/VM containment

Even safe-looking tools can invoke repository-controlled code.

Example:

```text
run_validation("unit")
```

may legitimately execute:

```text
npm test
```

but the repository's test script can run arbitrary code.

Therefore the durable boundary is below the agent/tool layer:

- container;
- VM/micro-VM;
- dedicated OS user;
- restricted mount;
- sandbox product such as those documented by pi.

The ideal failure mode is:

> a bad agent/tool destroys a disposable workspace

rather than:

> it destroys the user's home directory or unrelated repositories.

Note on distribution: installing a pi package is itself a trust decision separate from these runtime layers. See Section 22.5.

---

## 10. Bash allowlisting during migration

Pi does not currently provide a declarative per-command allowlist in settings. A `tool_call` extension hook can block a bash call before execution.

This is useful as a **migration safety net**, not the preferred final API.

### Minimum requirements

If raw bash remains temporarily:

1. default deny;
2. anchored/exact positive allowlist;
3. reject shell metacharacters where commands are expected to be simple;
4. explicit deny patterns for obvious disasters;
5. no interpreters unless intentionally approved;
6. audit every allowed and denied request;
7. run inside a constrained OS environment.

### Why prefix checks are unsafe

This:

```text
startsWith("git status")
```

is bypassable by:

```bash
git status; rm -rf ...
git status && ...
git status $(...)
```

Shell syntax includes much more than semicolons:

- pipes;
- substitutions;
- redirections;
- heredocs;
- environment assignments;
- subshells;
- globbing;
- process substitution;
- newlines;
- interpreter invocation.

Therefore the long-term answer should not be a more elaborate shell parser.

---

## 11. Process execution should remain, arbitrary shell construction should not

A capable coding agent ultimately needs processes:

- compiler;
- test runner;
- linter;
- formatter;
- static analyzer;
- git;
- build system;
- model/provider probe;
- project-specific utilities.

Removing all process execution would materially reduce usefulness.

The correct boundary is:

```text
keep: controlled process execution
remove: arbitrary model-authored shell programs
```

A structured tool may still spawn a process. The difference is that the model chooses a **capability and arguments**, not executable shell syntax.

---

## 12. Recommended agent operating modes

Three explicit modes make the policy easier to reason about.

### Restricted

For:

- reviewers;
- readers;
- analysts;
- planning peers.

Typical tools:

```text
read
grep
find
ls
codemode
query_jsonl
```

No general process execution.

### Engineering — preferred default

For normal editing agents:

```text
read
grep
find
ls
edit
write
codemode
query_jsonl
git
run_validation
other structured project tools
```

No raw bash.

This should become the normal operating mode.

### Escape-hatch

For:

- supervisor/debug agent;
- migration gaps;
- rare unsupported operations.

Adds:

```text
restricted_exec
```

or temporarily a tightly gated bash tool.

Every use should be observable and feed back into tool design.

---

## 13. Choices / directions

### Option 1 — keep unrestricted bash

**Description:** retain current behavior and rely on prompts/conventions.

**Advantages:**
- zero migration work;
- maximum flexibility.

**Problems:**
- no reliable accident boundary;
- shell becomes model's reflex;
- eventual destructive mistake remains plausible;
- repository-controlled commands can do anything the pi process can do.

**Assessment:** not appropriate for increasingly autonomous agents.

---

### Option 2 — keep bash with command allowlist

**Description:** intercept bash calls and permit only approved command shapes.

**Advantages:**
- quick improvement;
- low initial migration cost;
- useful telemetry about what the model still tries to execute.

**Problems:**
- shell parsing is difficult;
- allowlist tends to expand;
- interpreters/build tools can reintroduce arbitrary execution;
- easy to confuse accident mitigation with a true security boundary.

**Assessment:** good transitional architecture, weak final architecture.

---

### Option 3 — remove bash and rely only on existing pi tools + codemode

**Description:** disable model-facing bash immediately.

**Advantages:**
- strong simplification;
- eliminates direct shell disasters;
- already covers a large fraction of observed usage.

**Problems:**
- test/git/project tooling becomes awkward or impossible without replacements;
- heavy JSON analysis should not all be forced through QuickJS;
- likely to produce blocked/missing-capability cases.

**Assessment:** useful experiment, incomplete engineering-agent platform.

---

### Option 4 — structured capability architecture + isolated execution

**Description:**

- remove raw bash from normal agents;
- use pi built-ins for reading/search;
- use codemode for lightweight glue;
- add structured wrappers for stable process workflows;
- add streaming/query tools for common JSON/JSONL work;
- retain one audited restricted-exec escape hatch;
- isolate execution agents at the OS level.

**Advantages:**
- much smaller blast radius;
- faster/more deterministic common operations;
- lower token/output waste;
- easier policy enforcement;
- better observability;
- does not cripple engineering workflows.

**Cost:**
- several custom tools;
- policy layer;
- sandbox/container setup;
- iterative refinement based on real blocked calls.

**Assessment:** **preferred direction.**

---

## 14. Preferred end-state architecture

```text
                     HOST
        ┌──────────────────────────┐
        │ orchestrator             │
        │ policy                   │
        │ credentials              │
        └─────────────┬────────────┘
                      │
              constrained interface
                      │
        ┌─────────────▼────────────┐
        │ isolated workspace       │
        │                          │
        │ agent                    │
        │ ├─ read                  │
        │ ├─ grep                  │
        │ ├─ find / ls             │
        │ ├─ edit / write          │
        │ ├─ codemode              │
        │ ├─ query_jsonl           │
        │ ├─ git                   │
        │ ├─ run_validation        │
        │ ├─ fallow / herdr / ...  │
        │ └─ restricted_exec*      │
        │                          │
        │ project checkout         │
        └──────────────────────────┘

        * exceptional, audited, allowlisted
```

Key principle:

```text
common operation
    -> dedicated fast typed tool

uncommon bounded computation
    -> codemode

unsupported process requirement
    -> restricted_exec

arbitrary shell
    -> not a normal model capability
```

---

## 15. Implementation plan

### Phase 1 — stop reflexive bash usage

**A1.** Build a Pi package containing structured tools, the `tool_call` enforcement hook and agent-mode guidance. Activate it together with tool selection in settings: for a solo user, install the package and set `defaultTools` in `~/.pi/agent/settings.json`; for a team, commit one `.pi/settings.json` with both `packages` and `defaultTools`. The settings entry `-bash` removes bash from the model-facing surface; the hook blocks any attempted bash call. See Section 22.

Example settings carried by the package:

```json
{
  "defaultTools": [
    "read",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "codemode"
  ]
}
```

**A2.** Add agent instructions:

- fixed text → `grep` with `literal: true`;
- regex only when necessary;
- known file/range → `read`;
- file discovery → `find`;
- directory listing → `ls`;
- small/medium ad-hoc transformations → codemode;
- do not invent Python/shell commands when a tool exists.

**A3.** Measure:
- denied bash attempts;
- task completion rate;
- latency;
- tool counts;
- token/input/output volume.

---

### Phase 2 — add high-value structured tools

Build:

**A4. `git`**
- `status`
- `diff`
- `log`
- `show`
- `add`
- `commit`
- explicitly chosen branch/checkout operations

Use `spawn(..., { shell: false })`.

**A4a.** Declare compatibility with Pi ≥ 0.84.2, use host-provided `@earendil-works/*` dependencies, and add a startup version check that reports unsupported hosts and fails protected activation. See Section 22.3.

**A4b.** Add a `/doctor`-style command to the package that reports the active toolset, whether bash is absent, and which policy mode is live, so a user can verify the opt-in took effect. See Section 22.7.

**A5. `run_validation`**
- accepts named checks only;
- commands come from trusted configuration;
- bounded timeout/output.

**A6. `query_jsonl` / `json_query`**
- streaming;
- typed filters;
- projection;
- grouping/counting;
- limits;
- optional cache/index.

**A7. `check_model`**
- registry resolution;
- bounded live probe.

**A8. narrow wrappers**
- `fallow`
- `herdr`
- renderer/converter
- safe delete/cleanup

---

### Phase 3 — central policy

**A9.** Enforce workspace path boundaries.

**A10.** Route nested calls through the same policy path.

**A11.** Add per-tool:
- timeout;
- output cap;
- environment rules;
- cwd rules;
- audit metadata.

**A12.** Treat destructive operations separately:
- delete only inside workspace;
- optional confirmation/lease;
- prohibit root/home paths;
- preferably operate on disposable checkouts.

---

### Phase 4 — retain and measure one escape hatch

**A13.** Implement `restricted_exec` rather than broad bash if possible.

Example conceptual schema:

```text
restricted_exec({
  program: enum(...),
  args: [...],
  cwd: relative_workspace_path,
  timeoutClass: "short" | "normal"
})
```

**A14.** Log every request.

**A15.** Review repeated patterns.

If the same legitimate operation appears repeatedly:

```text
escape-hatch usage
    -> new structured tool
```

This gradually shrinks the escape hatch instead of expanding it.

---

### Phase 5 — OS containment

**A16.** Run editing/execution agents in a container, VM, micro-VM, or equivalent restricted environment.

**A17.** Mount only the required project/worktree where practical.

**A18.** Keep host credentials outside the sandbox where possible.

**A19.** Make destructive failure recoverable:
- git worktree/clone;
- snapshots;
- disposable workspace;
- preserved logs.

---

### Phase 6 — optimize from measurements

**A20.** Track tool latency and data volume.

For each tool call log at least:

```text
tool
operation
elapsed_ms
input_bytes
output_bytes
records_scanned
records_returned
cache_hit
exit_status
```

**A21.** Identify hotspots.

Examples:

- many literal searches → ensure `literal: true`;
- repeated same-file JSONL scans → cache/index;
- codemode spending significant CPU on aggregation → migrate that operation to a native query tool;
- large grep-context output → search first, then targeted read.

**A22.** Optimize only measured bottlenecks.

Do not replace simple safe operations with more complicated infrastructure without evidence.

---

## 16. Tool-selection policy to give agents

A concise policy for system/agent instructions:

```text
Choose the narrowest and cheapest tool that satisfies the task.

Repository search:
- Use grep with literal=true for fixed text.
- Use regex only when regex semantics are required.
- Use find for paths and read for known file ranges.

Structured data:
- Use codemode for small/medium one-off transforms.
- Use query_jsonl/json_query for large or repeated structured-data queries.
- Do not create Python, Node, jq, awk, or shell snippets when a provided tool covers the operation.

Execution:
- Use git, run_validation, and other structured tools for supported workflows.
- Use restricted_exec only when no structured capability exists.
- Raw bash is not part of the normal toolset.
```

This instruction should be backed by actual tool availability. Prompting alone is not a boundary.

---

## 17. What agents will do instead of random Python scripts

If bash is removed but no substitute is supplied, models may:

- attempt unavailable shell commands;
- overuse `read`;
- produce inefficient manual reasoning;
- request a missing capability.

If the new affordances are clear, the likely replacement behavior is:

```text
old:
LLM
 -> bash
 -> python3
 -> open/read file
 -> parse
 -> aggregate
 -> print

new, one-off:
LLM
 -> codemode
 -> tools.read
 -> JSON.parse
 -> aggregate
 -> emit bounded result

new, large/repeated:
LLM
 -> query_jsonl
 -> native streaming implementation
 -> bounded structured result
```

The second replacement is preferable for established, recurring query shapes because it is:

- faster;
- more deterministic;
- easier to test;
- easier to cap;
- less token-intensive.

Codemode remains important because not every analysis shape deserves a permanent custom API.

---

## 18. Lessons from `disler/bash-damage-from-within`

The `bash-damage-from-within` repository is directly relevant because it implements the same progression for **Pi itself**, from prompt-only safety through blacklist/whitelist hooks to a no-bash tool surface.

Its five-level framing is:

| Level | Mechanism | Practical value |
|---|---|---|
| 1 | user/skill instruction | behavioral guidance only |
| 2 | system-prompt instruction | stronger behavioral guidance only |
| 3 | bash blacklist hook | useful floor, reactive |
| 4 | default-deny bash whitelist | materially stronger transitional architecture |
| 5 | no bash + purpose-built tools | preferred model-facing architecture |

This independently supports the direction of this assessment:

```text
prompts
    -> useful for steering, not enforcement

blacklist
    -> defense in depth

default-deny allowlist
    -> migration architecture

purpose-built tools
    -> preferred steady state

OS isolation
    -> actual damage boundary
```

### 18.1 Capability composition is a first-class risk

The repository demonstrates a particularly important failure mode:

```text
agent can write arbitrary code
+
agent can execute arbitrary written code
=
arbitrary execution has effectively returned
```

Example:

```text
write cleanup.py containing destructive filesystem code
then:
python cleanup.py
```

A bash blacklist that blocks `rm -rf` never sees the destructive operation. It sees only:

```text
python cleanup.py
```

The same problem applies to any broadly allowed interpreter or launcher:

```text
python <agent-written-file>
node <agent-written-file>
ruby <agent-written-file>
perl <agent-written-file>
sh <agent-written-file>
```

It can also apply indirectly to:

```text
npm test
npm run <script>
make
just
build hooks
test runners
package-manager lifecycle scripts
```

Therefore the policy must evaluate **capability composition**, not only individual commands.

A useful rule is:

> **Never whitelist an interpreter pattern that can execute arbitrary agent-authored code. Pin known operations or known entrypoints instead.**

For example, prefer:

```text
run_validation({ check: "unit" })
```

where the harness owns the configured command, over:

```text
restricted_exec({
  program: "python",
  args: [agentChosenFile]
})
```

Even a fixed validation command can execute repository-controlled code, which is why OS isolation remains required.

### 18.2 Treat read scope and returned data as capabilities

The repo's Level 5 Pi example exposes a `list_target` tool that returns **names only**, not file contents.

This is a useful design principle beyond bash safety:

> **A safe tool should return the minimum data required for the operation.**

Examples:

```text
Need to know whether artifacts exist?
    -> return names / metadata

Need git state?
    -> return structured status, not arbitrary repository contents

Need counts from logs?
    -> return counts / grouped results, not entire JSONL

Need validation result?
    -> return exit status + bounded relevant output
```

This reduces:

- accidental secret disclosure;
- prompt-injection surface;
- token/context use;
- unnecessary data movement.

Tool design should therefore constrain both:

```text
what the tool may do
and
what the tool may reveal
```

### 18.3 Prompt injection belongs in the threat model

The repo includes an attack in which the agent reads a file and is instructed to follow instructions contained inside it.

That matters because removing bash does not remove prompt injection.

A repository may contain:

- README instructions;
- generated logs;
- issue text;
- vendor documentation;
- test fixtures;
- source comments;
- malicious or compromised dependency content.

These should be treated as **untrusted data**, not authority.

The tool-policy boundary must remain authoritative even if the model becomes convinced by repository content that it should perform a destructive action.

This strengthens the case for:

```text
model judgment
    -> advisory

tool policy
    -> enforcement

OS boundary
    -> containment
```

### 18.4 A reusable adversarial test corpus should be part of the implementation

The repository's strongest practical contribution is not a new policy mechanism; it is a repeatable attack suite.

It tests categories including:

- direct destructive command;
- destructive behavior hidden in a written script;
- alternative destructive command such as `find ... -delete`;
- prompt injection through repository content;
- interpreter-based/renamed-command bypass;
- sensitive-data access/exfiltration.

Create an equivalent test suite for this Pi harness and run it against every policy mode.

Suggested local test cases:

| Test | Expected result |
|---|---|
| direct `rm -rf` | blocked |
| `find ... -delete` | blocked |
| write destructive Python then execute it | execution path blocked |
| shell chaining/substitution | blocked |
| arbitrary interpreter execution | blocked |
| unauthorized path outside workspace | blocked |
| read secret file without capability | blocked |
| request full log when aggregate suffices | narrow tool returns bounded result |
| prompt injection in repository file | cannot change policy |
| allowed test command | succeeds inside isolated workspace |
| allowed fixed-string search | succeeds through `grep literal=true` |
| large JSONL count/group | succeeds through streaming query tool |

The suite should exercise **combinations of capabilities**, not just isolated tool calls.

### 18.5 Safety tests should be regression tests

Every time the escape hatch expands or a new tool is added:

1. add the legitimate operation it enables;
2. add abuse cases for the same capability;
3. run the adversarial suite;
4. verify expected allow/deny results;
5. record any change in blast radius.

This prevents a future convenience change from silently reintroducing arbitrary execution.

### 18.6 Cumulative risk increases with autonomous runtime

The repository also emphasizes an operational point: rare model/tool-policy mistakes become more important as the number of autonomous turns and sessions increases.

The exact probability is environment-dependent, but the conclusion is straightforward:

```text
more autonomous calls
    -> more opportunities for a low-probability failure
```

Therefore safety should be designed for:

```text
thousands of unattended tool calls
```

not for:

```text
one supervised interactive session that behaved correctly
```

This is another reason to prefer deterministic capability enforcement over model restraint.

### 18.7 How this changes the recommended design

The repository does **not** materially change the preferred Option 4 architecture. It strengthens it in four places:

1. **Add capability-composition review** to every allowlisted execution path.
2. **Design return-data scopes**, not only execution scopes.
3. **Add repository/prompt-injection attacks** to the threat model.
4. **Build an adversarial regression suite** before declaring the migration complete.

Source reviewed:

- https://github.com/disler/bash-damage-from-within
- https://github.com/disler/bash-damage-from-within/tree/main/pi
- Pi Level 4 whitelist implementation
- Pi Level 5 no-bash implementation
- repository attack prompts

---


### 18.8 Reconciliation with current Pi 1.0.x APIs

The `bash-damage-from-within` Pi examples are conceptually useful, but they were written against an older Pi API and should **not** be copied verbatim into a current implementation.

The repository's Level 3 source explicitly says it was verified against:

```text
@mariozechner/pi-coding-agent 0.70.6
```

Current Pi uses the `@earendil-works/*` package family and has added several tool/orchestration APIs since then.

#### What is stale in the repo code

**Package import**

Old:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
```

Current:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

**Tool schema / definition style**

The Level 5 repo example imports:

```ts
import { Type } from "typebox";
```

and passes a raw object directly to `pi.registerTool()`.

That basic registration shape is still supported, but current official examples commonly use:

```ts
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

followed by:

```ts
const tool = defineTool({ ... });
pi.registerTool(tool);
```

Use the current checked-in Pi examples as the API reference when implementing the real tools.

#### What still maps cleanly

The following repo mechanisms are still valid concepts in current Pi:

- `pi.on("tool_call", ...)`;
- returning `{ block: true, reason }` to refuse a tool call;
- `pi.registerTool(...)`;
- selecting tools with settings / CLI;
- omitting `bash` from the active toolset;
- keeping an unconditional bash block as defense in depth.

Current Pi's own `permission-gate.ts` still uses the same `tool_call` interception pattern.

#### Prefer current tool selection over repo-era invocation examples

The repo's Level 5 comment recommends:

```text
pi --tools read,edit,write,grep,find,run_tests,git_status,list_target
```

That remains a useful one-run mechanism, but current Pi also supports persistent tool selection through `defaultTools`.

For this project, prefer an explicit project/user configuration such as:

```json
{
  "defaultTools": [
    "-bash",
    "+grep",
    "+find",
    "+ls",
    "+codemode",
    "+run_validation",
    "+query_jsonl",
    "+git"
  ]
}
```

Important current behavior:

- `-bash` removes the built-in bash tool;
- an empty/default-tool selection does **not** automatically remove extension or SDK tools;
- therefore dangerous extension tools must also be controlled by registration/exposure/policy.

#### Current Pi has tool exposure controls the old repo did not use

Current Pi adds per-tool exposure modes including:

```text
direct
model-only
codemode
deferred
hidden
```

This is useful for reducing the number of general-purpose tools directly presented to the model.

For example:

```text
direct:
    read
    grep
    find
    ls
    edit
    write
    git
    run_validation

codemode/deferred:
    query_jsonl helpers
    specialist analysis utilities
```

Exposure is an interface/availability control, not a substitute for authorization. A callable tool must still enforce its own path, argument, environment, and execution policy.

#### Current Pi supports policy-aware nested tool calls

Current Pi now exposes:

```text
ctx.executeTool()
```

for tool orchestration, and nested calls carry a `parentToolCallId`.

This materially improves the codemode/custom-tool design because a composite tool can invoke another registered tool through Pi's normal execution path rather than calling its `.execute()` method directly.

That matters because direct `.execute()` calls can bypass normal tool-call interception.

Policy rule:

```text
custom tool / codemode
    -> ctx.executeTool(...)
    -> normal interception / policy / telemetry
```

not:

```text
custom tool
    -> anotherTool.execute(...)
    -> possible policy bypass
```

The standalone codemode documentation explicitly warns about this distinction.

#### Use `ctx.cwd`, not a module-load `process.cwd()` constant

The repo's Level 5 example captures:

```ts
const PROJECT_ROOT = process.cwd();
```

once when the extension loads.

Current extension tool executions receive an `ExtensionContext` whose `cwd` is the session's current working directory.

For project-scoped operations, resolve against:

```ts
ctx.cwd
```

inside the tool execution rather than relying on a process-global cwd captured at module initialization.

This makes path policy explicit and aligns custom tools with current built-in tool behavior.

#### Honor cancellation

The repo's `run_tests` example ignores its `_signal` argument while invoking `execFile`.

Current tools should propagate the provided `AbortSignal` into subprocess execution when the underlying API supports it.

A structured execution helper should consistently implement:

```text
AbortSignal
timeout
output limit
cwd policy
environment policy
```

rather than repeating process-launch behavior in each custom tool.

#### Prefer a shared execution helper over one-off `execFile` wrappers

The repo directly calls Node `execFile()` from custom tools. That is acceptable for a demonstration, but current Pi has a stronger execution abstraction story:

- coding-agent built-in process/file tools are backed by execution environments;
- `@earendil-works/pi-agent-core` exposes `ExecutionEnv`;
- Pi 1.0.4 introduced `@earendil-works/pi-env` for remote execution environments.

For this project, the preferred direction is:

```text
structured tool
    -> common constrained execution service / ExecutionEnv
    -> process
```

rather than:

```text
every tool
    -> its own execFile implementation
```

This centralizes:

- sandbox routing;
- environment filtering;
- cwd enforcement;
- timeout behavior;
- output windows;
- cancellation;
- telemetry.

#### Current Pi has stronger sandbox examples than the old repo references

Current Pi's extension examples now include:

- `protected-paths.ts`;
- `sandbox/` using an OS-level sandbox runtime;
- `gondolin/` routing tools into a micro-VM.

These should be treated as more current references for Layer 2/Layer 3 implementation than the old repo's Pi code.

### 18.9 Reconciled verdict on the repository

After comparison with current Pi 1.0.x:

```text
repo security ideas:
    keep

repo attack corpus:
    keep and adapt

repo Level 3/4/5 progression:
    keep as conceptual framing

repo Pi source code:
    reference only

current Pi docs/examples:
    authoritative implementation source
```

The most important modernization is that current Pi now gives us enough primitives to make the preferred architecture cleaner than the repo's Level 5 demonstration:

```text
defaultTools removes bash
+
typed structured tools
+
tool exposure controls
+
ctx.executeTool for policy-aware composition
+
codemode for bounded glue
+
ExecutionEnv / sandbox boundary
+
adversarial regression suite
```

That should be the implementation target.


## 19. Risks

### R1. Allowlist creep

A temporary bash allowlist can gradually expand until it recreates a shell.

**Mitigation:** repeated operations become structured tools; exceptions remain visible.

### R2. Interpreter escape

Allowing arbitrary:

- Python;
- Node;
- Ruby;
- Perl;
- shell;
- generic script runners

effectively restores arbitrary execution.

**Mitigation:** keep interpreters behind constrained tools or inside isolated disposable environments.

### R3. Safe wrapper, unsafe project command

A typed validation tool may still invoke repository-controlled code.

**Mitigation:** OS/container/VM isolation remains necessary.

### R4. Codemode misuse

Large datasets can be repeatedly loaded and parsed in QuickJS.

**Mitigation:** explicit JSON/JSONL routing policy and dedicated streaming tool.

### R5. Performance micro-optimization without evidence

Creating many tiny variants can complicate the tool surface.

**Mitigation:** instrument latency/volume, optimize measured hot paths, and prefer semantic flags such as `literal: true` over separate redundant tools.

### R6. Nested tool bypass

An orchestrator/codemode/custom tool can accidentally invoke another tool outside central policy.

**Mitigation:** route nested execution through pi's normal tool execution/interception path.

### R7. Untrusted package install

Installing a third-party pi package runs arbitrary code with full system access; a compromised or mistaken package can reintroduce the exact risks this effort removes.

**Mitigation:** pin package refs, review source before trusting a project, and treat install as a trust boundary separate from the runtime policy. See Section 22.5.

---

## 20. Decision

### Preferred direction

Adopt **Option 4: structured capability architecture + isolated execution**.

The practical end state is:

```text
raw model-facing bash:
    removed from routine agents

search/read:
    pi built-ins

fixed string search:
    grep literal=true / ripgrep fixed strings

small/medium arbitrary analysis:
    codemode

large/repeated JSON/JSONL:
    streaming query tool

git/tests/project operations:
    typed wrappers

rare unsupported process:
    restricted_exec

actual damage boundary:
    container / VM / OS isolation

distribution / opt-in:
    pi package installed per-user or per-project
```

This direction reduces catastrophic risk without reducing the system to a non-engineering assistant.

---

## 21. Immediate next steps

1. **Remove bash from one normal engineering-agent profile** and enable `grep`, `find`, `ls`, and `codemode`.
2. **Add explicit tool-selection guidance**, especially `grep literal=true` for fixed text.
3. **Implement `query_jsonl` first** because the observed Python/JSON workload is the largest single bash category and codemode should not be the heavy-data default.
4. **Implement structured `git` and `run_validation` tools** next.
5. **Add central tool policy and logging** for direct and nested tool calls.
6. **Keep a temporary fail-closed bash/restricted-exec escape hatch** and record every attempted use.
7. **Run execution-capable agents in an isolated workspace** before treating the setup as a meaningful security boundary.
8. **Review telemetry after real sessions** and convert recurring escape-hatch patterns into structured tools.
9. **Benchmark the actual hot paths** rather than assuming one parser/search mechanism is always fastest.
10. **Deliver the package and matching settings together:** solo developers install the package and set user `defaultTools`; teams commit one `.pi/settings.json` with package source and `-bash`. See Section 22.

The critical architectural rule is:

> **The model chooses the operation. The harness chooses the safe and efficient implementation.**

---

## 22. Distribution, activation, verification, and deactivation

Pi packages distribute extensions and skills. Pi settings select which tools are available. These are **separate mechanisms**. A package manifest does not itself carry or apply `defaultTools`; the intended no-bash installation pairs a package source with an explicit settings entry. The extension's `tool_call` hook is a second, independent block against bash calls.

### 22.1 Package contents and responsibility split

The package bundles:

- typed structured tools (`git`, `run_validation`, `query_jsonl`, and other approved capabilities);
- a `tool_call` policy hook that denies calls to built-in `bash`;
- agent operating-mode guidance through skills or prompts;
- an optional `/doctor` command and version-compatibility check.

The Pi settings file provides:

- `packages`: the package source that Pi installs/loads;
- `defaultTools`: the model-facing tool selection, including `-bash` and the intended replacement tools.

Minimal package manifest (illustrative):

```json
{
  "name": "pi-nobash",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  }
}
```

**Boundary:** Installing/loading the package activates its hook and tools; removing bash from the model's available toolset requires an effective `defaultTools` selection or an explicitly implemented runtime tool-selection action. This design uses **settings** as the primary tool-removal mechanism, not a package-manifest setting or an implicit extension side effect.

### 22.2 Activation: package author, solo developer, and team

**Build once (package author)**

- **A1.** Scaffold a Pi package, declaring extension and skill resources and compatibility with Pi ≥ 0.84.2.
- **A2.** Put typed tools and the `tool_call` block hook in `extensions/`, and operating-mode instructions in `skills/`.
- **A3.** Publish a pinned/versioned package through Git or npm.

**Activate (solo developer)**

- **A4.** Run `pi install git:github.com/<you>/pi-nobash@v1` (or an npm/local equivalent), which adds the package to user settings.
- **A5.** Add `"defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]` to `~/.pi/agent/settings.json`, preserving other required tool entries and selection semantics.
- **A6.** Start/restart Pi and verify the effective toolset and active enforcement hook.

**Activate (team/project)**

- **A7.** Commit one project `.pi/settings.json` with both the package source and tool selection. Conceptual example (replace the source and merge with any other settings):

```json
{
  "packages": ["git:github.com/<you>/pi-nobash@v1"],
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

- **A8.** A teammate pulls the repository, launches Pi in the project and trusts the project when prompted. Pi then resolves/loads the declared package and applies project tool selection. No separate per-person setup is intended for a trusted project; actual behavior must be verified against the supported Pi build and project-trust policy.

Project scope applies only while the project configuration is effective. It does not protect unrelated Pi sessions.

**Daily use**

- **A9.** Exact text → `grep literal=true`; discovery → `find`/`ls`; known ranges → `read`.
- **A10.** Modest JSON → codemode; large or repeated JSONL → `query_jsonl` or indexed backend when justified.
- **A11.** Git and test workflows → typed `git` and `run_validation`.
- **A12.** Unsupported operation → visible capability-gap result or audited `restricted_exec` request, never unbounded bash fallback.
- **A13.** Run `/doctor` to inspect the active toolset, whether bash is absent, enforcement mode, package/version compatibility, and availability of key replacement tools.

### 22.3 The two enforcement mechanisms

1. **Tool surface removal (primary):** the effective `defaultTools` setting includes `-bash`, so the model is not normally offered that tool.
2. **Call interception (backstop):** the installed extension returns `{ block: true, reason }` for attempted `bash` tool calls, including cases where another tool-selection path exposes the built-in again.

Neither mechanism on its own guarantees containment of subprocesses, interpreters, malicious project scripts, extension-internal process launches, or other model-visible execution tools. Apply the shared policy and isolation layers in Section 9.

The assessment's compatibility baseline is **Pi ≥ 0.84.2** because the documented `defaultTools`/custom-tool interaction was fixed in that release. Declare this in package compatibility metadata **and verify at startup**; dependency metadata alone should not be treated as an enforcement guarantee. If version or hook status cannot be verified, `/doctor` must show an explicit failure. A protected run should refuse to proceed if the required no-bash enforcement cannot be established.

### 22.4 Deactivation

**A14.** To disable the profile, reverse **both** controls in the applicable settings scope: remove/disable the package entry (or use `pi remove <source>` where applicable) **and** remove `-bash` from `defaultTools`. Restart Pi and verify the resulting toolset. Removing only the package leaves bash excluded if `-bash` remains; removing only `-bash` leaves the policy hook available to block calls. `pi config` can toggle bundled resources, but is not a replacement for checking effective `defaultTools`.

For a team, commit the project settings change. For a solo developer, update `~/.pi/agent/settings.json` and remove the user-scoped package if no longer needed.

### 22.5 Install-time trust boundary

Pi packages can execute extension code with host privileges. Trusting/installing a package is a separate security decision from enforcing safe tool calls later. For teams, pin package refs, review source, and use project trust gates. Package delivery does not replace runtime policy, restricted mounts, or OS/container/VM isolation.

### 22.6 Existing packaging precedent

`salesforce/sf-pi` demonstrates distributing a collection of Pi extensions and skills, project/global installation, and diagnostic commands. It is a structural reference, not proof of no-bash guarantees. The Pi package and settings documentation are the authoritative references for the exact installation and activation contract.

### 22.7 Activation acceptance tests

Verify on the minimum supported Pi version and a current version:

1. A trusted team project installs/loads the pinned package and activates the intended `defaultTools` selection.
2. `getActiveTools()` or equivalent effective-tool inspection confirms that `bash` is absent while the typed tools are available.
3. If bash is exposed by an override, the hook rejects the call before execution.
4. A missing/disabled hook, unsupported Pi version, or failed installation produces a clear verification failure rather than a silent claim of protection.
5. Disabling only the package versus only `-bash` produces the documented different outcomes.
6. Running outside the configured project does not incorrectly claim project-wide protection.

---

## 23. Semantic operations and implementation dispatch

### 23.1 Principle and boundary

The replacement interface should specify **the operation's meaning and constraints**, not the command line that happens to implement it:

```text
model intention
  -> typed semantic operation (what; inputs; limits)
  -> authorization and validation (whether; which paths)
  -> deterministic implementation selector (how)
  -> bounded execution inside appropriate isolation
  -> compact, structured result + telemetry
```

The dispatcher is ordinary trusted extension/runtime code, **not another LLM deciding what shell command to run**. The model is responsible for expressing intent; the runtime owns the executable, arguments, parser, query plan, limits and result shape. Policy evaluation must precede dispatch, and all selectable implementations must satisfy the same permission contract. A faster backend must never be chosen if it grants greater privileges.

This is a *design proposal*, not a claim that Pi ships a universal semantic dispatcher. Current Pi provides the built-in tools, extension registration, tool selection and execution primitives from which to build it. Keep the interface separate from the backend implementation so later performance changes do not require rewriting agent prompts or task configurations.

### 23.2 What belongs in a semantic tool contract

Each operation should have:

| Contract part | Purpose | Example |
|---|---|---|
| Operation | Stable capability name, not a command | `search_text`, `query_records`, `git_status`, `run_validation` |
| Arguments | Typed domain inputs | `pattern`, `literal`, `paths`, `where`, `columns`, `limit` |
| Scope | What the operation may access | `workspace`, allowed relative paths; no home-directory fallback |
| Semantics | Exact vs approximate; ordering; case, encoding, regex rules | `match: "literal"`, `caseSensitive: true` |
| Resource bounds | Prevent expensive or unbounded calls | `maxResults`, `maxOutputBytes`, `timeoutMs` |
| Effects | Read-only, write, process or network | Explicit classification used by policy |
| Result | Predictable schema with truncation/errors | Matches, counts, status, `truncated`, diagnostics |
| Version | Stable meaning as backends change | `schemaVersion: 1` |

Crucially, **no `command`, arbitrary `script`, or shell-expression parameter** should appear in the ordinary operation schema. Reject unknown fields. Validate sizes, ranges, paths, enum values, and output bounds before doing work.

A conceptual API (not Pi SDK implementation syntax):

```ts
type SearchText = {
  operation: "search_text";
  pattern: string;
  match: "literal" | "regex";
  paths?: string[];
  caseSensitive?: boolean;
  maxResults?: number;
  maxOutputBytes?: number;
};

type QueryRecords = {
  operation: "query_records";
  path: string;
  format: "json" | "jsonl";
  where?: Array<{ field: string; op: "eq" | "in" | "gte" | "lte"; value: unknown }>;
  select?: string[];
  groupBy?: string[];
  aggregate?: "count" | "sum" | "min" | "max";
  limit?: number;
};
```

Avoid turning `where` into model-authored JavaScript, SQL fragments, jq expressions or a custom programming language. Prefer a limited query AST validated by the runtime; add operators only for measured recurring needs.

### 23.3 What the dispatcher chooses

The model should **not** select between `grep`, `rg`, Node, Python, jq, SQLite or QuickJS for common tasks. It selects an intent such as `search_text` or `query_records`. A deterministic dispatcher can choose a backend based on verified inputs and preconditions:

| Intent | Default implementation | Alternative / trigger | Key caveat |
|---|---|---|---|
| Literal text search | Existing Pi `grep` with `literal: true` (ripgrep fixed strings) | None until benchmarks show a reason | Avoid a wrapper that merely adds another model/tool round-trip |
| Regex search | Pi `grep` in regex mode | Specialized engine only if semantics are defined and benchmarked | Regex engines have different syntax and performance |
| Path discovery / listing | Pi `find` / `ls` | Indexed repository inventory if repeatedly queried and freshness guaranteed | Respect ignore, hidden-file and symlink behavior |
| Known-file read | Pi `read` with bounded range | Cached chunks only if freshness maintained | Reading full file may waste context |
| Small one-off JSON | `read` + codemode parse/aggregate | Dedicated `json_query` if shape repeats | QuickJS is glue, not bulk compute |
| Large one-pass JSONL | Native line-streaming `query_jsonl` | None needed initially | Avoid full-file read into model or codemode |
| Repeated complex JSONL | Native streaming first | Indexed SQLite/DuckDB or persisted summary after benchmark | Cache invalidation and index-build cost |
| Git state/diff | Typed `git` operation, fixed `argv`, `shell: false` | Optional library API when semantics are verified | Pathspecs, repos, hooks and worktrees complicate correctness |
| Test/lint/typecheck | Named `run_validation` profile | Cached result only if inputs are reliably unchanged | Executing project scripts is still arbitrary code at OS level |
| Image/SVG conversion | Fixed typed converter | Select library/process by file type and size | Validate format, dimensions, workspace and resource budgets |

**Prefer existing Pi tools where they are already good**. In particular, semantic dispatch need not be one monolithic `do_everything` tool. An agent can call `grep` directly for searches; use custom structured tools only where they materially improve enforcement, speed, predictability or token efficiency. A clean tool surface is better than mechanically wrapping every built-in.

### 23.4 Deterministic routing algorithm

A dispatcher should be small, testable and unsurprising:

```text
1. Parse and strictly validate the typed request.
2. Authenticate the requesting agent/role and enforce operation and path permissions.
3. Normalize paths safely; check workspace boundaries and symlink policy.
4. Apply hard limits for time, bytes, records, depth and returned results.
5. Pick the lowest-overhead eligible implementation using explicit rules.
6. Execute via shared controlled execution/data access service.
7. Format a bounded result; report truncation and errors explicitly.
8. Record backend, duration, work volume, output size and cache use.
```

Do not choose based solely on nominal file size. Include the **operation shape** (one value vs count/group vs joins/sorts), expected number of repeated queries, output cardinality, available index, and index freshness. Start with simple thresholds/configurable routing rules; optimize only after measurement. A dynamic cost model is optional, not an initial requirement.

The runtime must not silently switch semantics when switching backends. For example, sorting, case sensitivity, null handling, numeric comparisons, `git` pathspec behavior, and malformed JSONL policy must produce equivalent results or explicit errors across implementations.

### 23.5 Safety cannot be delegated to backend choice

Tool interfaces and backend implementations need two different checks:

- **Capability policy**: who may read, write, run tests, use git, delete, or access outside the workspace. This is enforced before execution and also at the filesystem/OS boundary.
- **Implementation policy**: what fixed programs and argv are permitted to execute an approved operation; limits, environment, path handling, cancellation, and logging.

`spawn(..., { shell: false })` removes shell parsing but does **not** inherently make a process safe. Interpreters, git options, package scripts, build tools and callbacks can cause writes, run code or access the network. Use operation-specific argv construction with `--` where appropriate, explicit flag allowlists, controlled configuration, and OS isolation for executable workflows. A read-only semantic label must not hide a backend that can mutate state.

For nested operations, use Pi's normal policy-aware execution path where supported (`ctx.executeTool`, as described in Section 18.8). Do not call a tool's `.execute()` directly to bypass interception. Also consider direct file/process APIs used *inside* an extension: they need the same shared authorization/sandbox service because an external tool hook cannot automatically protect arbitrary extension-internal Node calls.

---

## 24. Performance model: optimize the full agent task, not only subprocess time

### 24.1 What “fastest” means

There are at least four costs:

1. **Runtime latency:** parse, disk I/O, scan, subprocess startup, index build, and conversion.
2. **Model latency:** deciding a command, extra tool calls, retries and repair turns.
3. **Context/token cost:** schemas exposed to the model, arguments, tool outputs and repeated data reads.
4. **Safety/operational cost:** blast radius, debugging time, stale caches, non-deterministic behavior.

A backend that runs 20% faster but returns 100× more text may be *slower for the complete agent task*. Conversely, adding a generic semantic tool for an already optimized, directly exposed Pi `grep` can increase overhead. Measure **task success, end-to-end latency and total token cost**, not only tool milliseconds.

### 24.2 Prefer bounded server-side aggregation and projection

For a request such as “count tool calls grouped by tool name in this run,” prefer:

```text
query_jsonl({path:"run-details/tool-calls.jsonl", groupBy:["tool"], aggregate:"count", limit:50})
    -> counts with at most 50 rows
```

over `read`/`cat` returning the entire JSONL log followed by model-side counting. Apply filtering and projection while streaming, aggregate inside the tool, and return only the needed fields. Include metadata such as `recordsScanned`, `recordsMatched`, `truncated`, `sourceFingerprint`, and `elapsedMs` to make output trustworthy and diagnosable. If the query requires a global sort/top-k, implement a bounded heap or explicitly limit memory; do not claim a streaming operation has constant memory if it buffers all records.

### 24.3 Choose JSON data engines by workload

**Default tiers:**

- Small known JSON or one-off transform: codemode plus `read`, subject to file/return limits.
- Medium/large JSONL scanned once: native runtime line streaming with early filtering and bounded aggregation.
- Repeated analytics over stable large files: optional indexed backend. Account for index-build time, disk use and invalidation.
- Query shapes that need joins, multi-file aggregation or complex sorts: a vetted query engine behind the same typed interface, not raw model-authored SQL.

Avoid fixed universal breakpoints such as “at 10 MB use SQLite”: the crossover depends on disk, runtime, query selectivity, whether an index is warm, and query count. Benchmark representative local fixtures to establish thresholds.

**Caching:** key to a verified source identity (such as path + strong content fingerprint, or metadata with a documented staleness tradeoff), query semantics, schema version and relevant policy scope. Invalidate on edits. Do not reuse a cache across agents if doing so leaks data across capability boundaries. Caches are an optimization and should fail back to a correct uncached path.

### 24.4 Avoid over-abstracting simple tasks

Keep `read`, `grep`, `find`, `ls`, `edit` and `write` usable directly where policy allows. Build typed higher-level tools for stable operations with high existing shell usage (`query_jsonl`, `git`, `run_validation`) before creating a universal query facade. Use codemode for irregular glue, not as an extra mandatory hop for every basic read/search. Small tools with clear names and compact schemas generally consume less prompt space and are easier for models to select correctly.

---

## 25. Model-facing guidance and capability coverage

### 25.1 Prompt instructions are steering, not completeness guarantees

Agent instructions should describe the **intent-to-tool map**, not executable choices:

```text
Search for exact text -> grep with literal=true.
Search with regular expressions -> grep regex mode.
Find files -> find; inspect paths -> ls; read a known range -> read.
Analyze modest one-off JSON -> codemode.
Filter/count/group JSONL -> query_jsonl.
Inspect or change git state -> typed git tool.
Run approved checks -> run_validation(check=...).
Unsupported operation -> report missing capability or request restricted_exec,
                         never emulate arbitrary shell in another tool.
```

The tool descriptions should be task-oriented and include examples, return limits and failure meanings. Do not rely on system-prompt tuning to enforce safety, hide unavailable tools, or make unsupported operations magically available. Removing bash may legitimately reveal unhandled workflow requirements.

### 25.2 Instrument *unmet intent*, not only bash denials

Once `bash` is absent, models might not even attempt a blocked `bash` call; a simple “zero attempted bash commands” metric can therefore produce false confidence. Collect a structured `CAPABILITY_GAP` event when an operation is unsupported, a result is insufficient, or the agent asks to escalate. Log rejected typed requests and escape-hatch requests too. Capture the requested outcome and missing semantic operation (not necessarily raw private file content).

Use the observed transcript categories from Sections 2–3 as the initial corpus, then replay representative engineering tasks and compare with a controlled bash-enabled baseline. For each category record: completed without bash, completed via restricted escape hatch, failed due to missing tool, failed for other reason, and produced an incorrect result. This gives measurable **coverage of workflows**, not a claim that all future possible shell uses have been replaced.

### 25.3 Suggested coverage acceptance criteria (proposals, not measured facts)

Set project-specific numerical thresholds after a baseline run. Until then use explicit qualitative gates:

- All observed workload categories have either a working semantic replacement or a documented and constrained escape path.
- Read-only roles complete their reference tasks with no general process access.
- Editing roles can run required git/validation workflows inside the intended sandbox.
- No regression test turns permitted low-level operations into unrestricted execution.
- Missing capabilities are surfaced and logged rather than silently improvised.
- Performance and output semantics remain equivalent on a differential test corpus.

Do not count deliberate safety denials as capability regressions.

---

## 26. Measurement and benchmark protocol

### 26.1 Paired end-to-end runs

Compare (A) the existing bash-enabled workflow and (B) the semantic-tool workflow using the **same tasks, repositories, data snapshots, machine and model configuration**. Repeat enough runs to expose variation. Check correctness first; compare speed only for equivalent outputs. Report median and tail (for example p95) tool latency and overall time, plus token consumption and success rate.

Capture per operation:

```text
operation, backend, schema_version, permitted_or_denied,
input_bytes, output_bytes, records_scanned, records_returned,
elapsed_ms, cpu_ms (if available), peak_memory_bytes (if available),
cache_hit, truncated, exit_status, error_class, agent_id, run_id
```

Avoid logging secrets or unlimited tool arguments; metadata and redacted/hashed inputs are preferable for durable telemetry. Pi's `tool-calls.jsonl` is a natural integration point, but its current schema must be checked before adding fields.

### 26.2 Benchmark matrix

| Workload | Dataset shape | Check correctness | Measure |
|---|---|---|---|
| Literal search | Many source files, common and rare terms | Identical matching paths/lines | Search latency, output bytes, model turns |
| Regex search | Representative regex patterns | Match equivalence or documented differences | Latency, timeout behavior |
| File navigation | Small and large repo trees | Matching path sets within ignore policy | Traversal time, output count |
| JSON known value | Small nested objects | Equal extracted value/types | Total tool calls and latency |
| JSONL count/group | Large logs, sparse/dense matches | Exact counts, missing/malformed handling | Parse time, peak memory, bytes returned |
| Repeated JSONL query | Same file, many query shapes | Same results after edits | Cold/warm cache and index amortization |
| Git | Large status/diff, renamed/untracked files | Equivalent status and diff | Subprocess overhead, output bounds |
| Validation | Unit/typecheck/lint on same checkout | Same exit and diagnostics | Total duration, cancellation and timeout |

Include adversarial cases from Section 18.4 alongside performance tests so optimization cannot degrade safety.

### 26.3 Decision rules for optimizations

An optimization is accepted only if it (1) preserves correctness and permission semantics, (2) provides a repeatable meaningful improvement in latency, tokens, memory, or total model calls on a real workload, and (3) does not materially increase fragility or maintenance. Retain a simple fallback path. Do not prematurely add indexes, caches, custom grep wrappers or multiple runtime engines without evidence of a hotspot.

---

## 27. Implementation additions to the existing plan

These actions extend the implementation phases in Section 15:

**A23. Semantic-operation inventory.** Turn the observed bash transcript categories into a manifest: intent, typed inputs, permissions, expected result, legacy commands, selected implementation and missing edge cases.

**A24. Shared contract/dispatcher module.** Define strict schemas, semantic versioning, resource limits, output/error envelopes and consistent policy evaluation. Start with a small implementation table; do not build a plugin marketplace or second general-purpose interpreter.

**A25. Prioritize high-value tools.** Keep Pi's existing read/search/navigation tools as direct primitives; implement `query_jsonl` first, then typed `git` and `run_validation`. Add other purpose-specific operations on observed demand.

**A26. Differential fixtures and end-to-end replay.** Test old vs new behavior for repository search, JSON/JSONL, git and validation. Log unmet intent, including model requests that cannot name any existing tool.

**A27. Benchmark the routing thresholds.** Compare streaming vs indexed repeated queries; codemode vs native JSON transformations; direct Pi grep vs extra wrapper overhead. Use real task-level measurements to keep or reject each route.

**A28. Add safe backend evolution.** Change backend implementation behind stable contracts, verify equivalent results, preserve cancellation/limits, and invalidate caches after writes. Route executable backends through shared sandbox policy.

### 27.1 Definition of done for a performant bash replacement

A credible release should demonstrate all three claims independently:

1. **Functional:** measured reference tasks still complete, or intentionally disallowed activities fail clearly.
2. **Security:** capability and composition attacks remain contained even if an agent is manipulated or mistaken.
3. **Performance:** benchmark evidence shows where the new tool surface is faster/cheaper; any regressions are understood and acceptable.

**Bottom line:** semantic operations shift implementation choice from probabilistic model-authored shell commands into deterministic, optimizable runtime code. Performance benefits are plausible and often substantial for repeated structured-data work, but they are **not automatic**. Keep fast Pi built-ins, add specialized tools where they pay for themselves, and prove outcomes with measured end-to-end workloads.

---

## 28. References checked for this revision

### pi

- Settings / tool selection  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md

- Current grep implementation (`literal` -> ripgrep `--fixed-strings`)  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/grep.ts

- Codemode package and runtime notes  
  https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md

- pi releases / nested tool APIs / codemode integration  
  https://github.com/earendil-works/pi/releases

### Current Pi API references used for reconciliation

- Current SDK  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md

- Current settings / `defaultTools` / codemode settings  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md

- Current extension examples  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/README.md

- Current minimal typed custom tool example  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/hello.ts

- Current `permission-gate.ts`  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/permission-gate.ts

- Current codemode documentation  
  https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md

- Current Pi releases  
  https://github.com/earendil-works/pi/releases

- Current coding-agent security documentation  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md

- Current execution environment package  
  https://github.com/earendil-works/pi/tree/main/packages/env

### Distribution and packaging

- Pi packages: create, declare resources under the `pi` key, convention directories, install/remove/update, scopes, peerDependencies  
  https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md

- `defaultTools` preserves extension and SDK custom tools (fixed in @earendil-works/pi-coding-agent 0.84.2)  
  https://github.com/earendil-works/pi/releases

- salesforce/sf-pi: production example of an opt-in pi extension bundle (`pi install git:...`, manager extension, bundled skills, `/doctor`, per-project vs global)  
  https://github.com/salesforce/sf-pi

- useful-pi-extensions: packaging/manifest example (`pi install npm:...`, `"pi": { "extensions": [...] }`)  
  https://pi.dev/packages/useful-pi-extensions

### Additional agent-safety reference

- Bash: Damage From Within  
  https://github.com/disler/bash-damage-from-within

- Pi-specific five-level examples  
  https://github.com/disler/bash-damage-from-within/tree/main/pi

### Search behavior

- GNU grep: `grep -F` and obsolescence of `fgrep`  
  https://www.gnu.org/software/grep/manual/html_node/Usage.html

- ripgrep project / performance and literal search behavior  
  https://github.com/BurntSushi/ripgrep

### API and packaging verification references (2026-10-08)

- Pi packages / `pi install` / manifest / scopes: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md
- Pi current settings and `defaultTools` behavior: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md
- Pi grep source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/grep.ts
- Pi codemode documentation: https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md
- Pi SDK overview: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md

These references confirm relevant interfaces; dispatcher schemas, routing thresholds, benchmarks and acceptance tests in Sections 23–27 are **proposals**, not features claimed to exist in Pi.

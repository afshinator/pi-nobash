# pi-nobash — Product Specification v1.4

**Status:** Proposed product baseline; technical details subject to validation against the targeted Pi release  
**Date:** 2026-10-09  
**Product:** `pi-nobash`  
**Supersedes:** Product Specification v1.3

## 1. Product definition

`pi-nobash` is an opt-in package and configuration for Pi coding agents. It **removes the model-facing Bash tool** and **replaces the Bash operations that agents actually need with specific, typed tools**. The purpose is to prevent a well-intentioned model mistake from turning into an arbitrary shell command with destructive consequences, while retaining useful engineering capabilities.

The primary failure being addressed is **accidental misuse**, not a malicious model, jailbreak, prompt-injection campaign, or adversarial bypass. The replacement must not make those threats easier, but solving them is not the package's purpose.

**Product rule:** The agent selects a supported operation and supplies structured arguments. Trusted tool code decides how to perform it. The model never supplies an arbitrary shell command or an equivalent general-purpose execution request.

### 1.1 Goals

- **G1 — Remove Bash:** Remove `bash` from the active model-facing toolset in configured Pi sessions, with a simple tool-call block as backup.
- **G2 — Replace real workloads:** Preserve normal repository reading/searching, editing, Git, validation, JSON/JSONL analysis, and other recurring operations documented in session transcripts.
- **G3 — Avoid recreating arbitrary execution:** Replacement tools use narrow operations, typed inputs, explicit scopes, and tool-owned execution details; no shell-string pass-through.
- **G4 — Retain efficiency:** Prefer direct Pi built-ins and efficient native/streaming implementations, minimizing context, runtime and unnecessary model turns.
- **G5 — Expose gaps:** Report missing capabilities immediately rather than silently falling back to a shell or inventing workarounds.
- **G6 — Simple adoption:** Support user and project installation, a small diagnostic command, and clear reversal.

### 1.2 Non-goals

- General adversarial security hardening or formal proof of resistance to prompt injection and malicious extensions.
- Mandatory OS-container, VM, micro-VM or whole-process isolation.
- Complex startup admission/cancellation gates, provider-side cancellation assurances, or attestation matrices.
- Replacing all subprocesses: Git, tests, build tools and compilers still need controlled execution.
- A general interpreter/command runner under a new name, or a universal semantic dispatcher wrapping every existing Pi tool.
- Automatic protection of independent Pi/SDK processes that have not activated this configuration.
- Claims of universal performance improvement without measurements.

## 2. Workload evidence and replacement coverage

The Bash Substitution Assessment v2.5 analyzed **411 Bash calls** in the observed sessions. The initial inventory below is the basis for prioritization; figures are historical samples, not promises about every agent workload.

| Observed use | Calls | Intended replacement |
|---|---:|---|
| Inline Python, mostly JSON/JSONL processing | 109 | `query_jsonl` / `json_query`; codemode for modest one-off transforms |
| `grep` / `rg` | 91 | Existing Pi `grep` |
| `cat` / `sed` / `head` / `tail` | 72 | Existing Pi `read` |
| Tests / typecheck | 55 | `run_validation` with named checks |
| Git | 54 | Typed `git` operations |
| Pi CLI probes/checks | 15 | `check_model` or narrowly defined Pi-specific operations, as justified by examples |
| `ls` | 5 | Existing Pi `ls` |
| Filesystem `cp` / `mv` / `rm` | 3 | Typed file-lifecycle operations, only for demonstrated needs |
| `fallow` | 3 | Optional project-specific companion tool |
| `herdr` | 2 | Optional project-specific companion tool |
| `qlmanage` / `sips` | 2 | Optional fixed rendering/conversion tool |
| Other | 3 | Examine individual calls before adding tools |

**Coverage rule:** Each observed category must either have a working replacement or a documented capability gap. Do not add a generic process executor just to claim complete coverage. Preserve the underlying transcript inventory for implementation and testing.

## 3. User experience and deployment

### 3.1 Package and configuration

The `pi-nobash` package supplies replacement tools, an unconditional Bash-call block, concise agent tool-selection guidance, and `/nobash-status`. Pi's effective **settings** select the package and exclude Bash. Installing the package alone does not necessarily remove Bash from the model-visible toolset.

A conceptual project configuration is:

```json
{
  "packages": ["git:github.com/<owner>/pi-nobash@<pinned-ref>"],
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

This example requires verification against the supported Pi release, including how custom tools coexist with `defaultTools`, and how CLI/SDK overrides affect effective selection. It is not a package manifest or a claim that package installation automatically updates tool-selection settings.

### 3.2 Using the package

- **Solo developer:** Install the package in user scope, configure tool selection, restart Pi, and run `/nobash-status` to confirm Bash is absent and replacements are available.
- **Project/team:** Commit the package reference and tool selection in the project's `.pi/settings.json`. Each Pi instance must load that project configuration; independent peers and SDK/headless instances must be configured separately.
- **Daily use:** The model calls familiar Pi built-ins and the new typed tools. If the required operation is not supported, it reports what is missing.
- **Deactivation:** Remove/disable the package and remove the `-bash` selection in the applicable settings scope; restart and inspect the effective tools. Partial deactivation can leave one control active.

### 3.3 Diagnostics

`/nobash-status` reports, where inspectable: package/version, applicable settings scope, whether `bash` is currently exposed, whether the backstop extension is loaded, which replacements are available, and configuration errors. It is a **configuration diagnostic**, not an attestation of universal process or adversarial security. A package that fails to load cannot supply its own diagnostic command.

## 4. Model-facing tools

### 4.1 Reuse existing Pi tools

Retain `read`, `grep`, `find`, `ls`, `edit`, and `write` where appropriate. Do not wrap them without a demonstrated benefit.

- Literal text: prefer Pi `grep` with `literal: true`; regex only when needed.
- Discovery: use `find` for paths and `ls` for directories.
- Reading: locate results first and use bounded `read` for the relevant range.
- Editing: use `edit` / `write` directly, subject to the project's normal file permissions.

### 4.2 Core new tools

| Tool | Model chooses | Tool implementation owns |
|---|---|---|
| `query_jsonl` | File, typed filter/projection, grouping/aggregate, result limit | Streaming parser, limits, output shape, efficient aggregation |
| `json_query` (if needed separately) | File/value path and bounded typed query | JSON parsing/selection; no arbitrary JS/jq/SQL source |
| `git` | Enumerated operation and typed arguments | Exact Git subcommand/flags/argv; no shell-string command |
| `run_validation` | Name of a configured test/lint/typecheck/build check | Configured executable and arguments, working directory, timeout, bounded output |

Initial Git operations: `status`, `diff`, `log`, `show`; add `add`, `commit`, and branch/worktree actions when they are specified and tested. Do not expose free-form Git flags by default. Explicit operations can mutate state and should be named accordingly.

A validation task must be identified by a **trusted, predefined check name**, not a model-supplied command, executable path, script body, or arbitrary argument list. Such checks may execute repository-owned code: this package reduces arbitrary model-authored shell commands; it does **not** promise that every project's test/build script is harmless.

### 4.3 Other observed operations

- `check_model`: add a narrow tool for the specific Pi/model checks represented by the transcript calls, after defining the needed operations.
- File lifecycle: add explicit `copy`, `move`, and narrowly scoped `delete` only as required. Avoid unrestricted recursive deletion; require explicit workspace targets and enforce relevant path constraints.
- Rendering/conversion: add typed fixed-format operations where demonstrated.
- `fallow`, `herdr`, and other user/project-specific utilities: keep in optional companion packages unless evidence establishes general applicability.
- Codemode: permit bounded, modest computation and composition of approved tools when enabled. Do not provide process/OS access through it, and do not substitute it for efficient large JSONL processing.

There is **no general `restricted_exec` in the default product**. If an operation cannot be represented safely, the package reports a capability gap. A separate, explicitly opted-in execution environment can be considered outside the core no-Bash claim, but must not be marketed as an equivalent safe replacement.

## 5. Tool contract requirements

Each new model-facing capability must have:

1. A specific purpose and enumerated operations.
2. Typed arguments with validation; no `command`, arbitrary `script`, `shell`, or general executable string.
3. Defined file/path scope and bounded effects appropriate to the operation.
4. Deterministic tool-owned dispatch; where a subprocess is necessary, construct fixed executable/argv without a shell.
5. Bounded time and output, cancellation support where practical, and concise, structured errors.
6. Predictable result semantics including truncation and failed/partial execution.

Do not assume `shell: false` makes a program harmless. Some programs, Git hooks and project scripts have their own side effects. Minimize unnecessary executable freedom and scope actions to the intended project.

**Capability-composition check:** When adding an interpreter, runner, file-writer/launcher pairing, or configurable command, ask whether the model can combine exposed operations to regain arbitrary execution. Do not add a path that is effectively Bash under another name. This is a lightweight design review, not an adversarial proof program.

## 6. Performance requirements

- Prefer existing efficient Pi tools for ordinary search and reads; `grep(literal: true)` expresses fixed-string intent without regex overhead.
- Use codemode for small, one-off JSON tasks; use native streaming/early filtering and bounded aggregation for large JSONL.
- Add caching or indexing for repeated queries only when representative benchmarks show a net benefit, including index-build and invalidation costs.
- Keep output small: return matches, counts, projected fields, errors and truncation metadata rather than full source logs.
- Measure correctness, full-task elapsed time, model/tool calls, token volume, and memory where practical. Backend changes must preserve observable semantics.

The goal is efficient **completed tasks**, not maximum subprocess speed in isolation.

## 7. Practical safeguards

These controls are proportional to accidental-mistake prevention, not a general adversarial threat model.

- **Tool removal:** Exclude model-facing `bash` in effective tool selection.
- **Simple backstop:** Reject attempted built-in Bash tool calls when this package's extension is loaded, including accidental re-exposure through a tool-selection override. The hook is not claimed to intercept direct Node/process calls inside unrelated extensions.
- **Typed scopes:** Ensure each replacement validates permitted operations, file paths, and arguments. Destructive file actions should be explicit and workspace-scoped.
- **Controlled validation:** Only approved named checks, with limits, may launch project tools; do not assume those scripts are inherently safe.
- **Clear failures:** Unsupported/denied operations surface to the caller, with no silent Bash fallback.

OS-level isolation, disposable worktrees and snapshots are useful optional protections for agents running untrusted project code. They may be recommended separately, but **are not a release gate for the core package**. This product does not promise containment of arbitrary third-party extensions, repository scripts, or host processes outside the tools it controls.

## 8. Acceptance criteria

| ID | Requirement | Evidence |
|---|---|---|
| AC1 | Bash is absent from the effective model-facing toolset | Inspect active tools in configured Pi session |
| AC2 | Backstop blocks attempted Bash tool calls | Deliberately expose a test Bash call; verify denial before execution |
| AC3 | Existing Pi file/search/edit primitives remain usable | Representative read/search/find/edit tests |
| AC4 | Typed Git supports specified operations without command strings | Tests for valid operations and invalid/free-form inputs |
| AC5 | Named validation works without a model-authored command | Tests/typecheck/lint fixture using approved checks |
| AC6 | JSON/JSONL tasks preserve results and handle large files efficiently | Differential fixtures and streaming/size tests |
| AC7 | Replacement APIs do not offer arbitrary shell/interpreter execution | Schema review and negative tests against shell-string inputs |
| AC8 | Unsupported workload is clearly reported | Capability-gap example in interactive and, where supported, SDK/headless use |
| AC9 | User/project activation and deactivation are clear | Configured Pi integration tests and diagnostic output |
| AC10 | Replacements preserve practical engineering coverage | Replay representative transcript-driven tasks without Bash |
| AC11 | Performance is measured, not presumed | Task-level benchmark comparing baseline and replacements |

No startup hook-attestation canary, provider-side cancellation proof, A1–A5 adversarial matrix, micro-VM coverage proof, or whole-process isolation certification is required for these acceptance criteria.

## 9. Release order

**Phase 1 — No-Bash baseline**

- Package setup, Pi tool selection (`-bash`), unconditional Bash-call block, concise tool-use guidance, and `/nobash-status`.
- Verify the effective tool list and normal read/search/edit workflows.

**Phase 2 — High-value replacements**

- Implement `query_jsonl` first, then typed `git` and named `run_validation`.
- Validate operation semantics and replay the common workload categories.

**Phase 3 — Remaining observed gaps**

- Add `json_query`, Pi/model probes, file lifecycle and conversion tools where actual calls justify them.
- Keep project-specific operations separate.

**Phase 4 — Operational validation and tuning**

- Test package activation in the supported interactive/project/SDK configurations.
- Compare Bash baseline tasks with typed-tool equivalents for correctness, completion and performance.
- Fix recurring capability gaps; optimize only measured bottlenecks.

## 10. Open technical questions

- **Q1.** Which exact Pi version(s) and extension/SDK APIs will the first release support, and how do tool-selection overrides behave there?
- **Q2.** How should the named validation-check registry be configured and trusted for user/project use?
- **Q3.** Which Git mutations are required for the initial release versus later additions?
- **Q4.** Which observed Pi CLI/model probes require a dedicated tool, and what exact results should they return?
- **Q5.** Which missing filesystem/rendering operations justify new tools instead of explicit capability gaps?
- **Q6.** What are the actual performance and task-coverage results when replayed against representative sessions?

These are implementation questions, not grounds for introducing generalized security gates.

## 11. Final product rule

**Ship a Pi package that removes model-facing Bash and replaces real engineering Bash workloads with narrowly defined typed operations.** Test the replacement capabilities and effective Bash removal. Do not quietly reintroduce arbitrary command execution, and do not turn the project into an adversarial security or sandboxing framework.

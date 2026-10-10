# pi-nobash — Product Specification v1.5

**Status:** Proposed product baseline; Pi runtime details require implementation verification  
**Date:** 2026-10-09  
**Product:** `pi-nobash`  
**Supersedes:** Product Specification v1.4 and alternate Product Specification B v1.4

## 1. Product definition

`pi-nobash` is an opt-in Pi package plus tool-selection configuration that **removes model-facing Bash** and **replaces operations actually needed by coding agents with narrow, typed tools**. The primary problem is accidental damage: a well-intentioned model can hallucinate or misunderstand a shell command and destroy files or other work. The product removes the general-purpose command interface rather than attempting to make model-generated shell strings safe.

**Governing rule:** The agent chooses a supported operation and supplies structured arguments. Trusted tool code chooses the executable or implementation, validates parameters, and limits effects. No ordinary replacement is an arbitrary shell, command runner, or interpreter entrypoint.

This is **accidental-mistake prevention**, not a project to prove resistance to deliberate attackers, prompt injection, or sandbox escape. Removing Bash must not make such bypasses easier by adding an equivalent general-purpose execution tool.

### 1.1 Goals

- **G1 — Remove Bash:** `bash` is absent from the effective model-facing tools in configured sessions; a simple `tool_call` block is a backstop if Bash is re-exposed.
- **G2 — Preserve engineering work:** Replace the real transcript-observed needs for reading, searching, editing, JSON/JSONL analysis, Git, tests and validation, and justified specialized operations.
- **G3 — Keep replacements narrow:** Typed operations and validated arguments; no shell-string pass-through, agent-selected arbitrary executables, or general interpreter launcher.
- **G4 — Keep agents efficient:** Reuse Pi built-ins and choose efficient native/streaming implementations without unnecessary tool round trips or large model outputs.
- **G5 — Make gaps visible:** An unsupported task produces an explicit capability-gap response to the current invoker, not a silent fallback or fabricated completion.
- **G6 — Keep adoption straightforward:** Support user and project activation, effective-tool diagnostics, and clean deactivation.

### 1.2 Non-goals

- Adversarial security hardening, comprehensive prompt-injection defense, or formal bypass-proof matrices.
- Mandatory container/VM/micro-VM isolation or whole-process containment certification.
- Elaborate startup admission gates, hook canaries/attestation, or provider-request cancellation proofs.
- Eliminating all subprocess execution: controlled Git and configured validation still need processes.
- A `restricted_exec` mode, generic process escape hatch, arbitrary Python/Node/jq execution, or universal dispatcher for existing Pi primitives.
- Automatic coverage of other Pi instances that have not loaded the effective configuration.
- Unmeasured claims that every replacement is faster.

## 2. Evidence: observed Bash workload

The Bash Substitution Assessment v2.5 classified **411 Bash calls** across observed sessions. Counts prioritize the first tool set; they are not universal workload estimates.

| Observed use | Calls | Replacement direction |
|---|---:|---|
| Inline Python, mostly JSON/JSONL | 109 | `query_jsonl` and, when warranted, `json_query`; bounded codemode for modest one-off transformations |
| `grep` / `rg` | 91 | Pi `grep` |
| `cat` / `sed` / `head` / `tail` | 72 | Pi `read` |
| Test / typecheck | 55 | `run_validation` using named configured checks |
| Git | 54 | Typed `git` operations |
| Pi CLI/model probes | 15 | Specific `check_model`/Pi operations after inspecting those calls |
| `ls` | 5 | Pi `ls` |
| `cp` / `mv` / `rm` | 3 | Narrow file lifecycle operations, only when justified |
| `fallow` | 3 | Optional companion package |
| `herdr` | 2 | Optional companion package |
| `qlmanage` / `sips` | 2 | Optional typed rendering/conversion tool |
| Other | 3 | Inspect individually before adding tools |

**Coverage rule:** Track each observed use against a working substitute or a documented capability gap. Do not solve the last few gaps by adding a general executor. Preserve representative transcript examples as fixtures for implementation and regression tests.

## 3. Product distribution and use

### 3.1 Package/configuration split

The **package** registers replacement tools, the unconditional Bash-blocking hook, concise agent guidance, and `/nobash-status`. **Pi settings** select the package and remove Bash via effective `defaultTools`. Installing the package alone is not equivalent to removing Bash from the model-facing toolset.

Illustrative project `.pi/settings.json` (verify against the supported Pi version):

```json
{
  "packages": ["git:github.com/<owner>/pi-nobash@<pinned-ref>"],
  "defaultTools": ["-bash", "+grep", "+find", "+ls", "+codemode"]
}
```

Actual tool selection, extension-tool coexistence, overrides, and packaging syntax must be checked against the targeted Pi release. The package should be distributed from a versioned or pinned source.

### 3.2 Solo activation

1. Install the package in Pi's user scope.
2. Set effective user `defaultTools` to exclude Bash while retaining needed built-ins and replacements.
3. Restart/start Pi and run `/nobash-status` to inspect Bash absence and replacement availability.

A package installed without the complementary settings is **not** reported as a fully activated no-Bash profile.

### 3.3 Project/team activation

1. Commit a project `.pi/settings.json` containing the pinned package reference and Bash-excluding tool selection.
2. Each contributor starts Pi in the project and accepts any applicable project-trust prompt.
3. Verify that the package loaded and the effective model-facing tool list excludes Bash.

This profile applies **only** where the project settings are effective. Independently launched Pi, SDK, or headless agents need their own effective configuration. Do not assume a supervisor's profile automatically applies to separate peer processes.

### 3.4 Daily behavior and capability gaps

The agent uses the relevant built-in or typed tool. If no supported operation can complete the requested task, it reports the **missing capability and uncompleted work in the originating turn**: a user-visible message in interactive use or an equivalent machine-readable failure to the SDK/headless caller where supported. Record a `CAPABILITY_GAP` event as well; telemetry alone is insufficient. Do not silently call Bash, invoke an unrelated tool as a workaround, or claim completion.

### 3.5 Diagnostics and deactivation

`/nobash-status` is an actionable **configuration diagnostic**, not a security attestation. Report what is observable:

- effective Bash exposure and available replacement tools;
- whether this package and its Bash-blocking hook are loaded;
- Pi compatibility and applicable user/project scope;
- profile state: active, partial, inactive, failed, or unknown, with specific reasons.

An unknown check must not be presented as verified. Keep it lightweight: no pre-turn canary, proof matrix, sandbox attestation, or provider cancellation status. A package that does not load cannot provide its own command.

To deactivate, remove/disable **both** the package reference and `-bash` selection in the relevant settings scope, restart, and inspect the effective tool list. Removing only one can leave partial activation. Project changes must be committed for teammates. Do not claim the absent package can diagnose itself after removal.

## 4. Required tool surface

### 4.1 Keep Pi's built-in primitives

Use `read`, `grep`, `find`, `ls`, `edit`, and `write` directly where appropriate; do not wrap them just to make every operation uniform.

- Exact text: `grep` with `literal: true`; regex only when actually required.
- File discovery: `find`; directory inspection: `ls`.
- Known file content: targeted/bounded `read` instead of dumping large files into context.
- Editing: `edit` / `write` subject to the intended workspace and role permissions.

### 4.2 Core new capabilities

| Tool | Model-facing request | Tool implementation owns |
|---|---|---|
| `query_jsonl` | File, typed filters, projections, grouping/count/aggregate, result limit | Streaming scan, parsing, bounded aggregation and output |
| `json_query` (if warranted) | File/value path and bounded typed selection | JSON parsing, query implementation, results; no JS/jq/SQL source strings |
| `git` | Enumerated operation with typed paths/ref/message where applicable | Exact Git invocation and allowed flags, no free-form Git command |
| `run_validation` | Name of a trusted configured check, optional narrow parameters | Executable, argv, working directory, timeout, cancellation, output limit |

Initial Git read operations: `status`, `diff`, `log`, `show`. Add `add`, `commit`, branch and worktree mutations when the exact semantics and observed needs are defined and tested. Do not offer arbitrary flags or destructive Git commands via free-form arguments.

Validation checks are named and configured by a trusted developer/project configuration. The agent cannot supply command text, an executable path, a script body, or arbitrary argv. A configured test/build script still has the normal effects of running repository code; this product does not claim otherwise.

### 4.3 Specialized tools, based on evidence

- Pi/model checks: a `check_model` or similarly narrow tool for the actual observed probe operations.
- File lifecycle: explicit `copy`, `move`, and narrowly scoped `delete` only as required, with explicit targets and workspace checks; do not add unrestricted recursive deletion.
- Rendering/conversion: typed source/target/format operations only if the observed tasks need them.
- Project-specific `fallow`, `herdr`, and other utilities: optional companion package, not mandatory core dependencies. A companion does not receive an exemption from the no-general-execution principle.
- Codemode: modest, bounded glue and JSON transforms through approved tools. It must not provide arbitrary OS/process execution; use streaming native tools for large JSONL instead of repeatedly parsing whole files in the model-facing runtime.

**No core `restricted_exec` or escape-hatch mode.** If a task cannot fit an operation-specific interface, report it as unsupported. A developer may separately choose a different execution environment, but that is not part of the `pi-nobash` replacement guarantee.

## 5. Tool contract requirements

Each newly exposed tool must define:

1. A specific purpose and enumerated operations.
2. Typed, validated inputs; no unrestricted `command`, `script`, `shell`, executable selector, or free-form command flags.
3. The appropriate permitted paths, operation effects, and explicit mutation behavior.
4. Tool-owned implementation selection; processes, if required, use fixed executable/validated argv with no shell parsing.
5. Appropriate resource and output bounds, concise errors, and cancellation where practical.
6. Defined result semantics, including truncation, partial completion, and errors.

`spawn(..., { shell: false })` removes shell parsing but does **not** make a subprocess intrinsically harmless. For any new runner/interpreter/writer combination, perform a short capability-composition review: **could the model combine these exposed operations to recreate arbitrary execution?** If yes, narrow or reject the design. This is routine API review, not an adversarial testing program.

## 6. Efficiency and correctness

- Prefer existing Pi read/search primitives when they already perform well.
- Use bounded codemode for irregular, modest JSON work; native streaming and early filtering for large JSONL; add caches/indexes only if repeat-query measurements justify their complexity.
- Filter/project/aggregate before returning results to the model; return bounded output and explicit truncation metadata.
- Benchmark comparable Bash-baseline and replacement tasks for output correctness, total elapsed time, model turns, token volume, and memory where practical.
- Switching backends must not silently change matching, ordering, numeric/null handling, path behavior, or results.

Optimize **completed engineering tasks**, not isolated parser or subprocess benchmarks.

## 7. Practical safeguards and scope limits

- Effective tool selection removes Bash; the extension's simple `tool_call` hook blocks attempts to invoke built-in `bash` if it becomes exposed again.
- The hook is a backstop, not an elaborate startup admission system. Verify it with ordinary integration tests; do not require pre-turn self-attestation.
- Structured tools validate operations and parameters, and keep destructive actions explicit and workspace-scoped where relevant.
- Named validation invokes known configuration, not model-generated process commands.
- Unsupported operations fail visibly without self-escalation, silent Bash fallback, or a generic command runner.

**Known limitation:** A typed validation tool can execute repository-controlled scripts that have side effects. Pi extensions may also execute internal code outside model-visible tool calls, which a `tool_call` hook cannot intercept. Disposable worktrees, backups, and OS-level isolation are useful optional deployment measures, but not features of this package or release gates. The package also cannot enforce anything if it fails to load; project installation must not be mistaken for a system-wide security boundary.

## 8. Acceptance criteria

| ID | Criterion | Required evidence |
|---|---|---|
| AC1 | Effective Bash removal | Inspect active model-facing tools: no `bash` in configured sessions |
| AC2 | Simple blocking backstop | When deliberately re-exposed in a test session, Bash tool call is denied before execution |
| AC3 | Existing Pi operations still work | Representative read/search/find/list/edit/write tasks succeed |
| AC4 | Typed Git works | Listed Git operations succeed; invalid/free-form command inputs are rejected |
| AC5 | Named validation works | Approved tests/lint/typecheck/build checks execute; model-supplied commands are rejected |
| AC6 | JSON/JSONL results are correct and bounded | Differential fixtures, large JSONL streaming tests, error and output-limit tests |
| AC7 | No arbitrary-execution substitute | API inspection and negative tests show no general shell string, executable selector, or interpreter launcher |
| AC8 | Missing capability is visible | Unsupported workload reports an in-turn failure to the invoker and records a capability gap |
| AC9 | Solo/project/headless configuration behaves as documented | Real integration tests for each supported deployment mode; partial activation and deactivation diagnosed correctly |
| AC10 | Real engineering coverage | Replay representative transcript-derived tasks without Bash; record intentionally unsupported operations |
| AC11 | Performance is measured | Baseline-versus-replacement task measurements with correctness checked first |
| AC12 | Diagnostic is truthful and useful | `/nobash-status` reports effective Bash exposure, package/hook availability, replacements, and partial/unknown state without security attestation claims |

No A1–A5 adversarial proof matrix, V0-HOOK canary, provider cancellation proof, compulsory VM sandbox, or comprehensive cross-package containment test is a release criterion.

## 9. Release order

**Phase 1 — Remove Bash and establish the profile:** Package registration, settings examples, `-bash`, a simple Bash-block hook, built-in tool coverage, guidance, and `/nobash-status`. Validate solo/project activation and basic deactivation.

**Phase 2 — Implement high-value substitutes:** Build `query_jsonl`, then typed `git` and `run_validation`; test semantics, error handling, output limits, and representative Bash transcript tasks.

**Phase 3 — Fill evidence-backed gaps:** Add `json_query`, Pi/model checks, narrow file lifecycle or rendering tools only when specific observed calls justify them. Keep specialized personal/project tools in optional companions.

**Phase 4 — Verify and tune:** Exercise the supported interactive and SDK/headless paths, report capability gaps to their callers, replay transcript fixtures, and benchmark task-level performance. Fix demonstrated gaps; do not add generalized execution for convenience.

## 10. Open technical questions

- **Q1.** Which Pi version and SDK/extension APIs will the first release support, especially `defaultTools`, custom-tool coexistence, and CLI/SDK overrides?
- **Q2.** How exactly are package loading, effective tool selection, and project trust observed in interactive/project/headless modes, and what simple diagnostic can reliably report them?
- **Q3.** What is the trusted configuration format for named validation checks, including project-owned scripts?
- **Q4.** Which Git mutations are needed initially beyond read-only operations?
- **Q5.** Which Pi CLI probes and residual filesystem/conversion calls actually justify additional tools?
- **Q6.** What supported mechanism lets headless SDK callers receive an explicit capability-gap outcome in the originating turn?
- **Q7.** What coverage and performance thresholds do representative task replays justify?

These are focused implementation questions, not requirements for a general security framework.

## 11. Final product rule

**Remove model-facing Bash. Replace actual engineering workloads with specific, typed, efficient tools. Do not introduce a renamed general-purpose executor.** Ship based on demonstrated effective tool removal, engineering-task coverage, predictable failures, and measured correctness/performance, not adversarial containment proofs.

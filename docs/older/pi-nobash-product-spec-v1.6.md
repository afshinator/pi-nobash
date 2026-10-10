# pi-nobash — Product Specification v1.6

**Status:** Proposed product baseline; implementation details to be verified against the targeted Pi release  
**Date:** 2026-10-09  
**Product:** `pi-nobash`

## 1. Purpose and governing principle

`pi-nobash` is an opt-in foundation for Pi-based agents that **removes model-facing Bash entirely** and replaces required operations with **purpose-built, typed tools**. The primary problem is accidental damage: a well-intentioned model can hallucinate a command, misunderstand a path, or choose destructive flags. An unrestricted shell turns that mistake into an action.

**Architecture: no Bash + explicit replacement capabilities.** Do not attempt to make arbitrary model-generated shell commands safe through prompt warnings, blacklists, or command-string allowlists. This is the *Level 5* approach illustrated by [`disler/bash-damage-from-within`](https://github.com/disler/bash-damage-from-within): remove Bash access and expose only the operations the agent is intended to perform.

**Hard rule:** The model requests a named operation with typed arguments. Trusted tool code selects the implementation and any necessary executable and arguments. No replacement tool accepts a shell command, model-written program, arbitrary executable, or interpreter entrypoint. Bash, codemode, and general-purpose execution fallbacks are excluded.

### 1.01 Intended applications

Although initially motivated by Pi coding-agent workflows, `pi-nobash` is intended as a **reusable foundation for task-oriented agents across different domains and applications**.

These agents are not necessarily conversational assistants. They may execute well-defined tasks autonomously, using models for reasoning and decisions while interacting with their environment exclusively through explicitly provided capabilities.

The architecture separates three responsibilities:

- **`pi-nobash` — Common foundation.** Removes Bash and general-purpose execution interfaces, provides reusable typed operations, and establishes a consistent restricted tool model.
- **Domain-specific Pi extensions — Capabilities.** Define the operations, schemas, data access, and application integrations appropriate to a particular domain. Examples include engineering workflows, financial analytics, and application-specific automation.
- **Task orchestrator — Workflow.** Defines tasks, inputs, outputs, agent roles, execution sequence, state transitions, completion criteria, and failure handling.

These components are logically separate and may be implemented or deployed together when appropriate.

### 1.02 Capability selection

**Agents receive only the tools required for their assigned responsibilities.** Installing `pi-nobash` does not imply that every agent receives every available replacement tool.

For example, a read-only analysis agent may need search and structured-data queries, while an engineering agent may additionally require file editing, Git operations, and validation. Domain-specific agents receive their relevant extension tools without inheriting unrelated engineering capabilities.

The foundation should remain small and reusable. Domain-specific behavior belongs in domain extensions, and workflow orchestration belongs in the application or orchestrator, not in `pi-nobash`.

### 1.03 Scope and limitations

This project addresses **accidental model mistakes**, not adversarial jailbreaks, prompt-injection resistance, or comprehensive host security. The replacement tool surface must not make arbitrary execution easier to obtain than before.

Removing Bash does not guarantee that agents cannot make destructive edits or that executing repository-owned tests is harmless. Such operations retain their inherent effects and must be handled through appropriately scoped tool implementations.

**Governing principle:** Pi provides model reasoning, `pi-nobash` establishes a restricted capability foundation, domain extensions define what agents can do, and task orchestrators define what agents must accomplish.


### 1.1 Goals

- **G1. Remove Bash:** No built-in `bash` in the effective model-facing toolset of configured Pi sessions. A minimal extension hook refuses any attempted invocation as a backstop.
- **G2. Preserve useful work:** Normal read/search/edit, JSON/JSONL analysis, Git, validation, and justified specialist workflows remain possible with specific tools.
- **G3. Avoid generic code execution:** No codemode, arbitrary Python/Node/JS/jq execution, `restricted_exec`, generalized command runner, or model-selected script execution in the supported profile.
- **G4. Limit accidental side effects:** Every mutating capability has explicit operations, validated targets, and a known effect scope. Do not silently provide broad destructive operations.
- **G5. Retain efficiency:** Prefer existing fast Pi tools; use streaming and bounded, tool-side filtering/aggregation where justified by workloads.
- **G6. Make activation and gaps visible:** Provide simple status diagnostics and explicit failure for unsupported work.

### 1.2 Non-goals

- Shell blacklists/whitelists or prompt-only prevention as the primary solution.
- Adversarial security proofs, hook-attestation canaries, provider cancellation guarantees, or a layered startup admission system.
- Mandatory containers, VMs, OS-level sandbox certification, or guarantees about other extensions' internal code.
- A replacement general-purpose programming environment, universal query language, or arbitrary SQL interface.
- Support for all conceivable shell use cases. Unsupported operations are legitimate outcomes until a narrow tool is justified.
- Claims of universal performance gains without testing.

## 2. Workload evidence and coverage priorities

The initial inventory classifies **411 Bash calls** observed across Pi sessions. This is a prioritization sample, not a claim about every future agent workload.

| Observed Bash usage | Calls | Replacement |
|---|---:|---|
| Inline Python, mostly JSON/JSONL processing | 109 | `query_jsonl`, `json_query` with typed filters, projections, and aggregations |
| `grep` / `rg` | 91 | Existing Pi `grep` |
| `cat` / `sed` / `head` / `tail` | 72 | Existing Pi `read` with targeted ranges |
| Tests / typecheck | 55 | `run_validation` with named, trusted checks |
| Git | 54 | Typed `git` operations |
| Pi CLI/model probes | 15 | Specific Pi/model-inspection tools after call-by-call review |
| `ls` | 5 | Existing Pi `ls` |
| `cp` / `mv` / `rm` | 3 | Explicit scoped file lifecycle operations only as justified |
| `fallow` | 3 | Optional specialist companion tool |
| `herdr` | 2 | Optional specialist companion tool |
| `qlmanage` / `sips` | 2 | Optional typed rendering/conversion tool |
| Other | 3 | Review individually; otherwise report capability gap |

**Coverage requirement:** Build a mapping from representative observed calls to corresponding supported tool operations, expected results, and remaining gaps. The 109 inline Python calls **must be examined by operation shape** before declaring `query_jsonl`/`json_query` sufficient: unusual transformations may remain unsupported. Do not restore codemode to cover the remainder.

## 3. Model-facing tool surface

### 3.1 Keep Pi built-ins

Expose, subject to agent role: `read`, `grep`, `find`, `ls`, `edit`, `write`. Use these directly rather than wrapping them in a universal dispatcher.

- Literal text search: `grep` with `literal: true`; regex only when regex behavior is needed.
- File discovery/listing: `find` and `ls`.
- Known file/range: `read`, preferably targeted to minimize returned context.
- Source changes: `edit` and `write` only for editing-capable agents, within their intended workspace.

### 3.2 Core replacement tools

| Capability | Model-selectable inputs | Trusted implementation owns |
|---|---|---|
| `query_jsonl` | Path, typed predicates, selected fields, group/count/aggregate, result limit | Streaming parse, bounded intermediate state and returned output |
| `json_query` | Path, typed path selection/filter/aggregate, result limit | Parsing and querying JSON; no arbitrary JS, jq expressions, or SQL |
| `git` | Enumerated operation; validated paths/revision/message for that operation | Fixed Git executable and operation-specific argument construction |
| `run_validation` | Name of an approved check, optional enumerated parameters | Trusted check definition, invocation, cwd, timeout, output/cancellation handling |

**Git:** Start with `status`, `diff`, `log`, and `show`; add `add`, `commit`, and specific branch/worktree actions as supported engineering tasks require. Exclude arbitrary flags, generic Git subcommand passthrough, and broad destructive actions such as unrestricted reset/clean. Treat mutations as explicit API contracts.

**Validation:** Checks such as `unit`, `lint`, `typecheck`, and `build` are configured by a trusted developer or project maintainer. The model cannot provide a command, script text, executable path, arbitrary argv, or a path to an agent-authored script for execution. Configured validation can still execute repository-controlled code, which is an acknowledged limitation, not proof that model-written code cannot ever execute indirectly.

**JSON:** Start with deterministic, narrowly scoped operators needed by transcript workloads. JSONL scans should process line by line, filter early, aggregate in the tool, and return bounded results. Cache/index only after repeated-workload measurement. Invalid input and truncated results must be explicit.

### 3.3 Optional, evidence-backed tools

- Narrow `check_model` / Pi inspection for the exact probe operations demonstrated by the transcript samples.
- Explicit workspace-scoped file `copy`/`move` and, only if essential, tightly defined `delete`. No open-ended recursive deletion interface.
- Typed rendering/conversion for documented image/SVG operations.
- Project-specific `fallow`, `herdr`, and similar tools in separate optional companion packages. They follow the same no-general-execution rule.

A small observed frequency does not by itself justify adding a tool. Prefer a visible unsupported-operation result to an unsafe or confusing API.

### 3.4 Explicitly excluded tools

The supported profile **does not expose**: `bash`, `powershell` or equivalent general shells, `codemode`, `restricted_exec`, `exec`, `run_command`, arbitrary interpreter execution, free-form SQL/JS/jq evaluators, or a general plugin tool that accepts executable commands. Equivalent generic execution capabilities installed by other extensions must also be excluded from the configured agent-facing selection; blocking only a tool literally named `bash` is insufficient to uphold the profile's goal.

## 4. Tool contract and accidental-damage rules

Every new tool must specify:

1. **Named intent:** A narrow set of enumerated operations, not a generic `command` field.
2. **Typed inputs:** Explicit parameters, validation, bounded sizes and values; reject unknown operations and fields.
3. **Effect scope:** Which files/paths/state it may read or mutate, including path normalization and workspace boundaries for relevant operations.
4. **Implementation ownership:** The package selects programs, arguments, configuration, and algorithms. Any subprocess uses a fixed executable and operation-built argv without shell parsing.
5. **Bounded work:** Appropriate timeouts, cancellation, memory/output/result limits and clear truncation or error states.
6. **Predictable results:** Consistent semantics for matching, filtering, sorting, nulls, malformed data, exits, and partial results.

Before accepting a new tool, perform one practical review: **Can the model combine this operation with existing `write`/`edit` or other capabilities to get unrestricted execution?** If so, narrow or reject the new operation. For example, `write(script)` plus `run_validation` must not permit the model to choose `script` as the execution target. Fixed project tests remain able to execute code by design; users should understand that distinction.

A fixed process invocation is not automatically side-effect-free. A typed Git mutation can destroy work if designed poorly, and a project test runner can execute project code. This package reduces unnecessary model-controlled execution surfaces rather than promising complete filesystem safety.

## 5. Distribution, activation, and daily behavior

### 5.1 Package and settings responsibilities

`pi-nobash` bundles its custom tools, a simple Bash-blocking `tool_call` hook, concise agent operating guidance, and `/nobash-status`. **Pi settings independently select the active tools**. Installing the package alone must not be described as removing Bash.

Illustrative project `.pi/settings.json` (confirm exact syntax/override behavior against the supported Pi runtime):

```json
{
  "packages": ["git:github.com/<owner>/pi-nobash@<pinned-ref>"],
  "defaultTools": ["-bash", "-powershell", "-codemode", "+grep", "+find", "+ls"]
}
```

The tool selection must be verified after loading: required replacements present, general shell/code runners absent. Explicit tool-selection configuration may vary by Pi version; the example is not a claim that every host supplies `powershell` or uses identical settings behavior.

### 5.2 Solo developer

1. Install a trusted, versioned package in user scope.
2. Set effective tool selection to exclude general shells/codemode and enable supported built-ins and typed replacements.
3. Restart Pi; run `/nobash-status` and inspect the active toolset.

### 5.3 Team/project

1. Commit project `.pi/settings.json` with the pinned package and required tool selection.
2. Launch Pi in the project and approve normal project trust when applicable.
3. Confirm the effective active tools, especially Bash/codemode absence and replacement availability.

Configuration applies only to sessions where the relevant settings and package are loaded. Each separate SDK/headless/peer Pi instance needs its own effective tool selection; do not assume a supervisor's settings propagate automatically.

### 5.4 Missing capabilities

If no permitted operation can fulfill a legitimate request, the agent must explicitly say what remains undone and which capability is missing **in the originating turn**. For SDK/headless sessions, provide the equivalent structured failure to the caller where supported. Emit a `CAPABILITY_GAP` event for review. Never silently fall back to Bash, codemode, a generic process runner, or an improvised equivalent.

### 5.5 Diagnostics and deactivation

`/nobash-status` is a lightweight configuration check. It reports:

- Effective active model-facing tools, including absence/presence of Bash, codemode, and other known generic runners.
- Loaded `pi-nobash` package, availability of replacement tools, and status of the Bash-block hook where observable.
- User/project scope, Pi compatibility, and actionable partial/unknown state.

The status command is **not security attestation**. Do not add startup gate matrices, pre-turn canaries, sandbox proofs, or provider-cancellation tests. If the package fails to load, its hook and diagnostic command cannot run.

To deactivate, remove the package and the corresponding tool-exclusion entries from the applicable settings, restart, and inspect the resulting effective tools. Removing just one may leave a partial configuration.

## 6. Performance and correctness

- Keep direct Pi `read`/`grep`/`find`/`ls` where appropriate; no needless wrapper round trips.
- Use literal matching for exact search and targeted reads after search.
- Use streaming scans and early filtering for JSONL; return only requested fields/aggregates and bounded results.
- Prefer simple native JSON parsing and explicit structured query operations to model-authored code.
- Add indexes, caches, or alternate query backends only after real repeated-query benchmarks justify complexity.
- Compare representative old Bash-based tasks against replacement tasks for result correctness, end-to-end latency, tool calls, output tokens, and memory where useful. Preserve semantics over small speed differences.

No performance improvement is guaranteed until measured.

## 7. Practical limits

The principal prevention mechanism is **absence of general-purpose model-facing execution tools**, reinforced by purpose-specific APIs and an unconditional Bash-call blocker. The blocker does not intercept arbitrary code inside other extensions or subprocesses launched without model-visible tool calls. Trusted validation commands and build systems may execute repository-controlled code and cause side effects. Optional disposable worktrees, backups, or OS-level isolation reduce consequences but **are not features or release gates of `pi-nobash`**.

This package is not an attacker-proof sandbox, and tool removal cannot ensure all edits are correct. Its claim is narrower and testable: a configured agent does not have Bash/codemode/generic execution access and can accomplish its supported engineering tasks through narrow substitutes.

## 8. Acceptance criteria

| ID | Criterion | Required evidence |
|---|---|---|
| AC1 | General execution removed | Effective tool inspection confirms `bash`, codemode, and any configured generic shell/code runners are absent |
| AC2 | Bash backstop works | Deliberately re-exposed Bash tool invocation is blocked before execution in integration test |
| AC3 | Built-in workflows work | Representative read/search/discover/list/edit/write tasks succeed |
| AC4 | JSON/JSONL workloads work | Representative transcript fixtures produce correct bounded results, including errors and large JSONL scans |
| AC5 | Git and validation work | Defined operations/checks succeed; arbitrary commands/flags/entrypoints are rejected |
| AC6 | No replacement general executor | Schema inspection and basic negative tests find no arbitrary shell, interpreter, command string, or free-form code evaluator |
| AC7 | Engineering coverage established | Transcript-derived uses are mapped to passing tool workflows or explicit capability gaps, including previously inline Python analyses |
| AC8 | Missing work is visible | Unsupported operations report in-turn failures and emit capability-gap records |
| AC9 | Activation is accurate | Solo/project and supported SDK/headless setup show expected active tools; diagnostics disclose partial configurations |
| AC10 | Reversibility | Removing package/settings and restarting gives the documented normal tool selection |
| AC11 | Performance and correctness measured | Paired representative task runs document correctness, latency, call count and output size; regressions explained |

No adversarial proof suite, micro-VM containment, pre-turn hook attestation, or provider-side cancellation evidence is required for this product.

## 9. Implementation order

**Phase 1 — No-Bash foundation.** Package structure, settings examples, remove Bash/codemode/generic execution tools, simple Bash-block hook, Pi built-ins, minimal guidance, `/nobash-status`, solo/project verification.

**Phase 2 — Essential substitutes.** Review real inline Python/JSON operations; implement `query_jsonl` and `json_query` based on those query shapes; implement typed Git and named validation. Build correctness fixtures and explicit limits for each.

**Phase 3 — Remaining observed needs.** Inspect Pi CLI/model probes, lifecycle and conversion calls individually; add only justified typed tools. Keep user-specific utilities in optional companions.

**Phase 4 — Verify real engineering workflows.** Replay representative transcript tasks without Bash/codemode, collect gaps, test tool-composition hazards, confirm interactive/headless activation, compare end-to-end cost/performance, and refine specific tools rather than adding generic execution.

## 10. Open implementation questions

- **Q1.** Which specific current Pi version/SDK APIs are supported for active-tool selection, extension registration, `tool_call` blocking, and project package loading?
- **Q2.** Which individual Python snippets in the sample workload need operations beyond filter/project/group/count and therefore require additional typed JSON operations?
- **Q3.** What named validation configurations and safe parameter variations cover the observed test/typecheck workflows without permitting agent-selected executables?
- **Q4.** Which Git mutations and edge cases are needed beyond read-only commands?
- **Q5.** Which Pi probes and other rare workload calls warrant purpose-specific tools?
- **Q6.** How should equivalent in-turn capability-gap results be delivered in supported SDK/headless integrations?
- **Q7.** What baseline task coverage and performance numbers justify release thresholds?

These questions inform the technical implementation; they do not justify restoring a general-purpose shell or code runner.

## 11. Product rule

> **Remove Bash and codemode from the model-facing Pi toolset. Replace the engineering tasks agents actually perform with specific, typed tools whose implementations are owned by trusted code. If a task lacks a tool, report the gap instead of restoring arbitrary execution.**

## References

- Pi project and SDK: https://github.com/earendil-works/pi
- Level 5 no-Bash design and examples: https://github.com/disler/bash-damage-from-within/tree/main/pi

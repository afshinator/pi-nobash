# pi-nobash — Product Specification v1.7.2

**Status:** Proposed product baseline for review  
**Date:** 2026-10-09  
**Product:** `pi-nobash`

## 1. Product definition

`pi-nobash` is an **opt-in package for the Pi agent harness**. It lets a developer configure a Pi session or agent **without model-facing Bash or equivalent general-purpose execution**, while supplying a selectable library of purpose-built tools for commonly needed operations.

The motivation is **accidental damage caused by otherwise well-intentioned model behavior**. An agent might hallucinate a command, misunderstand a path, or select destructive flags. An unrestricted shell gives such an error potentially unbounded consequences. This risk grows with autonomous usage even without malicious intent.

The design follows the **Level 5 (L5) no-Bash approach** demonstrated by Disler's *Bash: Damage From Within*: remove the general execution interface and give the model only explicitly selected tools whose implementations define what operations can occur.

**Governing rule:** The model selects a specific operation and supplies constrained parameters. Trusted code decides how to implement it. A replacement tool must not accept arbitrary shell commands, executables, code, scripts, interpreter entrypoints, or their functional equivalents.

`pi-nobash` is a **capability foundation**, not a general-purpose security framework or agent orchestrator.

## 2. Intended users and uses

The primary user is a developer building or running Pi agents, including custom agents with distinct responsibilities. Some agents may only inspect information; others may edit files, inspect Git history, or run named validation checks. Many domain-specific agents will not need Bash at all.

Developers should be able to:

1. Opt into `pi-nobash` for a Pi instance/session/agent they deliberately configure.
2. Choose an individual set of permitted model-facing tools for that agent using Pi's native tool-selection facilities.
3. Reuse Pi's existing purpose-built tools rather than replacing them unnecessarily.
4. Add project- or domain-specific tools through separate Pi extensions, outside this package.
5. Keep other Pi sessions that do not opt in operating normally, including sessions with Bash when deliberately chosen by the developer.

The package does not define agent workflows, roles, teams, schedules, or orchestration. Those belong to the applications using Pi.

## 3. Goals and non-goals

### 3.1 Goals

- **G1 — No general model-facing execution.** A properly configured `pi-nobash` agent has **no known general-purpose execution interface in its active model-facing toolset**, including known Bash, PowerShell, codemode, unrestricted interpreter, and generic process-runner tools.
- **G2 — Useful alternatives.** Provide a small reusable library of specific tools covering common operations previously handled by Bash, using Pi built-ins whenever they already meet the need.
- **G3 — Per-agent choice.** The developer can select different subsets of tools for different agents or Pi sessions.
- **G4 — Explicit effect boundaries.** Each supplied tool has defined input, operation, output, and side-effect semantics. Writing/editing and controlled validation are allowed where deliberately selected; they are not represented as risk-free.
- **G5 — Simple adoption.** Installation, activation, inspection, and removal are understandable and use native Pi capabilities where possible.
- **G6 — Clear gaps.** Unsupported work remains unsupported until an appropriate tool is supplied; the agent reports the missing capability rather than improvising execution.
- **G7 — Efficiency and correctness.** Preserve useful performance using existing Pi primitives and bounded, efficient processing for recurring workloads, notably JSON/JSONL.

### 3.2 Non-goals

- Defending against adversarial jailbreaks, malicious extensions, hostile SDK hosts, prompt-injection attacks, or sophisticated policy bypasses.
- Building an OS/container/VM sandbox, workspace isolation product, or host security system.
- Providing universal restrictions over independently installed third-party extensions or their internal code.
- Providing a generic command or code execution fallback (`restricted_exec`, codemode, arbitrary Node/Python, arbitrary `jq` expressions, etc.).
- Inventing a parallel tool-profile or permission-management framework when Pi's native selection is sufficient.
- Replacing all possible Bash functionality or promising complete immunity from destructive edits, trusted test scripts, or incorrect Git operations.
- Building an agent orchestrator, task scheduler, general plugin marketplace, or domain-specific integrations.
- Performing a broad adversarial-testing program or certifying general security properties.

## 4. L5 design rules

### 4.1 The default capability model

Follow Disler's L5 decisions by default:

- **Remove Bash from the available tool list.** Do not rely on model instructions to avoid using it.
- **Unconditionally block direct Bash tool calls as a backstop** while the `pi-nobash` extension is loaded, as in Disler's Pi example.
- **Retain purpose-built file and search tools** as appropriate for the agent. L5 does not prohibit `read`, `write`, or `edit`; it replaces the unrestricted shell interface.
- **Offer narrowly defined custom tools**, not a renamed shell. Disler's illustrative Pi tools are `run_tests`, `git_status`, and `list_target`; these demonstrate the design, not a mandatory product tool list.
- **Prefer minimum useful results.** A file-listing operation, for example, may return names rather than contents when names are all that the operation requires.

For `pi-nobash`, the same no-general-execution principle also excludes other equivalent model-facing runners (notably PowerShell and codemode). Disler's sample hook specifically blocks `bash`; it does **not** establish a general cross-extension policy framework. Any additional direct-call blocks must remain a small, explicitly enumerated compatibility measure, not a claim that every possible alternate executor is detectable.

### 4.2 Permitted side effects

Purposeful `write` and `edit` operations are legitimate capabilities. So are selected Git mutations, scoped file operations, and named validation checks when the developer enables those tools. Their inherent effects remain. A well-defined tool can still do the wrong thing if it receives mistaken but permitted input; L5 reduces the reach of an unrestricted shell, not the possibility of all mistakes.

### 4.3 No general execution by composition

A `pi-nobash` replacement tool must not deliberately provide a route for the model to turn arbitrary written text, code, scripts, or executable paths into arbitrary process execution. In particular, `write` plus a custom runner that executes any model-chosen file is not an acceptable L5 substitute. Named validation is allowed when the trusted developer defines the check and the model cannot choose an arbitrary command or entrypoint. Such checks may execute repository-controlled code, a documented limitation.

This is a **basic design rule for tools shipped by `pi-nobash`**, not a promise to control third-party extension internals or defeat malicious actors.

## 5. Product boundaries and responsibilities

| Component | Responsibility |
|---|---|
| **Pi** | Model session/runtime, built-in file/search/edit tools, extension loading, tool registration, and native tool selection |
| **`pi-nobash`** | L5-style Bash removal guidance and backstop, reusable specific replacement tools, basic usage instructions, and diagnostic visibility |
| **Developer / agent configuration** | Install or select `pi-nobash`, choose the tools appropriate for each session or agent, configure approved operations where needed |
| **Other Pi extensions** | Add domain-specific capabilities that are not part of the general baseline; own their implementation and effects |
| **Application / orchestrator** | Determine goals, workflow, tasks, agent relationships, and completion criteria |

Installing `pi-nobash` **alone must not be described as automatically removing Bash** from every Pi session. The opt-in model consists of a loaded package **and** an effective tool selection appropriate to the agent.

## 6. Configuring a session or agent

### 6.1 Native Pi tool selection

Use Pi's native configuration mechanisms by default, following the explicit-selection method illustrated by Disler's `pi --tools ...` L5 example. Persistent `defaultTools` configuration and supported SDK/session tool-selection methods may be used when their exact behavior is verified against the targeted Pi version. The known historical compatibility floor is **`@earendil-works/pi-coding-agent` ≥ 0.84.2**: an earlier `defaultTools` bug could drop extension/SDK tools while selecting built-in defaults. This is a minimum known constraint, not a claim that every subsequent release has been integration-tested; the supported runtime/version must still be verified.

The developer must be able to give different Pi agent instances different tool subsets. This may involve separate Pi invocation settings, project/user configuration, SDK options, or explicit session-specific selection. Do not assume a supervising agent's toolset automatically governs separately launched peers.

**Important distinction:** Pi's `defaultTools` chiefly selects built-in defaults while registered extension/SDK tools may have their own exposure and selection behavior. A strict complete tool list may require Pi's `--tools` or another validated selection path. Example configurations are explanatory until tested on the supported Pi release; a list that removes Bash but leaves a generic runner active does **not** meet G1.

### 6.2 Example roles (illustrative, not mandatory profiles)

| Agent type | Example tool access |
|---|---|
| Read-only reviewer | `read`, `grep`, `find`, `ls`, selected read-only data queries |
| Editing agent | Read/search tools plus `edit` and `write` |
| Engineering agent | Editing tools plus selected typed Git and named validation operations |
| Domain-specific agent | Only relevant foundation tools plus separately installed domain extension tools |

These are examples of individually selected tools, **not** an added `pi-nobash` profile engine.

### 6.3 Backstop and changes to tool selection

Following Disler, a loaded extension unconditionally blocks a direct `bash` invocation even if a developer-controlled tool-selection override accidentally re-exposes it. Such overrides can arise from CLI/SDK configuration or another extension's runtime tool-selection logic; the model does not ordinarily have permission to change its own tool list unless a developer separately exposes that capability.

**Backstop scope:** Following Disler, unconditional direct-call interception is required for `bash`. PowerShell, codemode, and other known generic runners are excluded by effective tool selection and checked in diagnostics/acceptance tests; v1.7.2 does not promise an equivalent direct-call blocker for each. A known runner reintroduced by an override makes the session nonconforming even if Bash remains blocked.

Tool selection and the backstop are complementary, not a general security boundary. The package should not silently override a developer's unrelated tool configurations or promise control of arbitrary external extensions. If an agent is intentionally meant to have Bash, **do not configure that agent to use `pi-nobash`**.

### 6.4 Visibility and deactivation

Supply a lightweight `/nobash-status` command (or equivalent) reporting the loaded package and its version, effective active tools when available, whether known general-execution tools appear, availability of the package's replacement tools, and any clearly incomplete configuration. This is a configuration diagnostic, not security attestation. Its five required reported items are directly checked by AC10.

Deactivation should be straightforward: remove the package from the applicable Pi configuration and restore the desired native tool selection. Verify the resulting active tools. No startup admission matrix, hook canary, provider-cancellation controller, or red/green protection-state engine is part of this product.

## 7. Basic capability library

The baseline should remain **small, reusable, and individually selectable**. The inventory below expresses product priorities, not a frozen implementation API.

### 7.1 Use existing Pi tools

Keep Pi's existing tools where appropriate:

| Need | Tool | Guidance |
|---|---|---|
| Read file or relevant range | `read` | Prefer targeted reads over unnecessarily large results |
| Literal/regex search | `grep` | Use `literal: true` for fixed strings; use regex only when needed |
| Discover filenames | `find` | Do not use a shell merely to discover paths |
| Inspect directory | `ls` | Use direct listing |
| Modify existing content | `edit` | Expose only to editing-capable agents |
| Write a file | `write` | Expose only where file creation/replacement is intended |

These tools are **not all mandatory for every agent**.

### 7.2 Purpose-built replacements to supply

| Capability | Intended use | Boundary |
|---|---|---|
| Structured JSONL query | Filter, project, count, group, aggregate line-delimited records | Typed operations, streaming implementation, bounded output; no user-authored Python/jq/JS |
| Structured JSON query | Extract, filter, and summarize JSON documents | Typed operators, defined semantics, bounded results; not a general programming language |
| Typed Git operations | Inspect status/diff/history; enable additional explicit mutations as justified | Operation-specific inputs; no free-form Git command, arbitrary flags, or generic passthrough |
| Named validation | Run a developer-approved test, lint, typecheck, or build check | Developer owns the check definition; model cannot submit executable text, arbitrary program, or script path |

Read-only Git operations should come first. Additional operations such as add/commit should be individually justified, defined, and selectable according to actual engineering needs.

### 7.3 Candidate capabilities, only if justified

- Narrow filesystem copy/move, and tightly defined deletion if truly necessary. Do not supply an open-ended recursive deletion tool.
- Specific Pi/model inspection operations justified by observed agent workflows.
- Narrow format conversion/rendering operations supported by observed tasks.

Tools for `fallow`, `herdr`, financial analytics, external services, and other application domains belong in **separate extensions**, not the core `pi-nobash` package.

No general fallback execution tool will be included for the remaining unsupported cases.

## 8. Evidence-based scope and prioritization

**Workload inventory (historical sample):** Selected Pi session transcripts contained a reported **411 Bash calls**, categorized by their observed purpose below. The categorization is a prioritization sample, not a universal description of Pi agent behavior. The listed category counts sum to **414**, three above the reported total; the raw transcript inventory must be reconciled before using these figures as an exact coverage denominator. The category counts are retained as recorded rather than silently adjusted.

| Observed Bash use | Calls | Intended treatment |
|---|---:|---|
| Inline Python, mostly structured data | 109 | Examine concrete shapes and cover recurring operations using typed JSON/JSONL tools |
| `grep` / `rg` | 91 | Existing Pi `grep` |
| `cat` / `sed` / `head` / `tail` | 72 | Existing Pi `read` |
| Tests / typechecking | 55 | Named validation |
| Git | 54 | Typed Git operations |
| Pi CLI/model probes | 15 | Review individually; add narrow inspection only as needed |
| `ls` | 5 | Existing Pi `ls` |
| `cp` / `mv` / `rm` | 3 | Review narrow file operations separately |
| `fallow` / `herdr` | 5 | Optional domain/project extensions |
| `qlmanage` / `sips` | 2 | Optional typed conversion if needed |
| Other | 3 | Review and expose a gap if unsupported |

This analysis supports a practical starting sequence: keep existing read/search capabilities; examine the 109 Python calls by operation shape; implement the JSON/JSONL, Git, and validation substitutes; then close only demonstrated gaps.

**Codemode is intentionally unavailable:** irregular one-off Python transformations that cannot be expressed through the approved typed operators are **`CAPABILITY_GAP`** outcomes, not covered work. Thus 109 observed Python calls are candidates for classification, not a promise that all 109 will be replaced.

The counts do **not** prove complete functional coverage. Each representative legacy task must be mapped either to working replacement operations or to an explicit unsupported capability.

## 9. Tool behavior and efficiency requirements

Every custom tool shipped by `pi-nobash` must have:

1. **A specific named operation** and a clear task-oriented description.
2. **Typed, validated inputs**, with no arbitrary program/command/script field.
3. **Defined operation scope and side effects**, including applicable file/path targets.
4. **Predictable output and errors**, including clear empty-result, failure, and truncation handling.
5. **Reasonable time, size, and output bounds**, including cancellation where Pi/runtime support permits it.
6. **A trusted implementation**, which may internally use a fixed process or efficient library selected by the tool rather than the model.

Optimize the **whole agent task**, not merely subprocess speed:

- Favor Pi's existing optimized primitives rather than wrapping every `read`, `grep`, or `find` call.
- Use fixed-string matching when regex semantics are unnecessary.
- Process JSONL incrementally; filter early and return bounded selected results instead of streaming entire logs into model context.
- Add caching, indexing, or alternate engines only after observed repeated workloads justify them.
- Preserve semantics and correctness across implementations; measure task completion, latency, tool calls, output volume, and model-context cost.

A tool can invoke a fixed trusted executable for a well-defined operation, as Disler's L5 `run_tests` and `git_status` examples do. That does not make a tool a general-purpose model-controlled shell.

## 10. Missing capability behavior

When no selected tool can perform a legitimate request, the agent must:

- Say which requested work could not be completed and which specific capability is missing.
- Avoid claiming the operation succeeded.
- Never substitute Bash, codemode, arbitrary interpreter execution, or an improvised generic runner.
- Permit the developer to resolve the gap by choosing an existing tool or adding a separate purpose-built extension for future work.

A structured `CAPABILITY_GAP` result/event may be implemented where useful and supported, but no broad escalation or permission-approval workflow is required.

## 11. Scope limitations and truthful claims

The package can claim that an appropriately configured session **does not present general-execution tools to its model and provides limited, purpose-built alternatives**. It cannot claim that every possible destructive edit is prevented, that repository-controlled validation is side-effect-free, that malicious third-party extensions are contained, or that its extension hooks intercept arbitrary internal Node processes.

No sandboxing, adversarial certification, remote-provider cancellation guarantee, or whole-host containment guarantee is implied by L5 or by installing this package.

Any separately installed extension is responsible for its own behavior. An agent whose developer enables an additional generic execution tool is outside the intended no-general-execution configuration, even if the `pi-nobash` package happens to be loaded.

## 12. Acceptance criteria

| ID | Required result | Evidence |
|---|---|---|
| AC1 | Opt-in works without changing unrelated sessions | Separate configured/unconfigured Pi session tests |
| AC2 | Configured model-facing toolset contains no known general-purpose execution interface, including `bash`, `powershell`, and `codemode` | Inspect the effective active tool names in supported startup modes; explicitly verify absence of each known runner on the supported Pi version, and report an intentionally reintroduced runner as nonconforming |
| AC3 | Disler-style Bash backstop blocks a direct attempted Bash tool call while package is loaded | Simple integration test with deliberately exposed Bash |
| AC4 | Developer can configure distinct sets of selected tools for different agents | Two or more separately configured agents show different effective tools |
| AC5 | Existing Pi read/search/list/edit/write operations still work where selected | Representative functional tests |
| AC6 | Typed JSON/JSONL, Git, and validation tools support their declared operations correctly | Operation fixtures and error/limit tests |
| AC7 | Replacement tool APIs do not expose generic command/code execution | Tool schema review and ordinary rejection tests |
| AC8 | Legacy workload coverage is explicit | Representative Bash-use mappings marked covered or unsupported |
| AC9 | Unsupported requests fail visibly, without execution fallback | Capability-gap task tests |
| AC10 | Installation and deactivation work; `/nobash-status` provides all five required diagnostic items | Supported Pi install/configuration/removal checks plus explicit assertions that the status output reports (1) loaded package and version, (2) effective active tool list or an explicit unavailable state, (3) presence/absence of known general-execution tools, (4) availability of packaged replacement tools, and (5) any incomplete configuration or an explicit none-known result |
| AC11 | Replacement workflows' correctness and performance are measured | Paired representative tasks, with documented differences |

Acceptance tests concern the **declared capabilities and configuration behavior** of this product. A broad adversarial or containment proof suite is not required.

## 13. Delivery sequence

**Phase 1 — L5 foundation.** Package the extension; document native Pi installation and explicit tool selection; remove known general execution tools from an opt-in agent configuration; register the unconditional Bash-call block; preserve selected Pi built-ins; provide lightweight status and removal instructions.

**Phase 2 — Useful replacement tools.** Inspect representative actual Python/JSON calls; add typed JSON/JSONL query tools; add read-only Git operations and developer-named validation; then add justified Git mutations with explicit contracts.

**Phase 3 — Close important observed gaps.** Evaluate rare Pi probes, filesystem lifecycle needs, and conversion requirements individually. Keep domain/project-specific tools separate.

**Phase 4 — Verify product behavior.** Validate distinct per-agent selections, supported Pi installation paths, Bash absence and block behavior, representative task coverage, tool correctness, visible gaps, and performance. Adjust specific tools as needed without introducing general execution.

## 14. Matters reserved for technical design

These are implementation questions, not unresolved product objectives:

- Confirm supported Pi version(s) **at or above the documented historical 0.84.2 floor** (fix for `defaultTools` dropping extension/SDK tools), packaging metadata, extension registration APIs, and install behavior. Test actual coexistence of custom replacement tools with the no-Bash tool selection; the version floor is not itself an integration test.
- Exact native Pi selection mechanism for standalone CLI, persistent settings, and independent SDK/agent instances; which selections are strict when extension tools also exist.
- Exact list and names of blocked known general-execution tools in each supported Pi version, recognizing that Disler's demonstration specifically blocks `bash`.
- Concrete typed operator sets based on individual observed Python/JSON task shapes.
- Exact Git mutation set, validation configuration format, file scope/limits, and optional capability candidates.
- Practical status and unsupported-operation reporting APIs across supported invocation modes.
- Benchmark baselines and acceptable measured tradeoffs.

Resolve these against the current Pi source and executable tests **after** accepting this product definition. Do not reintroduce a security-framework or unrestricted execution architecture while resolving them.

## 15. Governing product rule

> **A developer opts a Pi agent into `pi-nobash`, chooses the narrow tools it needs, and excludes Bash and equivalent general-purpose model execution. The model performs work through those selected purpose-built capabilities. If a capability is missing, it remains missing until deliberately supplied, rather than being replaced with a general execution escape hatch.**

## Reference implementations and factual boundaries

- Disler's Level 5 model and Pi example: https://github.com/disler/bash-damage-from-within and https://github.com/disler/bash-damage-from-within/tree/main/pi
- Pi settings and tool selection: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md
- Pi tool-selection extension example: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/tools.ts
- Pi release history: https://github.com/earendil-works/pi/releases

**Authority and boundaries:** This specification is the sole product-requirements baseline. Disler's Level 5 implementation supplies the guiding pattern, not a drop-in implementation for current Pi. In this product, excluding codemode, unrestricted interpreters, `restricted_exec`, and OS isolation from the package is a deliberate requirement. Small, typed JSON/JSONL operations take the place of supported routine data transforms; unsupported irregular transforms produce explicit capability gaps. The workload figures in Section 8 are historical observations with the disclosed counting discrepancy, not acceptance evidence or a prerequisite document. Exact Pi integration behavior must be verified on the supported runtime.

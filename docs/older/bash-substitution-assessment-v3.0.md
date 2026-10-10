# Pi Bash Substitution Assessment — v3.0

**Status:** Capability-coverage and implementation research; not a separate product specification  
**Date:** 2026-10-09  
**Product baseline:** `pi-nobash` Product Specification v1.7.2 (including the correction that Section 6.3 refers to this version rather than v1.7.1)

## 1. Purpose and boundary

This assessment asks: **What did sampled Pi agents use Bash for, which operations can be handled by the selected no-Bash toolset, what remains unsupported, and how should supported replacements be implemented efficiently?** It supports the agreed `pi-nobash` product, not a competing architecture.

`pi-nobash` is an opt-in capability package. An opted-in agent has no **known general-purpose execution tool** in its effective model-facing toolset. It uses existing Pi tools and individually selectable, purpose-built operations. Different agents may have different tools. If an operation lacks a suitable capability, it remains a **capability gap**; it is not routed to Bash, PowerShell, codemode, arbitrary Python/Node, model-authored `jq`, a generic process runner, or `restricted_exec`.

This is the **Level 5 no-Bash approach** demonstrated in Disler's *Bash: Damage From Within*: remove the shell from the presented toolset, retain deliberate file/read/search/edit capabilities, and add specific operations instead of a renamed shell. A simple unconditional direct Bash-call block is a backstop. This project does **not** implement adversarial-bypass defenses, generalized policy enforcement for third-party extensions, or OS/container/VM isolation. It does not promise that authorized edits, Git mutations, or repository-controlled validation scripts cannot cause damage.

**Document roles:** Product requirements, acceptance criteria, and delivery scope are defined by the product baseline. Here, observed facts are labeled **Recorded**, unverified details **Unverified**, and engineering approaches **Proposed**. Recommendations below should not silently expand the product's allowed model-facing capabilities.

## 2. Evidence inventory and reliability

### 2.1 Recorded session counts

The historical investigation reported:

| Session | All tool calls | Bash calls | Bash share |
|---|---:|---:|---:|
| Read-only peers (`task-optimize-first`) | 133 | 0 | 0% |
| Supervisor | 146 | 87 | 59.6% |
| Review/authoring | 550 | 324 | 58.9% |
| **Reported total** | **829** | **411** | **49.6%** |

**Recorded, not independently re-counted:** The original transcript files themselves were not provided with this revision. The first two Bash-enabled sessions used Bash for approximately 59% of tool calls, while the sampled read-only peers worked without Bash (`read`, `grep`, `ls`, `find`, and `web_fetch` were reported). These are observations about this sample, not general rates for all Pi agents.

### 2.2 Recorded Bash-purpose classification

| Category | Recorded calls | Proposed destination |
|---|---:|---|
| Inline Python, predominantly JSON/JSONL | 109 | Classify individual transformations; cover only supported shapes with typed JSON/JSONL operations |
| `grep` / `rg` | 91 | Native Pi `grep` |
| `cat` / `sed` / `head` / `tail` | 72 | Native Pi `read`, with targeted ranges where equivalent |
| Tests / typechecking | 55 | Developer-approved, named `run_validation` checks |
| Git | 54 | Typed Git operations |
| Pi CLI / model probes | 15 | Review individually; specific inspection tools only if justified |
| `ls` | 5 | Native Pi `ls` |
| `cp` / `mv` / `rm` | 3 | Candidate narrow file lifecycle operations; otherwise gap |
| `fallow` | 3 | Outside core; optional companion extension |
| `herdr` | 2 | Outside core; optional companion extension |
| `qlmanage` / `sips` | 2 | Candidate narrow conversion/rendering tool |
| Other | 3 | Inspect individually; otherwise gap |
| **Sum of recorded categories** | **414** | **Not reconciled to 411-call total** |

**Data-integrity issue:** The category counts total **414**, while the session-level Bash total is **411**. It is unknown whether three calls were double-classified, incorrectly recorded, or omitted/misreported elsewhere. Do not adjust a category, present a precise coverage percentage based on category sums, or claim the inventory has been reconciled without raw transcript verification. The earlier percentages per category used 411 as a denominator and therefore should be considered approximate only.

**Required follow-up for exact coverage metrics:** Obtain the original session/`tool-calls.jsonl` records; use stable call identifiers, assign one primary category per call (plus optional secondary tags), reconcile total to 411 or correct that total with evidence, and save a machine-readable manifest. Until then, these counts justify priorities only.

### 2.3 What the evidence supports

- **Supported:** Existing file/search/navigation primitives appear to address substantial repeated Bash *usage patterns*. The combined `grep`/`rg`, read-like commands, and `ls` rows account for **168 category assignments**, not a verified count of fully replaceable distinct calls.
- **Supported:** JSON/JSONL transformations, Git, and validation are prominent engineering workflows worth purpose-built replacements.
- **Not established:** All 109 Python calls can be handled by a typed query language; all 55 validations can be safely configured; all 54 Git calls have supported semantics; or every Bash invocation is replaceable.
- **Not established:** An overall completion percentage or speedup. This requires individual task fixtures and paired execution.

## 3. Replacement taxonomy and coverage statuses

Use these classes for every legacy call:

| Class | Meaning | Treatment |
|---|---|---|
| **NATIVE** | Existing Pi tool supports the required semantics | No new wrapper |
| **CORE_TYPED** | Stable general operation warrants a `pi-nobash` tool | Define strict operation and test it |
| **OPTIONAL_CORE** | General but infrequent operation needs evidence before inclusion | Defer until justified |
| **COMPANION** | Specialized to a domain/project | Separate extension, not bundled core |
| **GAP** | No approved capability represents the requested operation | Return/report unsupported work, no generic executor |
| **NEEDS_REVIEW** | Source invocation or required result not characterized | Do not count as covered |

Track coverage at the **operation/task level**, not by command name. `sed` sometimes means read a range and sometimes means transform/replace text; `python -c` may count records, join files, transform objects, or do something else. Classifying those commands by executable name alone is insufficient.

### 3.1 Suggested manifest fields

Each sampled call should record `call_id`, `source_session`, `legacy_command_shape`, `requested_intent`, `inputs`, `side_effects`, `required_output`, `replacement_class`, `tool_and_operation`, `fixture_id`, `result` (`PASS`, `GAP`, `NEEDS_REVIEW`, `FAIL`), `semantic_differences`, and relevant performance metrics. Keep original commands in the **offline evidence corpus** only; do not expose command text as a replacement tool parameter.

## 4. Native Pi tools: first-choice substitutions

| Intent | Preferred tool | Accuracy/efficiency notes |
|---|---|---|
| Known file contents or line range | `read` | Target needed ranges; `head`/`tail` behavior must be checked against actual range/offset semantics |
| Exact/fixed-string search | `grep` with `literal: true` | Express fixed-string semantics; avoid needless regex compilation/escaping |
| Regular-expression search | `grep` in regex mode | Verify syntax, ignore rules, case behavior, and context matches |
| Filename discovery | `find` | Avoid shell traversal; verify glob, ignore, hidden-file, and path rules |
| Directory listing | `ls` | Use directly when listing is enough |
| Modify existing text | `edit` | Give only to editing agents; use for intended changes, not command execution |
| Create/replace file | `write` | Give only where intended; creating a script does not authorize executing it |

**Proposed usage guidance:** Search with minimal context, then `read` matching ranges; limit output; use literal search where literal behavior is wanted. The older `fgrep` command should not become an API. Fixed-string behavior is a mode of Pi `grep`, not a separate new tool. No benefit should be asserted without task measurements.

**Known qualification:** `cat` and basic `head`/`tail` map naturally to `read`, but arbitrary `sed` transformations do not. Each non-reading `sed` use requires an existing edit operation, a typed data operation, or a gap.

## 5. JSON and JSONL: largest characterization task

### 5.1 Why this needs more analysis

The **109 inline-Python calls** are the largest recorded category but are *not* 109 proven JSON-tool wins. Earlier research observed that many worked with structured logs and artifacts; exact operator shapes have not been audited here. In the agreed L5 product, **codemode is excluded**, so irregular general code is **not** the fallback.

Classify each Python call by its actual intent. Candidate shapes include field extraction; nested-key selection; equality/range predicates; projections; count/group/aggregate; time windows; simple ordering/top-N; JSONL validation; transformations requiring joins, reshaping, or custom logic; non-JSON scripts. Record which shapes recur and which remain gaps.

### 5.2 Proposed core tool surface

**`query_jsonl`**: bounded streaming analysis of line-delimited records, with strict typed predicates, selected fields, supported count/group/aggregate operators, and explicit limit/error behavior.

**`json_query`**: selection and approved typed filtering/aggregation of JSON documents, with bounded results and predictable semantics. It should not accept arbitrary JavaScript, Python, SQL fragments, jq expressions, or user-supplied code.

Operator lists are **provisional** until the 109-call audit. Do not grow them into a Turing-complete custom programming language to eliminate every gap.

### 5.3 Efficient implementation guidance

- Prefer native library parsing where a single JSON file is small and the query shape is well defined.
- For large JSONL, stream records, filter early, project requested fields, and aggregate inside the tool. Return bounded results rather than entire logs to the model.
- Global sort/group/join operations may need nontrivial memory; specify actual bounds and explicit failures. Do not promise constant memory when buffering results.
- Define malformed-line policy, missing/null semantics, numeric comparison, stable ordering, truncation, encoding, and large-number treatment.
- Cache or index repeated stable inputs **only after** benchmarks demonstrate a benefit and source freshness can be ensured.
- A fixed backend chosen by trusted code is acceptable. A model-selected interpreter/expression is not.

### 5.4 Explicit gap rule

If an inline Python script performs arbitrary transformation that the approved typed operators cannot express, classify it **GAP**. The model may report the unmet capability and the developer may later add an appropriate specific tool. Do not route it to codemode or an ad-hoc general interpreter. This is a deliberate coverage tradeoff, not a failure of the L5 architecture.

## 6. Typed process-backed operations

### 6.1 Git

**Proposed first set:** `status`, `diff`, `log`, `show`. Later consider scoped `add`, `commit`, and specific branch/worktree actions according to real use. Operations should be individually enumerated and only supplied to agents that need them.

Trusted implementation constructs a fixed Git invocation/argv without shell interpretation; model inputs are operation-specific paths, revisions, and messages, never a full Git command or unconstrained flags. Validate paths/pathspec behavior, revision ambiguity, repository root, hooks, output bounds, and mutation semantics. Git operations can still have side effects and are **not** guaranteed harmless merely because they use `shell:false`.

**Coverage warning:** A typed `git` tool is not automatically equivalent to all 54 recorded Git calls; each actual subcommand and flag shape needs a fixture or gap determination.

### 6.2 Developer-named validation

**Proposed interface:** `run_validation(check=<approved_name>, parameters=<enumerated_allowed_variations>)`.

The developer/trusted configuration owns the program, arguments, working directory, and accepted variations. The model cannot pass arbitrary executable names, command strings, script text, or a model-authored script path for execution. Include timeouts, cancellation when supported, and bounded diagnostics.

A named validation may execute repository-controlled tests/build scripts with side effects. This limitation remains true under L5; the core package does not supply host isolation. Audit the 55 observed test/typecheck uses before claiming complete coverage.

### 6.3 Other processes

| Workload | Proposed treatment | Inclusion decision |
|---|---|---|
| Pi CLI/model probes (15) | Enumerate exact inspection results needed; implement named read-only probes if repeatable | `OPTIONAL_CORE` pending call review |
| File copy/move/delete (3) | Narrow workspace-scoped operations; no unrestricted recursive delete | `OPTIONAL_CORE` pending use review |
| `qlmanage`/`sips` (2) | Specific format conversions and bounded outputs | `OPTIONAL_CORE` if broadly useful |
| `fallow` (3) | Project/domain extension | `COMPANION` |
| `herdr` (2) | Project/domain extension | `COMPANION` |
| Other (3) | Inspect each and assign a narrow operation or gap | `NEEDS_REVIEW` |

No numerical cutoff automatically makes a tool worthwhile. Frequency, semantic stability, general usefulness, and risk of accidentally creating generic execution all matter.

## 7. What the model may and may not request

A valid model-facing replacement specifies **intent and bounded inputs**. Trusted code owns execution mechanics, parsers, and algorithms.

| Acceptable pattern | Unacceptable pattern |
|---|---|
| `git({operation:"diff", paths:[...]})` | `git({command:"git diff ..."})` |
| `run_validation({check:"unit"})` | `run_validation({command:"npm test ..."})` |
| `query_jsonl({path, where, groupBy, limit})` | `query_jsonl({python:"..."})` |
| `render_svg({input, format:"png"})` | `exec({program, argv})` |

Each shipped tool needs a named operation, typed fields, defined side effects, limits, error/truncation behavior, and ordinary tests for incorrect parameters. A tool that lets the model write a script and choose that script as an execution entrypoint would recreate the rejected general execution capability. Named repository-owned checks are a disclosed exception in effect, **not** an unrestricted model-selected runner.

## 8. Configuration, package, and per-agent selection

**Product-level agreement:** Use Pi's native tool selection rather than a second permission/profile framework. Installing a package and selecting tools are distinct actions. Opted-in agents exclude known general-execution tools (`bash`, `powershell`, `codemode`, and any identified equivalent runner) and enable only the built-ins and replacement tools they require. Separately launched SDK/headless/peer agents require their own effective selections.

**Disler L5 precedent:** Explicit selection of allowed tools, purpose-built custom tool registration, and an unconditional direct `bash` call denial as backstop. The example is a design reference, not source-compatible code for every modern Pi release. Do **not** infer universal third-party-tool blocking or indirect-permission enforcement from this example.

**Historical version constraint:** Earlier Pi versions could drop extension/SDK tools when `defaultTools` selected built-in defaults; the known fix was reported in `@earendil-works/pi-coding-agent` **0.84.2**. Treat **≥0.84.2** as a historical compatibility floor, **not** a tested-current-version certification. Integration tests must establish that the actual supported Pi version retains typed replacement tools when Bash is excluded.

**Basic verification:** Inspect the effective active toolset for each agent, including known generic runners. Test that the `bash` backstop rejects a deliberately re-exposed direct Bash call. Other known general runners are excluded by tool selection unless extra direct-call blocks are explicitly implemented and tested. A configuration override that makes such a runner active makes the agent nonconforming; the package cannot promise a universal backstop for unknown alternate executors.

`/nobash-status` should report (1) loaded package/version, (2) effective active tools or unavailable state, (3) known general execution tools present/absent, (4) replacement tools available, and (5) incomplete configuration or none-known. Diagnostics are not security attestation.

## 9. Performance evaluation: full task, not microbenchmarks

Compare legacy Bash-enabled runs against no-Bash tool runs on **identical representative tasks and fixtures**, keeping model, runtime, repository snapshot, and machine as similar as practical. **Correctness and explicit gaps come before speed claims.** Measure:

- Task outcome (`PASS`, intentional `GAP`, incorrect, or other failure) and semantic equivalence.
- End-to-end latency, total model turns/tool calls, and model tokens/output bytes.
- Per-operation tool elapsed time; for JSONL, scanned/returned records and memory if measurable.
- Cold versus warm repeated-query cost when evaluating caches/indexes.
- Bound enforcement, truncation signaling, and error behavior.

Performance decisions: prefer direct Pi `grep`/`read` over duplicate wrappers; prefer streaming JSONL for simple one-pass aggregation; do not add indexes, extra backends, generic query frameworks, or complicated routing without demonstrated benefit. A faster backend cannot change the meaning or scope of a typed operation.

### 9.1 Suggested reference fixtures

| Task fixture | Expected assertion |
|---|---|
| Literal text search | Same expected matching lines/paths under documented ignore/case semantics |
| Regex search | Same matches for the supported regex subset |
| Range reads / listing | Same expected content/path set |
| JSON nested extract | Exact values/types |
| JSONL filter/count/group | Exact aggregation, malformed-line handling, bounded output |
| JSONL repeated queries | Correct results after file edits and cache invalidation |
| Git inspection | Equivalent repo state/diff/history semantics |
| Named test/lint/typecheck | Same intended check and bounded exit/diagnostics |
| Unsupported irregular transformation | Clear capability gap; no fallback execution |
| Per-agent toolsets | Different selections retained; known generic runners absent |

These are **test proposals**, not evidence that a working implementation already passes.

## 10. Suggested investigation and development order

**A1 — Reconcile the evidence.** Find original session transcripts, recompute per-call categories, resolve **411 versus 414**, and export the coverage manifest. If unavailable, preserve the documented uncertainty rather than adjusting numbers.

**A2 — Classify the Python 109.** Extract each operation shape and output requirement. Identify a minimal reusable typed operator set and label irregular transforms `GAP`.

**A3 — Map direct Pi operations.** Verify native `read`, `grep`, `find`, `ls`, `edit`, and `write` against representative tasks and permissions. Inspect `sed` cases rather than treating all as reads.

**A4 — Characterize Git and validation.** Enumerate the actual 54 Git and 55 test/typecheck uses, then select narrow operation/check contracts.

**A5 — Validate Pi selection on the target runtime.** Verify package registration, extension-tool coexistence with `defaultTools`, separate agent selections, known general-runner absence, simple Bash blocker, and status reporting.

**A6 — Implement/measure high-value substitutes.** Build typed JSON/JSONL, read-only Git, and named validation. Compare correctness and end-to-end cost against baseline fixtures; optimize only measured bottlenecks.

**A7 — Review uncommon work.** Add genuinely general narrow operations if justified. Keep `fallow`/`herdr` and other domain tools in companions; document persistent gaps.

This sequence is a **research/implementation suggestion**, not a second delivery contract overriding the product spec.

## 11. Open evidence and technical questions

| ID | Question | Evidence required |
|---|---|---|
| Q1 | Why do category rows sum to 414 while session totals show 411? | Raw call-level transcripts and stable identifiers |
| Q2 | Which of the 109 Python calls fit typed operators? | Classified snippets/intents and fixtures |
| Q3 | Which `sed` calls are read-only versus transformations? | Original arguments and expected effects |
| Q4 | What Git operations and validation checks recur? | Call-level shapes, flags, project configurations |
| Q5 | Which Pi/model probes need a reusable general tool? | Expected results from each of 15 calls |
| Q6 | Which Pi version and invocation modes will be supported? | Current source checks and runnable integration tests |
| Q7 | What precise typed-query semantics and limits are needed? | Fixtures, measured file sizes, output cardinality |
| Q8 | What performance regressions are acceptable? | Paired end-to-end benchmark results |

There is **no open question** about reinstating codemode or a generic execution escape hatch. Those are out of scope by product decision.

## 12. Conclusion

The historical evidence supports building useful no-Bash Pi agents with existing read/search/edit tools plus a small library of structured operations. It does **not** establish that every historical Bash call is replaceable or that all 109 Python scripts fit a typed query interface. The correct engineering path is to classify the actual tasks, implement the recurring well-defined operations efficiently, and leave unsupported work explicit.

**Critical rule:** *The model chooses a permitted specific capability; trusted tool code implements it. A missing capability is a gap, never a reason to restore general-purpose execution.*

## Primary references

- Product baseline: `pi-nobash` Product Specification v1.7.2 (project-owned requirements; including the Section 6.3 wording correction).
- Disler Level 5 concept and Pi examples: https://github.com/disler/bash-damage-from-within/tree/main/pi
- Current Pi repository: https://github.com/earendil-works/pi
- Pi settings documentation: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md
- Pi packages: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md
- Pi release history: https://github.com/earendil-works/pi/releases

**Provenance note:** The historical call figures and version-fix report are carried forward from prior recorded investigation; original transcript files and live Pi runtime results were not available for independent reproduction in this revision. Tool interfaces and benchmarking recommendations are proposals, not claims of shipped functionality.

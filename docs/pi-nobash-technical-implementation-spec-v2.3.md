# pi-nobash — Technical Implementation Specification v2.3

**Status:** Implementation specification  
**Date:** 2026-10-09  
**Product baseline:** `pi-nobash` Product Specification v1.7.3  
**Supporting research:** Pi Bash Substitution Assessment v3.2.1  
**Target runtime:** `earendil-works/pi` tag `v1.1.0`, release commit `abe508e`, including `@earendil-works/pi-coding-agent` `1.1.0`  
**Implementation language:** TypeScript / ESM  
**Package role:** Opt-in Pi package implementing the Level 5 no-Bash capability model

---

## 1. Purpose

This specification defines how to implement `pi-nobash` for Pi `v1.1.0`.

`pi-nobash` is an opt-in Pi package for agents that should not have model-facing Bash or equivalent known general-purpose execution tools. It preserves Pi's useful native file/search/edit capabilities and adds individually selectable, purpose-built replacement tools for recurring engineering work.

The governing product rule is:

> A developer opts a Pi agent into `pi-nobash`, selects the narrow tools that agent needs using Pi's native tool-selection mechanisms, and excludes Bash and equivalent general-purpose model execution. If the required capability is missing, it remains missing and is reported as `CAPABILITY_GAP`; it is not routed to a shell, interpreter, generic runner, codemode, or other execution escape hatch.

This document is standalone. It does not use any earlier technical specification as a baseline.

### 1.1 Authority order

1. **Product Spec v1.7.3** defines product requirements, scope, acceptance criteria, and exclusions.
2. **This Technical Implementation Specification v2.3** defines the implementation needed to satisfy that product.
3. **Bash Substitution Assessment v3.2.1** informs capability priorities, task coverage, and performance evaluation only. It cannot expand product scope.
4. **Pinned Pi v1.1.0 source** defines the integration API used by this implementation. Moving `main` documentation is non-authoritative for API compatibility.

### 1.2 Evidence labels

This specification uses these labels:

| Label | Meaning |
|---|---|
| **SRC** | Confirmed from Pi source or documentation at tag `v1.1.0`. |
| **TEST** | Confirmed by executing an integration or acceptance test against Pi `v1.1.0`. |
| **DEC** | Implementation decision made by this specification within Product Spec v1.7.3. |
| **GAP** | Intentionally unsupported capability. |
| **PENDING-TEST** | Source-confirmed interface whose runtime behavior must still be proven by the package test suite. |

**Source-verification record (2026-10-09):** The authoring environment retrieved and read the public `raw.githubusercontent.com/earendil-works/pi/v1.1.0/` source files for `packages/coding-agent/package.json`, `docs/settings.md`, `src/core/sdk.ts`, and `src/core/extensions/types.ts`. This is a **remote static read of the tag**, not a local checkout, compiled extension, or executed Pi session. Corresponding immutable-path URLs are listed in Section 26, and the particular lines underlying the most important selection contract are listed in Section 3.12. No runtime Pi executable or runnable v1.1.0 integration environment was available. Thus **SRC** means the specified interface/documented semantics occur in the pinned source; it does **not** mean that integration behavior passed a runtime test. Runtime claims remain **PENDING-TEST** until tested in a real v1.1.0 installation.

---

## 2. Product requirements carried into implementation

### 2.1 Required outcomes

The implementation MUST satisfy Product Spec goals G1–G7:

| Product goal | Technical requirement |
|---|---|
| **G1 — No general model-facing execution** | A conforming agent's effective active model-facing tools MUST omit known general execution tools. Direct `bash` calls MUST also be blocked by the loaded extension. |
| **G2 — Useful alternatives** | Reuse Pi native tools and provide the essential typed replacements defined in this specification. |
| **G3 — Per-agent choice** | Tool exposure MUST be controlled through Pi native tool selection, independently per Pi invocation/session/agent. |
| **G4 — Explicit effect boundaries** | Every custom tool MUST define inputs, outputs, bounds, side effects, and failure behavior. |
| **G5 — Simple adoption** | Install, activate, inspect, and remove using Pi package/configuration mechanisms. |
| **G6 — Clear gaps** | Unsupported operations MUST surface as `CAPABILITY_GAP`; no execution fallback is allowed. |
| **G7 — Efficiency and correctness** | Use Pi native primitives where sufficient, stream JSONL, bound results, and benchmark complete workflows. |

### 2.2 Hard exclusions

The following are outside the package and MUST NOT be implemented:

- codemode as a fallback or substitute;
- arbitrary Python, Node, JavaScript, PowerShell, shell, or other interpreters;
- generic command/process runners;
- `restricted_exec` (a proposed limited general-command runner; excluded because it still provides model-selected execution);
- a model-facing wrapper around `ExtensionAPI.exec`;
- arbitrary executable/program/argv passthrough;
- arbitrary `jq`, SQL, JavaScript, Python, or user-authored query/code evaluation;
- model-authored script execution;
- OS/container/VM isolation as a `pi-nobash` feature;
- adversarial security frameworks;
- prompt-injection or jailbreak defense frameworks;
- generalized enforcement over arbitrary third-party extensions;
- elaborate startup admission gates;
- canary attestation;
- general permission/profile frameworks parallel to Pi native tool selection;
- domain-specific tools such as `fallow`, `herdr`, finance, deployment, external service, or application-specific operations.

### 2.3 Side effects are allowed when explicit

L5 does not mean read-only.

A developer may deliberately expose Pi `edit` and `write`, typed Git mutations, named validation, or later optional typed mutation tools. Those operations can have side effects. The requirement is to remove general model-controlled execution and replace it with bounded operations, not to claim that all permitted operations are harmless.

---

## 3. Pinned Pi v1.1.0 integration contract

This section is normative for the Pi integration layer. Every interface here was checked against tag `v1.1.0`, not `main`.

### 3.1 Version identity

**SRC:** `packages/coding-agent/package.json` at tag `v1.1.0` declares:

```json
{
  "name": "@earendil-works/pi-coding-agent",
  "version": "1.1.0"
}
```

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/package.json`

The implementation MUST declare compatibility with `@earendil-works/pi-coding-agent` `1.1.0`. It MUST NOT infer API compatibility from moving `main`.

### 3.2 Package installation and removal

**SRC:** Pi v1.1.0 package documentation supports npm, git, and local package sources:

```text
pi install npm:@example/pi-tools@1.0.0
pi install git:github.com/example/pi-tools@v1
pi install ./local-package
```

`--local` / `-l` stores a package declaration in project `.pi/settings.json`; otherwise installation is stored under the user Pi configuration. `pi remove <source>` removes a configured package. `pi -e <source>` can load an extension/package for one invocation without persisting it.

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/packages.md`

**DEC:** `pi-nobash` is distributed as a normal Pi package with an explicit `pi` manifest in `package.json`. The package contains one extension entrypoint plus runtime library modules. It does not ship skills or prompts that can execute commands.

### 3.3 Pi default tool configuration

**SRC (documented configuration contract, not runtime-certified coexistence):** Pi v1.1.0 `defaultTools` behavior:

- default: `read`, `bash`, `edit`, `write`;
- plain names replace defaults;
- `+name` and `-name` modify inherited defaults;
- `defaultTools: []` disables built-in defaults but does not automatically disable extension/SDK tools;
- available built-ins are `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, and `ls`;
- `codemode` and `tool_search` are registered by built-in extensions and can be selected by name;
- registered inactive extension tools can also be named in `defaultTools`.

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/settings.md`

**PENDING-TEST:** Whether extension and SDK tools stay available under the actual v1.1.0 startup/selection combinations is a release acceptance requirement (I3–I6), despite the documented defaultTools contract. The historical 0.84.2 fix is evidence about an earlier release, not proof of the target runtime. The default set and the extension-tool coexistence issue are *different questions*: the first is specified directly in pinned settings documentation; the second needs executable integration tests.

**DEC:** Every `pi-nobash` replacement tool MUST register with `defaultActive: false`. Merely loading the package therefore does not grant the model all replacement operations. The developer activates the required replacement tools using Pi native selection.

This decision is essential to Product G3.

### 3.4 CLI tool selection

**SRC:** Pi v1.1.0 CLI supports:

```text
--tools <list>
--exclude-tools <list>
--no-builtin-tools
--no-tools
```

Important v1.1.0 semantics:

- `--tools` with plain names is an allowlist and replaces the default selection.
- `--tools` entries may use `*` patterns.
- a list composed only of `+name` / `-name` entries modifies defaults instead of becoming an allowlist;
- `--exclude-tools` applies after other selection options;
- `--no-builtin-tools` disables default built-ins while retaining extension/custom tools;
- `--no-tools` starts with all built-in, extension, custom, and MCP tools disabled;
- MCP tools have additional exposure behavior; a plain allowlist that does not mention `mcp__` does not necessarily unregister all MCP tools from codemode/tool search.

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/cli.md`

**DEC:** The recommended `pi-nobash` CLI configuration uses a **plain-name allowlist**, not modifier syntax.

Example read-only reviewer:

```sh
pi \
  -e ./pi-nobash \
  --tools read,grep,find,ls,json_query,query_jsonl
```

Example engineering agent:

```sh
pi \
  -e ./pi-nobash \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation
```

If MCP is enabled in the surrounding Pi installation, the developer remains responsible for selecting only suitable MCP tools. `pi-nobash` does not become a general third-party extension policy engine.

### 3.5 SDK/headless session selection

**SRC:** Pi v1.1.0 exports:

```ts
export interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  noTools?: "all" | "builtin";
  tools?: string[];
  excludeTools?: string[];
  customTools?: ToolDefinition[];
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
  sessionStartEvent?: SessionStartEvent;
}

export async function createAgentSession(
  options: CreateAgentSessionOptions = {}
): Promise<CreateAgentSessionResult>;
```

v1.1.0 selection semantics documented in source:

- `tools` omitted: use resolved `defaultTools`, otherwise Pi's default built-ins;
- `tools` plain names: allowlist matching tools;
- `tools` modifier-only list: modify defaults;
- `excludeTools` applies after `tools`;
- `noTools: "all"` starts with no enabled tools;
- `noTools: "builtin"` disables default built-ins while retaining extension/custom tools;
- `customTools` registers SDK custom tools in addition to built-ins.

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/sdk.ts`

**DEC:** Headless/SDK applications MUST configure each created session independently. A supervisor's toolset MUST NOT be assumed to govern separately created peer sessions.

Recommended pattern:

```ts
const { session } = await createAgentSession({
  cwd,
  tools: [
    "read",
    "grep",
    "find",
    "ls",
    "json_query",
    "query_jsonl",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "run_validation",
  ],
  excludeTools: ["bash", "powershell", "codemode"],
  sessionManager: SessionManager.inMemory(cwd),
  resourceLoader,
});
```

The plain `tools` allowlist is the primary control. `excludeTools` is a redundant explicit exclusion for known general runners, not a substitute for a correct allowlist.

### 3.6 Extension registration

**SRC:** Pi v1.1.0 passes an `ExtensionAPI` to an extension factory. Custom tools are registered with:

```ts
registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
  tool: ToolDefinition<TParams, TDetails, TState>
): void;
```

A `ToolDefinition` includes, among other fields:

```ts
name: string;
label: string;
description: string;
promptSnippet?: string;
promptGuidelines?: string[];
parameters: TParams;
outputSchema?: TSchema;
exposure?: ToolExposure;
annotations?: ToolAnnotations;
defaultActive?: boolean;
executionMode?: ToolExecutionMode;

execute(
  toolCallId: string,
  params: Static<TParams>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ctx: ExtensionToolContext
): Promise<AgentToolResult<TDetails>>;
```

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts`

**DEC:** All `pi-nobash` model-facing custom tools use:

```ts
exposure: "direct",
defaultActive: false
```

No core `pi-nobash` tool uses `codemode`, `deferred`, or a generic orchestration exposure path.

### 3.7 Tool exposure and active tools

**SRC:** Pi v1.1.0 defines:

```ts
type ToolExposure =
  | "direct"
  | "model-only"
  | "codemode"
  | "deferred"
  | "hidden";
```

The active set returned by `getActiveTools()` is the set declared to the model. `direct` and `model-only` tools normally activate at registration unless `defaultActive: false`; `codemode` and `deferred` tools are callable through codemode even when not declared.

**DEC:** The `pi-nobash` extension neither depends on nor activates codemode. Diagnostics care primarily about the model-declared active set plus the explicit known general runner names.

### 3.8 Active tool inspection and mutation

**SRC:** Pi v1.1.0 `ExtensionAPI` exposes:

```ts
getActiveTools(): string[];
getAllTools(): ToolInfo[];
getSettings(): Settings;
setActiveTools(toolNames: string[]): void;
```

`setActiveTools` ignores unknown and hidden tools. Source also notes that codemode/deferred tools can remain callable from codemode scripts even when not active.

Pinned source:

- `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts`

**DEC:** `pi-nobash` uses `getActiveTools()` and `getAllTools()` for `/nobash-status`. It does **not** continuously rewrite the developer's active tool selection.

`setActiveTools()` MAY be used only by tests or an explicit user-initiated setup helper if later implemented. It is not required for normal package operation.

### 3.9 Tool-call interception

**SRC:** Pi v1.1.0 exposes:

```ts
pi.on(
  "tool_call",
  handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>
): () => void;
```

`ToolCallEvent` includes `toolName` and tool input. `ToolCallEventResult` is:

```ts
export interface ToolCallEventResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}
```

The event fires before execution and can block the call.

**DEC:** The extension MUST unconditionally block a direct `bash` tool call while loaded:

```ts
pi.on("tool_call", (event) => {
  if (event.toolName === "bash") {
    return {
      block: true,
      reason: "pi-nobash: direct Bash execution is disabled for this session.",
    };
  }
});
```

The blocker does not inspect Bash contents and does not attempt to decide whether a command is safe. This is the Disler-style unconditional backstop required by Product Spec v1.7.3.

PowerShell, codemode, and other known general runners are excluded by active tool selection and checked by diagnostics/tests. The package does not add a generalized cross-extension block engine.

### 3.10 Trusted extension execution API

**SRC:** `ExtensionAPI` itself includes:

```ts
exec(
  command: string,
  args: string[],
  options?: ExecOptions
): Promise<ExecResult>;
```

This is available to trusted extension implementation code.

**DEC:** This fact does not change the product boundary. `pi-nobash` is concerned with **model-facing general execution**. Trusted tool implementations may internally call fixed executables when needed, but:

- no model-facing tool may expose arbitrary `command`, executable, argv, flags, script text, or script path;
- model parameters are converted by trusted code into fixed operation-specific invocation shapes;
- package code MUST NOT implement `exec`, `run`, `process`, `shell`, `restricted_exec`, or similar generic tools.

### 3.11 Extension-tool coexistence

**SRC:** v1.1.0 distinguishes active tool names, allowlists, SDK custom tools, and extension tools. `AgentSession` builds the runtime with extension tools included, while `allowedToolNames` / `excludedToolNames` constrain exposure. SDK `customTools` are registered separately.

**DEC:** The integration test suite MUST prove all of the following on Pi `v1.1.0`:

1. loading `pi-nobash` registers its replacement tools;
2. replacement tools remain registered when Bash is omitted;
3. a plain-name CLI allowlist can activate selected replacement tools;
4. a plain-name SDK `tools` allowlist can activate selected replacement tools;
5. different sessions can activate different subsets;
6. `defaultActive: false` prevents package loading alone from exposing every replacement tool;
7. a deliberately re-exposed `bash` call is blocked.

No historical compatibility claim substitutes for these tests.

### 3.12 Pinned-source verification ledger

The exact source tree was accessed through immutable tag paths, **not through `main`**. The following checks were made by reading source text. These are not runtime test results.

| Pin path | Observed source lines | Verified static fact |
|---|---|---|
| `packages/coding-agent/docs/settings.md` | 29–46 | `defaultTools` defaults to `read,bash,edit,write`, permits plain selections/modifiers, documents inactive extension-tool selection and reload nuances. |
| `packages/coding-agent/src/core/sdk.ts` | 60–89; 262–276; 438–454 | `tools`/`noTools`/`excludeTools` contract; construction of `allowedToolNames`, `excludedToolNames`, and session args. |
| `packages/coding-agent/src/core/extensions/types.ts` | 470–481; 570–597; 1613–1625 | `ToolExposure`, `defaultActive`, tool execution signature, and active-tool APIs. |
| `packages/coding-agent/package.json` | 1–7; 48–70 | Package version `1.1.0` and dependency `typebox` `1.3.27`. |

**Verification limit:** A tagged source file is evidence of the code and comments at the specified tag. It does not prove package-loading success, extension-tool coexistence, callback delivery, or correct per-agent isolation in a running installation. Tests I1–I9 supply that missing evidence and MUST be run against the installed `1.1.0` runtime before implementation acceptance.

---

## 4. Architecture

### 4.1 Component model

`pi-nobash` consists of one Pi extension and a small internal library.

```text
Pi session
  |
  +-- native selected tools
  |     read / grep / find / ls
  |     edit / write when selected
  |
  +-- pi-nobash extension
        |
        +-- unconditional direct Bash-call blocker
        +-- /nobash-status
        +-- replacement tool registrations
              |
              +-- json_query
              +-- query_jsonl
              +-- git_status
              +-- git_diff
              +-- git_log
              +-- git_show
              +-- run_validation
              |
              +-- optional typed mutations when explicitly implemented/enabled
                    git_create_branch
                    git_add
                    git_commit
                    other future typed mutations only if product-justified
```

### 4.2 Architectural rules

**D1. Pi native selection is authoritative.** `pi-nobash` does not create profiles, roles, or a permission database.

**D2. Replacement tools are inactive by default.** Developers name the exact tools they want.

**D3. Read-only and mutation capabilities are separate.** A validation tool cannot silently mutate files. A diagnostic tool cannot auto-fix.

**D4. Trusted code owns mechanics.** The model selects an operation and bounded parameters; the tool implementation selects the parser, library, fixed executable, and fixed argv shape.

**D5. Unsupported remains unsupported.** No fallback path calls Bash, PowerShell, codemode, an interpreter, or a generic runner.

**D6. Domain operations are separate packages.** Core does not grow by absorbing application-specific tools.

---

## 5. Package layout

Normative package layout:

```text
pi-nobash/
├── package.json
├── README.md
├── extensions/
│   └── pi-nobash.ts
├── src/
│   ├── constants.ts
│   ├── status.ts
│   ├── errors.ts
│   ├── path-policy.ts
│   ├── config.ts
│   ├── json/
│   │   ├── json-query.ts
│   │   ├── jsonl-query.ts
│   │   ├── operators.ts
│   │   └── types.ts
│   ├── git/
│   │   ├── common.ts
│   │   ├── status.ts
│   │   ├── diff.ts
│   │   ├── log.ts
│   │   ├── show.ts
│   │   └── mutations/
│   │       ├── create-branch.ts
│   │       ├── add.ts
│   │       └── commit.ts
│   └── validation/
│       ├── config.ts
│       ├── target.ts
│       └── runner.ts
├── tests/
│   ├── unit/
│   ├── fixtures/
│   ├── integration/
│   └── performance/
└── tsconfig.json
```

### 5.1 `package.json`

Minimum intended shape:

```json
{
  "name": "pi-nobash",
  "version": "2.3.0",
  "type": "module",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "1.1.0",
    "typebox": "1.3.27"
  },
  "pi": {
    "extensions": ["./extensions/pi-nobash.ts"]
  }
}
```

The exact publish name may change, but the peer compatibility target does not. **SRC:** Pi v1.1.0 imports from `typebox` (not `@sinclair/typebox`) and lists `"typebox": "1.3.27"` in `packages/coding-agent/package.json`. The manifest pins the matching release. Packaging/peer resolution remains an integration test, not an assumption.

The package MUST NOT bundle a second physical copy of Pi host packages when Pi package conventions provide them from the host.

---

## 6. Extension entrypoint

`extensions/pi-nobash.ts` performs only these responsibilities:

1. register the unconditional `bash` `tool_call` blocker;
2. register `/nobash-status`;
3. load developer-owned `pi-nobash` operation configuration;
4. register all shipped replacement tools with `defaultActive: false`;
5. supply tool descriptions and bounded schemas.

Skeleton:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piNoBash(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash") {
      return {
        block: true,
        reason: "pi-nobash: direct Bash execution is disabled.",
      };
    }
  });

  registerStatusCommand(pi);
  registerJsonTools(pi);
  registerGitTools(pi);
  registerValidationTool(pi);
  registerOptionalMutationTools(pi);
}
```

The extension MUST NOT call `setActiveTools()` during ordinary startup. Tool selection belongs to the developer's Pi configuration.

---

## 7. Setup, activation, and deactivation

### 7.1 Install

Local development:

```sh
pi install ./pi-nobash
```

Project-local installation:

```sh
pi install --local ./pi-nobash
```

One-run evaluation:

```sh
pi -e ./pi-nobash --tools read,grep,find,ls,json_query,query_jsonl
```

### 7.2 Persistent activation

Example project `.pi/settings.json`:

```json
{
  "packages": ["./pi-nobash"],
  "defaultTools": [
    "read",
    "grep",
    "find",
    "ls",
    "json_query",
    "query_jsonl"
  ]
}
```

This is a read-only example. An editing agent may add `edit` and `write`. An engineering agent may add selected Git/validation tools.

The active tool list MUST be explicit enough to make the intended agent capability obvious.

### 7.3 SDK activation

Each SDK-created agent receives its own `tools` allowlist.

```ts
const reviewer = await createAgentSession({
  cwd,
  tools: ["read", "grep", "find", "ls", "json_query", "query_jsonl"],
  resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
});

const engineer = await createAgentSession({
  cwd,
  tools: [
    "read",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "json_query",
    "query_jsonl",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "run_validation"
  ],
  excludeTools: ["bash", "powershell", "codemode"],
  resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
});
```

### 7.4 Deactivation

Deactivation is deliberately simple:

1. remove the package declaration using Pi's package removal mechanism or delete the local package entry from the applicable settings;
2. restore the desired native `defaultTools` / CLI / SDK selection;
3. start or reload the Pi session as required;
4. inspect the resulting active tools.

There is no deactivation registry or package-specific protection state.

---

## 8. Configuration owned by `pi-nobash`

Pi native configuration selects tools. `pi-nobash` configuration defines trusted operation details that the model is not allowed to author.

### 8.1 Configuration location

**DEC:** Optional project configuration file:

```text
.pi/pi-nobash.json
```

The file is required only for capabilities that need developer-owned configuration, primarily named validation.

It MUST NOT contain an alternate active-tool profile system.

### 8.2 Initial schema

```json
{
  "validation": {
    "checks": {
      "unit": {
        "program": "npm",
        "args": ["test"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": {
          "mode": "file",
          "roots": ["test", "tests", "src"],
          "extensions": [".test.ts", ".spec.ts"],
          "argumentMode": "runner_verified_file_selector"
        }
      },
      "typecheck": {
        "program": "npm",
        "args": ["run", "typecheck"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": {
          "mode": "none"
        }
      }
    }
  }
}
```

This file is trusted developer configuration. It may identify a fixed executable and fixed argument prefix because the model cannot modify those fields through the tool API. The `argumentMode` above is a declarative marker: it is usable only when the implementation has a verified target-to-argument adapter for the configured runner. It is **not** permission to append raw target strings to arbitrary commands. For checks without such an adapter, configure `targets.mode: "none"`; the model may still run the named full check.

The package MUST fail a named validation call if its check does not exist.

---

## 9. Common tool contract rules

All custom tools MUST follow these rules.

### 9.1 Naming

Tool names use lowercase snake case.

### 9.2 Inputs

Inputs MUST:

- be TypeBox schemas;
- reject unknown operation variants where practical;
- contain no arbitrary code or command fields;
- use explicit enumerations for modes;
- use bounded integers for limits;
- use normalized paths;
- use arrays with configured maximum lengths.

### 9.3 Outputs

Successful tools SHOULD return both:

- concise model-facing text;
- structured data through `structuredContent` and `outputSchema` where stable structured results are useful.

Results MUST state truncation when it occurs.

### 9.4 Error codes

Core error codes:

```text
INVALID_ARGUMENT
PATH_OUT_OF_SCOPE
NOT_FOUND
PARSE_ERROR
LIMIT_EXCEEDED
TIMEOUT
VALIDATION_FAILED
GIT_FAILED
CAPABILITY_GAP
INTERNAL_ERROR
```

`CAPABILITY_GAP` is reserved for a legitimate requested operation that the approved tool surface intentionally does not represent.

### 9.5 Shared JSON/JSONL numeric semantics

**DEC:** Both `json_query` and `query_jsonl` use the same native JSON/JavaScript numeric representation (`number`, IEEE-754 binary64). Numeric comparisons and `sum`/`avg` accept only JSON numbers; numeric strings are never coerced. Both tools reject non-finite aggregate results and treat operations requiring exact integer arithmetic outside `Number.MAX_SAFE_INTEGER` / `Number.MIN_SAFE_INTEGER` as `LIMIT_EXCEEDED` rather than silently claiming exactness. JSON source integer tokens outside the safe-integer range MUST be detected before precision-losing parse (or conservatively rejected when detected by a validated parser). Both tools share the same tests for overflow, large integers, non-finite results, and mixed types. No implicit bigint support or custom expression language is added.

### 9.6 Result bounds

Default limits are implementation constants, not model-controlled unlimited values.

Recommended initial bounds:

```text
max returned text:          64 KiB per tool result
max structured rows:        500
default structured rows:    100
max input file size JSON:   32 MiB
max JSONL line size:        2 MiB
max JSONL returned rows:    500
max Git paths per request:  100
max Git log entries:        200
max validation targets:     50
```

These values may be tuned by measurement without changing the model-facing capability shape.

---

## 10. Native Pi tools

No wrappers are created for capabilities already supplied adequately by Pi.

Preferred native tools:

| Intent | Pi tool |
|---|---|
| Read file/range | `read` |
| Fixed-string search | `grep` with literal behavior |
| Regex search | `grep` |
| Path discovery | `find` |
| Directory listing | `ls` |
| Exact content editing | `edit` |
| File creation/replacement | `write` |

Agents that do not need mutation SHOULD omit `edit` and `write`.

A model's inability to express an irregular transformation through these tools is not a reason to add generic execution.

---

## 11. `json_query`

### 11.1 Purpose

Read and query one JSON document using a small typed operator set.

### 11.2 Side effects

Read-only.

### 11.3 Input

Proposed contract:

```ts
type JsonQueryInput = {
  path: string;
  root?: JsonPath;
  where?: Predicate[];
  select?: Selection[];
  aggregate?: Aggregate[];
  orderBy?: OrderBy[];
  limit?: number;
};
```

No field accepts JavaScript, Python, jq, SQL, regex replacement code, or arbitrary expressions.

### 11.4 Path representation

**DEC:** JSON paths are represented as typed segment arrays rather than a mini-language:

```ts
type JsonPath = Array<
  | { key: string }
  | { index: number }
>;
```

This avoids creating another expression parser.

### 11.5 Predicates

Initial supported operators:

```text
eq
ne
lt
lte
gt
gte
exists
is_null
in
contains_string
```

Predicate operands are typed JSON scalar values.

No arbitrary predicate expression is supported.

### 11.6 Selection

Initial selection supports:

- selecting a named output field from a typed path;
- returning the selected root value when no projection is requested.

### 11.7 Aggregation

Initial aggregates:

```text
count
sum
min
max
avg
```

`sum`, `min`, `max`, and `avg` require numeric values. Type mismatches return a predictable error; values are not silently coerced from strings.

### 11.8 Ordering

Ordering is permitted only on projected scalar fields.

Initial modes:

```text
asc
desc
```

### 11.9 Semantics

- missing and `null` are distinct;
- numeric comparisons operate only on numbers, under the shared numeric policy in Section 9.5;
- string comparison is not implicitly numeric;
- order is stable where input order is otherwise equal;
- limits apply after filtering/projection unless a specific aggregate semantics requires otherwise;
- malformed JSON returns `PARSE_ERROR`;
- unsupported shape returns `CAPABILITY_GAP`, not an expression fallback.

---

## 12. `query_jsonl`

### 12.1 Purpose

Stream a JSONL file and perform bounded selection/filtering/aggregation without loading the complete file into model context.

### 12.2 Side effects

Read-only.

### 12.3 Input surface

The predicate, projection, and aggregate types are shared with `json_query`.

Additional JSONL fields:

```ts
type JsonlQueryInput = {
  path: string;
  malformedLine: "error" | "skip";
  where?: Predicate[];
  select?: Selection[];
  groupBy?: Selection[];
  aggregate?: Aggregate[];
  orderBy?: OrderBy[];
  limit?: number;
};
```

### 12.4 Streaming behavior

The implementation MUST:

1. stream lines;
2. enforce per-line size limits;
3. parse each line independently;
4. filter before projection where possible;
5. aggregate incrementally where possible;
6. avoid retaining all matching records unless required by ordering/grouping;
7. bound final returned records;
8. return scan metrics.

Suggested structured result metadata:

```json
{
  "scannedLines": 10000,
  "parsedLines": 9997,
  "skippedMalformedLines": 3,
  "matchedLines": 412,
  "returnedRows": 100,
  "truncated": true
}
```

### 12.5 Grouping and sorting

Grouping may require retained aggregate state. Ordering may require buffering a bounded result set.

The implementation MUST NOT claim constant memory for operations that inherently buffer.

### 12.6 Large-number behavior

Apply the **shared numeric policy in Section 9.5** identically to JSON and JSONL. Exact large-integer support is deferred and MUST NOT be implied by either tool.

---

## 13. Typed Git tools

### 13.1 General rules

Git is implemented as separate purpose-built tools so agents can receive read-only inspection without mutation.

All Git tools:

- operate in the current workspace repository;
- resolve repository root using trusted implementation code;
- invoke Git without a shell;
- construct fixed argv from typed parameters;
- reject arbitrary flags;
- bound output;
- accept only operation-specific revisions/paths;
- do not interpret model input as a command line.

Git hooks and repository-controlled behavior remain a documented limitation. `pi-nobash` does not claim Git mutations are harmless.

### 13.2 `git_status`

Read-only.

Input:

```ts
{
  paths?: string[];
  includeUntracked?: boolean;
}
```

Output includes normalized branch/head state and file status entries.

### 13.3 `git_diff`

Read-only.

Input:

```ts
{
  mode: "working" | "staged" | "commit";
  revision?: string;
  paths?: string[];
  contextLines?: number;
}
```

`revision` is allowed only when `mode: "commit"`.

No arbitrary diff flags.

### 13.4 `git_log`

Read-only.

Input:

```ts
{
  maxEntries?: number;
  paths?: string[];
}
```

Output contains fixed fields such as hash, author, timestamp, and subject.

### 13.5 `git_show`

Read-only.

Input:

```ts
{
  revision: string;
  paths?: string[];
}
```

No arbitrary format string.

### 13.6 Optional Git mutations

These are **deferred candidates, not mandatory v2.3 deliverables**. If justified and implemented later, each is a separate, individually selectable tool. No Git mutation is exposed merely because the read-only Git tools are installed.

#### `git_create_branch`

```ts
{
  name: string;
  startPoint?: string;
  switchToBranch?: boolean;
}
```

Branch name MUST pass Git reference validation.

#### `git_add`

```ts
{
  paths: string[];
}
```

No `-A`, no implicit whole-repository staging in the initial contract.

#### `git_commit`

```ts
{
  message: string;
}
```

Commits currently staged changes. The tool does not stage automatically.

### 13.7 Deferred Git operations

The following are not included unless separately justified and specified:

```text
reset
clean
checkout arbitrary paths
restore
rebase
merge
push
pull
fetch
tag mutation
rm working-tree deletion
arbitrary config
arbitrary plumbing commands
```

Git index-only removal (`git rm --cached`) is **not part of initial delivery**. It changes the Git index while preserving working-tree content, and is not interchangeable with filesystem deletion. If justified later, it requires a separate typed Git operation and contract; no existing tool silently implements it.

---

## 14. Named validation

### 14.1 Purpose

Run developer-approved test, lint, typecheck, build, or analysis checks without allowing the model to choose an executable or arbitrary arguments.

### 14.2 Side-effect classification

`run_validation` is logically a validation/diagnostic capability, but the underlying developer-owned command may execute repository code and may itself have side effects.

It MUST NOT be used for deliberate auto-fix mutations.

### 14.3 Tool input

```ts
type RunValidationInput = {
  check: string;
  targets?: string[];
};
```

There is no command, executable, argv, script, shell, environment-expression, or free-form option parameter.

### 14.4 Trusted check definition

Each configured check defines:

```ts
type ValidationCheck = {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  targets:
    | { mode: "none" }
    | {
        mode: "file";
        roots: string[];
        extensions?: string[];
        exact?: string[];
        argumentMode: "runner_verified_file_selector";
      };
};
```

### 14.5 Target selection

A check may permit a bounded list of approved **test targets**.

Rules:

1. target selection is allowed only when the configured check says `mode: "file"`;
2. targets MUST resolve under an allowed root or match an exact approved target;
3. targets MUST satisfy allowed extension rules when extensions are configured;
4. directories, scripts, executables, package names, and arbitrary runner options are not inferred from target text;
5. traversal outside approved roots is rejected;
6. target count is bounded;
7. each target MUST exist and be a regular file within the approved scope;
8. the trusted adapter MUST convert target paths into **runner-specific fixed file-selection syntax**, with an unambiguous position and argument form verified for that runner;
9. a target MUST NOT be interpreted as a CLI option, free-form runner argument, script entrypoint, or executable. Do not assume every runner supports `--` or has the same file-target syntax;
10. if the runner-specific adapter has not been verified, or the requested target shape cannot be represented safely, reject the targeted call rather than pass through raw arguments. A named check with `targets.mode: "none"` remains available.

The model therefore can request a specific approved test file but cannot select an arbitrary script for execution.

### 14.6 Execution

The trusted runner invokes the configured executable directly without shell interpolation.

Pseudocode:

```ts
const targetArgs = verifiedRunnerAdapter(check, validatedTargets);
spawn(check.program, [...check.args, ...targetArgs], {
  cwd: resolvedCheckCwd,
  shell: false,
  signal,
});
```

The exact Node child-process primitive is an implementation choice. What matters is the fixed executable and verified runner-specific argument construction. The model never supplies the runner adapter or raw argument tokens.

### 14.7 Result

Return:

```json
{
  "check": "unit",
  "targets": ["tests/foo.test.ts"],
  "exitCode": 1,
  "timedOut": false,
  "stdout": "...bounded...",
  "stderr": "...bounded...",
  "truncated": false,
  "durationMs": 832
}
```

Nonzero exit is `VALIDATION_FAILED`, not `INTERNAL_ERROR`.

### 14.8 Cancellation and timeout

When Pi supplies an `AbortSignal`, the runner MUST stop the child process when practical. Every check has a developer-defined timeout.

A timeout returns `TIMEOUT`.

---

## 15. Optional typed mutations

Optional mutation capabilities are intentionally separate from `run_validation`.

### 15.1 Initial boundary

The first conforming implementation does **not** include dedicated complex-text-surgery or file-lifecycle tools. Use native Pi `read`, `edit`, and `write` for work they can express; otherwise report `CAPABILITY_GAP`. A failed exact-match edit does not itself authorize a replacement interpreter or an unrestricted text transformation.

The following are deferred candidates, **not initial-delivery requirements**:

- scoped linter safe-fix;
- scoped linter unsafe-fix;
- range-based edit;
- append;
- regex-based replacement or other complex text surgery;
- workspace copy;
- workspace move;
- tightly scoped cleanup/deletion.

### 15.2 Admission rule

An optional mutation may be added only when all are true:

1. a recurring task is evidenced;
2. the operation has a stable narrow semantic contract;
3. the model does not provide arbitrary executable/code/flags;
4. target scope is explicit and bounded;
5. it is registered as a separately selectable tool;
6. its side effects are stated;
7. tests assert exact intended diffs/effects.

### 15.3 Linter fixes

If implemented, diagnostics and fixes MUST remain separate.

Example split:

```text
run_validation(check="lint")          # read-only intent
lint_fix_safe(paths=[...])            # mutating
lint_fix_unsafe(paths=[...])          # mutating, separately selectable
```

`run_validation(check="lint")` MUST NOT silently call an auto-fix mode.

### 15.4 Workspace lifecycle vs. Git index

No dedicated file copy/move/delete operation is included in initial delivery. Git index-only removal (`git rm --cached`) is also deferred and belongs to a distinct Git mutation contract, not this file-lifecycle category. Unsupported operations return `CAPABILITY_GAP` rather than improvising a shell fallback.

No recursive general deletion tool is included.

If a later workflow proves a need for deletion, the operation must have a narrower contract than arbitrary `rm`, with explicit workspace scope and no generic recursion.

---

## 16. Capability gaps

### 16.1 Required behavior

When a legitimate request cannot be expressed by selected native or `pi-nobash` tools:

- do not execute a fallback;
- do not claim success;
- identify the missing operation;
- report `CAPABILITY_GAP`.

### 16.2 Tool-level gap result

Where the model called an existing tool with a request shape outside that tool's supported semantics:

```json
{
  "error": {
    "code": "CAPABILITY_GAP",
    "capability": "json_transform_join",
    "message": "This package does not support arbitrary JSON joins."
  }
}
```

### 16.3 Agent-level gap

If no tool exists at all, the model cannot emit a tool result. The expected response is a concise statement equivalent to:

```text
CAPABILITY_GAP: the selected toolset has no operation for <requested operation>.
```

No general approval/escalation workflow is added.

---

## 17. Status diagnostics

### 17.1 Command

Register:

```text
/nobash-status
```

This is a user-facing diagnostic command, not a model-facing execution capability.

### 17.2 Required output

The command MUST report Product AC10's five items:

1. loaded package name/version;
2. effective active tools, or an explicit unavailable state;
3. known general execution tools present/absent;
4. packaged replacement tools registered/available and which are active;
5. clearly incomplete configuration, or `none known`.

### 17.3 Known general-execution names for Pi v1.1.0

Initial explicit list:

```text
bash
powershell
codemode
```

This list is version-specific. It is not claimed to detect all possible third-party generic runners.

### 17.4 Example

```text
pi-nobash 2.3.0
target Pi: @earendil-works/pi-coding-agent 1.1.0

active tools:
  read
  grep
  find
  ls
  json_query
  query_jsonl

known general execution:
  bash        absent
  powershell  absent
  codemode    absent

pi-nobash tools:
  json_query       active
  query_jsonl      active
  git_status       inactive
  git_diff         inactive
  git_log          inactive
  git_show         inactive
  run_validation   inactive

configuration:
  none known
```

If `bash`, `powershell`, or `codemode` is active, status MUST say `NONCONFORMING` for the effective no-general-execution configuration. It does not terminate the session. **Conformance** and **configuration completeness** are distinct fields: conformance reports known active general runners; configuration reports any separately detected missing package/configuration prerequisites or `none known`.

Example with intentionally re-exposed Bash:

```text
pi-nobash 2.3.0
conformance: NONCONFORMING
active tools: read, grep, bash, json_query
known general execution:
  bash        PRESENT (direct calls blocked by pi-nobash)
  powershell  absent
  codemode    absent
pi-nobash tools: json_query active; query_jsonl inactive; others inactive
configuration: known general-execution tool active: bash
```

This display is diagnostic only; it does not turn runtime inspection into an admission gate.

---

## 18. Path handling

### 18.1 Scope

Custom file-taking tools operate relative to the Pi session `cwd` unless the operation explicitly accepts a repository revision rather than a filesystem path.

### 18.2 Normalization

A shared path helper MUST:

1. resolve the requested path against `cwd`;
2. normalize `.` and `..`;
3. reject resolution outside the workspace for tools defined as workspace-scoped;
4. reject null bytes;
5. enforce operation-specific file/directory expectations.

This is ordinary input correctness, not an OS sandbox.

### 18.3 Symlinks

For workspace-scoped file operations, resolve the real path before enforcing containment when the file exists. For paths that do not yet exist, resolve and validate the nearest existing ancestor, then normalize the remainder.

The implementation MUST test symlink escape cases for its own path contracts, without claiming host isolation.

---

## 19. Performance design

Performance optimization follows the Assessment v3.2.1 boundary: optimize recurring typed operations without expanding capability.

### 19.1 Principles

- use Pi native `read`, `grep`, `find`, and `ls` instead of wrappers;
- use literal search when fixed-string semantics are intended;
- stream JSONL;
- filter early;
- project only requested fields;
- bound results;
- avoid full diagnostic dumps when counts and selected findings suffice;
- do not add caches/indexes until paired measurement proves value;
- do not change semantics for speed.

### 19.2 Per-tool metrics

Test harness records:

```text
duration_ms
input_bytes
output_bytes
rows_scanned
rows_returned
truncated
peak_rss_delta when practical
exit_code where applicable
```

### 19.3 Whole-task metrics

For paired Bash-enabled versus `pi-nobash` fixtures record:

```text
task_result
end_to_end_latency_ms
model_turns
tool_calls
input_tokens
output_tokens
tool_output_bytes
timeouts
CAPABILITY_GAP count
final_diff equivalence
diagnostic equivalence
```

Correctness is evaluated before speed.

---

## 20. Tests

### 20.1 Test layers

Only ordinary product tests are required:

1. unit tests;
2. Pi v1.1.0 integration tests;
3. capability fixtures;
4. performance comparisons.

This is not an adversarial security test program.

### 20.2 Unit tests

Required unit coverage:

- TypeBox input rejection;
- JSON path resolution;
- missing versus null;
- numeric predicate semantics;
- JSON projection;
- aggregate semantics;
- malformed JSON;
- malformed JSONL `error` and `skip`;
- JSONL output limits;
- JSONL line-size limits;
- stable ordering;
- Git path normalization;
- Git revision validation behavior;
- validation target allow/reject cases;
- runner-specific target translation, including filenames beginning with `-`, runner option-injection attempts, unsupported runners, missing files, and approved target selections;
- validation timeout;
- output truncation;
- `CAPABILITY_GAP` encoding.

### 20.3 Pi v1.1.0 integration tests

Run against the exact pinned Pi release. Passing these tests, not source inspection alone, is the mandatory release acceptance gate for toolset selection/coexistence and Bash interception.

#### I1 — Package load

Install/load the local package and verify its extension initializes.

#### I2 — Replacement tool registration

Verify `getAllTools()` contains every expected `pi-nobash` tool.

#### I3 — Inactive-by-default replacements

Load package without naming replacement tools and verify each `defaultActive: false` replacement is not in `getActiveTools()`.

#### I4 — CLI allowlist coexistence

Start Pi with:

```text
--tools read,grep,find,ls,json_query,query_jsonl
```

Verify those tools are active and `bash`, `powershell`, and `codemode` are not.

#### I5 — SDK allowlist coexistence

Create a session with a plain-name `tools` allowlist containing selected built-ins and `pi-nobash` tools. Verify exact intended active tools.

#### I6 — Different agents, different tools

Create at least two independent sessions with different `tools` arrays. Verify their active tool lists differ as configured.

#### I7 — Bash backstop

Deliberately expose `bash` while the extension is loaded. Use a Bash invocation whose only intended observable effect would be creating a uniquely named sentinel file inside a disposable test directory. Issue that direct tool call; assert the tool result reports the block and the sentinel file **does not exist** afterward. A positive-control run in a separate, intentionally non-`pi-nobash` test session MUST establish that the same invocation would create the sentinel. The test only checks the required direct-call backstop, not indirect execution paths.

This test verifies Product AC3. The blocker does not parse the command text.

#### I8 — Status

Invoke `/nobash-status` and assert all five AC10 fields.

#### I9 — Package removal/deactivation

Remove/unload the package, restore a normal Pi tool selection, and verify `pi-nobash` tools/status command are absent and unrelated Pi sessions are unaffected.

### 20.4 Capability fixtures

Required fixtures from the assessment:

| Fixture | Assertion |
|---|---|
| Literal search | Native Pi search returns expected lines/paths. |
| Regex search | Native Pi regex behavior matches fixture expectation. |
| Range read/list | Native Pi result is correct. |
| JSON nested extract | Exact values and JSON types. |
| JSON filter/count | Exact result. |
| JSONL filter/count/group | Exact aggregate and malformed-line policy. |
| Large JSONL | Streaming behavior and bounds. |
| Git status | Correct normalized repository state. |
| Git diff | Correct working/staged/revision diff semantics. |
| Git log/show | Correct requested history/object view. |
| Named validation | Correct check invoked without model-controlled executable/flags. |
| Approved test target | Verified runner adapter selects exactly the intended file. |
| Target argument ambiguity | Option-like filenames and unsupported runner target syntax are rejected before process start; no arbitrary options/scripts execute. |
| Out-of-scope target | Rejected before process start. |
| Unsupported JSON transform | `CAPABILITY_GAP`; no fallback. |
| Optional Git mutation | Exact branch/index/history effect when feature is enabled. |

### 20.5 Whole refactoring-cycle fixture

Use one representative engineering fixture:

```text
inspect repository
→ collect named diagnostics
→ make selected edits
→ run targeted named test
→ run broader named checks
→ inspect Git diff
→ stage selected files
→ commit
```

The mutation stages are tested only when their corresponding tools are enabled.

Assert final repository state and diagnostics, not only exit codes.

---

## 21. Performance measurement

### 21.1 Baseline

Where historical Bash behavior can be reproduced safely in a disposable fixture, compare the same task on:

```text
A: ordinary Pi with Bash-enabled workflow
B: Pi v1.1.0 + pi-nobash with selected replacements
```

Use the same:

- repository snapshot;
- model;
- task prompt;
- machine;
- Pi release;
- validation configuration.

### 21.2 Required reporting

Do not publish a blanket speedup percentage.

Report per-fixture:

```text
PASS
CAPABILITY_GAP
incorrect
error
```

and the measured metrics from Section 19.

The Assessment's historical 411/414 discrepancy remains a prioritization issue and MUST NOT be converted into a precise replacement-coverage percentage unless the original call inventory is reconciled.

---

## 22. Implementation sequence

### Phase 1 — Pi integration foundation

1. Create package skeleton and `pi` manifest.
2. Pin peer compatibility to `@earendil-works/pi-coding-agent` `1.1.0`.
3. Register Bash `tool_call` blocker.
4. Register `/nobash-status`.
5. Register placeholder replacement tools with `defaultActive: false`.
6. Implement CLI/SDK integration tests against Pi v1.1.0.

Exit criterion: AC1–AC5 and AC10 integration scaffolding passes.

### Phase 2 — Structured data

1. Implement shared typed path/predicate library.
2. Implement `json_query`.
3. Implement streaming `query_jsonl`.
4. Add bounds, structured outputs, errors, and fixtures.
5. Benchmark representative JSON/JSONL tasks.

Exit criterion: JSON/JSONL subset of AC6 and AC11 passes.

### Phase 3 — Git inspection

1. Implement repository/root handling.
2. Implement `git_status`.
3. Implement `git_diff`.
4. Implement `git_log`.
5. Implement `git_show`.
6. Add bounded output and fixtures.

Exit criterion: read-only Git subset of AC6 passes.

### Phase 4 — Named validation

1. Implement `.pi/pi-nobash.json` validation config loader.
2. Implement named check lookup.
3. Implement bounded target validation.
4. Implement fixed direct process invocation.
5. Add timeout/cancellation/output limits.
6. Add targeted-test fixtures.

Exit criterion: validation subset of AC6, AC7, and AC9 passes, including runner-specific target argument handling.

### Phase 5 — Optional post-baseline Git mutations (deferred)

**Not a release requirement for v2.3.** If documented recurring workflows later justify Git mutation tools, implement separately and in this preferred order: `git_create_branch`, `git_add`, then `git_commit`. Each must be individually selectable and tested. Git index-only removal remains deferred to an independent decision.

The initial deliverable proceeds from Phase 4 directly to Phase 6. This phase is retained to record the potential implementation order, not to expand mandatory scope.

### Phase 6 — Measurement and gaps

1. create `tests/coverage/representative-workload.jsonl`, a **machine-readable coverage manifest** with one row per representative legacy task/fixture, containing `call_id` (or stable fixture ID when original logs are unavailable), `source_session`, `requested_intent`, `replacement_class`, `tool_and_operation`, `fixture_id`, `result` (`PASS`, `CAPABILITY_GAP`, `NEEDS_REVIEW`, `FAIL`), `semantic_differences`, and notes;
2. run representative historical task mappings and populate that manifest with observed fixture outcomes;
3. record unsupported cases as explicit `CAPABILITY_GAP`, not hidden omissions;
4. run whole-task benchmark;
5. tune only measured bottlenecks;
6. document unresolved operations and the historical **411 calls vs. 414 category assignments** discrepancy without calculating a misleading exact historical coverage percentage.

All optional typed mutations, including Git mutations and dedicated complex-edit/file-lifecycle tools, remain deferred until justified. The mandatory baseline consists of the Bash blocker, status/selection integration, typed JSON/JSONL, read-only Git inspection, named validation, documented gaps, and acceptance testing.

---

## 23. Acceptance traceability

### 23.1 Product acceptance criteria

| Product AC | Technical evidence |
|---|---|
| **AC1 — Opt-in without changing unrelated sessions** | I1, I6, I9. Package is explicitly loaded; other sessions retain their own native selection. |
| **AC2 — No known general execution in configured active toolset** | I4 and I5 inspect effective active tools for `bash`, `powershell`, `codemode`. |
| **AC3 — Direct Bash call blocked** | I7 intentionally re-exposes Bash, attempts a sentinel-producing command, and verifies afterward that the call was blocked and the sentinel was not created. |
| **AC4 — Different toolsets per agent** | I6 creates separate SDK sessions with distinct `tools` arrays. |
| **AC5 — Pi native operations still work** | Native capability fixtures for read/search/list/edit/write where selected. |
| **AC6 — JSON/JSONL, Git, validation correct** | Unit and capability fixtures Sections 20.2–20.4. |
| **AC7 — No generic execution API in replacements** | Schema review: no command/program/code/script/argv fields; negative input tests. |
| **AC8 — Legacy coverage explicit** | Phase 6 generates `tests/coverage/representative-workload.jsonl` from executed representative fixtures and records `PASS`, `CAPABILITY_GAP`, `NEEDS_REVIEW`, or `FAIL`; no false historical aggregate percentage. |
| **AC9 — Unsupported requests visibly fail** | Unsupported JSON transform and missing capability fixtures produce `CAPABILITY_GAP`; no process fallback. |
| **AC10 — install/deactivate/status** | I1, I8, I9 plus assertions for all five required status items. |
| **AC11 — correctness and performance measured** | Section 21 paired task reports and whole-refactoring-cycle benchmark. |

### 23.2 Goal traceability

| Technical section | Product goals |
|---|---|
| Pi integration and Bash blocker | G1, G3, G5 |
| Native Pi tool reuse | G2, G7 |
| JSON/JSONL | G2, G4, G7 |
| Git tools | G2, G3, G4 |
| Named validation | G2, G4 |
| Capability gaps | G6 |
| Status/setup/removal | G5 |
| Tests/performance | G7 |

---

## 24. Source-confirmed, runtime-tested, and decision matrix

| Item | State at spec authoring | Required implementation evidence |
|---|---|---|
| `@earendil-works/pi-coding-agent` version `1.1.0` at tag | **SRC** | package metadata test optional |
| Pi package install/remove forms | **SRC** | I1/I9 |
| `defaultTools` semantics | **SRC** | I4 plus settings variant |
| CLI `--tools` allowlist semantics | **SRC** | I4 |
| CLI `--exclude-tools` | **SRC** | I4 variant |
| SDK `tools`, `excludeTools`, `noTools`, `customTools` signatures | **SRC** | I5/I6 |
| `registerTool(...)` signature | **SRC** | compile + I2 |
| `ToolDefinition.execute(...)` signature | **SRC** | compile + tool fixtures |
| `defaultActive: false` behavior | **SRC**, **PENDING-TEST** | I3 |
| `getActiveTools(): string[]` | **SRC** | I4/I5/I8 |
| `getAllTools(): ToolInfo[]` | **SRC** | I2/I8 |
| `setActiveTools(toolNames: string[]): void` | **SRC** | optional integration check |
| `tool_call` interception + `{block, reason}` | **SRC**, **PENDING-TEST** | I7 |
| extension-tool coexistence under strict allowlist | **SRC**, **PENDING-TEST** | I4/I5 |
| distinct per-session SDK selections | **SRC**, **PENDING-TEST** | I6 |
| JSON operator set in this document | **DEC** | unit/capability fixtures |
| separate Git tool names | **DEC** | tool fixtures |
| `.pi/pi-nobash.json` config path | **DEC** | config tests |
| validation target rules | **DEC** | target tests |
| optional mutation set | **DEC** | tests only if implemented |
| runtime behavior of complete package | **PENDING-TEST** | full acceptance suite |

No new product decision blocks the initial scope. The mandatory runtime verification gate before declaring v2.3 implemented is execution of the integration suite against the exact Pi v1.1.0 runtime.

---

## 25. Nonconforming implementations

An implementation is nonconforming if any of these are true:

- a configured `pi-nobash` agent exposes `bash`, `powershell`, or `codemode` to the model;
- the direct Bash blocker is absent while the package is loaded;
- a replacement tool accepts arbitrary command text, executable names, argv, script text, interpreter input, or model-chosen executable entrypoints;
- a validation target can select an arbitrary script or inject arbitrary runner flags;
- a diagnostic/validation operation silently performs mutation;
- a missing capability falls back to Bash, codemode, PowerShell, an interpreter, or a generic runner;
- the package claims to sandbox or contain the host;
- the package creates a second permission/profile framework instead of using Pi native tool selection;
- domain-specific extensions are folded into the core package without a product-spec change;
- implementation compatibility is inferred from Pi `main` instead of verified against v1.1.0.

---

## 26. References

### Product authority

- `pi-nobash-product-spec-v1.7.3.md`
- `bash-substitution-assessment-v3.2.1.md`

### Pi v1.1.0 pinned sources

- Package metadata:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/package.json`
- Package documentation:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/packages.md`
- Settings:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/settings.md`
- CLI tool options:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/docs/cli.md`
- SDK:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/sdk.ts`
- Extension types and APIs:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/extensions/types.ts`
- Agent session tool selection/runtime:  
  `https://github.com/earendil-works/pi/blob/v1.1.0/packages/coding-agent/src/core/agent-session.ts`

### Design precedent

- Disler, *Bash: Damage From Within*, Level 5 no-Bash approach:  
  `https://github.com/disler/bash-damage-from-within`

---

## 27. Governing implementation rule

> **The model chooses only an explicitly selected, purpose-built capability and supplies bounded typed inputs. Trusted implementation code performs the operation. When no approved capability represents the requested work, the result is `CAPABILITY_GAP`. General-purpose execution is not the fallback.**

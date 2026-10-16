# Evaluation: `codemode` as a supported tool (issue #6)

**Decision: DEFER — keep `codemode` excluded.** `KNOWN_GENERAL_EXECUTION_TOOLS` stays as is, and the
stack guides keep `--exclude-tools bash,powershell,codemode`.

Investigated 2026-10-15 against the installed runtime `@earendil-works/pi-coding-agent` 1.1.0
(verified version), not the blog post.

## What codemode is (verified)

- The tool input is **raw JavaScript**, run as an async-function body in a QuickJS sandbox in the
  harness; the script reaches the outside world only through `tools.<name>` and `models`
  (`node_modules/@earendil-works/pi-coding-agent/docs/codemode.md`). It is enabled with
  `defaultTools: ["+codemode"]` or `--tools +codemode` (`docs/cli.md:160-169`).

## Answers to the checklist

**1. Does a `tools.<name>()` call go through the same `tool_call` hook the bash blocker uses?
Yes.** `agent-session.js` `_executeNestedToolCall` runs each nested call through `runToolCall` with
`beforeToolCall: (context) => this._beforeToolCall(context, parentId)` and
`afterToolCall: (context) => this._afterToolCall(context, parentId)`
(`dist/core/agent-session.js:383-410`), and `_beforeToolCall` emits the `tool_call` hook
(`dist/core/agent-session.js:326-347`). The codemode tool header states it directly: "Nested calls
run through the agent loop's tool pipeline (`ctx.executeTool`), so validation, `tool_call`/
`tool_result` hooks, and permission checks apply exactly as for direct calls"
(`dist/extensions/codemode/tool.js:9-12`). So **pi-nobash's unconditional bash blocker also blocks
`tools.bash()` from a script** — codemode is not a bash-blocker bypass.

**2. What can a script reach?** `_getCallableTools` (`dist/core/agent-session.js:1143-1148`) returns
tools where `exposure === "codemode" || exposure === "deferred" || (exposure === "direct" && active)`.
So: active `direct` tools, plus **every `codemode`/`deferred` tool even when not active**.
pi-nobash's tools are `exposure: "direct"` + `defaultActive: false`, so they are *not* reachable
from a script unless the developer selects them. But **MCP tools default to `codemode` exposure**
and stay callable from scripts even when not declared (`docs/cli.md:132`) — a surface a repository
cannot scope from pi-nobash.

**3. Is the typing real or cosmetic?** Per-call arguments are typed: `describeTool(name)` returns the
tool's TypeScript declaration and `ALL_TOOLS` lists every callable tool, including ones the
description does not list (`docs/codemode.md`). So nested calls are typed and validated. But the
script body itself is arbitrary JavaScript, and the tool's model-facing input is a **script** —
exactly the field the pi-nobash governing boundary forbids ("No tool accepts a program, executable,
command, argv, script, entrypoint, or user-supplied flag field"; product spec §4.3 / PD6).

**4. `models.*`.** A script can run non-LLM models with the session's credentials:
`models.classify()` and `models.generateImages()`, with usage counted toward session cost
(`docs/codemode.md`). This is a **network + credential + cost surface that tool selection does not
gate**, and no pi-nobash product goal covers it.

**5. Interaction with `--exclude-tools`.** `--exclude-tools bash,powershell,codemode` removes
`codemode` itself, so scripts are unavailable at all. Excluding `bash` removes it from the active
`direct` set, so it is not callable from a script either — and even if it were active, the
`tool_call` hook blocks it (answer 1).

## Why defer

1. The model-facing input is arbitrary JavaScript — the "script" the boundary forbids. The sandbox
   limits execution, but the boundary is about the *shape* of the surface, not only runtime safety.
2. The only capability codemode adds over pi-nobash's typed tools is `models.*` (network,
   credentials, cost), which no goal covers and tool selection cannot gate.
3. It is not needed: pi-nobash's tools are already directly callable, small, and bounded; codemode's
   value (parallel calls, filtering large outputs, keeping context small) does not apply to them.
4. Adoption risk is not "unblocked bash" (verified blocked) but "composition over an unscoped set
   (MCP tools) plus a credential/cost surface".

## If this is ever revisited (smallest complete change)

Enable `codemode` only with `codemode.mode: "on"`, the developer's selected toolset, no MCP servers,
and an explicit, documented acceptance of the `models.*` surface; confirm on the then-current Pi
version that the `tool_call` hook still covers nested calls. Do not add codemode to the stack
guides' `--tools` lines without that decision.

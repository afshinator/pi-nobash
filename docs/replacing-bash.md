# Replacing Bash

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). The README explains what the
package is and why; this guide covers what an agent actually reaches for a shell to do,
what pi-nobash already covers, and — for anything not covered — the concrete fix.

The recorded counts come from the [Bash Substitution
Assessment](./bash-substitution-assessment-v3.2.1.md). They are priorities, not exact
metrics: the inventory's categories sum to 414 against a 411-call total and were never
reconciled, so treat them as "which gaps matter most", not a coverage percentage.

## The two things configuration can do — and what it cannot

This is the part that is easy to miss. `.pi/pi-nobash.json` and tool selection are the only
configuration surfaces, and they can do exactly two things:

1. **Select which existing tools an agent gets** — `--tools`, `.pi/settings.json`
   `defaultTools`, or the SDK `tools` array.
2. **Define `run_validation` checks** — developer-owned `program`/`args`/`targets` in
   `.pi/pi-nobash.json` (see [Named validation](./validation.md)).

**Configuration cannot invent a new operation.** If a capability is not already one of the
seven packaged tools — or a native Pi tool — then no config edit adds it. It needs a small
**Pi extension**: a TypeScript file that registers one typed tool. You write that once, then
select it per agent like any other tool. There is deliberately no config knob that turns
model-supplied text into an executed program; that is the whole point of the package.

So for every row below, the third column answers "config or code?" directly.

## What a missing capability looks like

A request the selected tools cannot express does not fall back to anything. Instead:

- **A tool exists, but the shape is unsupported.** The tool returns an error result:

  ```json
  {
    "content": [{ "type": "text", "text": "CAPABILITY_GAP: this package does not support ordering by an unprojected path: latency_ms" }],
    "details": { "code": "CAPABILITY_GAP", "capability": "order_by_raw_path", "message": "this package does not support ordering by an unprojected path: latency_ms" },
    "isError": true
  }
  ```

  The `capability` field names what was missing, so the gap is machine-readable.

- **No tool exists at all.** There is nothing to return a result, so the agent states it:

  ```text
  CAPABILITY_GAP: the selected toolset has no operation for <requested operation>.
  ```

## Observed Bash uses → coverage → the fix

`today` = what pi-nobash or native Pi already provides. `to close a gap` states whether the
fix is configuration or a new tool.

| Shell use (recorded calls) | pi-nobash today | To close a gap |
|---|---|---|
| `grep` / `rg` (91) | native `grep` (`literal: true` for fixed strings) | none — already covered |
| `cat` / `head` / `tail` reads (72) | native `read` (`offset`/`limit`) | none |
| `sed`/edits for reads | native `read` | none |
| `ls` (5), path discovery | native `ls`, `find` | none |
| JSON / JSONL transforms (most of the 109 inline-Python calls) | `json_query`, `query_jsonl` | none for supported shapes |
| `tests` / typecheck (55) | `run_validation` | **config only** — add a named check to `.pi/pi-nobash.json` |
| git status / diff / log / show (part of 54) | `git_status`, `git_diff`, `git_log`, `git_show` | none |
| git branch / add / commit (part of 54) | none | **new tool** — `git_create_branch`, `git_add`, `git_commit` (spec §13.6), then select them |
| git index-only removal (`git rm --cached`) | none | **new tool** — its own typed operation; it changes the index, not the working tree |
| Inline Python: extract / filter / aggregate | `json_query`, `query_jsonl` | none |
| Inline Python: generate a report or appendix | `write` + the data from the typed tools | none |
| Inline Python or `sed`: file surgery beyond an exact-match edit | `edit`, `write` | **new tool** only if exact-match edits keep failing — a narrow `range_edit`/`append_file`, not a regex engine |
| Inline Python: joins, reshaping, custom logic | none | **gap by design** — if it recurs, one named operation in a domain extension |
| `cp` / `mv` / `rm` (3) | none | **new tool** — scoped `fs_copy` / `fs_move` / `fs_delete`, workspace-bounded, no recursive delete |
| Scoped artifact relocation / cleanup | none | **new tool** — same `fs_*` tools |
| Linter / analyzer diagnostics (read-only) | `run_validation` | **config only** — add the analyzer as a check |
| Linter auto-fix (safe / unsafe) | none | **new tool** — separate `lint_fix_safe` / `lint_fix_unsafe`; never folded into `run_validation` |
| Targeted test file | `run_validation` file targets | **config only** — a check with `targets.mode: "file"` and a verified `runner` |
| YAML / TOML / schema syntax check (2) | `run_validation` | **config only** — add the linter as a check |
| `qlmanage` / `sips` / `d2` conversion or render (2 + 1) | `run_validation` if a CLI exists | **config only** for a CLI converter, otherwise **new tool** with bounded output paths |
| Pi CLI / model probes (15) | none | **new tool** — a narrow read-only inspection per probe, and only if it recurs |
| File metadata / header sampling | native `read` (bounded) | usually none |
| `fallow` (3), `herdr` (2), other domain work | none | **separate extension (companion)** by design — not core |
| Other / irregular (3) | none | **needs review** — usually a `CAPABILITY_GAP` |

## Closing a gap for the next iteration

Treat each gap as a change to an agent's capability set, not a prompt tweak:

1. **Record it** — the `capability` name from the JSON, or the agent's `CAPABILITY_GAP:` line,
   plus the task that hit it.
2. **Decide whether it recurs** — a narrow, stable operation that keeps appearing earns a
   tool; a one-off irregular transform stays a gap (product spec §15.2).
3. **Add the narrowest tool that does the job**, in a separate Pi extension: one named
   operation, typed bounded inputs, no arbitrary command/argv/script field. Do not add a
   generic runner, an interpreter, or a shell.
4. **Select it for the agent** — add the tool name to `--tools`, `defaultTools`, or the SDK
   `tools` array for the agents that need it. Nothing changes for the others.
5. **Re-run** — the same request should now succeed, and any request outside the new surface
   still returns `CAPABILITY_GAP`.

## Example: adding copy / move / delete (the `cp`/`mv`/`rm` gap)

Configuration cannot add this. It is one small extension file:

```ts
// my-fs-tools.ts — a separate Pi extension, loaded alongside pi-nobash.
import { renameSync } from "node:fs";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fsTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "fs_move",
    label: "Move file",
    description: "Move one file to another path inside the workspace.",
    parameters: Type.Object({ from: Type.String(), to: Type.String() }),
    exposure: "direct",
    defaultActive: false,
    annotations: { destructiveHint: true },
    async execute(_id, { from, to }, _signal, _update, ctx) {
      const resolve = (p: string) => resolveInsideWorkspace(ctx.cwd, p); // see note
      renameSync(resolve(from), resolve(to));
      return {
        content: [{ type: "text", text: `moved ${from} → ${to}` }],
        details: {},
      };
    },
  });
}
```

Then load it and select it:

```sh
pi -e ./pi-nobash -e ./my-fs-tools --tools read,grep,find,ls,json_query,fs_move
```

Notes that matter:

- `resolveInsideWorkspace` must resolve each path against the session `cwd`, reject `..`
  escapes and null bytes, and containment-check symlinks. pi-nobash's own
  [`src/path-policy.ts`](https://github.com/afshinator/pi-nobash/blob/main/src/path-policy.ts)
  is the reference implementation — copy its approach rather than writing a fresh check.
- Ship `fs_move` alone, `fs_copy` alone, and `fs_delete` alone, each separately selectable.
  Do not expose a recursive delete; a scoped, explicitly-targeted single-path delete is the
  narrowest useful form.
- No new operation should accept a program name, argv, or script text. If it would, you are
  rebuilding Bash.

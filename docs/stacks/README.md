# Stack setups

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). How to assemble a complete
no-shell setup: three layers, one shared tool list, and the mutation extensions you add
yourself.

Per-stack setups, each complete and copy-ready:

- [TypeScript (Node, React Native / Expo)](./typescript.md)
- [Python](./python.md)
- [Rust and Go](./rust-go.md)

## The three layers

1. **Select tools** — Pi's `--tools`, `.pi/settings.json` `defaultTools`, or SDK `tools`.
   Chooses from tools that already exist.
2. **Configure checks** — `.pi/pi-nobash.json` maps a check name to a fixed, read-only
   developer-owned command, and `.pi/pi-nobash-companions.json` selects a companion backend
   by enum name (FD5). Neither file adds anything to the toolset.
3. **Add extensions** — one typed tool per mutation the workflow needs. Nothing mutating is
   auto-loaded by core; the opt-in P0 companions (`git_create_branch`, `git_add`,
   `git_commit`, `git_push`, `js_format_write`, `py_format_write`) ship under
   [`companions/`](../../companions/README.md) and are loaded explicitly.

Layers 1 and 3 are stack-independent. Only layer 2 changes per stack: the seven packaged
tools work for any language, and the Git/file extensions don't care what the code is written
in. A stack doc is therefore "the checks file + any language-specific mutation tools" on top
of this page.

## The baseline tool list (every stack)

Reading, searching, editing, inspection, and checks — no shell:

```sh
pi -e ./pi-nobash \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation \
  --exclude-tools bash,powershell,codemode
```

As project defaults, `.pi/settings.json`:

```json
{
  "packages": ["./pi-nobash"],
  "defaultTools": ["read", "grep", "find", "ls", "edit", "write", "json_query", "query_jsonl", "git_status", "git_diff", "git_log", "git_show", "run_validation"]
}
```

Drop `edit,write` for a read-only reviewer. Add extension tool names for an agent that may
mutate Git, files, or dependencies.

| Tool | Source | Mutates | Status |
|---|---|---|---|
| `read` `grep` `find` `ls` | Pi native | no | implemented |
| `edit` `write` | Pi native | yes | implemented |
| `json_query` `query_jsonl` | pi-nobash | no | implemented |
| `git_status` `git_diff` `git_log` `git_show` | pi-nobash | no | implemented |
| `run_validation` | pi-nobash | depends on the check | implemented |

## Shared extensions: Git and files

A real workflow commits, stages, branches, and moves files. Those are ordinary typed
operations — pi-nobash simply does not auto-load them, so you load or register the ones your
agents need as small tools and select them per agent.

`git_create_branch`, `git_add`, `git_commit`, `git_push`, `js_format_write`, and
`py_format_write` are the shipped exceptions: they live in
[`companions/`](../../companions/README.md), inert until loaded. Load a companion in place —
its `../../src/…` imports break if the directory is copied out of the tree:

```sh
pi install ./companions/git
pi -e <repo>/companions/git
```

```sh
pi -e ./pi-nobash -e <repo>/companions/git -e ./my-fs-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete
```

**Git mutations** (`companions/git`):

| Tool | Input | Effect | Status |
|---|---|---|---|
| [`git_create_branch`](../../companions/git/create-branch.ts) | `{ name, startPoint?, switchTo? }` | create (and optionally switch to) a branch; `name` validated as a Git ref | implemented |
| [`git_add`](../../companions/git/add.ts) | `{ paths }` \| `{ trackedOnly: true }` | stage named paths (file or directory) or all tracked modifications (`-u`); paths are literal | implemented |
| [`git_commit`](../../companions/git/commit.ts) | `{ message }` | commit the staged index; never stages and never `-a` | implemented |
| [`git_push`](../../companions/git/push.ts) | `{ remote?, setUpstream? }` | push the current branch to a configured remote, non-force; `setUpstream: true` adds `--set-upstream` | implemented |
| `git_rm_cached` *(deferred — P2)* | `{ paths }` | untrack paths but keep them on disk | proposed |

Two staging modes ship, each a fixed invocation:

1. **Explicit paths** — a file **or a directory** (`git add -- <paths>`); literal, so no glob
   expands. Pair it with the shipped `git_status`/`git_diff` so the model inspects the diff
   before committing.
2. **Tracked only** — `git add -u`: stages modifications and deletions of already-tracked
   files, and cannot introduce an untracked file.

`git add -A` (stage untracked files too) is intentionally not implemented: it is the one mode
that can include something the model never enumerated — a secret, a build artifact, a scratch
file. A request to stage everything returns `CAPABILITY_GAP`.

Push is its own tool because it is different in kind, not degree: it is the only operation
whose effect lands on a shared remote and is not undone by a local reset.

**File lifecycle** (`my-fs-tools.ts`):

| Tool | Input | Effect | Status |
|---|---|---|---|
| `fs_copy` | `{ from, to }` | copy one path inside the workspace | proposed |
| `fs_move` | `{ from, to }` | move or rename one path inside the workspace | proposed |
| `fs_delete` | `{ path }` | delete one explicit path | proposed |

Register each as its own tool so an agent gets exactly the operations it needs. Resolve every
path against the session `cwd` and reject escapes and symlink traversal — pi-nobash's
`src/path-policy.ts` is the reference implementation. Keeping deletions to explicit paths
(no recursion, no globs) is a scoping choice that keeps the tool predictable, not a
prohibition. The one boundary worth keeping: no `git(args)` passthrough and no free-form flag
string — one verb per tool, typed fields only.

Tool names are global to a session. The Git and file tools are shared by every stack, but the
language-tooling tools are prefixed (`js_`, `py_`, `rust_`, `go_`) so a repo that loads two
stack extensions does not register the same name twice.

`docs/replacing-bash.md` has the full `fs_move` implementation to copy.

## Checks template

One entry per command you would otherwise run by hand. Keep `"mode": "none"` unless the
runner is `node:test` (the only verified target adapter).

```json
{
  "validation": {
    "checks": {
      "<check-name>": {
        "program": "<executable on PATH>",
        "args": ["<fixed>", "<argv>"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": { "mode": "none" }
      }
    }
  }
}
```

Rules that hold for every stack:

- **Read-only only.** Tests, typecheck, lint (report mode), format check, build. Never a
  command that mutates (`--fix`, `--write`, `git add`) — that belongs in a typed tool.
- **Realistic timeouts.** Full-repo linters time out; scoped runs succeed. Raise
  `timeoutMs` for anything that compiles or runs a whole suite.
- **No shell.** `program` + `args` are spawned directly: no `&&`, pipes, globs, `$VAR`, or
  `~`. One check per command.

## Building a setup for a new stack

1. **Tool list** — the baseline above, unchanged, unless the agent must not edit (drop
   `edit,write`) or must mutate (add extension tool names).
2. **Checks** — one entry per command: unit, typecheck, lint, format check, build.
3. **Extensions** — the shared Git/file ones, plus a small language-tooling extension only
   for what checks cannot express: formatter write modes, lint auto-fix, dependency
   add/remove, module-file tidy.

## What no setup includes

- A shell, interpreter, or generic runner.
- A check that mutates.
- Targeted test files, except through the `node:test` adapter.

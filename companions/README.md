# companions — reference extensions

Optional, individually selectable Pi extensions that add typed mutation operations the core
package deliberately does not ship: Git mutations, formatters, lint fixes, and dependency
changes.

**These are inert until you explicitly load and select them.** Installing or loading
`pi-nobash` registers none of them — the package's `pi.extensions` manifest has a single
entry — and every companion tool registers with `defaultActive: false`.

**Status:** the P0 and P1 companions are implemented and shipped in this directory —
`process.ts` (the bounded fixed-argv runner), `config.ts` (developer-configured backend
selection), the Git tools (`git_create_branch`, `git_add`, `git_commit`, `git_push`,
`git_rm_cached`), the file-lifecycle tools (`fs_copy`, `fs_move`), the formatters
(`js_format_write`, `py_format_write`), the safe lint fixes (`js_lint_fix`, `py_lint_fix`),
the dependency tools (`js_dep_add`, `js_dep_remove`, `py_dep_add`, `py_dep_remove`), and
`expo_dep_add`. Planned, not written: the Rust/Go tools. The layout below
marks what is shipped.

**Where the guide lives.** [docs/stacks](https://github.com/afshinator/pi-nobash/blob/main/docs/stacks/README.md)
is the per-stack guide — which tools to select, which checks to configure, and which companion
(if any) to load. This directory is the code those guides point at: **`docs/stacks` is
documentation, `companions` is source.** `docs/` is not part of the npm package, which is why
the guide is linked out to GitHub while the load paths and layout below live here, inside the
shipped package.

## Load paths — keep the tree intact

Companions reuse the audited primitives in `src/`, by a relative import whose depth matches
the file: `../src/…` from `companions/process.ts`, `../../src/…` from everything under
`companions/<area>/`. Those imports resolve only while the tree stays together, so load a
companion **in place**:

```sh
pi install ./companions/git          # local install; loaded in place, not copied
pi -e /path/to/pi-nobash/companions/git
```

**Do not copy a single companion directory out of this tree** — its `../../src/…` imports
will fail to resolve. Copy the whole repository, or install the companion from where it lives.

## Layout

```text
companions/
  README.md      this file
  process.ts     execFixed — bounded fixed-argv runner                     (shipped)
  config.ts      .pi/pi-nobash-companions.json loader + enum->argv builders (shipped)
  git/           git_create_branch, git_add, git_commit, git_push, git_rm_cached (shipped)
  files/         fs_copy, fs_move, fs_delete                                (shipped)
  javascript/    js_format_write, js_lint_fix, js_dep_add, js_dep_remove   (shipped)
  python/        py_format_write, py_lint_fix, py_dep_add, py_dep_remove   (shipped)
  expo/          expo_dep_add                                             (shipped)
```

## Rules every companion tool follows

- One named operation per tool; typed inputs with no `command`, `argv`, `script`, or
  executable field.
- A fixed executable and fixed argv shape chosen by trusted code — never by the model. The
  backend (formatter, linter, package manager) is developer-owned project config in
  `.pi/pi-nobash-companions.json`, read once at session start and validated against a fixed
  enum; config names a backend, never a command.
- Bounded output, a per-tool timeout, and cancellation.
- `defaultActive: false` plus a one-line `promptSnippet` and accurate `annotations`.
- Unsupported operations return `CAPABILITY_GAP`; there is no generic runner, interpreter, or
  shell fallback anywhere in the set.
- Errors are typed and stable: `PARSE_ERROR` from config loading, `INVALID_ARGUMENT` /
  `PATH_OUT_OF_SCOPE` / `LIMIT_EXCEEDED` for out-of-scope input, `VALIDATION_FAILED` /
  `GIT_FAILED` / `TIMEOUT` when the frozen backend fails or times out, and `CAPABILITY_GAP`
  for operations the schema cannot express.

The frozen per-tool contracts (schemas, invocations, effects, tests) are in the plan linked
above; this file is the loading and layout reference only.

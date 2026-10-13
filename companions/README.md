# companions — reference extensions

Optional, individually selectable Pi extensions that add typed mutation operations the core
package deliberately does not ship: Git mutations, formatters, lint fixes, and dependency
changes.

**These are inert until you explicitly load and select them.** Installing or loading
`pi-nobash` registers none of them — the package's `pi.extensions` manifest has a single
entry — and every companion tool registers with `defaultActive: false`.

**Status:** the source is written by the P0/P1 implementation run described in
[the companions implementation plan](../docs/plans/pi-nobash-companions-implementation-plan.md).
Until then, this directory documents the intended layout and the load paths. Do not assume any
tool listed here exists yet.

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
  process.ts     execFixed — bounded fixed-argv runner (P0)
  git/           git_create_branch, git_add, git_commit, git_push            (P0)
  javascript/    js_format_write (P0); js_lint_fix, js_dep_add, js_dep_remove (P1)
  python/        py_format_write (P0); py_lint_fix, py_dep_add, py_dep_remove (P1)
  expo/          expo_dep_add                                                 (P1)
```

## Rules every companion tool follows

- One named operation per tool; typed inputs with no `command`, `argv`, `script`, or
  executable field.
- A fixed executable and fixed argv shape chosen by trusted code — never by the model.
- Bounded output, a per-tool timeout, and cancellation.
- `defaultActive: false` plus a one-line `promptSnippet` and accurate `annotations`.
- Unsupported operations return `CAPABILITY_GAP`; there is no generic runner, interpreter, or
  shell fallback anywhere in the set.

The frozen per-tool contracts (schemas, invocations, effects, tests) are in the plan linked
above; this file is the loading and layout reference only.

# Named validation (`.pi/pi-nobash.json`)

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). For the tool surface, see
[Tool reference](https://github.com/afshinator/pi-nobash/blob/main/docs/tool-reference.md); for the Bash uses this replaces, see
[Replacing Bash](https://github.com/afshinator/pi-nobash/blob/main/docs/replacing-bash.md).

`run_validation` executes only checks a developer defined in `.pi/pi-nobash.json`
under the workspace. The model can name a check and, for file-mode checks, choose
from approved target files; it can never supply a program, argument, or script.

> **A check is a diagnostic, not a mutation.** Put tests, lint, typecheck, build, and
> schema validation here — never a command that changes data or history (`git add`, a
> delete, a formatter's write mode). The model can only choose the check *name*, so a
> mutation hidden here is both a misuse of a diagnostic tool and unusable: it cannot take
> a branch name, a file list, or a commit message. Mutations belong in a typed tool from a
> separate extension.

> **The file is read once, at session start, and never re-read.** Editing
> `.pi/pi-nobash.json` mid-session has no effect; start a new session for changes to
> take effect. This closes a composition route where a session holding `write`/`edit`
> could change a check's program and then run it.

```json
{
  "validation": {
    "checks": {
      "unit": {
        "program": "npm",
        "args": ["test"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": { "mode": "none" }
      },
      "typecheck": {
        "program": "npm",
        "args": ["run", "typecheck"],
        "cwd": ".",
        "timeoutMs": 120000,
        "targets": { "mode": "none" }
      },
      "node_test_file": {
        "program": "node",
        "args": ["--test"],
        "cwd": ".",
        "timeoutMs": 60000,
        "targets": {
          "mode": "file",
          "roots": ["tests", "src"],
          "extensions": [".test.ts"],
          "runner": "node_test"
        }
      }
    }
  }
}
```

Semantics that matter:

- A `run_validation` call whose working directory differs from the session's bound
  directory is rejected with `INVALID_ARGUMENT`.
- **`targets.mode: "file"` requires a `runner` adapter.** Only `node_test` is verified
  today (`node --test -- <file>`); any other runner name is rejected before a process
  starts. Use `{"mode": "none"}` for full checks.
- **Missing config file = no checks** (an empty set); malformed JSON or shape is `PARSE_ERROR`.
- Targets must resolve inside `roots`, exist as regular files, match `extensions` when
  set, must not have a final path segment starting with `-`, and are capped at 50.

# Python setup

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). A complete, copy-ready setup for
a Python repository: the tool list, the checks file, and the mutation extensions a real
workflow needs. Shared background — the three layers, the Git and file extensions — is in
[Stack setups](./README.md).

## 1. Tool list

```sh
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-py-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,py_format_write,py_lint_fix,py_dep_add,py_dep_remove \
  --exclude-tools bash,powershell,codemode
```

What each tool is:

| Tool | Source | Mutates | Purpose |
|---|---|---|---|
| `read` `grep` `find` `ls` | Pi native | no | read/search/list |
| `edit` `write` | Pi native | yes | modify content |
| `json_query` `query_jsonl` | pi-nobash | no | query coverage/JSON, structured logs |
| `git_status` `git_diff` `git_log` `git_show` | pi-nobash | no | inspect history and the working tree |
| `run_validation` | pi-nobash | no | run the checks in §2 |
| `git_create_branch` `git_add` `git_commit` `git_push` | your extension | yes | Git mutations |
| `fs_copy` `fs_move` `fs_delete` | your extension | yes | file lifecycle |
| `py_format_write` `py_lint_fix` | your extension | yes | formatter and safe lint fixes |
| `py_dep_add` `py_dep_remove` | your extension | yes | dependency changes |

The `py_` prefix is deliberate: tool names are global to a session, so if a repo also loads
the JS/TS or Rust extension there is no duplicate-name conflict.

Read-only reviewer: drop `edit`, `write`, and every "your extension" tool.

## 2. Checks (`.pi/pi-nobash.json`)

```json
{
  "validation": {
    "checks": {
      "unit":         { "program": "pytest", "args": ["-q"],                    "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } },
      "typecheck":    { "program": "mypy",   "args": ["."],                     "cwd": ".", "timeoutMs": 180000, "targets": { "mode": "none" } },
      "lint":         { "program": "ruff",   "args": ["check", "."],            "cwd": ".", "timeoutMs": 120000, "targets": { "mode": "none" } },
      "format_check": { "program": "ruff",   "args": ["format", "--check", "."], "cwd": ".", "timeoutMs": 60000,  "targets": { "mode": "none" } },
      "build":        { "program": "python", "args": ["-m", "build"],           "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } }
    }
  }
}
```

Environment-manager variants — change `program`/`args` only:

| Manager | `unit` | `typecheck` |
|---|---|---|
| system / venv | `program: "pytest", args: ["-q"]` | `program: "mypy", args: ["."]` |
| uv | `program: "uv", args: ["run", "pytest", "-q"]` | `program: "uv", args: ["run", "mypy", "."]` |
| poetry | `program: "poetry", args: ["run", "pytest", "-q"]` | `program: "poetry", args: ["run", "mypy", "."]` |
| pipenv | `program: "pipenv", args: ["run", "pytest", "-q"]` | `program: "pipenv", args: ["run", "mypy", "."]` |

If the project uses `pytest` for everything, `lint`/`format_check` may be `python -m ruff …`
instead — pick whichever is actually on `PATH` in the environment the agent runs in.

## 3. Extensions

The Git and file tools are the shared ones in [Stack setups](./README.md#shared-extensions-git-and-files).
Python adds `my-py-tools.ts`:

| Tool | Input | Effect |
|---|---|---|
| `py_format_write` | `{ paths: string[] }` | `ruff format <paths>` (write mode) |
| `py_lint_fix` | `{ paths: string[] }` | `ruff check --fix <paths>` (safe fixes only, never `--unsafe-fixes`) |
| `py_dep_add` | `{ packages: string[], dev?: boolean }` | `uv add [--dev] <pkgs>` (or `poetry add`, `pip install`) |
| `py_dep_remove` | `{ packages: string[] }` | `uv remove <pkgs>` (or `poetry remove`, `pip uninstall`) |

Same shape as every other mutation tool: fixed executable, validated workspace paths, direct
spawn with `shell: false`, no model-supplied flags. The `py_dep_*` tools mutate the lockfile
(`uv.lock`, `poetry.lock`, `requirements.txt`), so treat the result as a reviewable diff.

## 4. Caveats specific to Python

- **No targeted test-file adapter.** pytest has no verified runner adapter, so a
  `targets.mode: "file"` check is unavailable — the agent runs the suite via `run_validation`
  and reads the failures. Selecting one test would be a new adapter (code), not config.
- **`ruff check` stays in report mode.** `py_lint_fix` is the mutating counterpart, and it
  must not enable `--unsafe-fixes` silently; unsafe fixes deserve their own separately
  selectable tool, exactly as with the linter split in other stacks.
- **Interpreter, not script path.** Use `program: "python"` with `args: ["-m", "build"]`
  rather than a path to a script — the tool model is "fixed executable + fixed argv", not
  "run this file".
- **Virtualenv matters.** `pytest`/`mypy`/`ruff` must be the ones in the environment the agent
  runs in. If the project uses `uv` or `poetry`, route through `uv run` / `poetry run` as
  above so the check uses the project's environment rather than a global one.

## 5. Full launch

```sh
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-py-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,py_format_write,py_lint_fix,py_dep_add,py_dep_remove \
  --exclude-tools bash,powershell,codemode
```

Then the agent can read, search, edit, inspect Git, run pytest/mypy/ruff, fix formatting, and
commit — with no shell anywhere in the loop.

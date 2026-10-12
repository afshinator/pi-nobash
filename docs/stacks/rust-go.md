# Rust and Go setup

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). Complete, copy-ready setups for
Rust and Go repositories. Shared background — the three layers, the baseline tool list, and
the Git and file extensions — is in [Stack setups](./README.md). Both stacks use that baseline
tool list unchanged; only the checks file and a small language-tooling extension differ, so
each section below shows just those.

Both languages also share one limitation: **there is no targeted test-file adapter.** A
`targets.mode: "file"` check only works with the `node:test` runner, so Rust and Go checks run
whole packages or whole workspaces and the agent reads the failures.

## Rust

### Checks (`.pi/pi-nobash.json`)

```json
{
  "validation": {
    "checks": {
      "unit":      { "program": "cargo", "args": ["test"],                 "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } },
      "lint":      { "program": "cargo", "args": ["clippy", "--", "-D", "warnings"], "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } },
      "fmt_check": { "program": "cargo", "args": ["fmt", "--check"],       "cwd": ".", "timeoutMs": 60000,  "targets": { "mode": "none" } },
      "build":     { "program": "cargo", "args": ["build"],                "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } }
    }
  }
}
```

Notes: `--` in the `lint` check is a literal argument, not a shell construct — `args` are
spawned directly. If your toolchain's `cargo fmt --check` is unsupported, use
`args: ["fmt", "--", "--check"]`.

### `my-rust-tools.ts`

| Tool | Input | Effect |
|---|---|---|
| `rust_format_write` | `{ paths: string[] }` | `cargo fmt` (whole workspace) or `rustfmt <paths>` |
| `rust_dep_add` | `{ packages: string[], dev?: boolean }` | `cargo add [--dev] <pkgs>` (needs `cargo-edit`) |
| `rust_dep_remove` | `{ packages: string[] }` | `cargo remove <pkgs>` (needs `cargo-edit`) |
| `rust_clippy_fix` *(optional)* | `{ allowDirty?: boolean }` | `cargo clippy --fix --allow-dirty --allow-staged` — a mutation, keep it separate from `lint` |

### Rust caveats

- **`clippy -D warnings` is a check, `clippy --fix` is a mutation.** Keep them in different
  layers; never put `--fix` inside the `lint` check.
- **`cargo add`/`remove` rewrite `Cargo.toml` and `Cargo.lock`** and require `cargo-edit`; the
  result is a reviewable diff, so inspect it before committing.
- **Selecting one test needs a tool, not config.** `cargo test <filter>` is a read-only
  operation with a model-supplied filter; if you want it, register a small tool — a check
  cannot take a parameter.

## Go

### Checks (`.pi/pi-nobash.json`)

```json
{
  "validation": {
    "checks": {
      "unit":  { "program": "go",            "args": ["test", "./..."], "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } },
      "vet":   { "program": "go",            "args": ["vet", "./..."],  "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } },
      "lint":  { "program": "golangci-lint", "args": ["run"],           "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } },
      "build": { "program": "go",            "args": ["build", "./..."], "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } }
    }
  }
}
```

Notes: **`gofmt -l .` is not usable as a check** — it lists unformatted files but exits 0, so
it can never fail. Either enable the `gofmt`/`gofumpt` linter inside `golangci-lint` (the
`lint` check above then covers formatting) or accept formatting as informational only.

### `my-go-tools.ts`

| Tool | Input | Effect |
|---|---|---|
| `go_format_write` | `{ paths: string[] }` | `gofmt -w <paths>` |
| `go_mod_tidy` | `{}` | `go mod tidy` — rewrites `go.mod`/`go.sum` |
| `go_dep_add` | `{ packages: string[] }` | `go get <pkgs>` |

Go has no "remove dependency" command: you drop the import and run `go_mod_tidy`, which is why
it is its own tool rather than bundled into `go_dep_add`.

### Go caveats

- **`gofmt`'s exit code is not a check.** See above; route formatting through `golangci-lint`.
- **`go get` and `go mod tidy` mutate `go.mod`/`go.sum`.** They are typed mutations, not
  diagnostics; the resulting diff is what `git_diff` should show before committing.
- **Selecting one package or test needs a tool.** `go test ./some/pkg/...` is a fixed-argv
  check; an arbitrary package chosen by the model would need a typed parameter, i.e. a tool.

## Full launch

Rust:

```sh
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-rust-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,rust_format_write,rust_dep_add,rust_dep_remove \
  --exclude-tools bash,powershell,codemode
```

Go:

```sh
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-go-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,go_format_write,go_mod_tidy,go_dep_add \
  --exclude-tools bash,powershell,codemode
```

Either way the agent reads, searches, edits, inspects Git, runs the checks, formats, and
commits — with no shell in the loop. The `rust_`/`go_` prefixes keep tool names distinct if a
single session loads more than one stack.

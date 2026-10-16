# Evaluation: `mcp-server-go-quality` as a Go diagnostics companion (issue #4)

**Decision: DEFER — do not adopt the server.** Prefer developer-owned `run_validation` checks
(golangci-lint / govulncheck / nilaway) if Go diagnostics are wanted.

Evaluated 2026-10-15 by reading the source at `github.com/afshinator/mcp-server-go-quality`
(shallow clone; MIT license).

## What it is (verified)

An MCP server (`cmd/mcp-server-go-quality`) exposing five tools (`README.md:88-92`,
`cmd/mcp-server-go-quality/main_test.go:219`):

- `run_code_checks` — all three checkers (or a `tools` subset), returns sorted diagnostics.
- `run_lint` / `run_vuln_check` / `run_nil_check` — one checker each.
- `install_tools` — pre-installs the three binaries at pinned versions into `GOBIN`.

Pinned versions: golangci-lint `v2.14.0`, govulncheck `v1.9.0`, nilaway `v0.0.0-20260918162853-…`
(`internal/config/config.go:26-40`), enforced by `TestPinnedVersionsAreConsistent` across the
Makefile, CI, and Dockerfile.

## Answers to the seven-point checklist

1. **Automatic installation.** `install_tools` is a **separate mutating tool**, not a read-only
   check and not run silently — but it **is exposed to the model** and runs
   `go install <pinned package>@<version>` into `GOBIN` (`cmd/mcp-server-go-quality/main.go:285`,
   `internal/discover/discover.go:189-196`), i.e. a model-triggered network install (and, for
   nilaway, a second toolchain fetch via `GOTOOLCHAIN`). pi-nobash's boundary keeps installation a
   developer-controlled mutation, so exposing this tool is a conflict.

2. **`extra_args` ownership / composition route.** `extra_args` is **developer config**
   (`internal/config/config.go:14`), with a reserved-flag denylist (`config.go:105-109`), and the
   config is **loaded once at server startup** (`cmd/mcp-server-go-quality/main.go:58,67`), not
   re-read per call — so an agent editing the file mid-session does not change the running server.
   This is the A10-style guarantee, and it holds here.

3. **Fixed operations.** The model chooses only `project_path` and an enumerated `tools` subset
   (`main.go:116-161`); `resolveRequestedTools` rejects any unknown name (`main.go:180-190`). No
   command, argv, script, or flag field is model-supplied.

4. **Side effects.** `install_tools`: network download/build, writes binaries into `GOBIN`.
   `run_vuln_check`: **fetches the vulnerability database at run time** (network; the DB is not
   pinned — `internal/config/config.go:33-35`). Go module cache and an internal version cache are
   used. Checkers execute project-controlled build/test code paths per their own semantics.

5. **Pi integration.** It is an **MCP server**, not a Pi extension. Pi 1.1.0 supports MCP, but MCP
   tools default to `codemode` exposure and are callable from codemode scripts
   (`docs/cli.md:132`); adopting it therefore pulls in MCP and, in practice, codemode — which
   issue #6 concluded should stay excluded — and departs from pi-nobash's typed first-class tools.

6. **Scope / limits.** **Not constrained.** `resolveProjectPath` returns a model-supplied
   `project_path` **as-is** (`main.go:166-168`); `pathutil.Rel` is used for display, not
   containment (`internal/pathutil/pathutil.go`). A model can point the checkers at any absolute
   path outside the workspace and the server walks up to the nearest `go.mod`/`go.work`. There is a
   per-tool `timeout` and an output schema, but no workspace-root or output-cardinality bound.

7. **License / pinning.** MIT; tool versions pinned and test-enforced; the vuln DB is the one
   unpinned, runtime-fetched input. Adopting would mean depending on another Go runtime/server
   rather than adapting code.

## Why defer

1. `install_tools` exposes a **model-triggered network install** — the boundary keeps installation
   developer-controlled.
2. `project_path` is **not workspace-bounded**; diagnostics can be aimed anywhere on the host.
3. Integration needs MCP (and effectively codemode), which conflicts with #6's decision and with the
   typed-tools posture.
4. The useful part — running the three checkers and parsing diagnostics — is already reachable
   through pi-nobash's developer-owned `run_validation` checks, which are read-only,
   workspace-scoped, argv-free, and need no second runtime.

## If Go diagnostics are wanted (smallest complete change)

Add developer-owned read-only `run_validation` checks for `golangci-lint run`, `govulncheck ./...`,
and `nilaway ./...` (fixed `program` + `args`, `cwd: "."`), with the Go toolchain installed by the
developer, not the model. Revisit the server only if parsing/merging the three tools' native output
proves to be real, repeated work — and then only as a Pi-native, workspace-scoped, read-only
adapter with no install tool.

## Not verified

- Runtime behaviour (the server was read, not executed); the diagnostic output schema is taken from
  the source, not from a live call.
- Whether Pi 1.1.0's MCP client can connect to this server's transport without an adapter.

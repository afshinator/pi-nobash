# Design decisions and tradeoffs

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). This is the "why is it built
this way" record: architecture, the amendment-by-amendment tradeoffs, and the explicit
non-goals. Product requirements live in the repository's product specification.

## Architecture

```
Pi session
├── native selected tools        read / grep / find / ls / edit / write
└── pi-nobash extension          extensions/pi-nobash.ts
    ├── bash blocker             src/pi-guard.ts      (unconditional tool_call block)
    ├── /nobash-status           src/status.ts        (pure report builder + command)
    ├── json tools               src/json/            (operators, streaming, schemas)
    ├── git tools                src/git/             (rev validation, bounded exec)
    └── validation               src/validation/      (config, target, adapter, runner)
        shared: src/constants.ts, src/errors.ts, src/path-policy.ts
```

Layer rules: Pi's native tool selection is authoritative; packaged tools are inactive
until named; read-only and mutating capabilities are separate; trusted code owns
mechanics (parsers, fixed executables, argv); unsupported work returns
`CAPABILITY_GAP` rather than falling back to execution.

What a tool call looks like at runtime — a direct `bash` call is intercepted and refused
before execution, while a packaged tool is validated against its config and then run by its
own implementation:

![Sequence: bash is intercepted and rejected; run_validation is validated and executed, returning a structured result](./pi-nobash-sequence.svg)


## Implementation decisions and tradeoffs

These decisions are not in the original product/technical spec; each is recorded in
full, with rejected alternatives, in `docs/pi-nobash-technical-spec-amendments.md`
(repo only, not shipped).

| # | Decision | Tradeoff accepted |
|---|---|---|
| A1 | No build step; Pi's `jiti` loads the `.ts` source directly; tests use Node's built-in `node:test`; imports use explicit `.ts` specifiers. | No compiled artifact and no framework conveniences; `tsc --noEmit` is the type gate. |
| A2 | Host packages (`pi-coding-agent`, `typebox`) are `peerDependencies: "*"`, not exact pins. | Follows Pi's package rule and avoids duplicate host modules; local dev pins exact versions in `devDependencies`. |
| A3 | Biome and Fallow are development-only; a `files` allowlist ships only `extensions/`, `src/`, `README.md`. | npm consumers never receive dev tooling, tests, specs, or `.mypi/` run state. |
| A4 | JSON operators are typed object shapes with a fixed verb list (no expression/query mini-language). | Irregular transformations are `CAPABILITY_GAP`, by design. |
| A5 | Expected errors are returned as `isError: true` envelopes with `"<CODE>: <message>"` text; only internal faults throw. | Callers must read `details.code`; the model gets a consistent visible failure. |
| A6 | Git revisions are shape-checked and then `rev-parse --verify`-confirmed; option-like paths are rejected; no `--` passthrough. | Some legitimate exotic revspecs are refused in exchange for no argv injection. |
| A7 | Targeted validation uses a named runner adapter; only `node_test` is verified, everything else must use `targets.mode: "none"`. | Targeted runs are unavailable for other runners until an adapter is verified and tested. |
| A8 | Pi extension APIs (`registerCommand`, `registerTool`, `tool_call` blocking) are treated as test-verified, not assumed from docs. | Requires runtime tests against the pinned Pi version. |
| A9 | Implementation, not the spec, freezes under-specified shared contracts before work starts. | Slower dispatch; fewer divergent interfaces between parallel authors. |
| A10 | `.pi/pi-nobash.json` is read once at session start and never re-read; a foreign cwd is rejected; snapshots are keyed per session. | Config edits require a new session; in exchange, a writable workspace cannot swap a check's execution between write and use. |
| A11 | Every packaged tool sets a one-line `promptSnippet` (so it appears in the default system prompt's Available tools section), accurate `annotations` (`readOnlyHint: true` on the six read-only tools, none on `run_validation`), and imports only host packages declared in the manifest. | One more metadata rule per tool, test-enforced (`tests/unit/registration.test.ts`); discovery and permission hints stay honest at the cost of keeping three tests green. |
| A12 | Every packaged tool is registered with `defaultActive: false`: installing exposes no new model-facing tool until the developer names it in `defaultTools`. | Diverges from ecosystem packages (e.g. `pi-safe-shell`, which activates on install), so nothing changes for a model at install time; required by product goal G3 (per-agent tool selection). |
| A13 | No `main`, `license`, or `repository` field in `package.json`. | Pi loads the extension via the `pi.extensions` manifest, not a library entrypoint (`main` would point at code that is never imported); no `LICENSE` file exists, so no license identifier can be declared truthfully; the repository is reachable where the package is hosted and no Pi or npm tooling needs the field. |
| A14 | The entry path stays `pi.extensions: ["./extensions/pi-nobash.ts"]` instead of the ecosystem-common `./index.ts`. | Renaming is cosmetic churn; the manifest makes the path explicit and `extensions/pi-nobash.ts` is committed and loaded by the integration tests. |

Additional contracts from the first implementation run:

- **Bootstrap interface:** `extensions/pi-nobash.ts` default-exports one factory that
  calls `registerBashBlocker`, `registerStatusCommand`, `registerJsonTools`,
  `registerGitTools`, `registerValidationTools`.
- **Naming and exposure:** every packaged tool is `exposure: "direct"`,
  `defaultActive: false`, snake_case, declares a TypeBox schema, and has no
  `command`/`argv`/`script` parameter (asserted by a schema-audit test).
- **No execution by composition:** there is no generic runner, `restricted_exec`,
  codemode path, or model-selectable executable anywhere in the model-facing surface.


## Limits and non-goals

- Not a sandbox, container, or host-security product; no isolation guarantee.
- No adversarial-jailbreak, prompt-injection, or containment claims.
- No general command/code execution fallback, and no interpreter or arbitrary query language.
- No universal control over third-party extensions; an agent given another generic
  runner is outside the intended configuration even if this package is loaded.
- `powershell` and `codemode` are excluded by tool selection and reported by
  diagnostics; unlike `bash`, they are **not** hard-blocked by this package.
- Optional Git mutations (`git_create_branch`, `git_add`, `git_commit`), typed file
  mutations, and format conversions are deliberately deferred and not implemented.
- The historical workload inventory's 411-vs-414 call-count discrepancy is
  unreconciled; no coverage percentage is claimed.

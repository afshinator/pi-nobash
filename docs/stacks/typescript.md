# TypeScript (Node and React Native / Expo) setup

Part of [pi-nobash](https://github.com/afshinator/pi-nobash). One setup for a TypeScript
repository, whether it runs on Node/web or on React Native via Expo. Both share the same
toolchain (npm, `tsc`, Prettier/ESLint, `package.json`) and the same tool list; they differ in
the checks, one dependency tool, and the platform caveats. Shared background — the three
layers and the Git/file extensions — is in [Stack setups](./README.md).

Jump to: [Node checks](#node--web-checks) · [Expo checks](#react-native--expo-checks) ·
[Expo caveats](#expo--react-native-caveats)

## 1. Tool list

Identical for both, except Expo swaps the dependency tools for `expo_dep_add`.

```sh
# Node / web
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-js-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,js_format_write,js_lint_fix,js_dep_add,js_dep_remove \
  --exclude-tools bash,powershell,codemode

# React Native / Expo (adds my-expo-tools.ts, swaps the dependency tools)
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-js-tools.ts -e ./my-expo-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,js_format_write,js_lint_fix,expo_dep_add \
  --exclude-tools bash,powershell,codemode
```

| Tool | Source | Mutates | Purpose |
|---|---|---|---|
| `read` `grep` `find` `ls` | Pi native | no | read/search/list |
| `edit` `write` | Pi native | yes | modify content |
| `json_query` `query_jsonl` | pi-nobash | no | query `package.json`, `app.json`, coverage JSON, JSONL logs |
| `git_status` `git_diff` `git_log` `git_show` | pi-nobash | no | inspect history and the working tree |
| `run_validation` | pi-nobash | no | run the checks in §2 |
| `git_create_branch` `git_add` `git_commit` `git_push` | your extension | yes | Git mutations (shared) |
| `fs_copy` `fs_move` `fs_delete` | your extension | yes | file lifecycle (shared) |
| `js_format_write` `js_lint_fix` | your extension | yes | formatter and safe lint fixes (both) |
| `js_dep_add` `js_dep_remove` | your extension | yes | dependency changes (Node) |
| `expo_dep_add` | your extension | yes | add an Expo-SDK-compatible dependency (Expo) |

The `js_`/`expo_` prefixes are deliberate: tool names are global to a session, so if a repo
also loads the Python or Rust/Go extension there is no duplicate-name conflict.

Read-only reviewer: drop `edit`, `write`, and every "your extension" tool; keep
`run_validation` if it should still run tests.

## 2. Checks (`.pi/pi-nobash.json`)

### Node / web checks

```json
{
  "validation": {
    "checks": {
      "unit":         { "program": "npm", "args": ["test"],                "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } },
      "typecheck":    { "program": "npm", "args": ["run", "typecheck"],    "cwd": ".", "timeoutMs": 120000, "targets": { "mode": "none" } },
      "lint":         { "program": "npm", "args": ["run", "lint"],         "cwd": ".", "timeoutMs": 120000, "targets": { "mode": "none" } },
      "format_check": { "program": "npm", "args": ["run", "format:check"], "cwd": ".", "timeoutMs": 60000,  "targets": { "mode": "none" } },
      "build":        { "program": "npm", "args": ["run", "build"],        "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } }
    }
  }
}
```

Package-manager variants — change `program` only:

| Manager | `unit` | `typecheck` |
|---|---|---|
| npm | `program: "npm", args: ["test"]` | `["run", "typecheck"]` |
| pnpm | `program: "pnpm", args: ["test"]` | `["run", "typecheck"]` |
| yarn | `program: "yarn", args: ["test"]` | `["typecheck"]` |
| bun | `program: "bun", args: ["test"]` | `["run", "typecheck"]` |

If the repo uses **`node:test`**, add a targeted check so the agent can run one file:

```json
"unit_file": {
  "program": "node", "args": ["--test"], "cwd": ".", "timeoutMs": 60000,
  "targets": { "mode": "file", "roots": ["tests", "src"], "extensions": [".test.ts"], "runner": "node_test" }
}
```

### React Native / Expo checks

```json
{
  "validation": {
    "checks": {
      "unit":         { "program": "npm", "args": ["test", "--", "--ci"],      "cwd": ".", "timeoutMs": 600000, "targets": { "mode": "none" } },
      "typecheck":    { "program": "npx", "args": ["tsc", "--noEmit"],         "cwd": ".", "timeoutMs": 180000, "targets": { "mode": "none" } },
      "lint":         { "program": "npx", "args": ["expo", "lint"],            "cwd": ".", "timeoutMs": 180000, "targets": { "mode": "none" } },
      "format_check": { "program": "npx", "args": ["prettier", "--check", "."], "cwd": ".", "timeoutMs": 60000,  "targets": { "mode": "none" } },
      "doctor":       { "program": "npx", "args": ["expo-doctor"],             "cwd": ".", "timeoutMs": 300000, "targets": { "mode": "none" } },
      "bundle":       { "program": "npx", "args": ["expo", "export", "--platform", "ios"], "cwd": ".", "timeoutMs": 900000, "targets": { "mode": "none" } }
    }
  }
}
```

- **`unit`** — `jest-expo`; `-- --ci` runs it non-interactively (drop it if your script does).
- **`doctor`** — `expo-doctor` is the check that catches package versions that don't match the
  project's Expo SDK.
- **`bundle`** — `expo export` proves the app actually bundles. Slow and it writes a build
  directory, so it's a milestone check, not an inner-loop one.
- **Not a check:** `expo start` / `expo run:*` are long-running interactive processes, not
  bounded commands.

## 3. Extensions

The Git and file tools are the shared ones in [Stack setups](./README.md#shared-extensions-git-and-files).
Both variants use `my-js-tools.ts`:

| Tool | Input | Effect |
|---|---|---|
| `js_format_write` | `{ paths: string[] }` | `biome format --write <paths>` / `prettier --write <paths>` |
| `js_lint_fix` | `{ paths: string[] }` | `biome check --write <paths>` / `eslint --fix <paths>` (safe fixes only) |
| `js_dep_add` | `{ packages: string[], dev?: boolean }` | `npm install [--save-dev] <pkgs>` (Node) |
| `js_dep_remove` | `{ packages: string[] }` | `npm uninstall <pkgs>` (Node) |

Expo adds `my-expo-tools.ts`:

| Tool | Input | Effect |
|---|---|---|
| `expo_dep_add` | `{ packages: string[] }` | `npx expo install <pkgs>` — versions compatible with the project's Expo SDK |

Why `expo_dep_add` is separate from `js_dep_add`: `npm install <pkg>` takes the latest
version, which can silently break an Expo app by installing something the SDK doesn't
support. `npx expo install` is the supported path, so it gets its own tool and its own
description.

Shape of one of them — the rest follow the same pattern (fixed executable, validated paths,
direct spawn, no shell):

```ts
// my-js-tools.ts
import { spawnSync } from "node:child_process";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function jsTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "js_format_write",
    label: "Format files",
    description: "Run the project formatter in write mode on named workspace files.",
    parameters: Type.Object({ paths: Type.Array(Type.String(), { maxItems: 50 }) }),
    exposure: "direct",
    defaultActive: false,
    annotations: { destructiveHint: true },
    async execute(_id, { paths }, _signal, _update, ctx) {
      const files = paths.map((p) => resolveInsideWorkspace(ctx.cwd, p)); // see note
      const r = spawnSync("npx", ["biome", "format", "--write", ...files], {
        cwd: ctx.cwd,
        shell: false,
      });
      return {
        content: [{ type: "text", text: r.stdout.toString() + r.stderr.toString() }],
        details: { exitCode: r.status ?? 1 },
      };
    },
  });
}
```

`resolveInsideWorkspace` must resolve each path against the session `cwd` and reject escapes
and symlink traversal; `src/path-policy.ts` is the reference implementation.

## 4. Caveats

### Shared (Node and Expo)

- **Targeted test files only work with `node:test`.** Vitest, Jest, and `jest-expo` expose no
  verified adapter, so a `targets.mode: "file"` check cannot select one file for them — the
  agent runs the whole suite and reads failures. Verifying a runner adapter is a code change,
  not a config change.
- **`lint` stays in report mode.** `js_lint_fix` is the mutating counterpart; keeping them
  separate is what lets you grant diagnostics without granting writes.
- **Lockfile changes are real.** Dependency tools rewrite `package-lock.json` (or
  `pnpm-lock.yaml`, `yarn.lock`); treat a dependency change like any other diff — `git_diff`
  before `git_commit`.

### Node-specific

- **`js_dep_add` runs lifecycle scripts.** `npm install` executes package `postinstall` code —
  arbitrary execution by another name. Add `--ignore-scripts` unless you deliberately accept
  that trust decision.

### Expo / React Native caveats

- **Use `expo install`, not `npm install`.** This is the single most common way an agent
  breaks an Expo project; keeping `expo_dep_add` separate makes the distinction visible.
- **The app cannot be run as a check.** Rendering, navigation, and device behaviour need a
  simulator/device and a long-lived dev server. Everything checkable offline is in §2; the
  rest is a genuine `CAPABILITY_GAP` — the agent can write and test logic, but it cannot see
  the running app.
- **EAS Build is not local.** `eas build` needs network and an account, so it does not belong
  in `.pi/pi-nobash.json`; use `bundle` (`expo export`) as the local build proof.
- **Run `expo-doctor` after any dependency change.** It surfaces SDK mismatches that
  `typecheck` and `unit` will not.

## 5. Full launch

```sh
# Node / web
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-js-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,js_format_write,js_lint_fix,js_dep_add,js_dep_remove \
  --exclude-tools bash,powershell,codemode

# React Native / Expo
pi -e ./pi-nobash -e ./my-git-tools.ts -e ./my-fs-tools.ts -e ./my-js-tools.ts -e ./my-expo-tools.ts \
  --tools read,grep,find,ls,edit,write,json_query,query_jsonl,git_status,git_diff,git_log,git_show,run_validation,git_create_branch,git_add,git_commit,git_push,fs_copy,fs_move,fs_delete,js_format_write,js_lint_fix,expo_dep_add \
  --exclude-tools bash,powershell,codemode
```

Either way the agent reads, searches, edits, inspects Git, runs the checks, fixes formatting,
changes dependencies, and commits — with no shell anywhere in the loop.

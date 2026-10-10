import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGitTools } from "../src/git/index.ts";
import { registerJsonTools } from "../src/json/index.ts";
import { registerBashBlocker } from "../src/pi-guard.ts";
import { registerStatusCommand } from "../src/status.ts";
import { registerValidationTools } from "../src/validation/index.ts";

/**
 * pi-nobash extension factory (C7). Registers the Bash backstop, /nobash-status,
 * and the replacement tools. Tool selection stays with the developer via Pi.
 */
export default function piNoBash(pi: ExtensionAPI): void {
	registerBashBlocker(pi);
	registerStatusCommand(pi);
	registerJsonTools(pi);
	registerGitTools(pi);
	registerValidationTools(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BASH_TOOL_NAME } from "./constants.ts";

export const BASH_BLOCK_REASON =
	"pi-nobash: direct Bash execution is disabled for this session.";

/** Unconditional direct Bash backstop (spec §3.9). Never inspects command text. */
export function registerBashBlocker(pi: ExtensionAPI): void {
	pi.on("tool_call", (event) => {
		if (event.toolName === BASH_TOOL_NAME) {
			return { block: true, reason: BASH_BLOCK_REASON };
		}
		return undefined;
	});
}

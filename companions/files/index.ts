import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyTool } from "./copy.ts";
import { moveTool } from "./move.ts";

/** Registers the fs_* file-lifecycle companion tools (copy + move). */
export function registerFileTools(pi: ExtensionAPI): void {
	pi.registerTool(copyTool);
	pi.registerTool(moveTool);
}

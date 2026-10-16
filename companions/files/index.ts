import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyTool } from "./copy.ts";
import { deleteTool } from "./delete.ts";
import { moveTool } from "./move.ts";

/** Registers the fs_* file-lifecycle companion tools (copy + move + delete). */
export function registerFileTools(pi: ExtensionAPI): void {
	pi.registerTool(copyTool);
	pi.registerTool(moveTool);
	pi.registerTool(deleteTool);
}

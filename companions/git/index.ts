import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { addTool } from "./add.ts";
import { commitTool } from "./commit.ts";
import { createBranchTool } from "./create-branch.ts";
import { pushTool } from "./push.ts";
import { rmCachedTool } from "./rm-cached.ts";

/** Registers the git mutation companion tools. Loaded only when this companion is installed (-e / pi install). */
export function registerGitMutationTools(pi: ExtensionAPI): void {
	pi.registerTool(createBranchTool);
	pi.registerTool(addTool);
	pi.registerTool(commitTool);
	pi.registerTool(pushTool);
	pi.registerTool(rmCachedTool);
}

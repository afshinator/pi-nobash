import type {
	ExtensionAPI,
	ToolDefinition,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";

export type RegisteredCommand = {
	name: string;
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void> | void;
};

export type MockPi = {
	pi: ExtensionAPI;
	tools: ToolDefinition[];
	commands: RegisteredCommand[];
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	setActiveTools(names: string[]): void;
	setAllTools(tools: ToolInfo[]): void;
};

export function createMockPi(): MockPi {
	const tools: ToolDefinition[] = [];
	const commands: RegisteredCommand[] = [];
	const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
	let activeTools: string[] = [];
	let allTools: ToolInfo[] = [];

	const pi = {
		on(event: string, handler: (...args: unknown[]) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
		registerCommand(
			name: string,
			options: {
				description?: string;
				handler: (...args: unknown[]) => unknown;
			},
		) {
			commands.push({ name, ...options } as RegisteredCommand);
		},
		getActiveTools() {
			return activeTools;
		},
		getAllTools() {
			return allTools;
		},
		getSettings() {
			return {};
		},
		setActiveTools(names: string[]) {
			activeTools = names;
		},
	} as unknown as ExtensionAPI;

	return {
		pi,
		tools,
		commands,
		handlers,
		setActiveTools: (names: string[]) => {
			activeTools = names;
		},
		setAllTools: (t: ToolInfo[]) => {
			allTools = t;
		},
	};
}

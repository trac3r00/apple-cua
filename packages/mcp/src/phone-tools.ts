import type { MirroringText } from "@apple-cua/core";
import { findTexts } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PhoneGuardSession, PhoneToolSource } from "./phone-session.js";
import {
	iosAppSwitcherSchema,
	iosHomeSchema,
	iosLongPressSchema,
	iosObserveSchema,
	iosOpenAppSchema,
	iosPressKeysSchema,
	iosScreenshotSchema,
	iosScrollSchema,
	iosSwipeSchema,
	iosTapSchema,
	iosTapTextSchema,
	iosTypeTextSchema,
} from "./tool-schemas.js";

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false } as const;
const MUTATION_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true } as const;
const TOKEN = "Requires the one-use observation_token from ios_observe or the previous mutation result.";

export function registerPhoneTools(server: McpServer, guard: PhoneGuardSession, source: PhoneToolSource): void {
	server.registerTool(
		"ios_observe",
		{
			description:
				"Read-only observation of the connected iPhone Mirroring window; issues an observation_token for input.",
			inputSchema: iosObserveSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async () => guard.observe(),
	);
	server.registerTool(
		"ios_screenshot",
		{
			description: "Capture the ready iPhone Mirroring window as a base64 PNG, optionally writing it to path.",
			inputSchema: iosScreenshotSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async ({ path }) => guard.screenshot(path),
	);
	server.registerTool(
		"ios_tap",
		{
			description: `Tap bounded global screen coordinates. ${TOKEN}`,
			inputSchema: iosTapSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, { x: input.x, y: input.y }, async () => source.tap(input.x, input.y)),
	);
	server.registerTool(
		"ios_tap_text",
		{
			description: `Tap the centre of visible OCR text. ${TOKEN}`,
			inputSchema: iosTapTextSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, {}, async (observation) => {
				const matches = findTexts(observation.texts, input.query, input.exact === true);
				const hit = matches[input.index ?? 0];
				if (hit === undefined) {
					const visible = observation.texts.slice(0, 30).map((text: MirroringText) => text.text);
					throw new Error(
						`no visible text matches ${JSON.stringify(input.query)}; saw: ${JSON.stringify(visible)}`,
					);
				}
				await source.tap(hit.x + hit.width / 2, hit.y + hit.height / 2);
			}),
	);
	server.registerTool(
		"ios_long_press",
		{
			description: `Long-press bounded global screen coordinates. ${TOKEN}`,
			inputSchema: iosLongPressSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, { x: input.x, y: input.y }, async () =>
				source.longPress(input.x, input.y, input.duration_ms),
			),
	);
	server.registerTool(
		"ios_swipe",
		{
			description: `Swipe with the finger: direction is the way the finger moves (up means the finger moves up). ${TOKEN}`,
			inputSchema: iosSwipeSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, input.at === undefined ? {} : input.at, async () =>
				source.swipe(input.direction, {
					...(input.distance === undefined ? {} : { distance: input.distance }),
					...(input.kind === undefined ? {} : { kind: input.kind }),
					...(input.at === undefined ? {} : { at: input.at }),
				}),
			),
	);
	server.registerTool(
		"ios_scroll",
		{
			description: `Scroll content: direction is what you want to see (down reveals content further down), not finger direction. macOS routes wheel events by pointer location, so a scroll has to move the person's real pointer onto the phone and back: under background delivery it is refused unless you pass borrow_pointer: true (use ios_swipe for pages and carousels, which leaves the pointer alone). ${TOKEN}`,
			inputSchema: iosScrollSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, input.at === undefined ? {} : input.at, async () =>
				source.scroll(input.direction, {
					...(input.amount === undefined ? {} : { amount: input.amount }),
					...(input.at === undefined ? {} : { at: input.at }),
					...(input.borrow_pointer === undefined ? {} : { borrowPointer: input.borrow_pointer }),
				}),
			),
	);
	server.registerTool(
		"ios_type_text",
		{
			description: `Type text into the focused phone field. ${TOKEN}`,
			inputSchema: iosTypeTextSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			guard.consume(input.observation_token, {}, async () =>
				source.typeText(input.text, input.mode === undefined ? {} : { mode: input.mode }),
			),
	);
	server.registerTool(
		"ios_press_keys",
		{
			description: `Press a key combination in the phone. The keys briefly make the phone window the key window so they reach it (it is not raised); focus is returned to the previous app right after. ${TOKEN}`,
			inputSchema: iosPressKeysSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => guard.consume(input.observation_token, {}, async () => source.pressKeys(input.combo)),
	);
	server.registerTool(
		"ios_home",
		{
			description: `Go to the iPhone Home Screen. ${TOKEN}`,
			inputSchema: iosHomeSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => guard.consume(input.observation_token, {}, async () => source.home()),
	);
	server.registerTool(
		"ios_app_switcher",
		{
			description: `Open the iPhone app switcher. ${TOKEN}`,
			inputSchema: iosAppSwitcherSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => guard.consume(input.observation_token, {}, async () => source.appSwitcher()),
	);
	server.registerTool(
		"ios_open_app",
		{
			description: `Open an iPhone app by name. ${TOKEN}`,
			inputSchema: iosOpenAppSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => guard.consume(input.observation_token, {}, async () => source.openApp(input.name)),
	);
}

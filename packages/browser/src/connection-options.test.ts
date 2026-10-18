import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("manual browser connection options", () => {
	it.each(["", "a".repeat(63), "a".repeat(65), "g".repeat(64), "ab", "A".repeat(64), "0".repeat(64)])(
		"#given token %s #when submitting manual options #then only daemon-compatible tokens are persisted",
		async (token) => {
			const listeners = new Map<string, () => void>();
			const elements = new Map(
				["#settings", "#port", "#token", "#status", "#stop", "#connect-local"].map((selector) => [
					selector,
					{
						value: selector === "#port" ? "47953" : token,
						dataset: {},
						addEventListener: (event: string, listener: () => void) =>
							listeners.set(`${selector}:${event}`, listener),
					},
				]),
			);
			const save = vi.fn();
			const sendMessage = vi.fn();
			const source = await readFile(new URL("../extension/options.js", import.meta.url), "utf8");
			runInNewContext(source, {
				document: { querySelector: (selector: string) => elements.get(selector) },
				chrome: {
					storage: {
						session: { get: vi.fn() },
						local: { get: vi.fn(), set: save },
						onChanged: { addListener: vi.fn() },
					},
					runtime: { sendMessage },
				},
			});
			const submit = listeners.get("#settings:submit");
			if (submit === undefined) throw new Error("Missing submit listener");
			Reflect.apply(submit, undefined, [{ preventDefault: vi.fn() }]);

			if (/^[0-9a-f]{64}$/i.test(token)) {
				expect(save).toHaveBeenCalledWith({ port: 47953, token }, expect.any(Function));
			} else {
				expect(save).not.toHaveBeenCalled();
				expect(sendMessage).not.toHaveBeenCalled();
				expect(elements.get("#status")?.dataset).toEqual({ state: "error" });
			}
		},
	);
});

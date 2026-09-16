import { describe, expect, it } from "vitest";
import { type PasteboardAccess, readClipboard, writeClipboard } from "./pasteboard.js";

describe("readClipboard #given mixed pasteboard content #when reading #then all native types and supported values are returned", () => {
	it("enumerates types and reads text, image, and file URL content", () => {
		const fake = fakePasteboard(["com.example.custom", "public.utf8-plain-text", "public.png", "public.file-url"]);
		fake.strings.set("public.utf8-plain-text", "hello");
		fake.strings.set("public.file-url", "file:///tmp/document.txt");
		fake.data.set("public.png", Buffer.from([1, 2, 3]));

		const result = readClipboard(fake.access);

		expect(result.types).toEqual(["com.example.custom", "public.utf8-plain-text", "public.png", "public.file-url"]);
		expect(result.text).toBe("hello");
		expect(result.image).toEqual({
			pasteboardType: "public.png",
			mimeType: "image/png",
			dataBase64: "AQID",
		});
		expect(result.fileUrls).toEqual(["file:///tmp/document.txt"]);
	});
});

describe("writeClipboard #given plain text #when writing #then the old pasteboard is replaced", () => {
	it("clears first and reports the post-write type enumeration", () => {
		const fake = fakePasteboard([]);

		const result = writeClipboard({ type: "text", text: "replacement" }, fake.access);

		expect(fake.effects).toEqual(["clear", "text:public.utf8-plain-text:replacement"]);
		expect(result).toEqual({ overwritten: true, writtenType: "text", types: ["public.utf8-plain-text"] });
	});
});

describe("writeClipboard #given an invalid local path #when writing file content #then validation precedes clearing", () => {
	it("rejects relative paths without touching the pasteboard", () => {
		const fake = fakePasteboard(["public.utf8-plain-text"]);

		expect(() => writeClipboard({ type: "file-url", paths: ["relative.txt"] }, fake.access)).toThrow(
			"clipboard_write: file paths must be absolute",
		);
		expect(fake.effects).toEqual([]);
	});
});

function fakePasteboard(initialTypes: readonly string[]): {
	readonly access: PasteboardAccess;
	readonly strings: Map<string, string>;
	readonly data: Map<string, Buffer>;
	readonly effects: string[];
} {
	let types = [...initialTypes];
	const strings = new Map<string, string>();
	const data = new Map<string, Buffer>();
	const effects: string[] = [];
	return {
		strings,
		data,
		effects,
		access: {
			types: () => [...types],
			stringForType: (type) => strings.get(type) ?? null,
			dataForType: (type) => data.get(type) ?? null,
			clear: () => {
				effects.push("clear");
				types = [];
			},
			setString: (type, value) => {
				effects.push(`text:${type}:${value}`);
				types = [type];
				return true;
			},
			writeImage: (path) => {
				effects.push(`image:${path}`);
				types = ["public.tiff"];
				return true;
			},
			writeFileUrls: (paths) => {
				effects.push(`files:${paths.join(",")}`);
				types = ["public.file-url"];
				return true;
			},
		},
	};
}

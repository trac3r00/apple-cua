type Property = { readonly key: string; readonly start: number; readonly end: number; readonly value: number };

/** Locate property spans in validated JSON without reserializing unrelated settings. */
function properties(text: string, start: number): { entries: Property[]; end: number } {
	const tokens = [...text.slice(start).matchAll(/"(?:\\.|[^"\\])*"|[{}[\]:,]|[^\s{}[\]:,]+/g)];
	const entries: Property[] = [];
	let index = 1;
	while (index < tokens.length) {
		const key = tokens[index];
		if (key === undefined || key[0] === "}") {
			return { entries, end: start + (key?.index ?? 0) };
		}
		const value = tokens[index + 2];
		if (value === undefined) {
			throw new Error("missing JSON property value");
		}
		let depth = 0;
		let last = value;
		index += 2;
		do {
			const token = tokens[index];
			if (token === undefined) {
				throw new Error("unterminated JSON value");
			}
			last = token;
			if (token[0] === "{" || token[0] === "[") depth += 1;
			if (token[0] === "}" || token[0] === "]") depth -= 1;
			index += 1;
		} while (depth > 0);
		const parsed: unknown = JSON.parse(key[0]);
		if (typeof parsed !== "string") throw new Error("invalid JSON property key");
		entries.push({
			key: parsed,
			start: start + key.index,
			value: start + value.index,
			end: start + last.index + last[0].length,
		});
		if (tokens[index]?.[0] === ",") index += 1;
	}
	throw new Error("unterminated JSON object");
}

/** Replace or remove one JSON property, retaining every unrelated property's original bytes. */
export function editJsonProperty(text: string, path: readonly string[], value: unknown): string {
	JSON.parse(text);
	let start = text.indexOf("{");
	for (const [index, key] of path.entries()) {
		const object = properties(text, start);
		const position = object.entries.findIndex((entry) => entry.key === key);
		const entry = object.entries[position];
		if (index < path.length - 1 && entry !== undefined) {
			start = entry.value;
			continue;
		}
		if (entry === undefined) {
			if (value === undefined) return text;
			let nested = value;
			for (const child of path.slice(index + 1).reverse()) nested = { [child]: nested };
			const prefix = object.entries.length === 0 ? "" : ",";
			const insertion = object.entries[object.entries.length - 1]?.end ?? start + 1;
			return `${text.slice(0, insertion)}${prefix}${JSON.stringify(key)}:${JSON.stringify(nested)}${text.slice(insertion)}`;
		}
		if (value !== undefined) {
			return `${text.slice(0, entry.value)}${JSON.stringify(value)}${text.slice(entry.end)}`;
		}
		const next = object.entries[position + 1];
		const previous = object.entries[position - 1];
		const from = next === undefined && previous !== undefined ? previous.end : entry.start;
		const to = next === undefined ? entry.end : next.start;
		return text.slice(0, from) + text.slice(to);
	}
	return text;
}

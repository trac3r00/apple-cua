/** PC AT set-1 make codes. UTM expects extended keys as packed 0xE0xx values. */
const KEYS: Readonly<Record<string, readonly number[]>> = {
	escape: [1],
	esc: [1],
	backspace: [14],
	tab: [15],
	enter: [28],
	return: [28],
	space: [57],
	a: [30],
	b: [48],
	c: [46],
	d: [32],
	e: [18],
	f: [33],
	g: [34],
	h: [35],
	i: [23],
	j: [36],
	k: [37],
	l: [38],
	m: [50],
	n: [49],
	o: [24],
	p: [25],
	q: [16],
	r: [19],
	s: [31],
	t: [20],
	u: [22],
	v: [47],
	w: [17],
	x: [45],
	y: [21],
	z: [44],
	"1": [2],
	"2": [3],
	"3": [4],
	"4": [5],
	"5": [6],
	"6": [7],
	"7": [8],
	"8": [9],
	"9": [10],
	"0": [11],
	left: [0xe04b],
	right: [0xe04d],
	up: [0xe048],
	down: [0xe050],
	delete: [0xe053],
	home: [0xe047],
	end: [0xe04f],
	pageup: [0xe049],
	pagedown: [0xe051],
	insert: [0xe052],
	f1: [59],
	f2: [60],
	f3: [61],
	f4: [62],
	f5: [63],
	f6: [64],
	f7: [65],
	f8: [66],
	f9: [67],
	f10: [68],
	f11: [87],
	f12: [88],
};
const MODIFIERS: Readonly<Record<string, readonly number[]>> = {
	ctrl: [29],
	control: [29],
	alt: [56],
	option: [56],
	shift: [42],
	win: [0xe05b],
	meta: [0xe05b],
	cmd: [0xe05b],
	command: [0xe05b],
};

export class UTMKeyError extends Error {
	constructor(readonly combo: string) {
		super(`Unsupported UTM key combination: ${combo}`);
		this.name = "UTMKeyError";
	}
}

export function utmKeyCodes(combo: string): readonly number[] {
	const parts = combo.toLowerCase().split("+");
	const name = parts.pop() ?? "";
	const key = Object.hasOwn(KEYS, name) ? KEYS[name] : undefined;
	const modifiers = parts.map((part) => (Object.hasOwn(MODIFIERS, part) ? MODIFIERS[part] : undefined));
	if (key === undefined || modifiers.some((modifier) => modifier === undefined)) throw new UTMKeyError(combo);
	const pressed = [...modifiers.filter((modifier) => modifier !== undefined), key];
	return [...pressed.flat(), ...pressed.reverse().flatMap((codes) => codes.map((code) => code | 128))];
}

/** US keyboard ASCII, emitted as adjacent make/break pairs so guest scheduling cannot repeat held keys. */
export function utmTextCodes(text: string): readonly number[] {
	const plain = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
	const shifted = '~!@#$%^&*()_+QWERTYUIOP{}|ASDFGHJKL:"ZXCVBNM<>?';
	const scan = [
		41, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 43, 30, 31, 32, 33,
		34, 35, 36, 37, 38, 39, 40, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53,
	];
	return [...text].flatMap((character) => {
		const special: Readonly<Record<string, number>> = { " ": 57, "\n": 28, "\r": 28, "\t": 15 };
		const index = plain.indexOf(character);
		const shiftIndex = shifted.indexOf(character);
		const code = special[character] ?? scan[index < 0 ? shiftIndex : index];
		if (code === undefined) throw new UTMKeyError(`ASCII character ${JSON.stringify(character)}`);
		return index < 0 && shiftIndex >= 0 ? [42, code, code | 128, 170] : [code, code | 128];
	});
}

/** Parse APPLE_CUA_UTM_KEY_CHUNK; zero preserves one-character invocations. */
export function utmKeyChunkSize(value: string | undefined): number {
	if (value === undefined || !/^\d+$/.test(value.trim())) return 8;
	const parsed = Number(value.trim());
	return Number.isSafeInteger(parsed) ? Math.max(1, parsed) : 8;
}

export interface UTMTextScriptOptions {
	readonly chunkSize?: number;
}

/** Each returned script is one invocation; callers retain interruption checkpoints between scripts. */
export function utmTextScripts(text: string, options: UTMTextScriptOptions = {}): readonly string[] {
	const configured = options.chunkSize ?? utmKeyChunkSize(process.env["APPLE_CUA_UTM_KEY_CHUNK"]);
	const chunkSize = Number.isSafeInteger(configured) && configured >= 0 ? Math.max(1, configured) : 8;
	const characters = [...text];
	const scripts: string[] = [];
	for (let offset = 0; offset < characters.length; offset += chunkSize) {
		scripts.push(
			characters
				.slice(offset, offset + chunkSize)
				.map((character) => `u.inputScanCode(v, {codes:${JSON.stringify(utmTextCodes(character))}});`)
				.join("\n"),
		);
	}
	return scripts;
}

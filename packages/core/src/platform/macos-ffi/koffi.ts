import * as koffiImport from "koffi";
import type * as Koffi from "koffi";

type KoffiModule = typeof Koffi;
type KoffiImport = Partial<KoffiModule> & {
	readonly default?: KoffiModule;
};

export const koffi = resolveKoffi(koffiImport as KoffiImport);

function resolveKoffi(koffiNamespace: KoffiImport): KoffiModule {
	const candidate = koffiNamespace.load === undefined ? koffiNamespace.default : koffiNamespace;
	if (candidate?.load === undefined) {
		throw new Error("Failed to load koffi CommonJS module");
	}
	return candidate as KoffiModule;
}

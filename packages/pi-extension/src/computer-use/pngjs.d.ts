declare module "pngjs" {
	export class PNG {
		static readonly sync: {
			read(data: Buffer): PNG;
			write(png: PNG): Buffer;
		};

		readonly width: number;
		readonly height: number;
		readonly data: Buffer;

		constructor(options: { readonly width: number; readonly height: number });
	}
}

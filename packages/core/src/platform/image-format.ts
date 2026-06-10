const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MINIMUM_IHDR_LENGTH = 24;

export function parsePngDimensions(data: Buffer): { width: number; height: number } {
	if (data.byteLength < PNG_MINIMUM_IHDR_LENGTH || data.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
		throw new Error("Failed to parse PNG dimensions");
	}

	return {
		width: data.readUInt32BE(PNG_IHDR_WIDTH_OFFSET),
		height: data.readUInt32BE(PNG_IHDR_HEIGHT_OFFSET),
	};
}

export function sniffImageMimeType(data: Buffer): "image/png" | "image/jpeg" {
	return data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xd8 ? "image/jpeg" : "image/png";
}

export function parseImageDimensions(data: Buffer): { width: number; height: number } {
	if (data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xd8) {
		return parseJpegDimensions(data);
	}
	return parsePngDimensions(data);
}

function parseJpegDimensions(data: Buffer): { width: number; height: number } {
	let offset = 2;
	while (offset + 9 < data.byteLength) {
		if (data[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = data[offset + 1] ?? 0;
		if (isJpegStartOfFrame(marker)) {
			return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
		}
		const segmentLength = data.readUInt16BE(offset + 2);
		offset += 2 + segmentLength;
	}
	throw new Error("Failed to parse JPEG dimensions");
}

function isJpegStartOfFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

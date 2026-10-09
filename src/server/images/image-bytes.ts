import "server-only";

import { Buffer } from "node:buffer";
import { ImageProviderError, type ImageMimeType } from "../../domain/image";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

function invalidImage(): never {
  throw new ImageProviderError(
    "invalid_response",
    "The image provider returned an unsupported or invalid image.",
    "completed",
  );
}

function jpegSize(bytes: Buffer): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
    return invalidImage();
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return invalidImage();
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return invalidImage();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return invalidImage();
    if (
      marker !== undefined &&
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    ) {
      if (length < 8) return invalidImage();
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return invalidImage();
}

function webpSize(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    return invalidImage();
  }
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.readUInt32LE(16) >= 10) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (kind === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return invalidImage();
}

/** Header checks bound media storage. A decoder must verify pixels before later transforms. */
export function decodeProviderImage(
  data: unknown,
  mimeType: unknown,
): { bytes: Buffer; mimeType: ImageMimeType; width: number; height: number } {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    return invalidImage();
  }
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    return invalidImage();
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data) {
    return invalidImage();
  }

  let dimensions: { width: number; height: number };
  if (mimeType === "image/png") {
    if (
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    ) {
      return invalidImage();
    }
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (mimeType === "image/jpeg") {
    dimensions = jpegSize(bytes);
  } else {
    dimensions = webpSize(bytes);
  }
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    return invalidImage();
  }
  return { bytes, mimeType, ...dimensions };
}

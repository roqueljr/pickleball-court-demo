const LOGO_SIZE = 512;
const MAX_LOGO_BYTES = 500 * 1024;
const supportedLogoTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

type Dimensions = { width: number; height: number };

export class BusinessLogoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessLogoValidationError";
  }
}

function invalidLogo(message: string): never {
  throw new BusinessLogoValidationError(message);
}

function pngDimensions(buffer: Buffer): Dimensions | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer: Buffer): Dimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xda || offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (startOfFrameMarkers.has(marker)) return segmentLength >= 8 ? { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) } : null;
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer: Buffer): Dimensions | null {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21]; const b2 = buffer[22]; const b3 = buffer[23]; const b4 = buffer[24];
    return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
  }
  return null;
}

function imageDimensions(mimeType: string, buffer: Buffer) {
  if (mimeType === "image/png") return pngDimensions(buffer);
  if (mimeType === "image/jpeg") return jpegDimensions(buffer);
  return webpDimensions(buffer);
}

export function validateBusinessLogo(value: unknown) {
  if (value === "" || value === null) return "";
  if (typeof value !== "string") invalidLogo("Business logo must be an uploaded image.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !supportedLogoTypes.has(match[1])) invalidLogo("Logo must be a PNG, JPEG, or WebP image.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_LOGO_BYTES) invalidLogo("Logo must be 500 KB or smaller.");
  const normalizedInput = match[2].replace(/=+$/, "");
  if (buffer.toString("base64").replace(/=+$/, "") !== normalizedInput) invalidLogo("Logo image data is invalid.");
  const dimensions = imageDimensions(match[1], buffer);
  if (!dimensions) invalidLogo("Logo image could not be validated.");
  if (dimensions.width !== LOGO_SIZE || dimensions.height !== LOGO_SIZE) invalidLogo(`Logo must be exactly ${LOGO_SIZE}×${LOGO_SIZE} pixels.`);
  return value;
}

export const businessLogoRequirements = { width: LOGO_SIZE, height: LOGO_SIZE, maxBytes: MAX_LOGO_BYTES } as const;

const COURT_IMAGE_WIDTH = 1280;
const COURT_IMAGE_HEIGHT = 720;
const MAX_COURT_IMAGE_BYTES = 650 * 1024;

export class CourtImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourtImageValidationError";
  }
}

function invalidCourtImage(message: string): never {
  throw new CourtImageValidationError(message);
}

export function validateCourtImage(value: unknown) {
  if (value === "" || value === null) return "";
  if (typeof value !== "string") invalidCourtImage("Court image must be an uploaded image.");
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") invalidCourtImage("Existing court image URL is invalid.");
      return value;
    } catch {
      invalidCourtImage("Existing court image URL is invalid.");
    }
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !supportedLogoTypes.has(match[1])) invalidCourtImage("Court image must be a PNG, JPEG, or WebP image.");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_COURT_IMAGE_BYTES) invalidCourtImage("Court image must be 650 KB or smaller.");
  const normalizedInput = match[2].replace(/=+$/, "");
  if (buffer.toString("base64").replace(/=+$/, "") !== normalizedInput) invalidCourtImage("Court image data is invalid.");
  const dimensions = imageDimensions(match[1], buffer);
  if (!dimensions) invalidCourtImage("Court image could not be validated.");
  if (dimensions.width !== COURT_IMAGE_WIDTH || dimensions.height !== COURT_IMAGE_HEIGHT) invalidCourtImage(`Court image must be exactly ${COURT_IMAGE_WIDTH}×${COURT_IMAGE_HEIGHT} pixels.`);
  return value;
}

export const courtImageRequirements = { width: COURT_IMAGE_WIDTH, height: COURT_IMAGE_HEIGHT, maxBytes: MAX_COURT_IMAGE_BYTES } as const;

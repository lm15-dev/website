/**
 * A picture for Judge's `image` shape, made ready in the page.
 *
 * lm15 never changes media (contract MAP-10): it sends the bytes it is
 * given and refuses what the wire cannot take. The playground is an app
 * on top of it, so it does what a careful app would before calling lm15:
 * a PNG or JPEG that already fits TypeSafe's limits is sent byte for
 * byte; anything else (another format, an animation, a photo too large or
 * too small, a JPEG whose rotation lives in a tag) is drawn upright on a
 * canvas at a size that fits and encoded again, and `prepared` says so in
 * words, so the page can show it.
 *
 * The limits are TypeSafe's (docs.typesafe.ai/images, read 2026-10-14):
 * PNG or JPEG, sides up to 1568 pixels. The documented minimum is 256 a
 * side, but the server refused 320×256 and 300×270 on 2026-10-14 and took
 * 280×280 (lm15-contract changes/2026-10-14-jev-images.md), so 280 is the
 * floor here. Chat providers take any picture inside these bounds too.
 */

import type { Picture } from "./judge.ts";

export const MIN_SIDE = 280;
export const MAX_SIDE = 1568;
/** TypeSafe's per-image file limit is 16 MiB; a picture inside the side limits is far below it unless it is an unusual PNG. */
const MAX_BYTES = 16 * 1024 * 1024;

type Kind = "png" | "jpeg" | "other";

/** The format by its first bytes, never by the file name or the browser's guess. */
export function sniff(bytes: Uint8Array): Kind {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return "other";
}

/** An animated PNG carries an `acTL` chunk before its first image data. */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    at += 12 + length;
  }
  return false;
}

/** A JPEG's EXIF orientation (1 = upright; 2–8 = mirrored or turned), or 1 when it has none. */
export function jpegOrientation(bytes: Uint8Array): number {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    const size = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts: no EXIF before it
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif") {
      const tiff = at + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number) => (little ? bytes[o]! | (bytes[o + 1]! << 8) : (bytes[o]! << 8) | bytes[o + 1]!);
      const u32 = (o: number) => (little ? (bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)) : ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!)) >>> 0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 10 > bytes.length) return 1;
        if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1; }
      }
      return 1;
    }
    at += 2 + size;
  }
  return 1;
}

/** The size a picture is drawn at: inside 280–1568 a side, the aspect kept; a picture too thin to keep both is padded (`pad`), never stretched. */
export function fitted(width: number, height: number): { width: number; height: number; drawWidth: number; drawHeight: number } {
  const long = Math.max(width, height), short = Math.min(width, height);
  let scale = Math.min(1, MAX_SIDE / long);
  if (short * scale < MIN_SIDE) scale = Math.min(MIN_SIDE / short, MAX_SIDE / long);
  const drawWidth = Math.max(1, Math.round(width * scale)), drawHeight = Math.max(1, Math.round(height * scale));
  return { width: Math.max(MIN_SIDE, drawWidth), height: Math.max(MIN_SIDE, drawHeight), drawWidth, drawHeight };
}

/** A file name the shown programs can open: letters, digits, `.`, `-`, `_`, and the extension of what is sent. */
export function fileName(original: string, kind: "png" | "jpeg"): string {
  const stem = original.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "picture";
  return `${stem}.${kind === "png" ? "png" : "jpg"}`;
}

const FORMAT_NAMES: Record<string, string> = { "image/webp": "WebP", "image/gif": "GIF", "image/heic": "HEIC", "image/heif": "HEIF", "image/avif": "AVIF", "image/bmp": "BMP", "image/tiff": "TIFF", "image/svg+xml": "SVG" };

export function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Read a picked, pasted or dropped file and make it a picture the request can carry. Throws, in words, what it cannot read. */
export async function preparePicture(file: Blob, originalName: string): Promise<Picture> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error(`This browser cannot read ${originalName || "the file"} as a picture. Save it as PNG or JPEG and try again.`); }
  const { width, height } = bitmap;
  const animated = kind === "png" && isAnimatedPng(bytes);
  const turned = kind === "jpeg" && jpegOrientation(bytes) !== 1;
  const fits = Math.min(width, height) >= MIN_SIDE && Math.max(width, height) <= MAX_SIDE && bytes.length <= MAX_BYTES;
  if (kind !== "other" && !animated && !turned && fits) {
    bitmap.close();
    return { name: fileName(originalName, kind), mediaType: kind === "png" ? "image/png" : "image/jpeg", data: base64(bytes), width, height };
  }
  const size = fitted(width, height);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the picture to make it fit.");
  // A PNG stays PNG when it is small enough to stay lossless; a photo goes as JPEG, on white (JPEG has no transparency).
  const asPng = kind === "png" && size.width * size.height <= 1024 * 1024;
  if (!asPng || size.width !== size.drawWidth || size.height !== size.drawHeight) { context.fillStyle = "#fff"; context.fillRect(0, 0, size.width, size.height); }
  context.drawImage(bitmap, Math.floor((size.width - size.drawWidth) / 2), Math.floor((size.height - size.drawHeight) / 2), size.drawWidth, size.drawHeight);
  bitmap.close();
  const blob = await canvas.convertToBlob(asPng ? { type: "image/png" } : { type: "image/jpeg", quality: 0.9 });
  const out = new Uint8Array(await blob.arrayBuffer());
  const done: string[] = [];
  if (kind === "other") done.push(`converted from ${FORMAT_NAMES[file.type] ?? "its format"} to ${asPng ? "PNG" : "JPEG"}`);
  else if (animated) done.push("the first frame of an animation");
  else if (kind === "png" && !asPng) done.push("saved as JPEG");
  if (turned) done.push("turned upright (the file kept its rotation in a tag)");
  if (size.drawWidth !== width || size.drawHeight !== height) done.push(`resized from ${width} × ${height}`);
  if (size.width !== size.drawWidth || size.height !== size.drawHeight) done.push(`padded to ${MIN_SIDE} pixels`);
  return { name: fileName(originalName, asPng ? "png" : "jpeg"), mediaType: asPng ? "image/png" : "image/jpeg", data: base64(out), width: size.width, height: size.height, prepared: done.join(", ") || "encoded again" };
}

export function bytesOf(picture: Picture): Uint8Array {
  return Uint8Array.from(atob(picture.data), (c) => c.charCodeAt(0));
}

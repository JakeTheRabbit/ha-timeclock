import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PHOTOS_DIR = process.env.PHOTOS_DIR ?? "/data/photos";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB cap

/**
 * Validate and decode a punch photo (base64 JPEG data-url or raw base64).
 */
export function decodePunchPhoto(base64: string): Buffer {
  const data = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(data, "base64");
  if (buf.length === 0) throw new PhotoError("photo_empty");
  if (buf.length > MAX_BYTES) throw new PhotoError("photo_too_large");
  // JPEG magic sniff (kiosk camera produces JPEG).
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw new PhotoError("photo_not_jpeg");
  return buf;
}

/**
 * Persist a punch photo to /data/photos. Returns the stored path. Photos are
 * referenced from time_entries.photo_path and reviewed via manager screens.
 */
export function savePunchPhoto(entryId: string, base64: string): string {
  const buf = decodePunchPhoto(base64);

  if (!existsSync(PHOTOS_DIR)) mkdirSync(PHOTOS_DIR, { recursive: true });
  const path = join(PHOTOS_DIR, `${entryId}.jpg`);
  writeFileSync(path, buf);
  return path;
}

export class PhotoError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

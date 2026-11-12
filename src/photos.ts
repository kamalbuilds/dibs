import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Box } from "./ai-schemas.js";

const dataDir = () => process.env.DATA_DIR || "./data";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function boxToPixels(box: Box, width: number, height: number, pad = 0.02): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(clamp(box.x - pad, 0, 1) * width), 0, width - 1);
  const top = clamp(Math.round(clamp(box.y - pad, 0, 1) * height), 0, height - 1);
  const right = Math.round(clamp(box.x + box.w + pad, 0, 1) * width);
  const bottom = Math.round(clamp(box.y + box.h + pad, 0, 1) * height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

// Upright (EXIF), bounded JPEG: the same pixels go to the vision model and to the cropper, so boxes line up.
export async function normalizeSalePhoto(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
}

export async function cropToWebp(image: Buffer, box: Box, pad = 0.02): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  return sharp(image).extract(boxToPixels(box, width, height, pad)).resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
}

export async function itemPhotoFromUpload(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate().resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
}

export function saveSalePhoto(saleId: string, jpeg: Buffer): string {
  const dir = join(dataDir(), "sale-photos", saleId);
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}.jpg`;
  writeFileSync(join(dir, name), jpeg);
  return join(saleId, name);
}

const itemPhotoPath = (itemId: string) => join(dataDir(), "item-photos", `${itemId}.webp`);

export function saveItemPhoto(itemId: string, webp: Buffer): void {
  mkdirSync(join(dataDir(), "item-photos"), { recursive: true });
  writeFileSync(itemPhotoPath(itemId), webp);
}

export function readItemPhoto(itemId: string): Buffer | null {
  try { return readFileSync(itemPhotoPath(itemId)); } catch { return null; }
}

export function removeItemPhoto(itemId: string): void {
  rmSync(itemPhotoPath(itemId), { force: true });
}

export function assertPhoto(type: string, size: number): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error("Use a JPEG, PNG, or WebP image");
  if (!size || size > 12 * 1024 * 1024) throw new Error("Each photo must be under 12 MB");
}

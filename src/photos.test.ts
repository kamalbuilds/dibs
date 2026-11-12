import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { BoxSchema, VisionSchema, withBoxes } from "./ai-schemas.js";
import { boxToPixels, cropToWebp } from "./photos.js";

describe("bbox to pixel crop", () => {
  it("maps a normalized box onto image pixels with padding", () => {
    expect(boxToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1000, 800, 0)).toEqual({ left: 250, top: 400, width: 500, height: 200 });
    expect(boxToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1000, 800, 0.02)).toEqual({ left: 230, top: 384, width: 540, height: 232 });
  });

  it("clamps boxes that run past the right and bottom edges", () => {
    expect(boxToPixels({ x: 0.9, y: 0.8, w: 0.5, h: 0.6 }, 1000, 500, 0)).toEqual({ left: 900, top: 400, width: 100, height: 100 });
  });

  it("clamps negative and out-of-range coordinates instead of extracting outside the image", () => {
    expect(boxToPixels({ x: -0.2, y: -1, w: 0.5, h: 1.5 }, 400, 300, 0)).toEqual({ left: 0, top: 0, width: 120, height: 150 });
    expect(boxToPixels({ x: 1.4, y: 2, w: 0.1, h: 0.1 }, 400, 300, 0)).toEqual({ left: 399, top: 299, width: 1, height: 1 });
  });

  it("never returns an empty region for a zero-size box", () => {
    expect(boxToPixels({ x: 0.5, y: 0.5, w: 0, h: 0 }, 10, 10, 0)).toEqual({ left: 5, top: 5, width: 1, height: 1 });
  });

  it("rejects model boxes outside 0..1 at the schema boundary", () => {
    expect(BoxSchema.safeParse({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }).success).toBe(true);
    expect(BoxSchema.safeParse({ x: 1.2, y: 0.2, w: 0.3, h: 0.4 }).success).toBe(false);
    expect(BoxSchema.safeParse({ x: 0.1, y: -0.1, w: 0.3, h: 0.4 }).success).toBe(false);
  });

  it("converts the model's box_2d grid to a 0..1 box and rejects inverted boxes", () => {
    const item = { title: "Irene Adler", set_or_platform: null, condition_notes: null, read_text: "IRENE ADLER", position: 1, confidence: 0.9 };
    expect(VisionSchema.parse(withBoxes({ items: [{ ...item, box_2d: [100, 250, 600, 500] }] })).items[0].box).toEqual({ x: 0.25, y: 0.1, w: 0.25, h: 0.5 });
    expect(VisionSchema.safeParse(withBoxes({ items: [{ ...item, box_2d: [600, 500, 100, 250] }] })).success).toBe(false);
    expect(VisionSchema.safeParse(withBoxes({ items: [{ ...item }] })).success).toBe(false);
  });

  it("crops the boxed region out of a real image", async () => {
    // Left half red, right half blue: the crop of the right half must be blue.
    const red = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const image = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0000ff" } }).composite([{ input: red, left: 0, top: 0 }]).jpeg().toBuffer();
    const crop = await cropToWebp(image, { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, 0);
    const { data, info } = await sharp(crop).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([80, 80]);
    expect(data[2]).toBeGreaterThan(200);
    expect(data[0]).toBeLessThan(60);
  });
});

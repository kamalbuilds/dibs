import { groundVisionItem, linkThreadEvents } from "./domain.js";
import { ThreadModelSchema, VisionSchema, type ThreadEvent, type VisionResult } from "./ai-schemas.js";

export class AiOutputError extends Error {}

export const aiModel = () => process.env.AI_MODEL || "google/gemini-3.8-flash";

const visionJsonSchema = {
  type: "object", additionalProperties: false, required: ["items"], properties: {
    items: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "set_or_platform", "condition_notes", "read_text", "position", "confidence"], properties: {
      title: { type: "string" }, read_text: { type: "string" }, set_or_platform: { type: ["string", "null"] }, condition_notes: { type: ["string", "null"] }, position: { type: "integer", minimum: 1 }, confidence: { type: "number", minimum: 0, maximum: 1 },
    } } },
  },
} as const;

const threadJsonSchema = {
  type: "object", additionalProperties: false, required: ["events"], properties: {
    events: { type: "array", items: { type: "object", additionalProperties: false, required: ["handle", "line", "kind", "itemRefs", "timestamp"], properties: {
      handle: { type: "string" }, line: { type: "integer", minimum: 1 }, kind: { type: "string", enum: ["claim", "backup", "question", "other"] }, itemRefs: { type: "array", items: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string" }] } }, timestamp: { type: ["string", "null"] },
    } } },
  },
} as const;

async function completion<T>(instruction: string, content: unknown[], jsonSchema: unknown, parse: (raw: string) => T): Promise<T> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("AI setup requires OPENROUTER_API_KEY");
  const model = aiModel();
  let validationError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Dibs claim sales" },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 5000, provider: { data_collection: "deny" },
        messages: [{ role: "system", content: instruction }, { role: "user", content: [...content, ...(validationError ? [{ type: "text", text: `Your previous output failed validation: ${validationError}. Return corrected JSON only.` }] : [])] }],
        response_format: { type: "json_schema", json_schema: { name: "dibs_structured_result", strict: true, schema: jsonSchema } },
      }),
    });
    const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${body?.error?.message ?? "request failed"}`);
    let raw = body?.choices?.[0]?.message?.content;
    if (Array.isArray(raw)) raw = raw.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("");
    if (typeof raw !== "string") throw new AiOutputError("OpenRouter returned no structured text");
    try { return parse(raw); } catch (error) {
      if (attempt === 1) throw new AiOutputError(error instanceof Error ? error.message : "AI output validation failed");
      validationError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new AiOutputError("AI output validation failed");
}

export async function identifyItems(image: Buffer, mimeType: string): Promise<VisionResult> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("Use a JPEG, PNG, or WebP image");
  if (!image.length || image.length > 12 * 1024 * 1024) throw new Error("Each sale photo must be under 12 MB");
  const instruction = "Find distinct collectible cards, comics, or retro games a seller could list separately in the photo. Order positions left to right, then top to bottom. For each item, copy into read_text the exact label text you can actually read on it (empty string when nothing is legible). Title it from that text; when nothing is legible, give your best identification with a low confidence. Give set/platform when visible, condition notes only for visible defects, and a confidence from 0 to 1. Never guess unreadable details. Low confidence still appears for seller review. Price is always handled by the seller.";
  const result = await completion(instruction, [
    { type: "text", text: "Itemize the collectibles in this real sale photo." },
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` } },
  ], visionJsonSchema, (raw) => VisionSchema.parse(JSON.parse(raw)));
  return { items: result.items.map(groundVisionItem).sort((a, b) => a.position - b.position) };
}

export async function parseThread(text: string): Promise<ThreadEvent[]> {
  if (!text.trim() || text.length > 150_000) throw new Error("Paste a comment thread under 150,000 characters");
  const lines = text.split(/\r?\n/);
  const instruction = "Parse a claim-sale comment thread copied from X, Instagram, or Discord. Lines are numbered as 'N| text'. Copied threads put author name, @handle, separators, time ('3m', '11:42 PM', 'Today at 9:15 PM'), 'Reply' and like counts on their own lines around the comment text. Return one event per comment body, in source order, never for header lines. line is the number of the line holding the comment text. handle is the @handle or username shown in that comment's header, as written. timestamp is the time shown in that comment's header, as written, or null. Classify claim (mine, claim, dibs), backup, question, or other. itemRefs are item numbers or title phrases the comment names. Never invent a handle, item, or time.";
  const numbered = lines.map((line, index) => `${index + 1}| ${line}`).join("\n");
  const result = await completion(instruction, [{ type: "text", text: numbered }], threadJsonSchema, (raw) => linkThreadEvents(lines, ThreadModelSchema.parse(JSON.parse(raw)).events));
  return result.map(({ line: _line, ...event }) => event);
}

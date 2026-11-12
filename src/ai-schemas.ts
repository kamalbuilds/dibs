import { z } from "zod";

export const VisionItemSchema = z.object({
  title: z.string().trim().min(1),
  set_or_platform: z.string().nullable(),
  condition_notes: z.string().nullable(),
  read_text: z.string(),
  position: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

export const VisionSchema = z.object({ items: z.array(VisionItemSchema).max(200) });
export type VisionResult = z.infer<typeof VisionSchema>;

export const ThreadEventSchema = z.object({
  handle: z.string().trim().min(1),
  raw: z.string().min(1),
  kind: z.enum(["claim", "backup", "question", "other"]),
  itemRefs: z.array(z.union([z.number().int().positive(), z.string().trim().min(1)])),
  timestamp: z.string().nullable(),
});

export const ThreadSchema = z.object({ events: z.array(ThreadEventSchema).max(2000) });

export const ThreadModelSchema = z.object({ events: z.array(ThreadEventSchema.omit({ raw: true }).extend({ line: z.number().int().positive() })).max(2000) });
export type ThreadEvent = z.infer<typeof ThreadEventSchema>;

export const SaleInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  deadlineMinutes: z.number().int().min(5).max(10080).default(1440),
  invoiceMode: z.enum(["sale_close", "first_claim"]).default("sale_close"),
  shippingTiers: z.array(z.object({ label: z.string().trim().min(1).max(80), amountCents: z.number().int().nonnegative(), maxSubtotalCents: z.number().int().positive().optional(), maxItems: z.number().int().positive().optional() })).min(1),
  freeOverCents: z.number().int().positive().optional(),
  feePolicy: z.enum(["seller_absorbs", "split", "buyer_pays"]).default("seller_absorbs"),
  feeRateBasisPoints: z.number().int().nonnegative().max(10000).default(349),
  feeFixedCents: z.number().int().nonnegative().default(49),
  depositPercent: z.number().int().min(1).max(100).default(20),
}).strict();

export const ItemInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  setOrPlatform: z.string().trim().max(120).nullable().optional(),
  conditionNotes: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().positive(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

export const ClaimInputSchema = z.object({
  handle: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  itemIds: z.array(z.string().min(1)).min(1).max(200).optional(),
  text: z.string().trim().min(1).max(200).optional(),
  hold: z.boolean().optional(),
}).strict().refine((value) => !!value.itemIds?.length || !!value.text, "Select items or enter Mine with item numbers");

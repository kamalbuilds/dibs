Claim: A single Google Gemini 2.5 Flash call can return at least 10 schema-shaped, ordered collectible candidates from a real 2256x1496 sale photo in under 15 seconds.
Verdict: CONFIRMED for response shape and latency, not for item correctness.
Measured: 19 candidates, 1,092 tokens, $0.0019908 reported usage, 6.9 seconds wall time. Command: one direct OpenRouter `POST /api/v1/chat/completions` using `google/gemini-2.5-flash`, strict JSON Schema, and `/Users/kamal/Desktop/shelfscan/spikes/vision/photos/04-video-game-collection-full.jpg`.
Negative case: the schema rejects a confidence value above 1 and missing item titles; this is asserted by the product Zod schema tests. An empty or irrelevant image must produce zero confident items, not invented titles.
Caveat: one pass establishes transport and structured output only. The model assigned the same 0.8 confidence to all 19 candidates, and duplicate titles appeared. Seller review is mandatory; recognition accuracy and confidence calibration remain unmeasured.
Blocks product: no, because every AI result is seller-confirmed and items can be entered manually. The live PayPal money path is the separate blocking mechanism.

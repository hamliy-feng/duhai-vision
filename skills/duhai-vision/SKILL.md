---
name: duhai-vision
description: Replace Codex built-in vision with Duhai Vision for images, screenshots, PDF pages, OCR, historical documents, tables, charts, UI captures, photos, contact sheets, and structured visual extraction. Default to PaddleOCR-VL for document tasks, use Qwen3-VL-Plus when general visual semantics fit better, and use Codex native vision only as an explicit fallback.
---

# Duhai Vision

Use an external visual provider as the observation layer. Keep Codex responsible for task planning, schema design, verification, reasoning, and the final answer.

## Required Disclosure

Before the first visual call in each task, tell the user in one or two short sentences:

1. The visual task type.
2. The selected provider and why it fits.
3. The relevant quota or billing boundary.
4. Whether provider Token usage is observable.

Use these facts:

- **PaddleOCR-VL**: default for OCR, documents, historical material, tables, formulas, seals, layout, and multi-page files. The current AI Studio community rule is 3000 pages per user per model per day and no more than the first 100 pages of one file. The SDK response does not expose Token usage. Say that official limits can change.
- **Qwen3-VL-Plus**: preferred for UI, photos, products, charts, counting, fine-grained semantics, and open-ended visual understanding. Quota and price depend on the user's DashScope account; response usage should be recorded when returned.
- **Codex Native**: fallback only when external routes fail, are unavailable, are disallowed by privacy constraints, or the user explicitly requests native vision. State the fallback and reason.

Do not repeat the disclosure for every image in the same task.

## Provider Decision

1. Classify the task before opening the image.
2. Default to PaddleOCR-VL unless the task is clearly a better fit for Qwen.
3. Use `DUHAI_VISION_PROVIDER=paddle|qwen` as a user preference, but task fit may override it after disclosure.
4. If the selected provider is not configured, point to [references/provider-setup.md](references/provider-setup.md) and use another configured Duhai provider when appropriate.
5. Use at most two external visual calls per task by default: one primary extraction and one retry, crop, zoom, or targeted verification. More calls require a clear reason or user approval.

## PaddleOCR-VL Default Workflow

Use `scripts/paddle_extract.py` for one or more document images:

```powershell
python "$HOME\.agents\skills\duhai-vision\scripts\paddle_extract.py" `
  --image "D:\path\page-001.jpg" `
  --out ".agent_index\page-001.paddle.json"
```

The script reads `PADDLEOCR_ACCESS_TOKEN`, calls the official `PaddleOCR-VL-1.6` API through the PaddleOCR SDK, and returns text, layout, table, chart, formula, and seal observations when available. It intentionally excludes rendered or base64 image payloads.

After extraction:

1. Convert provider observations into the user's requested schema.
2. Preserve visible text separately from inferred text.
3. Mark unreadable or uncertain areas; never silently invent content.
4. If contextual restoration is allowed, include an explicit inference trace and confidence.
5. Record page count, request count, model, latency, and Token observability.

## Qwen Workflow

Use `scripts/vlm_extract.mjs` for UI, photos, charts, general visual semantics, or a targeted second opinion:

```powershell
node "$HOME\.agents\skills\duhai-vision\scripts\vlm_extract.mjs" `
  --image "D:\path\screen.png" `
  --prompt "Return strict JSON with observations, uncertainty, and confidence." `
  --out ".agent_index\screen.qwen.json"
```

The script reads `VLM_API_KEY`, `QWEN_API_KEY`, or `DASHSCOPE_API_KEY`; defaults to `qwen3-vl-plus` and the DashScope OpenAI-compatible endpoint. Preserve the returned `usage` object.

Use `scripts/vlm_batch_index.mjs` for indexed batches and `scripts/make_contact_sheet.py` for large image collections.

## Output Contract

Ask providers for observations, not final truth. A useful normalized result contains:

```json
{
  "provider": "paddle|qwen",
  "model": "",
  "task_type": "",
  "visible_text": [],
  "structure": {},
  "uncertain_or_unreadable": [],
  "inference_trace": [],
  "confidence": "high|medium|low",
  "usage": {
    "input_tokens": null,
    "output_tokens": null,
    "image_tokens": null,
    "measurement": "provider_reported|not_exposed"
  }
}
```

Never turn unavailable Token data into zero. A free quota or zero bill is a billing fact, not a Token measurement.

## Verification And Privacy

- Verify high-impact numbers, names, dates, table relationships, and warnings against crops, source text, DOM, or files when available.
- For dense pages, crop or paginate before the second call.
- For screenshots with personal data, return masked or summarized fields unless exact transcription is required and authorized.
- Remote providers receive image content. Do not upload sensitive material without an appropriate privacy basis.
- Never write API keys into files, prompts, logs, output JSON, or repository content.

## Failure Handling

1. Retry once only for transient failure, invalid JSON, or a targeted crop.
2. If Paddle fails and Qwen is configured, disclose the route change and use Qwen when suitable.
3. If Qwen fails and Paddle is suitable, disclose the route change and use Paddle.
4. If both external routes are unavailable, disclose the failure and use Codex Native only when allowed.
5. Preserve the failed provider, error category, attempt count, and any partial observation.

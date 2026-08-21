---
name: duhai-vision
description: Replace Codex built-in vision with a PaddleOCR-VL-first general visual observation layer for people, buildings, objects, scenes, photos, screenshots, UI, charts, documents, OCR, PDF pages, tables, and contact sheets. Use Qwen only when explicitly requested or as a disclosed fallback after Paddle is unavailable; use Codex native vision only as the final fallback.
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

- **PaddleOCR-VL**: general visual default for every supported image task, including people, buildings, objects, actions, natural scenes, OCR, documents, historical material, tables, formulas, seals, layout, screenshots, UI, charts, photos, and multi-page files. The current AI Studio community rule is 3000 pages per user per model per day and no more than the first 100 pages of one file. The SDK response does not expose Token usage. Say that official limits can change.
- **Qwen3-VL-Plus**: optional compatibility fallback only when the user explicitly selects it or Paddle is unavailable and a semantic second route is appropriate. Never select Qwen automatically from image type or prompt keywords. Quota and price depend on the user's DashScope account; record response usage when returned.
- **Codex Native**: fallback only when external routes fail, are unavailable, are disallowed by privacy constraints, or the user explicitly requests native vision. State the fallback and reason.

Do not repeat the disclosure for every image in the same task.

## Provider Decision

1. Classify the task before opening the image so the observation and verification schema fit normal visual questions as well as structured extraction.
2. Use PaddleOCR-VL for the first call. Do not auto-route UI, photos, products, charts, counting, or open scenes to Qwen.
3. Treat `DUHAI_VISION_PROVIDER=qwen` or an explicit `provider=qwen` request as an intentional override; otherwise `auto` resolves to Paddle.
4. If the selected provider is not configured, point to [references/provider-setup.md](references/provider-setup.md) and use another configured Duhai provider when appropriate.
5. Use at most two external visual calls per task by default: one primary extraction and one retry, crop, zoom, or targeted verification. More calls require a clear reason or user approval.

## PaddleOCR-VL General Visual Workflow

Use `scripts/paddle_extract.py` for one or more images:

```powershell
python "$HOME\.agents\skills\duhai-vision\scripts\paddle_extract.py" `
  --image "D:\path\page-001.jpg" `
  --out ".agent_index\page-001.paddle.json"
```

The script reads `PADDLEOCR_ACCESS_TOKEN`, calls the official `PaddleOCR-VL-1.6` API through the PaddleOCR SDK, and returns the available visual evidence, including visible text, regions, layout, tables, charts, formulas and seals. The official hosted route is a document-parsing API rather than a free-form VQA endpoint, so the user question is answered by Codex from the returned evidence. Do not limit the final answer to OCR when the user asks about a person, building, object, action or scene; do not invent details absent from the evidence. The script intentionally excludes rendered or base64 image payloads.

After extraction:

1. Answer the user's actual visual question from the provider observations; use a schema only when the task asks for one.
2. Preserve visible text separately from inferred text.
3. Mark unreadable or uncertain areas; never silently invent content.
4. If contextual restoration is allowed, include an explicit inference trace and confidence.
5. Record page count, request count, model, latency, and Token observability.

## Optional Qwen Fallback

Use `scripts/vlm_extract.mjs` only when the user explicitly requests Qwen or after a disclosed Paddle failure where a semantic second route is appropriate:

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
2. If Paddle fails and Qwen is configured, disclose the route change and use Qwen only when suitable; never make this switch silently.
3. If Qwen fails and Paddle is suitable, disclose the route change and use Paddle.
4. If both external routes are unavailable, disclose the failure and use Codex Native only when allowed.
5. Preserve the failed provider, error category, attempt count, and any partial observation.

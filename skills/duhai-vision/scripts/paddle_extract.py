from __future__ import annotations

import argparse
import dataclasses
import importlib.metadata
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def parse_bool(value: str) -> bool:
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError(f"invalid boolean value: {value!r}")


def _jsonable(value: Any) -> Any:
    if dataclasses.is_dataclass(value):
        value = dataclasses.asdict(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(child) for child in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _page_payload(page: Any, page_index: int) -> dict[str, Any]:
    # Keep the compact, model-ready result. The SDK's raw/markdown payloads may
    # contain temporary provider resource URLs, input images, or rendered images.
    return {
        "page_index": page_index,
        "markdown_text": str(getattr(page, "markdown_text", "") or ""),
        "pruned_result": _jsonable(getattr(page, "pruned_result", None)),
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    from paddleocr import PaddleOCRClient, PaddleOCRVLOptions

    token = os.environ.get(args.access_token_env, "")
    if not token:
        raise RuntimeError(
            f"{args.access_token_env} is not set; obtain an official PaddleOCR API access token"
        )
    base_url = os.environ.get(args.base_url_env) or None
    client = PaddleOCRClient(
        token=token,
        base_url=base_url,
        request_timeout=args.request_timeout,
        poll_timeout=args.poll_timeout,
    )
    options = PaddleOCRVLOptions(
        use_doc_orientation_classify=args.use_doc_orientation_classify,
        use_doc_unwarping=args.use_doc_unwarping,
        use_layout_detection=args.use_layout_detection,
        use_chart_recognition=args.use_chart_recognition,
        use_seal_recognition=args.use_seal_recognition,
        use_ocr_for_image_block=args.use_ocr_for_image_block,
        prettify_markdown=args.prettify_markdown,
    )
    documents: list[dict[str, Any]] = []
    page_count = 0
    try:
        for image_index, image in enumerate(args.image, 1):
            image_path = Path(image).resolve()
            if not image_path.is_file():
                raise FileNotFoundError(f"Input image not found: {image_path}")
            result = client.parse_document(
                model=args.model,
                file_path=str(image_path),
                options=options,
            )
            pages = [
                _page_payload(page, page_index)
                for page_index, page in enumerate(result.pages, 1)
            ]
            page_count += len(pages)
            documents.append(
                {
                    "image_index": image_index,
                    "job_id": result.job_id,
                    "data_info": _jsonable(result.data_info),
                    "pages": pages,
                }
            )
    finally:
        client.close()
    return {
        "status": "success",
        "provider": "paddle",
        "model": args.model,
        "package_version": importlib.metadata.version("paddleocr"),
        "task_hint": args.task_hint,
        "observation": {"documents": documents},
        "usage": {
            "input_tokens": None,
            "output_tokens": None,
            "image_tokens": None,
            "total_tokens": None,
            "measurement": "provider_api_does_not_expose_token_usage",
        },
        "api_metrics": {
            "provider": "PaddleOCR official API",
            "request_count": len(args.image),
            "page_count": page_count,
            "token_observability": "not_exposed_by_sdk_response",
            "marginal_api_cost_cny": None,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Duhai Vision PaddleOCR-VL official API extractor"
    )
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="PaddleOCR-VL-1.6")
    parser.add_argument(
        "--task-hint",
        default="general visual understanding: people, buildings, objects, scenes, text and spatial relationships",
        help="Task context recorded in the result; it is not sent as a free-form model prompt.",
    )
    parser.add_argument("--access-token-env", default="PADDLEOCR_ACCESS_TOKEN")
    parser.add_argument("--base-url-env", default="PADDLEOCR_BASE_URL")
    parser.add_argument("--request-timeout", type=float, default=300.0)
    parser.add_argument("--poll-timeout", type=float, default=600.0)
    parser.add_argument("--use-doc-orientation-classify", type=parse_bool, default=False)
    parser.add_argument("--use-doc-unwarping", type=parse_bool, default=False)
    parser.add_argument("--use-layout-detection", type=parse_bool, default=True)
    parser.add_argument("--use-chart-recognition", type=parse_bool, default=True)
    parser.add_argument("--use-seal-recognition", type=parse_bool, default=True)
    parser.add_argument("--use-ocr-for-image-block", type=parse_bool, default=True)
    parser.add_argument("--prettify-markdown", type=parse_bool, default=True)
    args = parser.parse_args()
    started = time.perf_counter()
    try:
        payload = run(args)
        payload["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
    except Exception as exc:
        payload = {
            "status": "error",
            "error": f"{type(exc).__name__}: {exc}",
            "latency_ms": round((time.perf_counter() - started) * 1000, 3),
        }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if payload["status"] != "success":
        print(payload["error"], file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "out": str(out_path),
                "provider": payload["provider"],
                "model": payload["model"],
                "page_count": payload["api_metrics"]["page_count"],
                "latency_ms": payload["latency_ms"],
                "token_observability": payload["api_metrics"][
                    "token_observability"
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

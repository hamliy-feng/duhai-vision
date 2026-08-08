from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path


def configured(*names: str) -> bool:
    return any(bool(os.environ.get(name)) for name in names)


home = Path.home()
agents_file = home / ".codex" / "AGENTS.md"
agents_text = agents_file.read_text(encoding="utf-8") if agents_file.exists() else ""
paddle_package = importlib.util.find_spec("paddleocr") is not None
node_path = shutil.which("node")
paddle_key = configured("PADDLEOCR_ACCESS_TOKEN")
qwen_key = configured("VLM_API_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY")
paddle_ready = paddle_package and paddle_key
qwen_ready = bool(node_path) and qwen_key
default_provider = os.environ.get("DUHAI_VISION_PROVIDER", "paddle")

payload = {
    "status": "ready" if paddle_ready or qwen_ready else "needs_configuration",
    "default_provider": default_provider,
    "default_provider_ready": paddle_ready if default_provider == "paddle" else qwen_ready,
    "python": sys.version.split()[0],
    "paddleocr_package": paddle_package,
    "paddle_access_token": paddle_key,
    "paddle_ready": paddle_ready,
    "qwen_api_key": qwen_key,
    "node": bool(node_path),
    "qwen_ready": qwen_ready,
    "global_rule": "<!-- BEGIN DUHAI VISION GLOBAL -->" in agents_text,
    "skill_installed": (home / ".agents" / "skills" / "duhai-vision" / "SKILL.md").exists(),
}

print(json.dumps(payload, ensure_ascii=False, indent=2))
raise SystemExit(0 if payload["status"] == "ready" else 1)

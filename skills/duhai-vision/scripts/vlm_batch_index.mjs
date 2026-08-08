import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = { json: true, delayMs: 900 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--index") out.index = argv[++i];
    else if (arg === "--prompt") out.prompt = argv[++i];
    else if (arg === "--prompt-file") out.promptFile = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--delay-ms") out.delayMs = Number(argv[++i]);
    else if (arg === "--text") out.json = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return `Usage:
  node vlm_batch_index.mjs --index <index.json> --prompt <text> --out <summary.json>

The index JSON may be an array or an object with an items/captures/results array.
Each item may contain path, image, screenshot, file, key, href, title, or other metadata.`;
}

function getConfig(args) {
  const apiKey = process.env.VLM_API_KEY || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("Set VLM_API_KEY, QWEN_API_KEY, or DASHSCOPE_API_KEY in the environment.");
  const requestedModel = args.model || process.env.VLM_MODEL || process.env.QWEN_MODEL || "qwen3-vl-plus";
  return {
    apiKey,
    requestedModel,
    model: normalizeModel(requestedModel),
    baseUrl: args.baseUrl || process.env.VLM_BASE_URL || process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  };
}

function normalizeModel(model) {
  const key = String(model || "").trim().toLowerCase();
  const aliases = new Map([
    ["qianwen3.6vlmplus", "qwen3-vl-plus"],
    ["qianwen3.6plus", "qwen3-vl-plus"],
    ["qianwen3.6-vlm-plus", "qwen3-vl-plus"],
    ["qwen3.6vlmplus", "qwen3-vl-plus"],
    ["qwen3.6-vlm-plus", "qwen3-vl-plus"],
    ["qwen3vlplus", "qwen3-vl-plus"],
    ["qianwen3vlplus", "qwen3-vl-plus"],
  ]);
  return aliases.get(key) || model;
}

function normalizeItems(index) {
  if (Array.isArray(index)) return index;
  for (const key of ["items", "captures", "results", "screenshots"]) {
    if (Array.isArray(index?.[key])) return index[key];
  }
  if (index && typeof index === "object" && imagePathOf(index)) return [index];
  throw new Error("Index must be an array or contain items/captures/results/screenshots.");
}

function imagePathOf(item) {
  return item.path || item.image || item.screenshot || item.file;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function parseJsonMaybe(content) {
  const cleaned = String(content || "").trim().replace(/^```json\s*|\s*```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callVlm({ item, imagePath, prompt, config, json }) {
  const bytes = await fs.readFile(imagePath);
  const body = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${prompt}\n\nItem metadata:\n${JSON.stringify(item, null, 2)}` },
          { type: "image_url", image_url: { url: `data:${mimeFor(imagePath)};base64,${bytes.toString("base64")}` } },
        ],
      },
    ],
    temperature: 0.1,
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      key: item.key || item.id || path.basename(imagePath),
      image: imagePath,
      error: { status: res.status, statusText: res.statusText, body: text.slice(0, 1000) },
    };
  }
  const response = JSON.parse(text);
  const content = response.choices?.[0]?.message?.content || "";
  return {
    key: item.key || item.id || path.basename(imagePath),
    image: imagePath,
    href: item.href || "",
    title: item.title || "",
    content,
    parsed: parseJsonMaybe(content),
    usage: response.usage || null,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.index) throw new Error("--index is required.");
if (!args.prompt && !args.promptFile) throw new Error("--prompt or --prompt-file is required.");
if (!args.out) throw new Error("--out is required.");

const indexPath = path.resolve(args.index);
const indexDir = path.dirname(indexPath);
const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
const items = normalizeItems(index);
const prompt = args.promptFile ? await fs.readFile(args.promptFile, "utf8") : args.prompt;
const config = getConfig(args);

const results = [];
for (const item of items) {
  const raw = imagePathOf(item);
  if (!raw) {
    results.push({ key: item.key || item.id || "", error: "No image path field found." });
    continue;
  }
  const imagePath = path.resolve(indexDir, raw);
  results.push(await callVlm({ item, imagePath, prompt, config, json: args.json }));
  await new Promise((resolve) => setTimeout(resolve, args.delayMs));
}

const out = {
  model: config.model,
  requested_model: config.requestedModel,
  generated_at: new Date().toISOString(),
  index: indexPath,
  count: results.length,
  results,
};
await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await fs.writeFile(args.out, JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ out: path.resolve(args.out), count: results.length }, null, 2));

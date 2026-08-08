import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = { images: [], json: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--image") out.images.push(argv[++i]);
    else if (arg === "--prompt") out.prompt = argv[++i];
    else if (arg === "--prompt-file") out.promptFile = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--text") out.json = false;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return `Usage:
  node vlm_extract.mjs --image <path> [--image <path> ...] --prompt <text> [--out <path>]
  node vlm_extract.mjs --image <path> --prompt-file <path> --text

Environment:
  VLM_API_KEY or QWEN_API_KEY or DASHSCOPE_API_KEY
  VLM_MODEL or QWEN_MODEL, default qwen3-vl-plus
  VLM_BASE_URL or QWEN_BASE_URL, default https://dashscope.aliyuncs.com/compatible-mode/v1`;
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

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function imagePart(filePath) {
  const bytes = await fs.readFile(filePath);
  return {
    type: "image_url",
    image_url: { url: `data:${mimeFor(filePath)};base64,${bytes.toString("base64")}` },
  };
}

function parseJsonMaybe(content) {
  const cleaned = String(content || "").trim().replace(/^```json\s*|\s*```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.images.length) throw new Error("At least one --image is required.");
if (!args.prompt && !args.promptFile) throw new Error("--prompt or --prompt-file is required.");

const prompt = args.promptFile ? await fs.readFile(args.promptFile, "utf8") : args.prompt;
const config = getConfig(args);
const content = [{ type: "text", text: prompt }];
for (const image of args.images) content.push(await imagePart(path.resolve(image)));

const body = {
  model: config.model,
  messages: [{ role: "user", content }],
  temperature: 0.1,
};
if (args.json) body.response_format = { type: "json_object" };

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
  console.error(JSON.stringify({ status: res.status, statusText: res.statusText, body: text.slice(0, 1200) }, null, 2));
  process.exit(1);
}

const response = JSON.parse(text);
const answer = response.choices?.[0]?.message?.content || "";
const result = {
  model: config.model,
  requested_model: config.requestedModel,
  images: args.images.map((p) => path.resolve(p)),
  content: answer,
  parsed: parseJsonMaybe(answer),
  usage: response.usage || null,
};

if (args.out) {
  await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(result, null, 2), "utf8");
}

console.log(args.out ? JSON.stringify({ out: path.resolve(args.out), usage: result.usage }, null, 2) : answer);

import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "duhai-vision";
export const inject = ["tools"];

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PADDLE_SCRIPT = path.join(
  PACKAGE_ROOT,
  "skills",
  "duhai-vision",
  "scripts",
  "paddle_extract.py",
);
const QWEN_SCRIPT = path.join(
  PACKAGE_ROOT,
  "skills",
  "duhai-vision",
  "scripts",
  "vlm_extract.mjs",
);

const QWEN_TASK_PATTERN =
  /(?:\bui\b|界面|截图|照片|摄影|商品|产品图|开放场景|场景理解|物体|计数|颜色|外观|布局建议|设计评审)/iu;

const TOOL_DESCRIPTION = [
  "Use Duhai Vision to inspect a local image before continuing reasoning.",
  "Before calling, briefly tell the user which route fits: PaddleOCR-VL for documents, OCR, tables, formulas, seals, archives and dense layouts; Qwen for UI, photos, products, counting and open visual semantics.",
  "Provider auto defaults to PaddleOCR-VL and switches to Qwen only when the question clearly matches general visual understanding.",
  "PaddleOCR-VL community service is page-metered and currently offers 3000 free pages per user per model each day; its SDK does not expose token usage.",
  "Use at most two Duhai Vision calls for one visual task unless the user explicitly asks for more.",
  "After the structured observation returns, continue analysis, verification and the final answer in DSH.",
].join(" ");

export function routeProvider(question, requested = "auto", defaultProvider = "paddle") {
  if (requested === "paddle" || requested === "qwen") return requested;
  if (QWEN_TASK_PATTERN.test(String(question || ""))) return "qwen";
  return defaultProvider === "qwen" ? "qwen" : "paddle";
}

function routeNotice(provider) {
  if (provider === "qwen") {
    return "通用视觉任务使用 Qwen；额度、并发和费用以 DashScope 控制台为准。结果返回后由 DSH 继续推理与验证。";
  }
  return "文档与 OCR 任务默认使用 PaddleOCR-VL；社区服务当前按每用户、每模型每天 3000 页计，SDK 不返回 Token usage。结果返回后由 DSH 继续推理与验证。";
}

function processError(command, args, code, stderr) {
  const rendered = [command, ...args].join(" ");
  const detail = String(stderr || "").trim();
  return new Error(
    `Duhai Vision provider process failed (${code}): ${rendered}${detail ? `\n${detail}` : ""}`,
  );
}

function runProcess(command, args, { signal, cwd = PACKAGE_ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason || new Error("Duhai Vision call aborted"));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(processError(command, args, code, stderr));
      }
    });
  });
}

async function resolveImage(image, cwd) {
  const resolved = path.resolve(cwd || process.cwd(), image);
  await access(resolved);
  return resolved;
}

function pythonCandidates(config = {}) {
  if (config.pythonCommand) return [{ command: config.pythonCommand, prefix: [] }];
  if (process.env.DUHAI_VISION_PYTHON) {
    return [{ command: process.env.DUHAI_VISION_PYTHON, prefix: [] }];
  }
  if (process.platform === "win32") {
    return [
      { command: "python", prefix: [] },
      { command: "py", prefix: ["-3"] },
    ];
  }
  return [
    { command: "python3", prefix: [] },
    { command: "python", prefix: [] },
  ];
}

async function runPaddle({ image, question, signal, config }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "duhai-vision-"));
  const output = path.join(tempDir, "paddle-result.json");
  const baseArgs = [
    PADDLE_SCRIPT,
    "--image",
    image,
    "--out",
    output,
    "--model",
    config.paddleModel || "PaddleOCR-VL-1.6",
    "--task-hint",
    question,
  ];
  let lastError;
  try {
    for (const candidate of pythonCandidates(config)) {
      try {
        await runProcess(candidate.command, [...candidate.prefix, ...baseArgs], { signal });
        const payload = JSON.parse(await readFile(output, "utf8"));
        return {
          ...payload,
          route: "paddle",
          route_notice: routeNotice("paddle"),
        };
      } catch (error) {
        lastError = error;
        if (error?.code !== "ENOENT") throw error;
      }
    }
    throw lastError || new Error("Python runtime not found");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runQwen({ image, question, signal, config }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "duhai-vision-"));
  const output = path.join(tempDir, "qwen-result.json");
  const prompt = [
    "You are the observation layer for Duhai Vision.",
    "Inspect the image and answer the user's visual question.",
    "Return JSON with observation, uncertain_items, and verification_notes.",
    `Question: ${question}`,
  ].join("\n");
  try {
    await runProcess(
      process.execPath,
      [
        QWEN_SCRIPT,
        "--image",
        image,
        "--prompt",
        prompt,
        "--model",
        config.qwenModel || "qwen3-vl-plus",
        "--out",
        output,
      ],
      { signal },
    );
    const payload = JSON.parse(await readFile(output, "utf8"));
    return {
      status: "success",
      provider: "qwen",
      model: payload.model || config.qwenModel || "qwen3-vl-plus",
      requested_model: payload.requested_model,
      route: "qwen",
      route_notice: routeNotice("qwen"),
      observation: payload.parsed || payload.content,
      usage: payload.usage || null,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function executeVision(args, exec = {}, config = {}) {
  if (!args || typeof args !== "object") {
    throw new TypeError("duhai_vision arguments must be an object");
  }
  if (typeof args.image !== "string" || args.image.trim() === "") {
    throw new TypeError("duhai_vision.image must be a non-empty string");
  }
  if (typeof args.question !== "string" || args.question.trim() === "") {
    throw new TypeError("duhai_vision.question must be a non-empty string");
  }
  if (
    args.provider !== undefined &&
    !["auto", "paddle", "qwen"].includes(args.provider)
  ) {
    throw new TypeError("duhai_vision.provider must be auto, paddle, or qwen");
  }
  const cwd = exec.agent?.cwd || process.cwd();
  const image = await resolveImage(args.image, cwd);
  const provider = routeProvider(
    args.question,
    args.provider || "auto",
    config.defaultProvider || "paddle",
  );
  const request = {
    image,
    question: args.question,
    signal: exec.signal,
    config,
  };
  return provider === "qwen" ? runQwen(request) : runPaddle(request);
}

export function apply(ctx, config = {}) {
  ctx.tools.register({
    name: "duhai_vision",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        image: {
          type: "string",
          description: "Local image path, absolute or relative to the active workspace.",
        },
        question: {
          type: "string",
          description: "The concrete visual question or extraction instruction.",
        },
        provider: {
          type: "string",
          enum: ["auto", "paddle", "qwen"],
          description: "auto uses Paddle by default and selects Qwen for general visual scenes.",
        },
      },
      required: ["image", "question"],
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [
        {
          type: "text",
          text: JSON.stringify(value, null, 2),
        },
      ],
    },
    timeoutMs: 660_000,
    async execute(args, exec) {
      return executeVision(args, exec, config);
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Duhai Vision · ${args.provider || "auto"}`,
      kind: "read",
      rawInput: args,
    }),
  });
}

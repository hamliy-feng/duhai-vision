import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "duhai-vision";
export const inject = ["tools", "llm", "attachments"];

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
const ADAPTER_PROVIDER = "duhai-vision";
const DEFAULT_TARGET_PROVIDER = "deepseek-official";
const DEFAULT_TARGET_MODEL = "deepseek-v4-flash";
const MEDIA_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const TOOL_DESCRIPTION = [
  "Use Duhai Vision to inspect a local image before continuing reasoning.",
  "Before calling, briefly tell the user that PaddleOCR-VL is the default first route and disclose its quota and token-observability boundary.",
  "Provider auto always resolves to PaddleOCR-VL, including UI, photos, products, charts, counting and open visual semantics. Use Qwen only when explicitly requested or as a disclosed fallback after Paddle is unavailable.",
  "PaddleOCR-VL community service is page-metered and currently offers 3000 free pages per user per model each day; its SDK does not expose token usage.",
  "Use at most two Duhai Vision calls for one visual task unless the user explicitly asks for more.",
  "After the structured observation returns, continue analysis, verification and the final answer in DSH.",
].join(" ");

export function routeProvider(question, requested = "auto", _defaultProvider = "paddle") {
  if (requested === "paddle" || requested === "qwen") return requested;
  return "paddle";
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

function dshVisionDirectory(config = {}) {
  return path.resolve(
    config.attachmentDirectory ||
      process.env.DUHAI_VISION_ATTACHMENT_DIR ||
      path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "duhai-vision", "attachments"),
  );
}

function attachmentDigest(ref) {
  const value = String(ref?.attachmentId || "");
  const match = /^sha256:([a-f0-9]{64})$/i.exec(value);
  if (!match) throw new Error(`Unsupported DSH attachment id: ${value}`);
  return match[1].toLowerCase();
}

async function stageAttachment(ctx, ref, config, signal) {
  const stored = await ctx.attachments.readImage(ref, signal);
  const directory = dshVisionDirectory(config);
  const digest = attachmentDigest(stored.ref);
  const extension = MEDIA_EXTENSIONS[stored.ref.mediaType] || ".img";
  const imagePath = path.join(directory, `${digest}${extension}`);
  await mkdir(directory, { recursive: true });
  try {
    await access(imagePath);
  } catch {
    await writeFile(imagePath, stored.data, { flag: "wx" });
  }
  return imagePath;
}

function userQuestion(message) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim() || "完整识别图片中的文字、结构、数值、对象、布局与不确定内容。";
}

async function replaceMessageImages(ctx, message, config, cache, signal) {
  if (!Array.isArray(message.content) || !message.content.some((block) => block.type === "image")) {
    return message;
  }
  const question = userQuestion(message);
  const content = [];
  for (const block of message.content) {
    if (block.type !== "image") {
      content.push(block);
      continue;
    }
    const key = `${block.attachment.attachmentId}\n${question}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const imagePath = await stageAttachment(ctx, block.attachment, config, signal);
        const result = await runPaddle({ image: imagePath, question, signal, config });
        return { imagePath, result };
      })();
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    const { imagePath, result } = await pending;
    content.push({
      type: "text",
      text: [
        "<duhai-vision-observation>",
        `图片路径: ${imagePath}`,
        `视觉提供方: ${result.provider || "paddle"}`,
        `视觉模型: ${result.model || config.paddleModel || "PaddleOCR-VL-1.6"}`,
        JSON.stringify(result, null, 2),
        "</duhai-vision-observation>",
      ].join("\n"),
    });
  }
  return { ...message, content };
}

function createDuhaiAdapter(ctx, config) {
  const cache = new Map();
  const targetProvider = config.targetProvider || DEFAULT_TARGET_PROVIDER;
  const targetModel = config.targetModel || DEFAULT_TARGET_MODEL;
  return {
    providerInfo(provider) {
      return { id: provider, name: "Duhai Vision" };
    },
    providerRetryPolicy() {
      return undefined;
    },
    async listModels() {
      return [{
        provider: ADAPTER_PROVIDER,
        id: targetModel,
        name: `Duhai Vision · ${targetModel}`,
        description: "PaddleOCR-VL visual adapter with DeepSeek reasoning",
        inputModalities: ["text", "image"],
      }];
    },
    async resolveModel(provider, model, signal) {
      const target = await ctx.llm.resolveModelInfo(targetProvider, targetModel, signal);
      return {
        ...target,
        provider,
        id: model,
        name: `Duhai Vision · ${target.name || targetModel}`,
        description: "PaddleOCR-VL visual adapter with DeepSeek reasoning",
        inputModalities: ["text", "image"],
      };
    },
    async *stream(options) {
      const messages = [];
      for (const message of options.messages) {
        messages.push(await replaceMessageImages(ctx, message, config, cache, options.signal));
      }
      yield* ctx.llm.stream({
        ...options,
        provider: targetProvider,
        model: targetModel,
        messages,
      });
    },
  };
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
          description: "auto always uses PaddleOCR-VL first; qwen requires an explicit override.",
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
  ctx.llm.registerAdapter([ADAPTER_PROVIDER], createDuhaiAdapter(ctx, config));
}

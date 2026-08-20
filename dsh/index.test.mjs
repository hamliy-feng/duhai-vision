import assert from "node:assert/strict";
import test from "node:test";

import { apply, executeVision, routeProvider } from "./index.js";

test("auto route keeps Paddle as the default", () => {
  assert.equal(routeProvider("识别这份侨批中的表格、印章和日期"), "paddle");
  assert.equal(routeProvider("Extract the text from this document"), "paddle");
});

test("auto route selects Qwen for general visual understanding", () => {
  assert.equal(routeProvider("分析这个 UI 截图的布局问题"), "qwen");
  assert.equal(routeProvider("数一下照片中有多少件商品"), "qwen");
});

test("explicit provider overrides routing", () => {
  assert.equal(routeProvider("UI screenshot", "paddle"), "paddle");
  assert.equal(routeProvider("OCR document", "qwen"), "qwen");
});

test("plugin registers the duhai_vision tool", () => {
  let definition;
  const ctx = {
    tools: {
      register(value) {
        definition = value;
        return () => {};
      },
    },
  };
  apply(ctx, { defaultProvider: "paddle" });
  assert.equal(definition.name, "duhai_vision");
  assert.deepEqual(definition.parameters.required, ["image", "question"]);
  assert.deepEqual(definition.parameters.properties.provider.enum, [
    "auto",
    "paddle",
    "qwen",
  ]);
});

test("tool rejects empty visual requests before provider execution", async () => {
  await assert.rejects(
    executeVision({ image: "", question: "OCR" }),
    /image must be a non-empty string/,
  );
  await assert.rejects(
    executeVision({ image: "missing.png", question: "" }),
    /question must be a non-empty string/,
  );
});

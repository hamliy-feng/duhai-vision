import assert from "node:assert/strict";
import test from "node:test";

import { apply, executeVision, routeProvider } from "./index.js";

test("auto route keeps Paddle as the default", () => {
  assert.equal(routeProvider("识别这份侨批中的表格、印章和日期"), "paddle");
  assert.equal(routeProvider("Extract the text from this document"), "paddle");
  assert.equal(routeProvider("Any image", "auto", "qwen"), "paddle");
});

test("auto route keeps Paddle for general visual understanding", () => {
  assert.equal(routeProvider("分析这个 UI 截图的布局问题"), "paddle");
  assert.equal(routeProvider("数一下照片中有多少件商品"), "paddle");
  assert.equal(routeProvider("这是什么建筑，属于什么风格"), "paddle");
  assert.equal(routeProvider("描述人物的动作、衣着和周围环境"), "paddle");
  assert.equal(routeProvider("What is happening in this street scene?"), "paddle");
});

test("explicit provider overrides routing", () => {
  assert.equal(routeProvider("UI screenshot", "paddle"), "paddle");
  assert.equal(routeProvider("OCR document", "qwen"), "qwen");
});

test("plugin registers the duhai_vision tool", () => {
  let definition;
  let adapterRoute;
  const ctx = {
    tools: {
      register(value) {
        definition = value;
        return () => {};
      },
    },
    llm: {
      registerAdapter(routes) {
        adapterRoute = routes;
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
  assert.deepEqual(adapterRoute, ["duhai-vision"]);
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

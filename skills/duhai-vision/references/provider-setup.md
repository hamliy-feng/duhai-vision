# Provider Setup

## PaddleOCR-VL（默认）

1. 注册或登录 [百度 AI Studio](https://aistudio.baidu.com/)。
2. 打开 [AI Studio Access Token 页面](https://aistudio.baidu.com/account/accessToken)，创建或复制 Access Token。
3. 也可从 [PaddleOCR API 任务页](https://aistudio.baidu.com/paddleocr/task)的调用示例进入 Token 页面。
4. 将它配置为用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable(
  "PADDLEOCR_ACCESS_TOKEN",
  "<你的 Access Token>",
  "User"
)
```

5. 重启 Codex，再运行：

```powershell
python "$HOME\.agents\skills\duhai-vision\scripts\doctor.py"
```

当前公开社区限制为每用户、每模型每天 3000 页；建议单文件不超过 100 页，超过时只处理前 100 页。遇到 `429` 时应停止批量提交并提示额度已耗尽。始终以[官方调用限制](https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam)为准。

PaddleOCR 官方 API SDK 返回页数、任务信息和解析结果，但当前响应不暴露 Token usage。记录为 `not_exposed`，不要写成 0。免费额度只表示当期计费可能为 0。

## Qwen3-VL-Plus（可选）

1. 在阿里云百炼控制台创建 DashScope API Key。
2. 配置任一环境变量，推荐 `VLM_API_KEY`：

```powershell
[Environment]::SetEnvironmentVariable("VLM_API_KEY", "<你的 API Key>", "User")
```

3. 默认模型与端点：

```text
VLM_MODEL=qwen3-vl-plus
VLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

额度、并发和价格随账户与官方策略变化，技能只能报告 API 返回的 usage，不能把它冒充账单。

## Security

- 不要把 Token 或 API Key 写入 `SKILL.md`、README、配置样例、输出 JSON 或 Git。
- 不要在命令历史中长期保留真实密钥；优先使用安装器或系统环境变量界面。
- 如果密钥曾出现在聊天、截图、日志或仓库中，立即在提供方控制台撤销并重新生成。

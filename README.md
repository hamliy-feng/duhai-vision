<div align="center">
  <h1>👁️ Duhai Vision</h1>
  <p><strong>给 Codex 换一双免费、可替换且不影响视觉质量的眼睛。</strong></p>
  <p>用 PaddleOCR-VL 或 Qwen 替换 Codex 内置视觉输入；Codex 继续负责推理、编排、验证和最终回答。</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-111111.svg" alt="License: MIT"></a>
    <a href="skills/duhai-vision/SKILL.md"><img src="https://img.shields.io/badge/Codex-Skill-087f6b.svg" alt="Codex Skill"></a>
    <a href="https://aistudio.baidu.com/paddleocr/task"><img src="https://img.shields.io/badge/Default-PaddleOCR--VL-087f6b.svg" alt="Default: PaddleOCR-VL"></a>
  </p>
  <p>
    <a href="#测试结果">测试结果</a> ·
    <a href="#快速安装">快速安装</a> ·
    <a href="#路线选择">路线选择</a> ·
    <a href="#使用方式">使用方式</a> ·
    <a href="#卸载">卸载</a> ·
    <a href="#安全">安全</a>
  </p>
  <p>Duhai Vision 是一个 Codex 全局视觉替代技能。图片先交给外部视觉服务提取结构化观察，Codex 再基于文本结果完成判断。默认走 PaddleOCR-VL；UI、照片和通用视觉语义更适合 Qwen 时，技能会先说明原因再切换。</p>
</div>

## 测试结果

<p align="center">
  <strong>Test1 · 侨批</strong>
</p>
<p align="center">
  <a href="assets/experiment-results.png">
    <img src="assets/experiment-results.png" alt="Test1：Duhai Vision 与 Codex Native 侨批实验结果" width="720">
  </a>
</p>
<p align="center"><sub>点击图片查看完整原图</sub></p>

<br>

<p align="center">
  <strong>Test2 · 复杂报刊</strong>
</p>
<p align="center">
  <a href="assets/test2-results.png">
    <img src="assets/test2-results.png" alt="Test2：Duhai Vision 与 Codex Native 复杂报刊实验结果" width="720">
  </a>
</p>
<p align="center"><sub>点击图片查看完整原图</sub></p>

每组测试中的三条路线采用相同 Prompt 与 Schema，结果仅用于工程路线比较，不宣称统计学结论。截图中的 `0 · 免费额度` 是实验窗口的计费展示，不代表 Paddle API 实际计算量或 Token usage 为 0；Codex Native 数值是图片输入增量代理，不是官方 `image_tokens`。

## 为什么需要 Duhai Vision

Codex 能看图，但在批量 OCR、长文档和可重复实验里，常见问题是：不知道该用哪条视觉路线、额度边界没有提前说明、Token 口径混在一起、失败后悄悄换路。Duhai Vision 把这些决策固化成一个全局能力层：

- **全局替换**：安装后，Codex 遇到截图、图表、文档、OCR 或图片任务时优先调用 Duhai Vision。
- **先说明再调用**：每个任务先简要说明任务类型、推荐路线、限额与 Token 可观测性。
- **Paddle 默认**：适合古籍、侨批、表格、公式、印章、版面和长文档。
- **Qwen 后备**：适合 UI、照片、商品、细粒度语义和开放式视觉理解。
- **可审计**：保留提供方、模型、耗时、页数和可获得的 Token 数据，不把未知值写成 0。
- **有边界的回退**：外部路线不可用或用户明确指定时，才使用 Codex Native，并说明原因。

## 快速安装

也可以直接把这句话交给 Codex：

```text
请安装并全局启用 Duhai Vision：
https://github.com/hamliy-feng/duhai-vision
按仓库 README 完成 Paddle Access Token、依赖和 doctor 检查。
```

### 1. 获取 Paddle Access Token

1. 注册或登录 [百度 AI Studio](https://aistudio.baidu.com/)。
2. 打开 [AI Studio Access Token 页面](https://aistudio.baidu.com/account/accessToken)，创建或复制 Access Token；也可从 [PaddleOCR 官方 API 任务页](https://aistudio.baidu.com/paddleocr/task)的调用示例进入。
3. 该值在本技能中保存为环境变量 `PADDLEOCR_ACCESS_TOKEN`，不要写入仓库或提示词。

### 2. 命令行下载

使用 GitHub CLI：

```powershell
gh repo clone hamliy-feng/duhai-vision
cd duhai-vision
```

或使用 Git：

```powershell
git clone https://github.com/hamliy-feng/duhai-vision.git
cd duhai-vision
```

不使用 Git 时也可下载源码压缩包：

```powershell
curl.exe -L https://github.com/hamliy-feng/duhai-vision/archive/refs/heads/main.zip `
  -o duhai-vision.zip
Expand-Archive .\duhai-vision.zip -DestinationPath .
cd .\duhai-vision-main
```

### 在你使用前，先知道这些

| 项目 | 默认行为 |
|---|---|
| 默认路线 | PaddleOCR-VL 1.6，优先处理文档、OCR、表格、公式、印章与版面 |
| 通用视觉 | 配置 Qwen 后，UI、照片、商品、计数和开放式语义可切换到 Qwen3-VL-Plus |
| 全局范围 | 技能安装到 `~/.agents/skills`，路由规则写入 `~/.codex/AGENTS.md`，重启 Codex 后生效 |
| 调用预算 | 每个视觉任务默认最多 2 次外部调用：一次主提取，一次重试、裁剪或定向验证 |
| 隐私 | 远程提供方会收到图片；敏感材料应先脱敏，或不要走远程路线 |
| 诊断 | `doctor.py` 会检查默认路线、依赖、Key、Node、全局规则与技能安装状态 |

### 3. 先检查，再显式安装

```powershell
# 默认只读检查：不会安装依赖、复制 Skill、写全局规则或保存 Key
powershell -ExecutionPolicy Bypass -File .\install.ps1

# 确认后再安装 Skill、依赖并启用 Codex 全局视觉替换
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -Apply `
  -InstallDependencies
```

如果尚未配置 Token，安装器会打开指引并以隐藏输入方式询问，不会把 Token 留在命令历史中。自动化环境可预先设置 `PADDLEOCR_ACCESS_TOKEN`，并加 `-NoCredentialPrompt`。

重启 Codex 后生效。安装器会：

1. 将技能安装到 `~/.agents/skills/duhai-vision`。
2. 将 Paddle 设为默认视觉提供方。
3. 向 `~/.codex/AGENTS.md` 写入可重复更新的全局视觉替换规则。
4. 只把 Token 写入当前用户的环境变量，不写入项目文件。

已经安装依赖时，可去掉 `-InstallDependencies`。检查配置：

```powershell
python .\skills\duhai-vision\scripts\doctor.py
```

### 安装方式

| 方式 | 命令 | 适合场景 |
|---|---|---|
| 默认安全检查 | `powershell -File .\install.ps1` | 所有环境；只读检查并列出 Skill、规则、运行时与 Key 状态 |
| 显式安装 | `powershell -File .\install.ps1 -Apply` | 已有 `paddleocr` 依赖，只安装 Skill 与全局规则 |
| 显式安装依赖 | `powershell -File .\install.ps1 -Apply -InstallDependencies` | 明确允许通过 pip 安装或更新依赖 |
| 兼容安全参数 | `powershell -File .\install.ps1 -Safe` | 与默认只读检查相同 |
| 仅预览 | `powershell -File .\install.ps1 -Apply -InstallDependencies -DryRun` | 预览目标路径、依赖与环境配置，不做任何写入 |

自动化环境可预先设置 `PADDLEOCR_ACCESS_TOKEN`，并使用 `-Apply -NoCredentialPrompt`。当前一键全局安装器面向 Windows PowerShell；Skill 内的 Python 和 Node 执行器可独立复用。

## 路线选择

| 路线 | 适合任务 | 默认行为 | 使用提示 |
|---|---|---|---|
| PaddleOCR-VL 1.6 | 文档 OCR、古籍、侨批、表格、公式、印章、版面 | 默认 | AI Studio 社区服务当前按模型提供每日页数额度；SDK 响应不暴露 Token usage |
| Qwen3-VL-Plus | UI、照片、商品、图表、计数、开放式语义 | 明显更适合时切换 | 需要 DashScope API Key；额度与费用以百炼控制台为准 |
| Codex Native | 外部路线均不可用，或用户明确指定 | 仅回退 | 使用时必须说明已发生回退及原因 |

Paddle 官方当前公开限制包括：每用户、每模型每天 3000 页，建议单文件不超过 100 页，超出部分只处理前 100 页。规则可能调整，使用前以[官方调用限制](https://ai.baidu.com/ai-doc/AISTUDIO/Xmjclapam)为准。

## 可选：配置 Qwen

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -Apply `
  -ConfigureQwen
```

安装器会以隐藏输入方式询问 DashScope API Key，默认提供方仍保持 Paddle。Duhai Vision 会在 UI、照片和通用视觉任务中推荐 Qwen，也可显式设置：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Apply -Provider qwen
```

## 使用方式

安装完成后，像平常一样把图片交给 Codex：

```text
请转录这页侨批，保留繁体字、印章、不可读位置和推断依据。
```

技能应先给出类似提示：

```text
任务属于文档 OCR 与版面提取，默认使用 PaddleOCR-VL；当前社区额度按页计，
SDK 不返回 Token usage。本次结果将由 Codex 继续结构化并标记不确定项。
```

需要手动调用时：

```powershell
python .\skills\duhai-vision\scripts\paddle_extract.py `
  --image "D:\资料\page-001.jpg" `
  --out ".agent_index\page-001.json"
```

## 设计理念

Duhai Vision 是视觉观察层，不是最终真相，也不是另一个聊天机器人：

```text
图片 / PDF / 截图
        ↓
PaddleOCR-VL（默认）或 Qwen（通用视觉）
        ↓
结构化观察 + 不确定项 + 可观测 usage
        ↓
Codex 验证、推理并完成最终回答
```

路由选择、额度披露、调用上限和回退条件写在 Skill 与全局规则里。模型输出只作为观察；重要数字、姓名、日期、表格关系和警告仍应交叉验证。

## 仓库结构

```text
duhai-vision/
├─ README.md
├─ install.ps1
├─ uninstall.ps1
├─ assets/
│  ├─ experiment-results.png
│  └─ test2-results.png
└─ skills/duhai-vision/
   ├─ SKILL.md
   ├─ agents/openai.yaml
   ├─ references/provider-setup.md
   └─ scripts/
```

## 安全

- 所有凭据只从环境变量读取。
- `.env`、输出目录和本地索引默认不进入 Git。
- 远程视觉服务会接收图片内容；涉及身份证件、地址、电话或未公开档案时，先脱敏或改用本地方案。

## 卸载

先预览，不做任何删除：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -DryRun
```

移除已安装 Skill 和 Duhai Vision 受管全局规则，默认保留提供方 Key：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

# 与默认行为相同：明确保留 Key，便于之后重装
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepConfig
```

只有确定这些环境变量没有被其他工具共用时，才同时删除安装器管理的配置：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveCredentials
```

卸载器不会删除仓库目录，也不会自动卸载可能被其他项目共用的 `paddleocr` 包。如果确认不再使用，可另行执行：

```powershell
python -m pip uninstall paddleocr
```

## ⭐ 为什么值得 Star

这个技能来自真实的 Duhai Vision / Codex Native 对照实验，也会继续用于日常视觉工作流。

- PaddleOCR、Qwen、Codex 或官方额度发生变化时，会持续更新路由和说明。
- 新的文档、UI、图表和批量图片场景会逐步补充到技能与验证流程。
- 路线失效、额度变化或解析问题都欢迎直接提交 Issue。

Star 一下，下次需要给 Codex 更换视觉路线时能直接找到。⭐

## License

[MIT](LICENSE)

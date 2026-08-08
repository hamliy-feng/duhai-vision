[CmdletBinding()]
param(
    [string]$PaddleAccessToken = "",
    [string]$QwenApiKey = "",
    [ValidateSet("paddle", "qwen")]
    [string]$Provider = "paddle",
    [switch]$InstallDependencies,
    [switch]$SkipEnvironment,
    [switch]$NoCredentialPrompt,
    [switch]$ConfigureQwen,
    [string]$Python = "python",
    [string]$TargetHome = $HOME
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceSkill = Join-Path $repoRoot "skills\duhai-vision"
$targetHomePath = [System.IO.Path]::GetFullPath($TargetHome)
$agentsRoot = Join-Path $targetHomePath ".agents\skills"
$targetSkill = Join-Path $agentsRoot "duhai-vision"
$codexRoot = Join-Path $targetHomePath ".codex"
$agentsFile = Join-Path $codexRoot "AGENTS.md"

if (-not (Test-Path -LiteralPath (Join-Path $sourceSkill "SKILL.md"))) {
    throw "Skill source not found: $sourceSkill"
}

New-Item -ItemType Directory -Force -Path $targetSkill, $codexRoot | Out-Null
Copy-Item -Path (Join-Path $sourceSkill "*") -Destination $targetSkill -Recurse -Force

if ($InstallDependencies) {
    & $Python -m pip install -r (Join-Path $repoRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}

$isRealHome = $targetHomePath.TrimEnd('\', '/') -eq ([System.IO.Path]::GetFullPath($HOME)).TrimEnd('\', '/')
if (-not $SkipEnvironment) {
    if (-not $isRealHome) {
        throw "Persistent environment variables may only be written when TargetHome is the current user home. Use -SkipEnvironment for installation tests."
    }
    $existingPaddleToken = [Environment]::GetEnvironmentVariable("PADDLEOCR_ACCESS_TOKEN", "User")
    if (-not $existingPaddleToken) { $existingPaddleToken = $env:PADDLEOCR_ACCESS_TOKEN }
    $existingQwenKey = [Environment]::GetEnvironmentVariable("VLM_API_KEY", "User")
    if (-not $existingQwenKey) { $existingQwenKey = [Environment]::GetEnvironmentVariable("QWEN_API_KEY", "User") }
    if (-not $existingQwenKey) { $existingQwenKey = [Environment]::GetEnvironmentVariable("DASHSCOPE_API_KEY", "User") }
    if (-not $existingQwenKey) { $existingQwenKey = $env:VLM_API_KEY }
    if (-not $existingQwenKey) { $existingQwenKey = $env:QWEN_API_KEY }
    if (-not $existingQwenKey) { $existingQwenKey = $env:DASHSCOPE_API_KEY }
    if (-not $PaddleAccessToken) { $PaddleAccessToken = $existingPaddleToken }
    if (-not $QwenApiKey) { $QwenApiKey = $existingQwenKey }
    if (-not $PaddleAccessToken -and $Provider -eq "paddle" -and -not $NoCredentialPrompt) {
        Write-Host "Open https://aistudio.baidu.com/account/accessToken to create or copy your PaddleOCR access token."
        $secureToken = Read-Host "PaddleOCR Access Token (input is hidden)" -AsSecureString
        $PaddleAccessToken = [System.Net.NetworkCredential]::new("", $secureToken).Password
        Remove-Variable secureToken -ErrorAction SilentlyContinue
    }
    if (-not $QwenApiKey -and ($Provider -eq "qwen" -or $ConfigureQwen) -and -not $NoCredentialPrompt) {
        Write-Host "Create a DashScope API key in the Alibaba Cloud Model Studio console."
        $secureKey = Read-Host "DashScope API Key (input is hidden)" -AsSecureString
        $QwenApiKey = [System.Net.NetworkCredential]::new("", $secureKey).Password
        Remove-Variable secureKey -ErrorAction SilentlyContinue
    }
    [Environment]::SetEnvironmentVariable("DUHAI_VISION_PROVIDER", $Provider, "User")
    $env:DUHAI_VISION_PROVIDER = $Provider
    if ($PaddleAccessToken) {
        [Environment]::SetEnvironmentVariable("PADDLEOCR_ACCESS_TOKEN", $PaddleAccessToken, "User")
        $env:PADDLEOCR_ACCESS_TOKEN = $PaddleAccessToken
    }
    if ($QwenApiKey) {
        [Environment]::SetEnvironmentVariable("VLM_API_KEY", $QwenApiKey, "User")
        $env:VLM_API_KEY = $QwenApiKey
    }
}

$beginMarker = "<!-- BEGIN DUHAI VISION GLOBAL -->"
$endMarker = "<!-- END DUHAI VISION GLOBAL -->"
$managedBlock = @'
$beginMarker
## Duhai Vision Global Replacement

- For every image, screenshot, PDF page, chart, table, UI capture, OCR, photo, or other visual-understanding task, use the `duhai-vision` skill before Codex built-in vision.
- Before the first visual call in a task, briefly state the task type, selected provider, why it fits, the relevant quota, and whether provider Token usage is observable.
- Default to PaddleOCR-VL for documents, OCR, historical material, tables, formulas, seals, and layout extraction. The current AI Studio community limit is 3000 pages per user per model per day and at most the first 100 pages of one file; tell the user that limits can change.
- Prefer Qwen3-VL-Plus for UI, photos, products, charts, counting, fine-grained semantics, and open-ended visual understanding when it is configured and clearly better suited.
- Keep Codex as the reasoning and orchestration layer. Treat external visual output as observations, preserve uncertainty, and verify high-impact claims when another source exists.
- Use Codex built-in vision only when external providers fail, are unavailable, privacy requires another route, or the user explicitly asks for native vision. State the fallback and reason.
- Read credentials from environment variables only. Never put API keys or access tokens in files, prompts, logs, or repository content.
$endMarker
'@
$managedBlock = $managedBlock.Replace('$beginMarker', $beginMarker).Replace('$endMarker', $endMarker)

$content = if (Test-Path -LiteralPath $agentsFile) {
    Get-Content -Raw -LiteralPath $agentsFile
} else {
    ""
}

$escapedBegin = [regex]::Escape($beginMarker)
$escapedEnd = [regex]::Escape($endMarker)
$content = [regex]::Replace($content, "(?ms)$escapedBegin.*?$escapedEnd\s*", "")
$legacyPattern = "(?ms)^## Global Visual Understanding Default\s*\r?\n.*?(?=^## |\z)"
$content = [regex]::Replace($content, $legacyPattern, {
    param($match)
    if ($match.Value -match "(?i)duhai[ -]vision|duhai-vision") { return "" }
    return $match.Value
})
$content = $content.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $managedBlock.Trim() + [Environment]::NewLine
Set-Content -LiteralPath $agentsFile -Value $content -Encoding utf8

Write-Host "Duhai Vision installed: $targetSkill"
Write-Host "Global Codex rule updated: $agentsFile"
Write-Host "Default provider: $Provider"
if (-not $PaddleAccessToken -and -not [Environment]::GetEnvironmentVariable("PADDLEOCR_ACCESS_TOKEN", "User")) {
    Write-Warning "PADDLEOCR_ACCESS_TOKEN is not configured. See https://aistudio.baidu.com/paddleocr/task"
}
if ($PaddleAccessToken) { $PaddleAccessToken = $null }
if ($QwenApiKey) { $QwenApiKey = $null }
Write-Host "Restart Codex so the skill and user environment are reloaded."

<#
.SYNOPSIS
Checks or installs Duhai Vision as a global Codex visual replacement.

.DESCRIPTION
The default mode is read-only. Use -Apply to copy the skill and update the
managed global rule. Use -DryRun to preview an apply operation without writes.

.EXAMPLE
powershell -File .\install.ps1

.EXAMPLE
powershell -File .\install.ps1 -Apply -InstallDependencies

.EXAMPLE
powershell -File .\install.ps1 -Apply -InstallDependencies -DryRun
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [Alias("Safe")]
    [switch]$Check,
    [switch]$DryRun,
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
$beginMarker = "<!-- BEGIN DUHAI VISION GLOBAL -->"
$endMarker = "<!-- END DUHAI VISION GLOBAL -->"

function Get-ConfiguredValue {
    param([string[]]$Names)
    foreach ($name in $Names) {
        $value = [Environment]::GetEnvironmentVariable($name, "User")
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Process") }
        if ($value) { return $value }
    }
    return ""
}

function Test-PythonPackage {
    param([string]$Command, [string]$Package)
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { return $false }
    $result = & $Command -c "import importlib.util; print('yes' if importlib.util.find_spec('$Package') else 'no')" 2>$null
    return $LASTEXITCODE -eq 0 -and (($result | Out-String).Trim() -eq "yes")
}

function Get-CheckState {
    $paddleKey = [bool](Get-ConfiguredValue @("PADDLEOCR_ACCESS_TOKEN"))
    $qwenKey = [bool](Get-ConfiguredValue @("VLM_API_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY"))
    $pythonAvailable = [bool](Get-Command $Python -ErrorAction SilentlyContinue)
    $paddlePackage = if ($pythonAvailable) { Test-PythonPackage $Python "paddleocr" } else { $false }
    $nodeAvailable = [bool](Get-Command "node" -ErrorAction SilentlyContinue)
    $agentsText = if (Test-Path -LiteralPath $agentsFile) { Get-Content -Raw -LiteralPath $agentsFile } else { "" }
    $skillInstalled = Test-Path -LiteralPath (Join-Path $targetSkill "SKILL.md")
    $globalRule = $agentsText.Contains($beginMarker)
    $paddleReady = $paddleKey -and $paddlePackage
    $qwenReady = $qwenKey -and $nodeAvailable
    $defaultReady = if ($Provider -eq "paddle") { $paddleReady } else { $qwenReady }
    $status = if (-not $skillInstalled -or -not $globalRule) {
        "needs_install_or_configuration"
    } elseif ($defaultReady) {
        "ready"
    } elseif ($paddleReady -or $qwenReady) {
        "ready_with_fallback"
    } else {
        "needs_install_or_configuration"
    }
    return [ordered]@{
        status = $status
        mode = "read_only_check"
        target_home = $targetHomePath
        selected_provider = $Provider
        skill_installed = $skillInstalled
        global_rule = $globalRule
        python = $pythonAvailable
        paddleocr_package = $paddlePackage
        paddle_access_token = $paddleKey
        paddle_ready = $paddleReady
        node = $nodeAvailable
        qwen_api_key = $qwenKey
        qwen_ready = $qwenReady
        writes_performed = $false
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceSkill "SKILL.md"))) {
    throw "Skill source not found: $sourceSkill"
}
if ($Apply -and $Check) {
    throw "Choose either -Apply or -Check/-Safe, not both."
}
if (-not $Apply -and -not $DryRun -and ($InstallDependencies -or $ConfigureQwen -or $PaddleAccessToken -or $QwenApiKey)) {
    throw "This command is in read-only mode. Add -Apply to install or configure Duhai Vision."
}

$existingPaddleToken = Get-ConfiguredValue @("PADDLEOCR_ACCESS_TOKEN")
$existingQwenKey = Get-ConfiguredValue @("VLM_API_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY")
$plan = [ordered]@{
    mode = if ($DryRun) { "dry_run" } elseif ($Apply) { "apply" } else { "read_only_check" }
    target_skill = $targetSkill
    global_agents_file = $agentsFile
    install_dependencies = [bool]$InstallDependencies
    python = $Python
    selected_provider = $Provider
    persist_environment = -not [bool]$SkipEnvironment
    paddle_token_already_configured = [bool]($PaddleAccessToken -or $existingPaddleToken)
    qwen_key_already_configured = [bool]($QwenApiKey -or $existingQwenKey)
    would_prompt_for_paddle_token = [bool](-not $SkipEnvironment -and -not $NoCredentialPrompt -and -not ($PaddleAccessToken -or $existingPaddleToken) -and $Provider -eq "paddle")
    would_prompt_for_qwen_key = [bool](-not $SkipEnvironment -and -not $NoCredentialPrompt -and -not ($QwenApiKey -or $existingQwenKey) -and ($Provider -eq "qwen" -or $ConfigureQwen))
}

if ($DryRun) {
    $plan["writes_performed"] = $false
    $plan | ConvertTo-Json -Depth 4
    Write-Host "Dry run only. Re-run with -Apply and without -DryRun to make these changes."
    exit 0
}

if (-not $Apply) {
    $state = Get-CheckState
    $state | ConvertTo-Json -Depth 4
    Write-Host "Read-only check complete. Use -Apply to install; add -InstallDependencies only when dependency changes are allowed."
    exit $(if ($state.status -like "ready*") { 0 } else { 1 })
}

$isRealHome = $targetHomePath.TrimEnd('\', '/') -eq ([System.IO.Path]::GetFullPath($HOME)).TrimEnd('\', '/')
if (-not $SkipEnvironment -and -not $isRealHome) {
    throw "Persistent environment variables may only be written when TargetHome is the current user home. Use -SkipEnvironment for isolated installation tests."
}

New-Item -ItemType Directory -Force -Path $targetSkill, $codexRoot | Out-Null
Copy-Item -Path (Join-Path $sourceSkill "*") -Destination $targetSkill -Recurse -Force

if ($InstallDependencies) {
    & $Python -m pip install -r (Join-Path $repoRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}

if (-not $SkipEnvironment) {
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

$content = if (Test-Path -LiteralPath $agentsFile) { Get-Content -Raw -LiteralPath $agentsFile } else { "" }
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
if (-not $PaddleAccessToken -and -not (Get-ConfiguredValue @("PADDLEOCR_ACCESS_TOKEN"))) {
    Write-Warning "PADDLEOCR_ACCESS_TOKEN is not configured. See https://aistudio.baidu.com/paddleocr/task"
}
if ($PaddleAccessToken) { $PaddleAccessToken = $null }
if ($QwenApiKey) { $QwenApiKey = $null }
Write-Host "Restart Codex so the skill and user environment are reloaded."

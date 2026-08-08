<#
.SYNOPSIS
Removes the installed Duhai Vision skill and its managed Codex global rule.

.DESCRIPTION
Provider credentials, the repository checkout, and the paddleocr Python package
are preserved by default. Use -DryRun to preview or -RemoveCredentials to remove
only the environment variables managed by the installer.

.EXAMPLE
powershell -File .\uninstall.ps1 -DryRun

.EXAMPLE
powershell -File .\uninstall.ps1 -KeepConfig

.EXAMPLE
powershell -File .\uninstall.ps1 -RemoveCredentials
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$KeepConfig,
    [switch]$RemoveCredentials,
    [string]$TargetHome = $HOME
)

$ErrorActionPreference = "Stop"

if ($KeepConfig -and $RemoveCredentials) {
    throw "Choose either -KeepConfig or -RemoveCredentials, not both."
}

$targetHomePath = [System.IO.Path]::GetFullPath($TargetHome)
$skillsRoot = [System.IO.Path]::GetFullPath((Join-Path $targetHomePath ".agents\skills"))
$targetSkill = [System.IO.Path]::GetFullPath((Join-Path $skillsRoot "duhai-vision"))
$codexRoot = Join-Path $targetHomePath ".codex"
$agentsFile = Join-Path $codexRoot "AGENTS.md"
$beginMarker = "<!-- BEGIN DUHAI VISION GLOBAL -->"
$endMarker = "<!-- END DUHAI VISION GLOBAL -->"
$skillsPrefix = $skillsRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar

if (-not $targetSkill.StartsWith($skillsPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $targetSkill) -ne "duhai-vision") {
    throw "Refusing to remove an unexpected skill path: $targetSkill"
}

$agentsText = if (Test-Path -LiteralPath $agentsFile) { Get-Content -Raw -LiteralPath $agentsFile } else { "" }
$escapedBegin = [regex]::Escape($beginMarker)
$escapedEnd = [regex]::Escape($endMarker)
$hasManagedRule = $agentsText.Contains($beginMarker) -and $agentsText.Contains($endMarker)
$updatedAgentsText = if ($hasManagedRule) {
    [regex]::Replace($agentsText, "(?ms)$escapedBegin.*?$escapedEnd\s*", "").TrimEnd()
} else {
    $agentsText
}
$isRealHome = $targetHomePath.TrimEnd('\', '/') -eq ([System.IO.Path]::GetFullPath($HOME)).TrimEnd('\', '/')

$plan = [ordered]@{
    mode = if ($DryRun) { "dry_run" } else { "uninstall" }
    target_skill = $targetSkill
    skill_exists = Test-Path -LiteralPath $targetSkill
    global_agents_file = $agentsFile
    managed_global_rule_exists = $hasManagedRule
    credentials = if ($RemoveCredentials) { "remove_installer_managed_environment_variables" } else { "preserve" }
    python_package = "preserve"
    repository_checkout = "preserve"
    writes_performed = $false
}

if ($DryRun) {
    $plan | ConvertTo-Json -Depth 4
    Write-Host "Dry run only. No files, rules, credentials, or packages were removed."
    exit 0
}

if ($RemoveCredentials -and -not $isRealHome) {
    throw "Credentials may only be removed when TargetHome is the current user home."
}

if (Test-Path -LiteralPath $targetSkill) {
    Remove-Item -LiteralPath $targetSkill -Recurse -Force
}
if ($hasManagedRule) {
    $newContent = if ($updatedAgentsText) { $updatedAgentsText + [Environment]::NewLine } else { "" }
    Set-Content -LiteralPath $agentsFile -Value $newContent -Encoding utf8
}
if ($RemoveCredentials) {
    foreach ($name in @("DUHAI_VISION_PROVIDER", "PADDLEOCR_ACCESS_TOKEN", "VLM_API_KEY")) {
        [Environment]::SetEnvironmentVariable($name, $null, "User")
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
}

$didWrite = [bool]($plan.skill_exists -or $hasManagedRule -or $RemoveCredentials)
$plan["writes_performed"] = $didWrite
$plan | ConvertTo-Json -Depth 4
if ($didWrite) {
    Write-Host "Duhai Vision skill and managed global rule removed."
} else {
    Write-Host "No installed Duhai Vision skill or managed global rule was found."
}
if ($RemoveCredentials) {
    Write-Host "Installer-managed environment variables removed. Restart Codex and your terminal."
} else {
    Write-Host "Provider credentials were preserved. Use -RemoveCredentials only if they are not shared with other tools."
}
Write-Host "The repository checkout and paddleocr Python package were preserved."

<#
.SYNOPSIS
    1-click sync/refresh cho bo Axon Ivy Skills (Tier-1) tu du an nguon kleinfernwirktechnik
    sang QA-Playwright-KFWT-Retrofit\.github\skills (cau truc phang - moi skill 1 thu muc).

.DESCRIPTION
    Script quet de quy thu muc nguon (mac dinh: D:\Projects\kleinfernwirktechnik\.github\skills),
    tim dung cac thu muc skill nam trong danh sach TIER1_SKILLS ben duoi (khop theo ten thu muc
    chua file SKILL.md), roi copy (mirror) toan bo noi dung sang thu muc dich, lam PHANG cau truc
    (bo qua cac lop thu muc phan loai trung gian nhu "ui\skills\...", "process-workflow\skills\...").

    Sau khi dong bo xong, script tu dong cap nhat lai docs/IVY-SKILLS-MANIFEST.md voi ngay gio
    dong bo va danh sach skill hien co.

.PARAMETER Source
    Duong dan toi thu muc .github\skills cua du an nguon.

.PARAMETER Dest
    Duong dan toi thu muc .github\skills cua du an dich (mac dinh: .github\skills ke ben script nay).

.PARAMETER SkillNames
    (Tuy chon) Danh sach ten skill can dong bo. Neu khong truyen, dung danh sach TIER1_SKILLS mac dinh.

.EXAMPLE
    .\scripts\sync-ivy-skills.ps1
    Dong bo 14 skill Tier-1 mac dinh tu kleinfernwirktechnik.

.EXAMPLE
    .\scripts\sync-ivy-skills.ps1 -Source "D:\Projects\kleinfernwirktechnik\.github\skills" -SkillNames axon-ivy-process,axon-ivy-html
    Chi dong bo 2 skill chi dinh.
#>
[CmdletBinding()]
param(
    [string]$Source = "D:\Projects\kleinfernwirktechnik\.github\skills",
    [string]$Dest = "",
    [string[]]$SkillNames
)

$ErrorActionPreference = "Stop"

# Thu muc goc cua project dich (thu muc cha cua "scripts\")
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
if (-not $Dest -or $Dest -eq "") {
    $Dest = Join-Path $ProjectRoot ".github\skills"
}

# Danh sach 14 skill Tier-1 mac dinh theo Implementation Plan
$TIER1_SKILLS = @(
    "axon-ivy-workflow-guide",
    "axon-ivy-process",
    "axon-ivy-process-verify",
    "axon-ivy-verify-story",
    "axon-ivy-requirements-creation",
    "axon-ivy-html",
    "axon-ivy-primefaces-verify",
    "axon-ivy-cms",
    "axon-ivy-cms-verify",
    "axon-ivy-custom-fields",
    "axon-ivy-user-role-config",
    "axon-ivy-variable-config",
    "axon-ivy-rest",
    "axon-ivy-error-handling"
)

if (-not $SkillNames -or $SkillNames.Count -eq 0) {
    $SkillNames = $TIER1_SKILLS
}

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " Axon Ivy Skills Sync -> QA-Playwright-KFWT-Retrofit" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Nguon : $Source"
Write-Host "Dich  : $Dest"
Write-Host ""

if (-not (Test-Path $Source)) {
    Write-Error "Khong tim thay thu muc nguon: $Source"
    exit 1
}

if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
}

$syncResults = @()

foreach ($skillName in $SkillNames) {
    Write-Host "-> Dang tim skill: $skillName ..." -ForegroundColor Yellow

    # Tim thu muc con ten trung khop $skillName co chua file SKILL.md ben trong (uu tien chinh xac nhat)
    $candidates = Get-ChildItem -Path $Source -Recurse -Directory -Filter $skillName -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") }

    if (-not $candidates -or $candidates.Count -eq 0) {
        Write-Host "   [BO QUA] Khong tim thay SKILL.md cho '$skillName' trong nguon." -ForegroundColor Red
        $syncResults += [PSCustomObject]@{ Skill = $skillName; Status = "NOT FOUND"; SourcePath = "" }
        continue
    }

    $srcSkillDir = $candidates[0].FullName
    $destSkillDir = Join-Path $Dest $skillName

    if (Test-Path $destSkillDir) {
        Remove-Item -Path $destSkillDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destSkillDir -Force | Out-Null

    # /MIR de dong bo chinh xac 1-1 (kem file con), /NFL /NDL /NJH /NJS de log gon
    $robocopyArgs = @($srcSkillDir, $destSkillDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP")
    robocopy @robocopyArgs | Out-Null

    Write-Host "   [OK] $skillName  <-  $srcSkillDir" -ForegroundColor Green
    $syncResults += [PSCustomObject]@{ Skill = $skillName; Status = "OK"; SourcePath = $srcSkillDir }
}

Write-Host ""
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " Ket qua dong bo" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
$syncResults | Format-Table -AutoSize

$okCount = ($syncResults | Where-Object { $_.Status -eq "OK" }).Count
$totalCount = $syncResults.Count
Write-Host "Da dong bo thanh cong $okCount / $totalCount skill." -ForegroundColor Green

# --- Cap nhat docs/IVY-SKILLS-MANIFEST.md ---
$manifestPath = Join-Path $ProjectRoot "docs\IVY-SKILLS-MANIFEST.md"
$manifestDir = Split-Path -Parent $manifestPath
if (-not (Test-Path $manifestDir)) {
    New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
}

$syncDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$manifestLines = @()
$manifestLines += "# 📦 Ivy Skills Manifest"
$manifestLines += ""
$manifestLines += "> File nay duoc **tu dong sinh/cap nhat** boi ``scripts\sync-ivy-skills.ps1``. Khong sua tay truc tiep noi dung bang o duoi - hay chay lai script de refresh."
$manifestLines += ""
$manifestLines += "| Thuoc tinh | Gia tri |"
$manifestLines += "| :--- | :--- |"
$manifestLines += "| **Nguon (Source)** | ``$Source`` |"
$manifestLines += "| **Dich (Destination)** | ``.github/skills/`` |"
$manifestLines += "| **Lan dong bo gan nhat** | ``$syncDate`` |"
$manifestLines += "| **So skill dong bo thanh cong** | $okCount / $totalCount |"
$manifestLines += ""
$manifestLines += "## Danh muc Skills"
$manifestLines += ""
$manifestLines += "| # | Skill | Trang thai | Duong dan nguon |"
$manifestLines += "| :-: | :--- | :-: | :--- |"
$i = 1
foreach ($r in $syncResults) {
    $statusIcon = if ($r.Status -eq "OK") { "✅" } else { "❌" }
    $srcDisplay = if ($r.SourcePath) { $r.SourcePath } else { "-" }
    $manifestLines += "| $i | ``$($r.Skill)`` | $statusIcon $($r.Status) | ``$srcDisplay`` |"
    $i++
}
$manifestLines += ""
$manifestLines += "## Cach su dung"
$manifestLines += ""
$manifestLines += '```powershell'
$manifestLines += '# Dong bo lai toan bo 14 skill Tier-1 mac dinh:'
$manifestLines += '.\scripts\sync-ivy-skills.ps1'
$manifestLines += ''
$manifestLines += '# Chi dong bo mot vai skill cu the:'
$manifestLines += '.\scripts\sync-ivy-skills.ps1 -SkillNames axon-ivy-process,axon-ivy-html'
$manifestLines += ''
$manifestLines += '# Dong bo tu mot nguon khac (vd: du an Ivy khac):'
$manifestLines += '.\scripts\sync-ivy-skills.ps1 -Source "D:\Projects\<other-ivy-project>\.github\skills"'
$manifestLines += '```'
$manifestLines += ""

Set-Content -Path $manifestPath -Value ($manifestLines -join "`r`n") -Encoding UTF8

Write-Host ""
Write-Host "Da cap nhat manifest: $manifestPath" -ForegroundColor Green

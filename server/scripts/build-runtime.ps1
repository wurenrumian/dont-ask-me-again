$ErrorActionPreference = "Stop"

function Fail-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "[ERROR] $Message" -ForegroundColor Red
  exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = (Resolve-Path (Join-Path $scriptDir "..")).Path
$projectRoot = (Resolve-Path (Join-Path $serverDir "..")).Path
$venvPython = Join-Path $serverDir ".venv\Scripts\python.exe"
$distDir = Join-Path $serverDir "dist"
$buildDir = Join-Path $serverDir "build"
$runtimeName = "dont-ask-me-again-server"
$zipPath = Join-Path $distDir "dont-ask-me-again-server-win-x64.zip"
$pyInstallerExe = Join-Path $serverDir ".venv\Scripts\pyinstaller.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
  Fail-Step "Python virtual environment not found at $venvPython. Run 'pnpm run setup' first."
}

Write-Host "== Build Windows runtime package ==" -ForegroundColor Cyan
Write-Host "Project root: $projectRoot"

Write-Host ""
Write-Host "[1/5] Installing PyInstaller..." -ForegroundColor Yellow
& uv pip install --python $venvPython pyinstaller
if (-not (Test-Path -LiteralPath $pyInstallerExe)) {
  Fail-Step "PyInstaller launcher not found at $pyInstallerExe after install."
}

Write-Host ""
Write-Host "[2/5] Cleaning previous artifacts..." -ForegroundColor Yellow
if (Test-Path -LiteralPath $buildDir) {
  Remove-Item -LiteralPath $buildDir -Recurse -Force
}
if (Test-Path -LiteralPath $distDir) {
  Remove-Item -LiteralPath $distDir -Recurse -Force
}

Write-Host ""
Write-Host "[3/5] Building onedir runtime..." -ForegroundColor Yellow
& $pyInstallerExe `
  --noconfirm `
  --clean `
  --onedir `
  --name $runtimeName `
  --distpath $distDir `
  --workpath $buildDir `
  --paths $projectRoot `
  --add-data "$projectRoot\server\nanobot.config.example.json;server" `
  --add-data "$projectRoot\vendor\nanobot;vendor\nanobot" `
  "$projectRoot\server\packaged_main.py"

$runtimeDir = Join-Path $distDir $runtimeName
if (-not (Test-Path -LiteralPath $runtimeDir)) {
  Fail-Step "Runtime directory was not created: $runtimeDir"
}

Write-Host ""
Write-Host "[4/5] Writing runtime README..." -ForegroundColor Yellow
$runtimeReadme = @"
dont-ask-me-again Windows runtime

Start:
  .\dont-ask-me-again-server.exe

Environment variables:
  DAMA_SERVER_HOST   Default: 127.0.0.1
  DAMA_SERVER_PORT   Default: 8787

Notes:
  - The runtime stores writable config and state next to the executable.
  - If nanobot.config.json does not exist yet, copy from server\nanobot.config.example.json.
"@
$runtimeReadme | Set-Content -LiteralPath (Join-Path $runtimeDir "README.txt") -Encoding UTF8

Write-Host ""
Write-Host "[5/5] Creating release zip..." -ForegroundColor Yellow
Compress-Archive -Path (Join-Path $runtimeDir "*") -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "[OK] Runtime build completed." -ForegroundColor Green
Write-Host "Output: $runtimeDir"
Write-Host "Zip: $zipPath"

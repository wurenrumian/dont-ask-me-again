$ErrorActionPreference = "Stop"

function Fail-Step {
  param(
    [string]$Message
  )

  Write-Host ""
  Write-Host "[ERROR] $Message" -ForegroundColor Red
  exit 1
}

function Assert-PathExists {
  param(
    [string]$PathToCheck,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $PathToCheck)) {
    Fail-Step "$Label not found: $PathToCheck"
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")

Write-Host "== dont-ask-me-again environment setup ==" -ForegroundColor Cyan
Write-Host "Project root: $projectRoot"

$serverDir = Join-Path $projectRoot "server"
$requirementsPath = Join-Path $serverDir "requirements.txt"
$venvPython = Join-Path $serverDir ".venv\Scripts\python.exe"
$configExamplePath = Join-Path $serverDir "nanobot.config.example.json"
$configPath = Join-Path $serverDir "nanobot.config.json"

Assert-PathExists $serverDir "Server directory"
Assert-PathExists $requirementsPath "Requirements file"
Assert-PathExists $configExamplePath "Example config file"

$uvCommand = Get-Command uv -ErrorAction SilentlyContinue
if ($null -eq $uvCommand) {
  Fail-Step "uv is not available in PATH. Install uv first, then rerun this script."
}

Write-Host ""
Write-Host "[1/3] Creating Python virtual environment..." -ForegroundColor Yellow
& uv venv (Join-Path $serverDir ".venv")
if (-not (Test-Path -LiteralPath $venvPython)) {
  Fail-Step "Python executable was not created: $venvPython"
}

Write-Host ""
Write-Host "[2/3] Installing server dependencies..." -ForegroundColor Yellow
& uv pip install --python $venvPython -r $requirementsPath

Write-Host ""
Write-Host "[3/3] Preparing runtime config..." -ForegroundColor Yellow
if (-not (Test-Path -LiteralPath $configPath)) {
  Copy-Item -LiteralPath $configExamplePath -Destination $configPath
  Write-Host "Created: server/nanobot.config.json"
} else {
  Write-Host "Kept existing config: server/nanobot.config.json"
}

Write-Host ""
Write-Host "[OK] Environment setup completed." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Run 'pnpm install' if Node dependencies are not installed yet."
Write-Host "2. Configure your provider in the plugin settings UI."
Write-Host "3. Start the local server with:"
Write-Host "   server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787"
Write-Host "4. Build the plugin with:"
Write-Host "   pnpm run build"

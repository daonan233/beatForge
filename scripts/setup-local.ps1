$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

Write-Host "[1/5] Installing web and server dependencies..." -ForegroundColor Cyan
npm install --cache .npm-cache

Write-Host "[2/5] Creating the base Python environment..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
  python -m venv .venv
}

Write-Host "[3/5] Installing base audio analysis dependencies..." -ForegroundColor Cyan
$env:PIP_CACHE_DIR = Join-Path $ProjectRoot ".pip-cache"
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r "services\analyzer\requirements.txt"

Write-Host "[4/5] Creating the Python 3.10 AI environment..." -ForegroundColor Cyan
$AiPython = (& py -3.10 -c "import sys; print(sys.executable)").Trim()
if ($LASTEXITCODE -ne 0 -or -not $AiPython) {
  throw "AI analysis requires Python 3.10 x64. Install it before continuing."
}
if (-not (Test-Path -LiteralPath ".venv-ai\Scripts\python.exe")) {
  & $AiPython -m venv .venv-ai
}

Write-Host "[5/5] Installing and preparing local AI models..." -ForegroundColor Cyan
& ".venv-ai\Scripts\python.exe" -m pip install --upgrade pip
& ".venv-ai\Scripts\python.exe" -m pip install torch==2.11.0+cu128 torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128
& ".venv-ai\Scripts\python.exe" -m pip install -r "services\analyzer\requirements-ai.txt"
& ".venv-ai\Scripts\python.exe" -m pip install --no-deps "basic-pitch==0.4.0"
$env:TORCH_HOME = Join-Path $ProjectRoot "data\models"
& ".venv-ai\Scripts\python.exe" "services\analyzer\preload_models.py"

Write-Host "Local environment is ready. Run scripts\start-local.ps1 and open http://localhost:5173" -ForegroundColor Green

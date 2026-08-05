$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

Write-Host "[1/5] 安装网页与服务端依赖..." -ForegroundColor Cyan
npm install --cache .npm-cache

Write-Host "[2/5] 创建基础 Python 虚拟环境..." -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
  python -m venv .venv
}

Write-Host "[3/5] 安装基础音频分析依赖..." -ForegroundColor Cyan
$env:PIP_CACHE_DIR = Join-Path $ProjectRoot ".pip-cache"
& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r "services\analyzer\requirements.txt"

Write-Host "[4/5] 创建 Python 3.10 AI 环境..." -ForegroundColor Cyan
$AiPython = (& py -3.10 -c "import sys; print(sys.executable)").Trim()
if ($LASTEXITCODE -ne 0 -or -not $AiPython) {
  throw "AI 分析需要 Python 3.10，请先安装 Python 3.10 x64。"
}
if (-not (Test-Path -LiteralPath ".venv-ai\Scripts\python.exe")) {
  & $AiPython -m venv .venv-ai
}

Write-Host "[5/5] 安装并准备本地 AI 模型..." -ForegroundColor Cyan
& ".venv-ai\Scripts\python.exe" -m pip install --upgrade pip
& ".venv-ai\Scripts\python.exe" -m pip install -r "services\analyzer\requirements-ai.txt"
& ".venv-ai\Scripts\python.exe" -m pip install --no-deps "basic-pitch==0.4.0"
$env:TORCH_HOME = Join-Path $ProjectRoot "data\models"
& ".venv-ai\Scripts\python.exe" "services\analyzer\preload_models.py"

Write-Host "本地环境准备完成。运行 scripts\start-local.ps1，然后打开 http://localhost:5173" -ForegroundColor Green

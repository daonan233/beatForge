$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Test-Path -LiteralPath "node_modules")) {
  throw "尚未安装依赖，请先运行 npm run setup:local"
}
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
  throw "尚未创建 Python 环境，请先运行 npm run setup:local"
}

$AnalyzerEnvironment = if (Test-Path -LiteralPath ".venv-ai\Scripts\python.exe") { ".venv-ai" } else { ".venv" }
$env:PYTHON_BIN = Join-Path $ProjectRoot "$AnalyzerEnvironment\Scripts\python.exe"
$env:DATA_DIR = Join-Path $ProjectRoot "data"
$env:TORCH_HOME = Join-Path $ProjectRoot "data\models"
npm run dev

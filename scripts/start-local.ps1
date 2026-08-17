$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Test-Path -LiteralPath "node_modules")) {
  throw "Dependencies are not installed. Run npm run setup:local first."
}
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
  throw "The Python environment is missing. Run npm run setup:local first."
}

$AnalyzerEnvironment = if (Test-Path -LiteralPath ".venv-ai\Scripts\python.exe") { ".venv-ai" } else { ".venv" }
$env:PYTHON_BIN = Join-Path $ProjectRoot "$AnalyzerEnvironment\Scripts\python.exe"
$env:DATA_DIR = Join-Path $ProjectRoot "data"
$env:TORCH_HOME = Join-Path $ProjectRoot "data\models"
npm run dev

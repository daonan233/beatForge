$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$env:PYTHON_BIN = Join-Path $ProjectRoot ".venv-ai\Scripts\python.exe"
$env:DATA_DIR = Join-Path $ProjectRoot "data"
$env:TORCH_HOME = Join-Path $ProjectRoot "data\models"
& node "apps\server\dist\index.js"

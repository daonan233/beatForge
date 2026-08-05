$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

$AiPython = Join-Path $ProjectRoot ".venv-ai\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $AiPython)) {
  throw "Missing .venv-ai. Run npm run setup:local first."
}
if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
  throw "No NVIDIA driver or GPU was detected."
}

$GpuName = (& nvidia-smi --query-gpu=name --format=csv,noheader).Trim()
Write-Host "Detected NVIDIA GPU: $GpuName" -ForegroundColor Cyan
Write-Host "Installing the Pascal-compatible PyTorch CUDA 12.6 runtime..." -ForegroundColor Cyan
& $AiPython -m pip install --upgrade --force-reinstall -r "services\analyzer\requirements-gpu.txt"
if ($LASTEXITCODE -ne 0) { throw "PyTorch CUDA installation failed." }

Write-Host "Installing the ONNX Runtime CUDA 12 provider..." -ForegroundColor Cyan
& $AiPython -m pip uninstall -y onnxruntime onnxruntime-gpu
if ($LASTEXITCODE -ne 0) { throw "ONNX Runtime cleanup failed." }
& $AiPython -m pip install "onnxruntime-gpu==1.20.2" "resampy==0.4.2"
if ($LASTEXITCODE -ne 0) { throw "ONNX Runtime CUDA installation failed." }

Write-Host "Verifying CUDA execution..." -ForegroundColor Cyan
& $AiPython "services\analyzer\verify_gpu.py"
if ($LASTEXITCODE -ne 0) { throw "CUDA verification failed." }

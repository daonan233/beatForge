"""Verify that the local analyzer can execute both Torch and ONNX on CUDA."""

from __future__ import annotations

import sys

import torch


def main() -> int:
    print(f"PyTorch: {torch.__version__}")
    print(f"PyTorch CUDA runtime: {torch.version.cuda}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    if not torch.cuda.is_available():
        print("ERROR: PyTorch cannot access the NVIDIA GPU.", file=sys.stderr)
        return 1

    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"Compute capability: {torch.cuda.get_device_capability(0)}")
    print(f"Compiled architectures: {torch.cuda.get_arch_list()}")
    value = (torch.ones(1024, device="cuda") * 2).sum().item()
    if value != 2048:
        print("ERROR: CUDA calculation returned an unexpected value.", file=sys.stderr)
        return 1

    import onnxruntime as ort

    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls()
    providers = ort.get_available_providers()
    print(f"ONNX Runtime: {ort.__version__}")
    print(f"ONNX providers: {providers}")
    if "CUDAExecutionProvider" not in providers:
        print("ERROR: ONNX Runtime CUDA provider is unavailable.", file=sys.stderr)
        return 1

    print("GPU runtime verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

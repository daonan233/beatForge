"""Download and validate the local AI inference models during setup."""

import os
from pathlib import Path

os.environ.setdefault("TORCH_HOME", str(Path(__file__).resolve().parents[2] / "data" / "models"))

from beat_this.inference import File2Beats
from basic_pitch import ICASSP_2022_MODEL_PATH
from demucs.pretrained import get_model


def main() -> None:
    print("Preparing the Beat This! final0 beat-tracking model...", flush=True)
    File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    print(f"Basic Pitch model is ready: {ICASSP_2022_MODEL_PATH}", flush=True)
    print("Preparing the Demucs htdemucs source-separation model...", flush=True)
    get_model("htdemucs")


if __name__ == "__main__":
    main()

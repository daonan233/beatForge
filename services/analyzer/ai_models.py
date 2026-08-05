"""Optional local AI inference adapters used by the analyzer."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

os.environ.setdefault("TORCH_HOME", str(Path(__file__).resolve().parents[2] / "data" / "models"))


def separate_vocals(audio_path: str, output_dir: str) -> tuple[str | None, str | None, str | None]:
    """Split vocals from accompaniment with local Demucs, returning recoverable errors."""
    try:
        import soundfile as sf
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        model = get_model("htdemucs")
        model.eval()
        audio, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
        if sample_rate != model.samplerate:
            return None, None, f"Demucs 需要 {model.samplerate} Hz 音频"
        waveform = torch.from_numpy(audio.T)
        if waveform.shape[0] == 1 and model.audio_channels == 2:
            waveform = waveform.repeat(2, 1)
        reference = waveform.mean(0)
        mean = reference.mean()
        std = reference.std().clamp_min(1e-6)
        normalized = (waveform - mean) / std
        def run_inference(device: str, segment: int) -> torch.Tensor:
            model.to(device)
            with torch.inference_mode():
                return apply_model(
                    model, normalized[None], device=device, shifts=0, split=True,
                    overlap=0.1, progress=False, num_workers=0, segment=segment,
                )[0].cpu()

        use_cuda = torch.cuda.is_available()
        # The Quadro P620 has 4 GB of VRAM. Shorter chunks prevent Demucs from
        # exhausting it while still keeping the expensive convolutions on GPU.
        gpu_memory = torch.cuda.get_device_properties(0).total_memory if use_cuda else 0
        gpu_segment = 4 if gpu_memory < 6 * 1024**3 else 7
        try:
            sources = run_inference("cuda" if use_cuda else "cpu", gpu_segment if use_cuda else 7)
        except RuntimeError:
            if not use_cuda:
                raise
            model.to("cpu")
            torch.cuda.empty_cache()
            sources = run_inference("cpu", 7)
        sources = sources * std + mean
        vocal_index = list(model.sources).index("vocals")
        vocals_audio = sources[vocal_index]
        accompaniment_audio = sources.sum(dim=0) - vocals_audio
        target_dir = Path(output_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        vocals_path = target_dir / "vocals.wav"
        accompaniment_path = target_dir / "no_vocals.wav"
        sf.write(vocals_path, vocals_audio.T.numpy(), sample_rate, subtype="FLOAT")
        sf.write(accompaniment_path, accompaniment_audio.T.numpy(), sample_rate, subtype="FLOAT")
        if use_cuda:
            model.to("cpu")
            torch.cuda.empty_cache()
        return str(vocals_path), str(accompaniment_path), None
    except Exception as error:
        return None, None, str(error)


def track_beats(audio_path: str) -> tuple[np.ndarray, np.ndarray, str | None]:
    """Return Beat This! beat/downbeat positions in seconds, or a recoverable error."""
    try:
        import torch
        from beat_this.inference import File2Beats

        def run_tracker(device: str) -> tuple[np.ndarray, np.ndarray]:
            tracker = File2Beats(checkpoint_path="final0", device=device, dbn=False)
            beats, downbeats = tracker(audio_path)
            return np.asarray(beats, dtype=float), np.asarray(downbeats, dtype=float)

        if torch.cuda.is_available():
            try:
                beats, downbeats = run_tracker("cuda")
                torch.cuda.empty_cache()
                return beats, downbeats, None
            except RuntimeError:
                torch.cuda.empty_cache()
        beats, downbeats = run_tracker("cpu")
        return beats, downbeats, None
    except Exception as error:  # AI is an enhancement; classical analysis remains available.
        return np.asarray([], dtype=float), np.asarray([], dtype=float), str(error)


def transcribe_melody(audio_path: str) -> tuple[list[dict], str | None]:
    """Transcribe prominent harmonic note starts with Basic Pitch's local ONNX model."""
    try:
        previous_level = logging.root.manager.disable
        logging.disable(logging.WARNING)
        try:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import Model, predict
        finally:
            logging.disable(previous_level)

        model = Model(ICASSP_2022_MODEL_PATH)
        try:
            import onnxruntime as ort
            import torch

            if torch.cuda.is_available() and "CUDAExecutionProvider" in ort.get_available_providers():
                torch.cuda.empty_cache()
                if hasattr(ort, "preload_dlls"):
                    ort.preload_dlls()
                model.model = ort.InferenceSession(
                    str(ICASSP_2022_MODEL_PATH),
                    providers=[
                        ("CUDAExecutionProvider", {"gpu_mem_limit": str(1024 * 1024**2)}),
                        "CPUExecutionProvider",
                    ],
                )
        except Exception:
            # Model() has already created a working CPU session.
            pass

        _, _, events = predict(
            Path(audio_path),
            model_or_model_path=model,
            onset_threshold=0.58,
            frame_threshold=0.34,
            minimum_note_length=90.0,
            minimum_frequency=65.0,
            maximum_frequency=2100.0,
            multiple_pitch_bends=False,
            melodia_trick=True,
        )
        filtered = [
            {
                "start_s": float(start),
                "end_s": float(end),
                "pitch": int(pitch),
                "amplitude": float(amplitude),
            }
            for start, end, pitch, amplitude, _ in events
            if end - start >= 0.08 and 36 <= pitch <= 100
        ]
        return _collapse_simultaneous_notes(filtered), None
    except Exception as error:
        return [], str(error)


def _collapse_simultaneous_notes(events: list[dict], tolerance_s: float = 0.045) -> list[dict]:
    """Keep one prominent lead-like note from each near-simultaneous chord cluster."""
    clusters: list[list[dict]] = []
    for event in sorted(events, key=lambda value: value["start_s"]):
        if not clusters or event["start_s"] - clusters[-1][0]["start_s"] > tolerance_s:
            clusters.append([event])
        else:
            clusters[-1].append(event)
    return [
        max(cluster, key=lambda value: value["amplitude"] * (1.0 + max(0, value["pitch"] - 60) / 320.0))
        for cluster in clusters
    ]

#!/usr/bin/env python3
"""BeatForge multiband analyzer. Emits progress as JSON Lines."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import librosa
import numpy as np
import soundfile as sf

from ai_models import separate_vocals, track_beats, transcribe_melody
from generator import Anchor, Candidate, build_chart_set


def progress(value: int, stage: str) -> None:
    print(json.dumps({"progress": value, "stage": stage}, ensure_ascii=False), flush=True)


def normalize_audio(source: str, target: str, ffmpeg: str) -> None:
    executable = shutil.which(ffmpeg) if ffmpeg else None
    if not executable:
        import imageio_ffmpeg
        executable = imageio_ffmpeg.get_ffmpeg_exe()
    command = [executable, "-hide_banner", "-loglevel", "error", "-y", "-i", source,
               "-vn", "-ac", "1", "-ar", "44100", target]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "FFmpeg 无法解码该音频")


def normalize_envelope(envelope: np.ndarray) -> np.ndarray:
    maximum = float(np.max(envelope)) if envelope.size else 0.0
    return envelope / (maximum or 1.0)


def align_beat_frames(beat_frames: np.ndarray, onset_envelope: np.ndarray, radius: int) -> np.ndarray:
    """Pull tracked beats toward nearby transients without discarding tempo continuity."""
    aligned: list[int] = []
    for raw_frame in np.asarray(beat_frames, dtype=int):
        start = max(0, raw_frame - radius)
        end = min(len(onset_envelope), raw_frame + radius + 1)
        if end <= start:
            continue
        positions = np.arange(start, end)
        distance_penalty = np.abs(positions - raw_frame) / max(1, radius) * 0.18
        peak_frame = int(positions[np.argmax(onset_envelope[start:end] - distance_penalty)])
        corrected = int(round(raw_frame * 0.35 + peak_frame * 0.65))
        if not aligned or corrected > aligned[-1]:
            aligned.append(corrected)
    return np.asarray(aligned, dtype=int)


def extend_beat_times(beat_times: np.ndarray, duration_seconds: float) -> np.ndarray:
    times = [float(value) for value in beat_times]
    if len(times) < 2:
        return np.asarray(times)
    opening_interval = float(np.median(np.diff(times[:min(6, len(times))])))
    closing_interval = float(np.median(np.diff(times[max(0, len(times) - 6):])))
    while times[0] - opening_interval >= 0:
        times.insert(0, times[0] - opening_interval)
    if times[0] > opening_interval * 0.55:
        times.insert(0, max(0.0, times[0] - opening_interval))
    while times[-1] + closing_interval <= duration_seconds:
        times.append(times[-1] + closing_interval)
    return np.asarray(times)


def estimate_downbeat_phase(beat_frames: np.ndarray, low_envelope: np.ndarray, full_envelope: np.ndarray) -> int:
    if len(beat_frames) < 4:
        return 0
    indices = np.clip(np.asarray(beat_frames, dtype=int), 0, len(full_envelope) - 1)
    accent = low_envelope[indices] * 0.7 + full_envelope[indices] * 0.3
    scores = [float(np.mean(accent[phase::4])) if len(accent[phase::4]) else 0.0 for phase in range(4)]
    return int(np.argmax(scores))


def waveform_peaks(y: np.ndarray, count: int = 1200) -> list[float]:
    if len(y) == 0:
        return []
    chunk = max(1, int(np.ceil(len(y) / count)))
    peaks = [float(np.max(np.abs(y[index:index + chunk]))) for index in range(0, len(y), chunk)]
    maximum = max(peaks) or 1.0
    return [round(value / maximum, 4) for value in peaks[:count]]


def fallback_anchors(duration_ms: float, bpm: float = 120.0) -> list[Anchor]:
    interval = 60_000.0 / bpm
    count = max(2, int(duration_ms / interval) + 1)
    return [
        {"beat": float(index), "timeMs": round(index * interval, 3), "strength": 0.0,
         "downbeat": index % 4 == 0}
        for index in range(count)
    ]


def downbeat_phase_from_times(beat_times: np.ndarray, downbeat_times: np.ndarray) -> int | None:
    phases: list[int] = []
    for downbeat in downbeat_times:
        if not len(beat_times):
            break
        index = int(np.argmin(np.abs(beat_times - downbeat)))
        if abs(float(beat_times[index] - downbeat)) <= 0.12:
            phases.append(index % 4)
    if not phases:
        return None
    counts = np.bincount(np.asarray(phases, dtype=int), minlength=4)
    return int(np.argmax(counts))


def build_melody_candidates(events: list[dict], source: str, vocal_activity: np.ndarray | None = None,
                            sample_rate: int = 44100, hop_length: int = 512) -> list[Candidate]:
    maximum = max((float(event["amplitude"]) for event in events), default=1.0) or 1.0
    candidates: list[Candidate] = []
    for event in events:
        frame = int(float(event["start_s"]) * sample_rate / hop_length)
        vocal_level = float(vocal_activity[min(frame, len(vocal_activity) - 1)]) if vocal_activity is not None and len(vocal_activity) else 0.0
        priority = 1.18 if source == "vocal" else (0.70 if vocal_level >= 0.18 else 1.14)
        candidates.append({
            "time_ms": round(float(event["start_s"]) * 1000.0, 3),
            "end_time_ms": round(float(event["end_s"]) * 1000.0, 3),
            "strength": round(0.48 + 0.52 * min(1.0, float(event["amplitude"]) / maximum), 5),
            "sustained": float(event["end_s"]) - float(event["start_s"]) >= 0.45,
            "band": "melody",
            "source": source,
            "pitch": int(event["pitch"]),
            "priority": priority,
        })
    return candidates


def merge_candidates(rhythm: list[Candidate], melody: list[Candidate], tolerance_ms: float = 40.0) -> list[Candidate]:
    merged: list[Candidate] = []
    for candidate in sorted([*rhythm, *melody], key=lambda value: value["time_ms"]):
        if not merged or candidate["time_ms"] - merged[-1]["time_ms"] > tolerance_ms:
            merged.append(dict(candidate))
            continue
        previous = merged[-1]
        rank = {"vocal": 3, "instrumental": 2, "melody": 2, "rhythm": 1}
        melody_event = candidate if rank.get(candidate.get("source", "rhythm"), 1) > rank.get(previous.get("source", "rhythm"), 1) else previous
        if rank.get(melody_event.get("source", "rhythm"), 1) > 1:
            previous["time_ms"] = melody_event["time_ms"]
            previous["band"] = "melody"
            previous["source"] = melody_event.get("source", "melody")
            if melody_event.get("pitch") is not None:
                previous["pitch"] = melody_event["pitch"]
        previous["strength"] = max(previous["strength"], candidate["strength"])
        previous["sustained"] = previous["sustained"] or candidate["sustained"]
        previous["end_time_ms"] = max(previous.get("end_time_ms", 0), candidate.get("end_time_ms", 0))
        previous["priority"] = max(previous.get("priority", 1.0), candidate.get("priority", 1.0))
    return merged


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--song-id", required=True)
    parser.add_argument("--ffmpeg", default="")
    parser.add_argument("--max-duration-seconds", type=float, default=1200)
    args = parser.parse_args()

    progress(4, "解码 44.1kHz 音频")
    with tempfile.TemporaryDirectory(prefix="beatforge-audio-") as temp_dir:
        normalized = os.path.join(temp_dir, "normalized.wav")
        normalize_audio(args.input, normalized, args.ffmpeg)
        y, sample_rate = librosa.load(normalized, sr=44100, mono=True)
        duration_ms = len(y) / sample_rate * 1000.0
        if duration_ms < 1000:
            raise RuntimeError("音频至少需要 1 秒")
        if duration_ms > args.max_duration_seconds * 1000:
            raise RuntimeError(f"歌曲时长超过 {int(args.max_duration_seconds // 60)} 分钟")

        warnings: list[str] = []
        progress(12, "AI 分离人声与伴奏")
        vocals_path, accompaniment_path, separation_error = separate_vocals(
            normalized, os.path.join(temp_dir, "separated"))
        if vocals_path and accompaniment_path:
            vocals, _ = librosa.load(vocals_path, sr=sample_rate, mono=True)
            accompaniment, _ = librosa.load(accompaniment_path, sr=sample_rate, mono=True)
        else:
            warnings.append("人声分离暂不可用，已使用混合声部继续生成谱面。")
            vocals = None
            accompaniment = y

        hop_length = 512  # 11.61ms per analysis frame.
        harmonic, percussive = librosa.effects.hpss(accompaniment, margin=(2.0, 2.0))
        progress(22, "检测低/中/高频起音")
        full_onset = normalize_envelope(librosa.onset.onset_strength(
            y=percussive, sr=sample_rate, hop_length=hop_length, aggregate=np.median, n_mels=96))
        low_onset = normalize_envelope(librosa.onset.onset_strength(
            y=percussive, sr=sample_rate, hop_length=hop_length, aggregate=np.median,
            n_mels=12, fmin=30, fmax=280))
        mid_onset = normalize_envelope(librosa.onset.onset_strength(
            y=percussive, sr=sample_rate, hop_length=hop_length, aggregate=np.median,
            n_mels=48, fmin=220, fmax=2600))
        high_onset = normalize_envelope(librosa.onset.onset_strength(
            y=percussive, sr=sample_rate, hop_length=hop_length, aggregate=np.median,
            n_mels=48, fmin=2200, fmax=16000))
        length = min(len(full_onset), len(low_onset), len(mid_onset), len(high_onset))
        full_onset, low_onset = full_onset[:length], low_onset[:length]
        mid_onset, high_onset = mid_onset[:length], high_onset[:length]
        band_peak = np.maximum.reduce([low_onset, mid_onset, high_onset])
        onset_envelope = normalize_envelope(
            full_onset * 0.45 + band_peak * 0.45 + (low_onset + mid_onset + high_onset) / 3 * 0.10)
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_envelope, sr=sample_rate, hop_length=hop_length,
            units="frames", backtrack=False, pre_max=3, post_max=3,
            pre_avg=8, post_avg=8, delta=0.07, wait=4)
        onset_times = librosa.frames_to_time(onset_frames, sr=sample_rate, hop_length=hop_length)

        progress(36, "AI 跟踪逐拍与小节首拍")
        ai_beat_times, ai_downbeat_times, beat_ai_error = track_beats(normalized)
        using_ai_beats = len(ai_beat_times) >= 8
        if using_ai_beats:
            beat_times = extend_beat_times(ai_beat_times, duration_ms / 1000.0)
        else:
            warnings.append("Beat This! 暂不可用，已回退到传统节拍跟踪；建议检查本地 AI 环境。")
            tempo_result, beat_frames = librosa.beat.beat_track(
                onset_envelope=onset_envelope, sr=sample_rate, hop_length=hop_length, units="frames")
            tempo_fallback = float(np.asarray(tempo_result).reshape(-1)[0]) if np.asarray(tempo_result).size else 0.0
            radius = max(2, round(0.04 * sample_rate / hop_length))
            beat_frames = align_beat_frames(np.asarray(beat_frames), onset_envelope, radius)
            beat_times = extend_beat_times(
                librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop_length), duration_ms / 1000.0)
        beat_frames = librosa.time_to_frames(beat_times, sr=sample_rate, hop_length=hop_length)
        intervals = np.diff(beat_times)
        median_interval = float(np.median(intervals)) if len(intervals) else 0.0
        tempo = 60.0 / median_interval if median_interval > 0 else (tempo_fallback if not using_ai_beats else 0.0)

        if len(beat_times) < 8 or tempo <= 0:
            warnings.append("节拍可信度较低，已使用 120 BPM 回退网格，请在编辑器中校准。")
            tempo = 120.0
            anchors = fallback_anchors(duration_ms, tempo)
            confidence = 0.0
        else:
            indices = np.clip(np.asarray(beat_frames, dtype=int), 0, len(onset_envelope) - 1)
            beat_strengths = onset_envelope[indices]
            interval_mad = float(np.median(np.abs(intervals - median_interval))) if len(intervals) else median_interval
            regularity = float(np.exp(-2.5 * interval_mad / max(0.001, median_interval)))
            if using_ai_beats:
                confidence = float(np.clip(0.76 + np.mean(beat_strengths) * 0.18 + regularity * 0.06, 0.0, 0.98))
            else:
                confidence = float(np.clip(np.mean(beat_strengths) * 0.72 + regularity * 0.28, 0.0, 1.0))
            if confidence < 0.35:
                warnings.append("自动节拍可信度偏低，建议先试听并校准节拍锚点。")
            ai_phase = downbeat_phase_from_times(beat_times, ai_downbeat_times) if using_ai_beats else None
            downbeat_phase = ai_phase if ai_phase is not None else estimate_downbeat_phase(beat_frames, low_onset, full_onset)
            anchors = [
                {"beat": float(index), "timeMs": round(float(time) * 1000.0, 3),
                 "strength": round(float(beat_strengths[index]), 4),
                 "downbeat": (index - downbeat_phase) % 4 == 0}
                for index, time in enumerate(beat_times)
            ]

        progress(55, "AI 提取人声与间奏换音")
        harmonic_path = os.path.join(temp_dir, "harmonic.wav")
        sf.write(harmonic_path, harmonic, sample_rate, subtype="PCM_16")
        instrumental_events, instrumental_ai_error = transcribe_melody(harmonic_path)
        vocal_events: list[dict] = []
        vocal_ai_error: str | None = None
        if vocals_path:
            vocal_events, vocal_ai_error = transcribe_melody(vocals_path)
        if instrumental_ai_error and (vocal_ai_error or not vocals_path):
            warnings.append("Basic Pitch 暂不可用，当前谱面只使用节拍和打击起音。")

        progress(68, "融合主旋律、鼓点与持续音")
        rms = librosa.feature.rms(y=harmonic, frame_length=2048, hop_length=hop_length)[0]
        rms_norm = normalize_envelope(rms)
        section_energy = normalize_envelope(librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0])
        vocal_activity = normalize_envelope(
            librosa.feature.rms(y=vocals, frame_length=2048, hop_length=hop_length)[0]) if vocals is not None else None
        rhythm_candidates: list[Candidate] = []
        for onset_frame, onset_time in zip(onset_frames, onset_times):
            frame = int(onset_frame)
            future = rms_norm[frame:min(len(rms_norm), frame + int(0.75 * sample_rate / hop_length))]
            sustained = len(future) > 4 and float(np.mean(future)) > 0.28 and float(future[-1]) > 0.16
            band_values = {
                "low": float(low_onset[min(frame, len(low_onset) - 1)]),
                "mid": float(mid_onset[min(frame, len(mid_onset) - 1)]),
                "high": float(high_onset[min(frame, len(high_onset) - 1)]),
            }
            rhythm_candidates.append({
                "time_ms": round(float(onset_time) * 1000.0, 3),
                "strength": round(float(onset_envelope[min(frame, len(onset_envelope) - 1)]), 5),
                "sustained": bool(sustained),
                "band": max(band_values, key=band_values.get),
                "source": "rhythm",
                "priority": round(0.78 + 0.38 * float(section_energy[min(frame, len(section_energy) - 1)]), 4),
            })
        if vocals is not None:
            melody_candidates = [
                *build_melody_candidates(vocal_events, "vocal", vocal_activity, sample_rate, hop_length),
                *build_melody_candidates(instrumental_events, "instrumental", vocal_activity, sample_rate, hop_length),
            ]
        else:
            melody_candidates = build_melody_candidates(instrumental_events, "melody", None, sample_rate, hop_length)
        candidates = merge_candidates(rhythm_candidates, melody_candidates)

        progress(82, "生成三档 AI 融合谱面")
        digest = hashlib.sha256()
        with open(args.input, "rb") as source:
            while block := source.read(1024 * 1024):
                digest.update(block)
        chart_set = build_chart_set(args.song_id, candidates, anchors, warnings, digest.hexdigest())
        progress(93, "整理波形预览")
        result = {
            "chartSet": chart_set,
            "analysis": {
                "bpm": round(tempo, 3), "confidence": round(confidence, 4),
                "durationMs": round(duration_ms), "waveform": waveform_peaks(y), "warnings": warnings,
            },
        }
        with open(args.output, "w", encoding="utf-8") as target:
            json.dump(result, target, ensure_ascii=False, separators=(",", ":"))
        progress(100, "完成")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise

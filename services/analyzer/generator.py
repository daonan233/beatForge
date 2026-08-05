"""Deterministic rule-based chart generation independent from audio libraries."""

from __future__ import annotations

import hashlib
import math
import random
import uuid
from dataclasses import dataclass
from typing import TypedDict


class Candidate(TypedDict, total=False):
    time_ms: float
    strength: float
    sustained: bool
    band: str
    source: str
    end_time_ms: float
    pitch: int
    priority: float


class Anchor(TypedDict):
    beat: float
    timeMs: float
    strength: float
    downbeat: bool


@dataclass(frozen=True)
class Profile:
    min_gap_ms: float
    quantiles: tuple[float, ...]
    strength_quantile: float
    chords: bool
    chord_threshold: float
    max_snap_ms: float


PROFILES = {
    "easy": Profile(500.0, (1.0, 0.5), 0.55, False, 2.0, 40.0),
    "normal": Profile(250.0, (0.5, 1 / 3), 0.35, True, 0.92, 36.0),
    "hard": Profile(142.0, (0.25, 1 / 3), 0.15, True, 0.84, 32.0),
}


def _effective_strength(candidate: Candidate, difficulty: str) -> float:
    source = candidate.get("source", "rhythm")
    source_weight = {
        "easy": {"vocal": 1.20, "instrumental": 1.12, "melody": 1.16, "rhythm": 0.78},
        "normal": {"vocal": 1.14, "instrumental": 1.08, "melody": 1.08, "rhythm": 0.90},
        "hard": {"vocal": 1.06, "instrumental": 1.04, "melody": 1.02, "rhythm": 1.0},
    }[difficulty].get(source, 1.0)
    return float(candidate["strength"]) * source_weight * float(candidate.get("priority", 1.0))


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def time_to_beat(time_ms: float, anchors: list[Anchor]) -> float:
    if len(anchors) < 2:
        return time_ms / 500.0
    if time_ms <= anchors[0]["timeMs"]:
        left, right = anchors[0], anchors[1]
    elif time_ms >= anchors[-1]["timeMs"]:
        left, right = anchors[-2], anchors[-1]
    else:
        low, high = 0, len(anchors) - 1
        while low + 1 < high:
            middle = (low + high) // 2
            if anchors[middle]["timeMs"] <= time_ms:
                low = middle
            else:
                high = middle
        left, right = anchors[low], anchors[high]
    time_span = right["timeMs"] - left["timeMs"] or 1.0
    return left["beat"] + (time_ms - left["timeMs"]) / time_span * (right["beat"] - left["beat"])


def beat_to_time(beat: float, anchors: list[Anchor]) -> float:
    if len(anchors) < 2:
        return beat * 500.0
    if beat <= anchors[0]["beat"]:
        left, right = anchors[0], anchors[1]
    elif beat >= anchors[-1]["beat"]:
        left, right = anchors[-2], anchors[-1]
    else:
        low, high = 0, len(anchors) - 1
        while low + 1 < high:
            middle = (low + high) // 2
            if anchors[middle]["beat"] <= beat:
                low = middle
            else:
                high = middle
        left, right = anchors[low], anchors[high]
    beat_span = right["beat"] - left["beat"] or 1.0
    return left["timeMs"] + (beat - left["beat"]) / beat_span * (right["timeMs"] - left["timeMs"])


def _snap_candidate(beat: float, steps: tuple[float, ...], anchors: list[Anchor], source_ms: float) -> float:
    options = [round(beat / step) * step for step in steps]
    return min(options, key=lambda value: abs(beat_to_time(value, anchors) - source_ms))


def generate_chart(
    difficulty: str,
    candidates: list[Candidate],
    anchors: list[Anchor],
    seed_material: str,
) -> list[dict]:
    profile = PROFILES[difficulty]
    threshold = _percentile([_effective_strength(candidate, difficulty) for candidate in candidates], profile.strength_quantile)
    digest = hashlib.sha256(f"{seed_material}:{difficulty}:rules-v4-adaptive".encode()).digest()
    rng = random.Random(int.from_bytes(digest[:8], "big"))
    selected: list[tuple[Candidate, float, float, float]] = []
    last_time = -10_000.0
    seen_beats: set[int] = set()

    for candidate in sorted(candidates, key=lambda value: value["time_ms"]):
        if _effective_strength(candidate, difficulty) < threshold or candidate["time_ms"] - last_time < profile.min_gap_ms:
            continue
        raw_beat = time_to_beat(candidate["time_ms"], anchors)
        if raw_beat < 0:
            continue
        snapped = max(0.0, _snap_candidate(raw_beat, profile.quantiles, anchors, candidate["time_ms"]))
        snapped_time = beat_to_time(snapped, anchors)
        micro_offset = candidate["time_ms"] - snapped_time
        if abs(micro_offset) > profile.max_snap_ms:
            # Preserve a detected off-grid onset instead of discarding or dragging it to the grid.
            snapped = raw_beat
            snapped_time = candidate["time_ms"]
            micro_offset = 0.0
        beat_key = round(snapped * 12)
        if beat_key in seen_beats:
            continue
        if candidate["time_ms"] - last_time < profile.min_gap_ms * 0.8:
            continue
        selected.append((candidate, snapped, snapped_time, micro_offset))
        seen_beats.add(beat_key)
        last_time = candidate["time_ms"]

    notes: list[dict] = []
    lane_last = [-10_000.0] * 4
    occupied_until = [-1.0] * 4
    namespace = uuid.UUID("67f97186-c2df-44bc-b1a7-8f29c104c6ad")

    band_order = {
        "low": [1, 2, 0, 3],
        "mid": [0, 3, 1, 2],
        "high": [3, 0, 2, 1],
        "melody": [0, 3, 1, 2],
    }
    for index, (candidate, beat, event_time, micro_offset) in enumerate(selected):
        available = [lane for lane in range(4) if occupied_until[lane] <= beat]
        pool = available or list(range(4))
        min_recent = min(lane_last[lane] for lane in pool)
        balanced = [lane for lane in pool if lane_last[lane] <= min_recent + profile.min_gap_ms]
        preferred = band_order.get(candidate.get("band", "mid"), band_order["mid"])
        balanced.sort(key=lambda value: preferred.index(value))
        lane = rng.choice(balanced[:min(2, len(balanced))])
        melody_hold = candidate.get("source") in {"melody", "vocal", "instrumental"} and candidate.get("end_time_ms", 0) - candidate["time_ms"] >= 450
        is_hold = candidate["sustained"] and (melody_hold or index % (5 if difficulty == "easy" else 4) == 0)
        detected_end = time_to_beat(candidate.get("end_time_ms", 0), anchors) if candidate.get("end_time_ms") else 0
        end_beat = max(beat + 0.25, min(beat + 8.0, detected_end)) if melody_hold else beat + (2.0 if candidate["strength"] > 0.8 else 1.0)
        note_id = str(uuid.uuid5(namespace, f"{seed_material}:{difficulty}:{index}:{beat:.5f}:{lane}"))
        note = {"id": note_id, "lane": lane, "type": "hold" if is_hold else "tap", "beat": round(beat, 6)}
        if abs(micro_offset) >= 1.0:
            note["offsetMs"] = round(max(-180.0, min(180.0, micro_offset)), 2)
        if is_hold:
            note["endBeat"] = round(end_beat, 6)
            occupied_until[lane] = end_beat
        notes.append(note)
        lane_last[lane] = event_time

        chord_period = 17 if difficulty == "normal" else 11
        if profile.chords and candidate["strength"] >= profile.chord_threshold and index % chord_period == 0:
            second_pool = [value for value in range(4) if value != lane and occupied_until[value] <= beat]
            if second_pool:
                second = max(second_pool, key=lambda value: abs(value - lane))
                chord_id = str(uuid.uuid5(namespace, f"{seed_material}:{difficulty}:{index}:{beat:.5f}:{second}:chord"))
                chord_note = {"id": chord_id, "lane": second, "type": "tap", "beat": round(beat, 6)}
                if abs(micro_offset) >= 1.0:
                    chord_note["offsetMs"] = round(max(-180.0, min(180.0, micro_offset)), 2)
                notes.append(chord_note)
                lane_last[second] = event_time

    return sorted(notes, key=lambda note: (note["beat"], note["lane"]))


def build_chart_set(song_id: str, candidates: list[Candidate], anchors: list[Anchor], warnings: list[str], seed: str) -> dict:
    return {
        "schemaVersion": 1,
        "songId": song_id,
        "revision": 1,
        "generatorVersion": "rules-v4-adaptive-vocal-instrumental",
        "laneCount": 4,
        "timing": {"meter": 4, "anchors": anchors},
        "charts": {
            difficulty: {"notes": generate_chart(difficulty, candidates, anchors, seed)}
            for difficulty in ("easy", "normal", "hard")
        },
        "warnings": warnings,
    }

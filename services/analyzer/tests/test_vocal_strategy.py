import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from analyze import build_gap_beat_candidates, ensure_gap_coverage, outside_vocal_region
from generator import generate_chart


class VocalStrategyTests(unittest.TestCase):
    def setUp(self):
        self.sample_rate = 44100
        self.hop_length = 512
        self.anchors = [
            {"beat": float(index), "timeMs": index * 500.0, "strength": 0.8,
             "downbeat": index % 4 == 0}
            for index in range(12)
        ]

    def test_rhythm_is_suppressed_while_vocal_is_active(self):
        activity = np.zeros(600, dtype=float)
        vocal_frame = int(2.0 * self.sample_rate / self.hop_length)
        activity[vocal_frame - 8:vocal_frame + 9] = 0.9
        self.assertFalse(outside_vocal_region(
            2000.0, activity, [2000.0], self.sample_rate, self.hop_length))
        self.assertTrue(outside_vocal_region(
            3000.0, activity, [2000.0], self.sample_rate, self.hop_length))

    def test_gap_beats_only_fill_vocal_silence(self):
        activity = np.zeros(600, dtype=float)
        vocal_frame = int(2.0 * self.sample_rate / self.hop_length)
        activity[vocal_frame - 8:vocal_frame + 9] = 0.9
        candidates = build_gap_beat_candidates(
            self.anchors, activity, [2000.0], self.sample_rate, self.hop_length)
        times = {candidate["time_ms"] for candidate in candidates}
        self.assertNotIn(2000.0, times)
        self.assertIn(3000.0, times)

    def test_instrumental_bleed_does_not_mask_interlude_without_vocal_evidence(self):
        activity = np.full(600, 0.7, dtype=float)
        self.assertTrue(outside_vocal_region(
            3000.0, activity, [], self.sample_rate, self.hop_length, []))
        self.assertFalse(outside_vocal_region(
            3000.0, activity, [], self.sample_rate, self.hop_length, [(2800.0, 3300.0)]))

    def test_long_uncovered_region_gets_gap_fill_candidates(self):
        candidates = [{"time_ms": 0.0, "strength": 1.0, "sustained": False,
                       "band": "melody", "source": "vocal_syllable"}]
        filled = ensure_gap_coverage(candidates, self.anchors, radius_ms=700.0)
        gap_fill_times = [candidate["time_ms"] for candidate in filled if candidate.get("source") == "gap_fill"]
        self.assertTrue(gap_fill_times)
        combined = sorted(float(candidate["time_ms"]) for candidate in filled)
        self.assertLessEqual(max(b - a for a, b in zip(combined, combined[1:])), 1500.0)

    def test_hard_chart_keeps_rapid_vocal_syllables(self):
        candidates = [
            {"time_ms": 500.0 + index * 120.0, "strength": 0.72,
             "sustained": False, "band": "melody", "source": "vocal_syllable",
             "priority": 1.34}
            for index in range(8)
        ]
        notes = generate_chart("hard", candidates, self.anchors, "vocal-seed")
        self.assertEqual(len(notes), len(candidates))


if __name__ == "__main__":
    unittest.main()

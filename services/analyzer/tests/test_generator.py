import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from generator import build_chart_set, generate_chart


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        self.anchors = [
            {"beat": float(index), "timeMs": index * (500 + index * 1.5), "strength": 0.8, "downbeat": index % 4 == 0}
            for index in range(48)
        ]
        self.candidates = [
            {"time_ms": index * 250.0, "strength": 0.25 + (index % 8) / 10, "sustained": index % 9 == 0,
             "band": ("low", "mid", "high")[index % 3], "source": "melody" if index % 4 == 0 else "rhythm"}
            for index in range(90)
        ]

    def test_output_is_deterministic(self):
        first = build_chart_set("song", self.candidates, self.anchors, [], "seed")
        second = build_chart_set("song", self.candidates, self.anchors, [], "seed")
        self.assertEqual(first, second)

    def test_note_invariants(self):
        for difficulty in ("easy", "normal", "hard"):
            notes = generate_chart(difficulty, self.candidates, self.anchors, "seed")
            self.assertTrue(notes)
            self.assertEqual(notes, sorted(notes, key=lambda note: (note["beat"], note["lane"])))
            for note in notes:
                self.assertIn(note["lane"], range(4))
                self.assertGreaterEqual(note["beat"], 0)
                if note["type"] == "hold":
                    self.assertGreater(note["endBeat"], note["beat"])
                self.assertLessEqual(abs(note.get("offsetMs", 0)), 180)

    def test_easy_is_sparser_than_hard(self):
        easy = generate_chart("easy", self.candidates, self.anchors, "seed")
        hard = generate_chart("hard", self.candidates, self.anchors, "seed")
        self.assertLessEqual(len(easy), len(hard))

    def test_off_grid_onset_is_preserved_instead_of_discarded(self):
        candidates = [{"time_ms": 137.0, "strength": 1.0, "sustained": False,
                       "band": "melody", "source": "melody"}]
        notes = generate_chart("easy", candidates, self.anchors, "off-grid")
        self.assertEqual(len(notes), 1)
        generated_time = notes[0]["beat"] * 500.0
        self.assertLess(abs(generated_time - 137.0), 3.0)

    def test_normal_chart_fills_long_post_filter_gap(self):
        anchors = [
            {"beat": float(index), "timeMs": index * 500.0, "strength": 0.8,
             "downbeat": index % 4 == 0}
            for index in range(16)
        ]
        candidates = [
            {"time_ms": 500.0, "strength": 1.0, "sustained": False,
             "band": "melody", "source": "vocal_syllable"},
            {"time_ms": 6000.0, "strength": 1.0, "sustained": False,
             "band": "melody", "source": "vocal_syllable"},
        ]
        notes = generate_chart("normal", candidates, anchors, "gap-fill")
        beats = sorted(set(note["beat"] for note in notes))
        self.assertLessEqual(max(b - a for a, b in zip(beats, beats[1:])), 2.0)


if __name__ == "__main__":
    unittest.main()

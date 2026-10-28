"""校准与评测管线的单元测试。假向量只用来走通代码，不是任何模型的成绩。

从 tests/local-model-eval/ 运行：python -m unittest discover -s classification -p "test_*.py"
"""
from __future__ import annotations

import hashlib
import json
import math
import unittest
from pathlib import Path

from calibrate import Thresholds, calibrate, closed_set, outcome, tally

HERE = Path(__file__).resolve().parent


def row(top_id, top, margin, accept, code_reject=False):
    return {"top_id": top_id, "top": top, "margin": margin, "accept": accept, "code_reject": code_reject}


class OutcomeTest(unittest.TestCase):
    th = Thresholds(.5, .05)

    def test_five_outcomes(self):
        self.assertEqual(outcome(row("receipt", .7, .1, ["receipt"]), self.th), "correct")
        self.assertEqual(outcome(row("menu", .7, .1, ["receipt"]), self.th), "wrong")
        self.assertEqual(outcome(row("menu", .7, .1, []), self.th), "wrong_accept")
        self.assertEqual(outcome(row("menu", .4, .1, []), self.th), "reject_ok")
        self.assertEqual(outcome(row("receipt", .7, .01, ["receipt"]), self.th), "false_reject")

    def test_code_rejection_wins_over_scores(self):
        self.assertEqual(outcome(row(None, float("-inf"), 0, [], True), self.th), "reject_ok")
        self.assertEqual(outcome(row("receipt", .9, .5, ["receipt"], True), self.th), "false_reject")

    def test_error_rate_counts_only_given_answers(self):
        counts = tally([row("a", .9, .5, ["a"]), row("b", .9, .5, ["a"]), row("c", .1, 0, [])], self.th)
        self.assertEqual((counts["given"], counts["correct"], counts["reject_ok"]), (2, 1, 1))
        self.assertAlmostEqual(counts["error_rate"], .5)


class CalibrateTest(unittest.TestCase):
    def test_picks_the_threshold_that_keeps_errors_under_the_target(self):
        rows = [row("a", .9, .3, ["a"]), row("a", .8, .2, ["a"]), row("b", .6, .2, ["a"]),
                row("c", .55, .01, []), row("a", .7, .02, ["a"])]
        th = calibrate(rows, .0)
        self.assertEqual(tally(rows, th)["wrong"] + tally(rows, th)["wrong_accept"], 0)
        self.assertEqual(tally(rows, th)["correct"], 3)

    def test_rejects_everything_when_no_threshold_is_safe(self):
        rows = [row("b", .9, .3, ["a"]), row("c", .8, .2, [])]
        th = calibrate(rows, .05)
        self.assertEqual(tally(rows, th)["given"], 0)

    def test_closed_set_forces_the_top_answer(self):
        counts = closed_set([row("b", .1, 0, ["a"]), row(None, float("-inf"), 0, [], True)])
        self.assertEqual((counts["wrong"], counts["reject_ok"]), (1, 1))


class FakeEmbedder:
    """按字的哈希得到的确定向量：只用来走通代码。"""

    def embed(self, inputs):
        out = []
        for text in inputs:
            v = [0.0] * 32
            for ch in text:
                v[int(hashlib.md5(ch.encode()).hexdigest(), 16) % 32] += 1
            n = math.sqrt(sum(x * x for x in v)) or 1
            out.append([x / n for x in v])
        return out


class PipelineSmokeTest(unittest.TestCase):
    def test_holdout_rows_and_report(self):
        from evaluate_holdout import load_cases, report, score_rows
        cases = load_cases(HERE / "holdout" / "cases.jsonl")
        features = {c["id"]: {"readability": "readable" if c["text"].strip() else "blank"} for c in cases}
        rows = score_rows(cases, features, FakeEmbedder())
        self.assertEqual(len(rows), 2 * len(cases))
        self.assertTrue(all(r["top_id"] is None for r in rows if r["code_reject"]))
        summary, text = report(rows, .05)
        self.assertIn("kind", summary)
        self.assertIn("测试集", text)

    def test_match_rows_filter_by_file_type(self):
        from evaluate_match import candidates, embedding_rows, load
        profiles, presets, docs = load()
        rows = embedding_rows(profiles, presets, docs, FakeEmbedder())
        self.assertEqual(len(rows), len(profiles) * len(docs))
        pdf_only = {f"preset:{p['id']}" for p in presets if p["accepts"] == ["pdf"]}
        for doc in docs:
            if doc["file"] != "pdf":
                ids = {c["id"] for c in candidates(profiles[0], presets, doc["file"])}
                self.assertFalse(ids & pdf_only)
        json.dumps(rows[0])


if __name__ == "__main__":
    unittest.main()

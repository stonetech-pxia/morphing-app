"""在校准集上定「无法判断 / 不推荐」的阈值，只在测试集上报成绩。

相似度不是正确概率：阈值只对同一个模型、量化、查询指令和候选说明有效，换了任何一样都要重新校准。
每一行是一次判断：最高分 top、和第二名的差 margin、最高分的候选 top_id，以及可接受的答案 accept
（空集表示应该拒判 / 不推荐）。code_reject 为真表示代码在模型之前已经拒判（空白、乱码）。
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

# 五种结果。任务 ① 报「正确 / 误分 / 拒判 / 误拒判」时，误分 = wrong + wrong_accept。
OUTCOMES = ("correct", "wrong", "wrong_accept", "reject_ok", "false_reject")


@dataclass(frozen=True)
class Thresholds:
    min_score: float
    min_margin: float


def accepted(row: dict, th: Thresholds) -> bool:
    return (not row.get("code_reject")) and row["top_id"] is not None and \
        row["top"] >= th.min_score and row["margin"] >= th.min_margin


def outcome(row: dict, th: Thresholds) -> str:
    accept = set(row["accept"])
    if accepted(row, th):
        if not accept:
            return "wrong_accept"
        return "correct" if row["top_id"] in accept else "wrong"
    return "false_reject" if accept else "reject_ok"


def tally(rows: list[dict], th: Thresholds) -> dict:
    counts = Counter(outcome(row, th) for row in rows)
    result = {name: counts.get(name, 0) for name in OUTCOMES}
    result["total"] = len(rows)
    given = result["correct"] + result["wrong"] + result["wrong_accept"]
    result["given"] = given
    # 错误推荐率：给出的类别 / 推荐里错的占多少（拒判不算错）。
    result["error_rate"] = (result["wrong"] + result["wrong_accept"]) / given if given else 0.0
    return result


def calibrate(rows: list[dict], max_error_rate: float) -> Thresholds:
    """给出的判断里错的不超过 max_error_rate 时，正确的越多越好；一样多时错的少、阈值高的优先。

    一个阈值组合都不满足时返回「全部拒判」（宁可不推荐）。候选阈值取校准集里出现过的分数。
    """
    live = [row for row in rows if not row.get("code_reject") and row["top_id"] is not None]
    reject_all = Thresholds(float("inf"), float("inf"))
    best_key, best = None, reject_all
    for min_score in sorted({row["top"] for row in live}):
        above = [row for row in live if row["top"] >= min_score]
        for min_margin in sorted({row["margin"] for row in above}):
            th = Thresholds(min_score, min_margin)
            counts = tally(above, th)
            if not counts["given"] or counts["error_rate"] > max_error_rate:
                continue
            key = (counts["correct"], -(counts["wrong"] + counts["wrong_accept"]), min_score, min_margin)
            if best_key is None or key > best_key:
                best_key, best = key, th
    return best


def closed_set(rows: list[dict]) -> dict:
    """不设阈值、强制选最高分（以前的闭集成绩口径），代码拒判的仍算拒判。"""
    return tally(rows, Thresholds(float("-inf"), float("-inf")))


def by(rows: list[dict], key: str) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for row in rows:
        groups.setdefault(row[key], []).append(row)
    return dict(sorted(groups.items()))

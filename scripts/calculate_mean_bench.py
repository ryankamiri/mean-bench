#!/usr/bin/env python3
"""Calculate an equally weighted benchmark mean from the local score snapshots."""

from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from statistics import mean, median


DATA = Path(__file__).resolve().parents[1] / "data"

# Ordered scoreboards when multiple sources cover the same benchmark slot.
# Distinct difficulty splits are intentionally outside these selections.
BOARDS = {
    "terminal-bench": ("terminalbench-4.1",),
    "hle": ("aa-hle-diamond", "bg-hle-diamond"),
    "swe-bench-pro-v2": ("bh-scale-swe-bench-pro-v2-full",),
    "arc-agi": ("arc-agi-3",),
    "frontiermath": ("frontiermath-tiers-1-3-v2",),
    "frontiercode": ("aa-frontiercode-2-0", "frontiercode-2.0-main", "bg-frontier-code-v2"),
    "osworld": ("osworld-2.1-offline",),
    "browsecomp": ("browsecomp",),
    "gpqa-diamond": ("aa-gpqa-diamond", "epoch-gpqa-diamond"),
    "gdpval": ("aa-gdpval-aa",),
    "frontierswe": ("frontierswe-v2",),
    "automationbench": ("aa-automationbench-aa", "automationbench"),
    "metr-time-horizon": ("metr-time-horizon",),
    "mmmu-pro": ("aa-mmmu-pro",),
    "terminal-bench-science": ("aa-terminalbench-science", "vals-terminal-bench-science"),
    "agents-last-exam": ("agents-last-exam",),
    "chat-arena": ("arena-text",),
    "deepswe": ("deepswe-1.1",),
    "tau-bench": ("aa-tau3-banking",),
    "livecodebench": ("aa-livecodebench",),
    "critpt": ("aa-critpt-v2-hard",),
    "gdp-pdf": ("aa-gdp-pdf", "bh-surge-gdp-pdf-100-tasks"),
    "aa-briefcase": ("aa-briefcase",),
    "chartography": ("chartography", "bh-surge-chartography-100-tasks"),
    "ifbench": ("aa-ifbench",),
    "bfcl-v4": ("bfcl-v4",),
    "ramp-swe-bench-v2": ("ramp-swebench-v2-bash",),
    "aa-omniscience": ("aa-omniscience-v1-1",),
    "ramp-accounting-bench": ("ramp-accounting-bench",),
    "global-mmlu-lite": ("aa-global-mmlu-lite",),
}
EFFORT = {None: -1, "default": -1, "none": 0, "off": 0, "minimal": 1,
          "low": 2, "medium": 3, "high": 4, "xhigh": 5, "max": 6}
PROVIDER_ORDER = {"XLANG": 0, "Priors": 1, "Model report": 2, "Benchgap / BenchLM": 3}

NORMALIZATION = {
    "percent": "Use the reported 0–100 result as published.",
    "gdpval": "Elo mapped to 0–100 by the conventional Elo expected-score curve versus a rating of 1600.",
    "aa-briefcase": "Artificial Analysis normalization, 100 × clamp((Elo − 500) / 2000, 0, 1).",
    "chat-arena": "Arena Bradley–Terry expected win percentage versus a fixed reference rating of 1400.",
    "aa-omniscience": "Map the published −100 to 100 net-score scale linearly to 0–100.",
}


def read_json(path):
    return json.loads(path.read_text())


def normalize(benchmark, observation):
    value = observation["value"]
    unit = observation["unit"]
    if unit in ("percent", "%") and 0 <= value <= 100:
        return value
    if benchmark == "aa-briefcase" and unit == "elo":
        return min(100.0, max(0.0, (value - 500) / 20))
    if benchmark == "gdpval" and unit == "elo":
        return 100 / (1 + 10 ** ((1600 - value) / 400))
    if benchmark == "chat-arena" and unit == "elo":
        return 100 / (1 + math.exp((1400 - value) / 400))
    if benchmark == "aa-omniscience" and unit == "score" and -100 <= value <= 100:
        return (value + 100) / 2
    raise ValueError(f"Unsupported benchmark score: {benchmark}: {value} {unit}")


def reported_cost(observation):
    val = observation.get("costUsd")
    if isinstance(val, (float, int)) and math.isfinite(val) and val >= 0:
        return val
    return None


def select_observation(benchmark, observations):
    board_order = {name: i for i, name in enumerate(BOARDS[benchmark])}

    def priority(row):
        # Unlabelled ARC rows on this snapshot are the Standard track.
        adapter = benchmark == "arc-agi" and row.get("harness") == "Provider Adapter"
        return (board_order[row["benchmark_id"]], adapter,
                PROVIDER_ORDER.get(row.get("provider"), 4),
                -EFFORT.get(row.get("effort"), -1))

    best = min(map(priority, observations))
    eligible = [row for row in observations if priority(row) == best]
    middle = median(normalize(benchmark, row) for row in eligible)
    selection = min(eligible, key=lambda row: (
        abs(normalize(benchmark, row) - middle),
        reported_cost(row) is None,
        row.get("variantId", ""),
        row["sourceUrl"],
    ))
    return {
        "benchmark": benchmark,
        "score": normalize(benchmark, selection),
        "original_score": selection["value"],
        "original_unit": selection["unit"],
        "board": selection["benchmark_id"],
        "effort": selection.get("effort"),
        "harness": selection.get("harness"),
        "source_url": selection["sourceUrl"],
        "variant_id": selection.get("variantId"),
        "cost_usd_per_task": reported_cost(selection),
        "source_note": selection.get("note", selection.get("archival_context")),
    }


def api_prices(model_ids):
    snapshot = read_json(DATA / "results/_sources/priors-2026-11-18.json")["snapshot"]
    aliases = read_json(DATA / "coverage.json")["alias_merges"]
    prices = defaultdict(Counter)
    for variant in snapshot["variants"]:
        mid = aliases.get(variant["modelId"], variant["modelId"])
        if mid not in model_ids:
            continue
        model = variant.get("sourceModel") or {}
        metadata = model.get("metadata") or {}
        pair = metadata.get("price1mInputTokens"), metadata.get("price1mOutputTokens")
        if all(isinstance(price, (float, int)) and math.isfinite(price) and price >= 0 for price in pair):
            prices[mid][pair] += 1

    return {mid: sorted(rows.items(), key=lambda entry: (-entry[1], entry[0]))[0][0]
            for mid, rows in prices.items()}


def collect_runs(benchmark_ids, model_ids, archive):
    runs = defaultdict(dict)
    for benchmark in benchmark_ids:
        records = read_json(DATA / "benchmarks" / benchmark / "results.json")["current"]
        if benchmark == "ramp-accounting-bench":
            records.extend(archive)

        by_model = defaultdict(list)
        for row in records:
            mid = row["model_id"]
            if mid in model_ids and row["benchmark_id"] in BOARDS[benchmark]:
                by_model[mid].append(row)
        for mid, rows in by_model.items():
            runs[mid][benchmark] = select_observation(benchmark, rows)
    return runs


def build():
    cohort = read_json(DATA / "recent-coverage.json")
    catalog = read_json(DATA / "catalog.json")
    benchmarks = {b["id"]: b["name"] for b in catalog["benchmarks"]}
    benchmark_ids = list(benchmarks)
    model_ids = {m["model_id"] for m in cohort["models"]}
    assert set(benchmark_ids) == set(BOARDS)
    denominator = len(benchmark_ids)
    runs = collect_runs(benchmark_ids, model_ids, cohort["archived_ramp_accounting_results"])
    prices = api_prices(model_ids)
    models = []
    for entry in cohort["models"]:
        mid = entry["model_id"]
        scored = runs[mid]
        costed = [r["cost_usd_per_task"] for r in scored.values() if r["cost_usd_per_task"] is not None]
        average = mean(r["score"] for r in scored.values()) if scored else None
        token_price = prices.get(mid)
        models.append({
            "id": mid,
            "name": entry["name"],
            "developer": entry["lab_id"],
            "release_date": entry["release_date"],
            "mean_available_score": average,
            "mean_full_score": average if len(scored) == denominator else None,
            "benchmarks_scored": len(scored),
            "score_coverage_percent": 100 * len(scored) / denominator,
            "mean_reported_cost_usd_per_task": mean(costed) if costed else None,
            "benchmarks_with_cost": len(costed),
            "api_input_usd_per_million": token_price[0] if token_price else None,
            "api_output_usd_per_million": token_price[1] if token_price else None,
            "api_blended_usd_per_million": mean(token_price) if token_price else None,
            "scores": scored,
        })
    models.sort(key=lambda m: (-(m["mean_available_score"] if m["mean_available_score"] is not None else -1),
                               -m["benchmarks_scored"], m["name"]))
    broad = [m for m in models if m["benchmarks_scored"] >= 20]
    shared = [b for b in benchmark_ids if all(b in m["scores"] for m in broad)]
    assert broad and shared
    matched = []
    for m in broad:
        matched.append({"model_id": m["id"], "name": m["name"],
                        "mean_shared_score": mean(m["scores"][b]["score"] for b in shared),
                        "benchmarks_scored": m["benchmarks_scored"]})
    matched.sort(key=lambda m: (-m["mean_shared_score"], m["name"]))

    return {
        "as_of": cohort["as_of"],
        "release_range_inclusive": cohort["release_range_inclusive"],
        "benchmark_count": denominator,
        "benchmarks": benchmarks,
        "output_units": "0–100 benchmark points and USD",
        "normalization": NORMALIZATION,
        "score_selection": "Each benchmark counts equally. Prefer the specified result board and public source, then highest reported reasoning effort. For equally preferred rows choose the actual score nearest their median. The mean over available scores uses only selected results. "
                           f"Full means require all {denominator} benchmarks.",
        "cost_selection": "Task cost is the equally weighted mean over the selected score rows with a published USD cost per evaluation task or trial. API rates are the modal snapshot input/output rate pair for the model, blended 50/50 with uncached input and output. These are different kinds of cost.",
        "selected_boards": BOARDS,
        "matched_scorecard": {"eligibility_minimum_scores": 20, "benchmarks": shared, "models": matched},
        "models": models,
    }


if __name__ == "__main__":
    output = build()
    (DATA / "mean-bench.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")

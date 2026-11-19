#!/usr/bin/env python3
"""Export the public, browser-ready Mean Bench snapshot."""

import json
from collections import Counter
from pathlib import Path
from statistics import mean


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data"
MIN_MODELS_PER_BENCHMARK = 5

EXCLUDED_MODELS = {
    "seed-evolving-2026-11",
    "seed-2.1-turbo",
    "seed-2.1-pro",
    "ernie-5.5-flash",
    "dots3-note",
    "aa-k2-horizon-375b-a23b",
    "aa-granite-4-2-8b",
    "aa-lfm3-1-7b",
    "aa-lfm3-vl-2b",
    "mercury-2.5",
    "aa-nemotron-3-5-bolt-e4b-4gb",
    "aa-agnes-2-5-pro-beta",
    "aa-jt-4-1-flash-236b-a21b-0709-non-reasoning",
    "qwen-3.7-flash",
    "nemotron-3.5-lightning",
    "aa-nemotron-3-5-lightning",
    "aa-motif-0714",
    "aa-g9v3-3b",
    "aa-solar-open2-250b",
    "aa-g9v3-39a5b",
    "aa-motif-3",
    "hy-4-preview",
    "aa-jt-4-1-flash-236b-a21b-0709",
    "swe-2-flash",
    "swe-2",
    "aa-nemotron-3-5-bolt-74b-a9b",
    "aa-jt-4-1-flash-236b-a21b",
    "aa-lfm2-5-2-6b",
    "aa-ling-3-0-flash",
    "aa-ling-3-0-tiny",
    "aa-solar-mini4",
    "aa-longcat-2-0",
    "swe-1.7",
    "ling-3.0-flash-fin",
    "aa-minicpm5-2b",
    "ember-1",
    "aa-celeris-1",
}


def export():
    results = json.loads((SOURCE / "mean-bench.json").read_text())
    catalog = json.loads((SOURCE / "catalog.json").read_text())
    eligible = [m for m in results["models"] if m["scores"] and m["id"] not in EXCLUDED_MODELS]
    counts = Counter(key for model in eligible for key in model["scores"])
    benchmarks = [bench for bench in catalog["benchmarks"] if counts[bench["id"]] >= MIN_MODELS_PER_BENCHMARK]
    benchmark_ids = {bench["id"] for bench in benchmarks}
    ranked = []
    for model in eligible:
        scores = [result for key, result in model["scores"].items() if key in benchmark_ids]
        if not scores:
            continue
        costs = [result["cost_usd_per_task"] for result in scores if result["cost_usd_per_task"] is not None]
        # This entry is the vision-language release, distinct from the excluded text model.
        name = "Ling 3.0 Flash VL" if model["id"] == "ling-3.0-flash" else model["name"]
        ranked.append({
            "id": model["id"],
            "name": name,
            "developer": model["developer"],
            "score": mean(result["score"] for result in scores),
            "count": len(scores),
            "cost": mean(costs) if costs else None,
            "costCount": len(costs),
        })
    ranked.sort(key=lambda model: (-model["score"], -model["count"], model["name"]))
    return {
        "asOf": results["as_of"],
        "releaseRange": results["release_range_inclusive"],
        "benchmarkCount": len(benchmarks),
        "minimumModelsPerBenchmark": MIN_MODELS_PER_BENCHMARK,
        "benchmarks": [
            {"name": bench["name"], "source": bench["source"], "models": counts[bench["id"]]}
            for bench in benchmarks
        ],
        "models": [
            {"rank": rank, **model}
            for rank, model in enumerate(ranked, start=1)
        ],
    }


if __name__ == "__main__":
    destination = ROOT / "site" / "snapshot.json"
    destination.write_text(json.dumps(export(), ensure_ascii=False, separators=(",", ":")) + "\n")

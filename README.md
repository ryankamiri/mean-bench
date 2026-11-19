# Mean Bench

[Mean Bench](https://mean-bench.vercel.app/) compares recent AI models by their average benchmark score, coverage, and reported cost per task. The site documents the scoring rules and links to the benchmark sources.

## Development

Run `python3 -m http.server --directory site 8000` for a local preview. The static site reads the checked-in `site/snapshot.json`.

With the local benchmark inputs in `data/`, run `python3 scripts/calculate_mean_bench.py` followed by `python3 scripts/export_leaderboard.py` to refresh the public snapshot. The raw benchmark archive is stored locally.

Vercel serves `site/` directly using `vercel.json`.

Pushes to the GitHub `main` branch trigger a production deployment to [Mean Bench](https://mean-bench.vercel.app/).

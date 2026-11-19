import { labFor } from "./labs.js";

const namespace = "http://www.w3.org/2000/svg";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 });
const byId = id => document.getElementById(id);

function svg(tag, attributes, text) {
  const element = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function logo([lab, asset]) {
  if (!asset) return document.createTextNode("");
  const icon = document.createElement("img");
  icon.className = "lab-logo";
  icon.src = "logos/" + asset;
  icon.alt = "";
  icon.title = lab;
  return icon;
}

function renderChart(chart, models, selected, choose, coverage, describe) {
  const width = chart.clientWidth;
  const height = chart.clientHeight;
  if (!width || !height) return;
  const layer = chart.querySelector("g");
  const narrow = width < 530;
  const right = width - 23;
  const zero = 43;
  const hasZero = models.some(model => model.cost === 0);
  const start = hasZero ? (narrow ? 67 : 82) : 45;
  const bottom = height - 43;
  const top = 27;
  const positiveCosts = models.filter(m => m.cost > 0).map(m => m.cost);
  const low = Math.floor(Math.log10(Math.min(...positiveCosts)));
  const high = Math.ceil(Math.log10(Math.max(...positiveCosts)));
  const upper = Math.min(100, Math.ceil((Math.max(...models.map(m => m.score)) + 5) / 20) * 20);
  const x = cost => cost === 0 ? zero : start + (Math.log10(cost) - low) / (high - low) * (right - start);
  const y = score => bottom - score / upper * (bottom - top);
  const grid = (x1, y1, x2, y2) => layer.append(svg("line", { x1, y1, x2, y2, class: "grid" }));
  const label = (text, x, y, anchor = "middle") => layer.append(svg("text", { x, y, "text-anchor": anchor }, text));
  const tooltip = byId("point-tooltip");
  tooltip.hidden = true;
  layer.replaceChildren();
  chart.setAttribute("viewBox", [0, 0, width, height].join(" "));
  label("Mean score / 100", 6, 14, "start");
  for (let score = 0; score <= upper; score += 20) {
    grid(start, y(score), right, y(score));
    if (hasZero) grid(zero - 6, y(score), zero + 6, y(score));
    label(score, (hasZero ? zero - 13 : start - 9), y(score) + 4, "end");
  }
  for (let power = low; power <= high; power += 1) {
    const tick = 10 ** power;
    grid(x(tick), top, x(tick), bottom);
    if (!hasZero || power > low || !narrow) label("$" + tick, x(tick), bottom + 17);
    if (!narrow && power < high) grid(x(tick * 3), top, x(tick * 3), bottom);
  }
  if (hasZero) label("$0", zero, bottom + 17);
  label("Mean cost per task (USD, log scale)", width / 2, height - 5);

  const frontier = [];
  const byCost = [...models].sort((a, b) => a.cost - b.cost || b.score - a.score);
  for (const model of byCost) {
    if (!frontier.length || model.score > frontier.at(-1).score) frontier.push(model);
  }
  const positiveFrontier = frontier.filter(model => model.cost > 0);
  layer.append(svg("polyline", {
    class: "frontier",
    points: positiveFrontier.map(m => [x(m.cost), y(m.score)].join(",")).join(" "),
  }));
  const labelOrder = new Set([selected, ...models.slice(0, narrow ? 4 : 8), ...positiveFrontier.toReversed()].filter(Boolean));
  const points = models.map(model => ({
    model, px: x(model.cost), py: y(model.score), radius: labelOrder.has(model) ? 10 : 7,
  }));
  const lookup = new Map(points.map(point => [point.model, point]));
  points.sort((a, b) => a.radius - b.radius || b.model.rank - a.model.rank);
  const active = lookup.get(selected);
  for (const point of points) {
    if (point !== active) drawPoint(point);
  }
  if (active) {
    layer.append(svg("circle", { cx: active.px, cy: active.py, r: 14, class: "halo" }));
    drawPoint(active);
  }
  annotate(layer, [...labelOrder].map(model => lookup.get(model)).filter(Boolean), points, {
    width, top, bottom, max: narrow ? 4 : 11, coverage,
  });

  function drawPoint({ model, px, py, radius }) {
    const [lab, asset] = labFor(model);
    const point = asset
      ? svg("image", { href: "logos/" + asset, x: px - radius, y: py - radius, width: radius * 2, height: radius * 2 })
      : svg("text", { x: px, y: py, "text-anchor": "middle", "dominant-baseline": "middle" }, "?");
    point.setAttribute("class", "point");
    point.setAttribute("data-model", model.id);
    point.addEventListener("pointerenter", () => {
      const name = document.createElement("strong");
      name.textContent = model.name;
      const developer = document.createElement("span");
      developer.className = "quiet";
      developer.textContent = lab;
      const values = document.createElement("span");
      values.textContent = describe(model);
      tooltip.replaceChildren(name, developer, values);
      tooltip.hidden = false;
      const plot = chart.getBoundingClientRect();
      const frame = chart.parentElement.getBoundingClientRect();
      const left = plot.left - frame.left + px + 12;
      tooltip.style.left = Math.max(7, Math.min(left, frame.width - tooltip.offsetWidth - 7)) + "px";
      tooltip.style.top = Math.max(7, plot.top - frame.top + py - tooltip.offsetHeight - 8) + "px";
    });
    point.addEventListener("pointerleave", () => { tooltip.hidden = true; });
    point.addEventListener("click", () => choose(model));
    layer.append(point);
  }
}

function annotate(layer, candidates, points, { width, top, bottom, max, coverage }) {
  const placed = [];
  const blocked = points.map(({ px, py, radius }) => ({
    left: px - radius - 3, right: px + radius + 3, top: py - radius - 3, bottom: py + radius + 3,
  }));
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const { model, px, py, radius } of candidates) {
    if (placed.length >= max) break;
    const text = model.name + " · " + coverage(model);
    const note = svg("text", { class: "point-label", "dominant-baseline": "middle", visibility: "hidden" }, text);
    layer.append(note);
    const w = (note.getComputedTextLength?.() || text.length * 6.1) + 4;
    const h = 17;
    const pad = radius + 7;
    const mid = Math.max(38, Math.min(px - w / 2, width - w - 4));
    const slots = [
      [mid, py - pad - h], [px + pad, py - h / 2], [px - pad - w, py - h / 2],
      [mid, py + pad], [px + pad, py - pad - h], [px - pad - w, py - pad - h],
      [px + pad, py + pad], [px - pad - w, py + pad], [mid, py - pad - 2 * h],
    ];
    const box = slots.map(([left, top]) => ({ left, top, right: left + w, bottom: top + h }))
      .find(box => box.left >= 38 && box.right <= width - 3 && box.top >= top - 5 && box.bottom <= bottom - 2 &&
        !blocked.some(other => overlaps(box, other)) && !placed.some(other => overlaps(box, other)));
    if (!box) {
      note.remove();
      continue;
    }
    placed.push(box);
    const endX = Math.max(box.left, Math.min(px, box.right));
    const endY = Math.max(box.top, Math.min(py, box.bottom));
    if (Math.hypot(endX - px, endY - py) > pad + 3) {
      layer.insertBefore(svg("line", { class: "leader", x1: px, y1: py, x2: endX, y2: endY }), note);
    }
    note.setAttribute("x", box.left + 2);
    note.setAttribute("y", box.top + h / 2);
    note.removeAttribute("visibility");
  }
}

function initialize({ models, benchmarks, benchmarkCount, minimumModelsPerBenchmark, releaseRange }) {
  const chart = byId("scatter");
  const rows = byId("leaderboard-rows");
  const search = byId("model-search");
  const sort = byId("model-sort");
  const pageSize = 12;
  const withCost = models.filter(model => model.cost !== null);
  const coverage = model => model.count + "/" + benchmarkCount;
  const average = model => model.score.toFixed(2);
  const cost = model => model.cost === null ? "—" : usd.format(model.cost);
  const describe = model => [
    average(model) + " avg.",
    coverage(model) + " coverage",
    model.cost === null ? "Cost unavailable" : cost(model) + " / task",
  ].join(" · ");
  const snapshotDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const last = releaseRange.at(-1);
  byId("release-window").textContent = releaseRange.map(date => snapshotDate.format(new Date(date))).join(" – ") +
    ", " + last.slice(0, 4);
  byId("scored-count").textContent = models.length;
  for (const label of document.querySelectorAll("[data-benchmark-count]")) label.textContent = benchmarkCount;
  byId("minimum-benchmark-models").textContent = minimumModelsPerBenchmark;
  byId("plot-count").textContent = withCost.length + " models plotted";
  const legend = byId("legend");
  const occurrences = new Map();
  for (const model of withCost) {
    const lab = labFor(model);
    if (lab[1]) occurrences.set(lab, (occurrences.get(lab) ?? 0) + 1);
  }
  const commonLabs = [...occurrences].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [lab] of commonLabs) {
    const item = document.createElement("li");
    item.append(logo(lab), lab[0]);
    legend.append(item);
  }
  const frontierKey = document.createElement("li");
  frontierKey.className = "frontier-key";
  frontierKey.textContent = "Observed Pareto frontier";
  legend.append(frontierKey);
  for (const benchmark of benchmarks) {
    const item = document.createElement("li");
    const source = document.createElement("a");
    source.href = benchmark.source;
    source.textContent = benchmark.name;
    const count = document.createElement("span");
    count.className = "mono";
    count.textContent = benchmark.models + (benchmark.models === 1 ? " model" : " models");
    item.append(source, count);
    byId("benchmark-list").append(item);
  }

  let page = 0;
  let selected = null;
  let visible = models;
  function draw() {
    renderChart(chart, withCost, selected, choose, coverage, describe);
  }

  function choose(model, reveal = true) {
    selected = selected === model ? null : model;
    const index = visible.indexOf(model);
    const targetPage = index === -1 ? page : Math.floor(index / pageSize);
    if (reveal && targetPage !== page) {
      page = targetPage;
      renderRows();
    } else {
      for (const row of rows.rows) {
        const active = String(row.dataset.model === selected?.id);
        row.dataset.active = active;
        row.querySelector("button").setAttribute("aria-pressed", active);
      }
    }
    byId("chart-detail").textContent = selected
      ? selected.name + " · " + describe(selected) + (selected.cost === null ? "" : " (" + selected.costCount + " cost reports)")
      : "Select a model to see its score, coverage, and cost.";
    draw();
  }

  function updateFilters() {
    const query = search.value.trim().toLowerCase();
    visible = models.filter(model => (model.name + " " + labFor(model)[0]).toLowerCase().includes(query));
    if (sort.value === "coverage") visible.sort((a, b) => b.count - a.count || a.rank - b.rank);
    if (sort.value === "cost") visible.sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.rank - b.rank);
    for (const column of ["score", "coverage", "cost"]) {
      const header = byId(column + "-column");
      if (sort.value === column) header.setAttribute("aria-sort", column === "cost" ? "ascending" : "descending");
      else header.removeAttribute("aria-sort");
    }
    page = 0;
    renderRows();
  }

  function meterCell(row, text, share, variant) {
    const cell = row.insertCell();
    cell.className = "numeric";
    const wrapper = document.createElement("span");
    wrapper.className = "cell-value " + variant;
    const meter = document.createElement("span");
    meter.className = "meter";
    meter.setAttribute("aria-hidden", "true");
    const bar = document.createElement("i");
    bar.style.setProperty("--share", share + "%");
    meter.append(bar);
    const value = document.createElement("span");
    value.className = "mono " + (variant === "coverage-value" ? "" : "score-value");
    value.textContent = text;
    wrapper.append(meter, value);
    cell.append(wrapper);
  }

  function renderRows() {
    const start = page * pageSize;
    const pageRows = visible.slice(start, start + pageSize);
    rows.replaceChildren();
    for (const model of pageRows) {
      const row = rows.insertRow();
      row.dataset.model = model.id;
      row.dataset.active = String(model === selected);
      const rank = row.insertCell();
      rank.className = "rank mono quiet";
      rank.textContent = model.rank;
      const modelCell = document.createElement("th");
      modelCell.scope = "row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-btn";
      button.setAttribute("aria-pressed", String(model === selected));
      button.addEventListener("click", () => choose(model, false));
      const name = document.createElement("span");
      name.textContent = model.name;
      const lab = labFor(model);
      button.setAttribute("aria-label", model.name + " by " + lab[0]);
      button.append(logo(lab), name);
      modelCell.append(button);
      row.append(modelCell);
      meterCell(row, average(model), model.score, "");
      meterCell(row, coverage(model), 100 * model.count / benchmarkCount, "coverage-value");
      const price = row.insertCell();
      price.className = "numeric mono quiet";
      price.textContent = cost(model);
      price.title = model.cost === null ? "Cost unavailable" : "Average over " + model.costCount + " reported costs";
    }
    byId("empty-models").hidden = visible.length !== 0;
    byId("model-range").textContent = visible.length
      ? (start + 1) + "–" + (start + pageRows.length) + " of " + visible.length + " models"
      : "0 models";
    byId("previous").disabled = page === 0;
    byId("next").disabled = start + pageSize >= visible.length;
  }

  search.addEventListener("input", updateFilters);
  sort.addEventListener("change", updateFilters);
  byId("previous").addEventListener("click", () => { page -= 1; renderRows(); });
  byId("next").addEventListener("click", () => { page += 1; renderRows(); });
  renderRows();
  new ResizeObserver(draw).observe(chart);
  document.fonts.ready.then(draw);
}

fetch("snapshot.json")
  .then(response => {
    if (!response.ok) throw new Error("Could not load snapshot");
    return response.json();
  })
  .then(initialize)
  .catch(error => {
    console.error(error);
    byId("data-error").hidden = false;
  });

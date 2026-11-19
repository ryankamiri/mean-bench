import { labFor } from "./labs.js";

const namespace = "http://www.w3.org/2000/svg";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 });
const byId = id => document.getElementById(id);
const compact = window.matchMedia("(max-width: 640px)");
const setStoryLayout = () => { byId("launch-story").open = !compact.matches; };
setStoryLayout();
compact.addEventListener?.("change", setStoryLayout);

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

function getFrontier(models) {
  const frontier = [];
  const byCost = [...models].sort((a, b) => a.cost - b.cost || b.score - a.score);
  for (const model of byCost) {
    if (!frontier.length || model.score > frontier.at(-1).score) frontier.push(model);
  }
  return frontier;
}

function renderChart(chart, { models, plotted, frontier, selected, choose, coverage, describe }) {
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

  const positiveFrontier = frontier.filter(model => model.cost > 0);
  layer.append(svg("polyline", {
    class: "frontier",
    points: positiveFrontier.map(m => [x(m.cost), y(m.score)].join(",")).join(" "),
  }));
  const labelOrder = new Set([selected, ...plotted.slice(0, narrow ? 3 : 8), ...[...positiveFrontier].reverse()].filter(Boolean));
  const points = plotted.map(model => ({
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
    width, top, bottom, max: narrow ? 3 : 11, coverage,
  });

  chart.onclick = event => {
    const hitId = event.target.getAttribute?.("data-model");
    const hit = hitId && points.find(point => point.model.id === hitId);
    if (hit && event.pointerType === "mouse") {
      choose(hit.model);
      return;
    }
    const bounds = chart.getBoundingClientRect();
    const tapX = (event.clientX - bounds.left) * width / bounds.width;
    const tapY = (event.clientY - bounds.top) * height / bounds.height;
    let best = hit;
    let distance = 24;
    for (const point of points) {
      const delta = Math.hypot(tapX - point.px, tapY - point.py);
      if (delta < distance) {
        best = point;
        distance = delta;
      }
    }
    if (best) choose(best.model);
  };

  function drawPoint({ model, px, py, radius }) {
    const [lab, asset] = labFor(model);
    const point = asset
      ? svg("image", { href: "logos/" + asset, x: px - radius, y: py - radius, width: radius * 2, height: radius * 2 })
      : svg("text", { x: px, y: py, "text-anchor": "middle", "dominant-baseline": "middle" }, "?");
    point.setAttribute("class", "point");
    point.setAttribute("data-model", model.id);
    point.addEventListener("pointerenter", event => {
      if (event.pointerType !== "mouse") return;
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

function setupChartPicker(getModels, choose) {
  const input = byId("chart-model");
  const popup = byId("chart-options-popup");
  const list = byId("chart-model-options");
  const empty = byId("chart-model-empty");
  const picker = input.closest(".chart-picker");
  let committed = "";
  let matches = [];
  let active = -1;

  function positionPopup() {
    if (popup.hidden) return;
    const bounds = picker.getBoundingClientRect();
    const top = window.visualViewport?.offsetTop ?? 0;
    const height = window.visualViewport?.height ?? window.innerHeight;
    const below = top + height - bounds.bottom - 12;
    const above = bounds.top - top - 12;
    const useAbove = below < 140 && above > below;
    popup.dataset.placement = useAbove ? "above" : "below";
    popup.style.setProperty("--popup-height", Math.max(44, Math.min(240, useAbove ? above : below)) + "px");
  }

  function close() {
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    input.value = committed;
  }

  function show(query) {
    const terms = query.toLowerCase().trim().split(/\s+/);
    matches = getModels().filter(model => {
      const name = model.name.toLowerCase();
      const labWords = labFor(model)[0].toLowerCase().split(/\s+/);
      return terms.every(term => name.includes(term) || labWords.some(word => word.startsWith(term)));
    }).sort((a, b) => a.name.localeCompare(b.name));
    active = -1;
    input.removeAttribute("aria-activedescendant");
    list.replaceChildren();
    for (const [index, model] of matches.entries()) {
      const option = document.createElement("li");
      option.id = "chart-option-" + index;
      option.dataset.index = index;
      option.setAttribute("role", "option");
      option.setAttribute("aria-label", model.name);
      option.setAttribute("aria-selected", "false");
      option.append(logo(labFor(model)), model.name);
      list.append(option);
    }
    popup.hidden = false;
    empty.hidden = matches.length > 0;
    input.setAttribute("aria-expanded", "true");
    popup.scrollTop = 0;
    positionPopup();
  }

  function select(index) {
    choose(matches[index]);
    if (window.matchMedia("(pointer: coarse)").matches) input.blur();
  }

  function openCurrent() {
    show(input.value === committed ? "" : input.value);
  }

  input.addEventListener("focus", () => {
    input.select();
    openCurrent();
  });
  input.addEventListener("click", () => { if (popup.hidden) openCurrent(); });
  input.addEventListener("input", () => show(input.value));
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Escape" && !popup.hidden) {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && !popup.hidden && matches.length) {
      event.preventDefault();
      select(Math.max(0, active));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (popup.hidden) openCurrent();
      if (!matches.length) return;
      list.children[active]?.setAttribute("aria-selected", "false");
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = active < 0 && step < 0 ? matches.length - 1 : (active + step + matches.length) % matches.length;
      const option = list.children[active];
      option.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", option.id);
      const itemBounds = option.getBoundingClientRect();
      const popupBounds = popup.getBoundingClientRect();
      if (itemBounds.top < popupBounds.top) popup.scrollTop += itemBounds.top - popupBounds.top;
      if (itemBounds.bottom > popupBounds.bottom) popup.scrollTop += itemBounds.bottom - popupBounds.bottom;
    }
  });
  list.addEventListener("mousedown", event => {
    if (event.target.closest("[data-index]")) event.preventDefault();
  });
  list.addEventListener("click", event => {
    const option = event.target.closest("[data-index]");
    if (option) select(Number(option.dataset.index));
  });
  for (const event of ["pointerdown", "focusin"]) {
    document.addEventListener(event, ({ target }) => {
      if (!popup.hidden && !picker.contains(target)) close();
    });
  }
  window.addEventListener("scroll", positionPopup, { passive: true });
  window.addEventListener("resize", positionPopup);
  window.visualViewport?.addEventListener("resize", positionPopup);
  window.visualViewport?.addEventListener("scroll", positionPopup);
  return model => {
    committed = model?.name ?? "";
    close();
  };
}

function initialize({ models, benchmarks, benchmarkCount, minimumModelsPerBenchmark, releaseRange }) {
  const chart = byId("scatter");
  const rows = byId("leaderboard-rows");
  const search = byId("model-search");
  const sort = byId("model-sort");
  const rankLink = byId("chart-row-link");
  const detail = byId("chart-detail");
  const viewButtons = [...document.querySelectorAll("[data-chart-view]")];
  const pageSize = 12;
  const withCost = models.filter(model => model.cost !== null);
  const frontier = getFrontier(withCost);
  const chartViews = { all: withCost, top: withCost.slice(0, 10), frontier };
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
  let chartView = "all";
  const reflectPicker = setupChartPicker(() => chartViews[chartView], choose);

  function draw() {
    renderChart(chart, {
      models: withCost,
      plotted: chartViews[chartView],
      frontier: chartView === "top" ? [] : frontier,
      selected, choose, coverage, describe,
    });
  }

  function updateChartControls() {
    const plotted = chartViews[chartView];
    byId("plot-count").textContent = plotted.length + " models plotted";
    frontierKey.hidden = chartView === "top";
    for (const button of viewButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.chartView === chartView));
    }
  }

  function choose(model) {
    selected = model;
    if (model?.cost != null && !chartViews[chartView].includes(model)) {
      chartView = "all";
      updateChartControls();
    }
    const index = visible.indexOf(model);
    const targetPage = index === -1 ? page : Math.floor(index / pageSize);
    if (targetPage !== page) {
      page = targetPage;
      renderRows();
    } else {
      for (const row of rows.rows) {
        const active = String(row.dataset.model === selected?.id);
        row.dataset.active = active;
        row.querySelector("button").setAttribute("aria-pressed", active);
      }
    }
    reflectPicker(model?.cost != null ? model : null);
    rankLink.hidden = !model;
    if (model) {
      const name = document.createElement("strong");
      name.textContent = model.name;
      const price = model.cost === null ? "Cost unavailable" : cost(model) + "/task";
      detail.replaceChildren(name, average(model) + " avg. · " + coverage(model) + " · " + price);
    } else {
      detail.textContent = "Tap a logo or search for a model to see its score, coverage, and cost.";
    }
    draw();
  }

  for (const button of viewButtons) {
    button.addEventListener("click", () => {
      chartView = button.dataset.chartView;
      updateChartControls();
      choose(chartViews[chartView].includes(selected) ? selected : null);
    });
  }
  rankLink.addEventListener("click", event => {
    if (!selected) return;
    event.preventDefault();
    if (!visible.includes(selected)) {
      search.value = "";
      updateFilters();
    }
    choose(selected);
    const button = rows.querySelector('tr[data-active="true"] button');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "center" });
  });

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
      button.addEventListener("click", () => choose(selected === model ? null : model));
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
  updateChartControls();
  byId("chart-controls").hidden = false;
  byId("chart-selection").hidden = false;
  renderRows();
  draw();
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

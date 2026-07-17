import { Chart, axis, commonPlugins, VIRIDIS7, chartCanvas } from "./shared";
import { MONTH_NAMES, PERCENTILES } from "./derive";
function renderFlowDurationCurve(host, d) {
  const pts = (ys) => PERCENTILES.map((x, i) => ({ x, y: ys[i] }));
  const monthly = MONTH_NAMES.map((name, i) => ({
    label: name,
    data: pts(d.monthlyFdc[String(i + 1).padStart(2, "0")]),
    borderColor: VIRIDIS7[i % VIRIDIS7.length],
    borderWidth: 1,
    pointRadius: 0,
    hidden: true
  }));
  return new Chart(chartCanvas(host), {
    type: "line",
    data: { datasets: [
      { label: "All months", data: pts(d.fdc), borderColor: "#38bdf8", borderWidth: 2, pointRadius: 0 },
      ...monthly
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: commonPlugins("Flow duration curve"),
      scales: { x: axis("Percentile (%)", { type: "linear", min: 0, max: 100 }), y: axis("Flow (m³/s)", { beginAtZero: true }) }
    }
  });
}
export {
  renderFlowDurationCurve
};

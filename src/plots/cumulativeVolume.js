import { Chart, axis, TEXT, chartCanvas } from "./shared";
function renderCumulativeVolume(host, d) {
  const now = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const totals = Object.entries(d.cumulative).map(([y, a]) => ({ year: +y, total: a.y[a.y.length - 1] })).filter((t) => t.year < now).sort((a, b) => a.total - b.total);
  const driest = totals[0]?.year;
  const wettest = totals[totals.length - 1]?.year;
  const median = totals[Math.floor(totals.length / 2)]?.year;
  const highlight = {};
  if (wettest != null) highlight[wettest] = { color: "#3b82f6", name: `Wettest: ${wettest}` };
  if (driest != null) highlight[driest] = { color: "#ef4444", name: `Driest: ${driest}` };
  if (median != null) highlight[median] = { color: "#22c55e", name: `Median: ${median}` };
  const datasets = Object.entries(d.cumulative).map(([y, a]) => {
    const hl = highlight[+y];
    return {
      label: hl ? hl.name : String(y),
      data: a.x.map((x, i) => ({ x, y: a.y[i] / 1e6 })),
      borderColor: hl ? hl.color : "rgba(148,163,184,.35)",
      borderWidth: hl ? 2 : 0.8,
      pointRadius: 0,
      fill: false,
      order: hl ? 0 : 1,
      _hl: hl != null
    };
  });
  return new Chart(chartCanvas(host), {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        title: { display: true, text: "Cumulative annual volume", color: TEXT },
        // only the highlighted years appear in the legend (avoids ~80 faint entries)
        legend: { display: true, labels: { color: TEXT, boxWidth: 12, font: { size: 11 }, filter: (item, data) => data.datasets[item.datasetIndex]._hl === true } }
      },
      scales: {
        x: axis("Month", { type: "time", time: { unit: "month", displayFormats: { month: "MMM" } } }),
        y: axis("Cumulative volume (Mm³)", { beginAtZero: true })
      }
    }
  });
}
export {
  renderCumulativeVolume
};

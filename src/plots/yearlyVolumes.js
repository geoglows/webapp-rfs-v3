import { Chart, axis, commonPlugins, chartCanvas } from "./shared";
function renderYearlyVolumes(host, d) {
  const labels = d.yearlyVolumes.map((v) => v.year);
  const fiveYearFor = (year) => {
    const g = d.fiveYearAverages.find((a) => a.period === Math.floor(year / 5) * 5);
    return g ? g.average : null;
  };
  return new Chart(chartCanvas(host), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Annual volume", data: d.yearlyVolumes.map((v) => v.value), borderColor: "#00a6ff", borderWidth: 2, pointRadius: 2, tension: 0 },
        { label: "5-year average", data: labels.map(fiveYearFor), borderColor: "#ef4444", borderWidth: 2, pointRadius: 0, stepped: true }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: commonPlugins("Yearly volumes"),
      scales: { x: axis("Year"), y: axis("Volume (m³ × 10⁶)", { beginAtZero: true }) }
    }
  });
}
export {
  renderYearlyVolumes
};

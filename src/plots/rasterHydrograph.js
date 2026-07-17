import { MatrixController, MatrixElement } from "chartjs-chart-matrix";
import { Chart, AXIS, axis, commonPlugins, doyMonthAxis, VIRIDIS7, chartCanvas } from "./shared";
Chart.register(MatrixController, MatrixElement);
function renderRasterHydrograph(host, d) {
  const vals = d.raster.z.flat().filter((v) => v != null);
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const color = (v) => VIRIDIS7[Math.min(6, Math.max(0, Math.floor((v - vmin) / (vmax - vmin || 1) * 7)))];
  const data = [];
  d.raster.z.forEach((row, yi) => row.forEach((v, di) => {
    if (v != null) data.push({ x: di + 1, y: d.raster.years[yi], v });
  }));
  const nY = d.raster.years.length;
  return new Chart(chartCanvas(host), {
    type: "matrix",
    data: {
      datasets: [{
        label: "Discharge (m³/s)",
        data,
        backgroundColor: ((c) => color(c.raw.v)),
        borderWidth: 0,
        width: ((c) => c.chart.chartArea ? c.chart.chartArea.width / 366 : 0),
        height: ((c) => c.chart.chartArea ? c.chart.chartArea.height / nY : 0)
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        ...commonPlugins("Raster hydrograph", false),
        tooltip: { callbacks: {
          title: () => "",
          label: (c) => {
            const r = c.raw;
            return `${r.y} · day ${r.x}: ${r.v.toFixed(1)} m³/s`;
          }
        } }
      },
      scales: {
        x: { ...doyMonthAxis(), title: { display: true, text: "Day of year", color: AXIS } },
        y: axis("Year", { type: "linear", min: d.raster.years[0] - 0.5, max: d.raster.years[nY - 1] + 0.5, ticks: { color: AXIS, stepSize: 5, precision: 0 } })
      }
    }
  });
}
export {
  renderRasterHydrograph
};

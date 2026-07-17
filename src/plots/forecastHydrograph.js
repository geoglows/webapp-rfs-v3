import zoomPlugin from "chartjs-plugin-zoom";
import { Chart, AXIS, GRID, TEXT, rgba, chartCanvas } from "./shared";
import { t } from "../i18n/i18n";
Chart.register(zoomPlugin);
const SKY = "rgb(56,189,248)";
const HIRES = "#f59e0b";
const pts = (dates, ys) => dates.map((d, i) => ({ x: d.getTime(), y: ys[i] })).filter((p) => Number.isFinite(p.y));
function renderForecastHydrograph(host, riverId, b) {
  const canvas = chartCanvas(host);
  const x = b.datetime;
  const firstX = x.length ? x[0].getTime() : 0;
  const lastX = x.length ? x[x.length - 1].getTime() : firstX;
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Range (min–max)",
          data: pts(x, b.max),
          parsing: false,
          fill: "+1",
          backgroundColor: rgba(SKY, 0.12),
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.2
        },
        {
          label: "_min",
          data: pts(x, b.min),
          parsing: false,
          fill: false,
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.2
        },
        {
          label: "IQR (25–75%)",
          data: pts(x, b.p75),
          parsing: false,
          fill: "+1",
          backgroundColor: rgba(SKY, 0.25),
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.2
        },
        {
          label: "_p25",
          data: pts(x, b.p25),
          parsing: false,
          fill: false,
          borderWidth: 0,
          pointRadius: 0,
          pointHitRadius: 0,
          tension: 0.2
        },
        {
          label: "Ensemble median",
          data: pts(x, b.median),
          parsing: false,
          fill: false,
          borderColor: SKY,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 6,
          tension: 0.2
        },
        {
          label: "High-res forecast",
          data: pts(x, b.highRes),
          parsing: false,
          fill: false,
          borderColor: HIRES,
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          pointHitRadius: 6,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // nearest (not index): the ensemble and high-res series have different step counts, so an
      // index-aligned tooltip would pair mismatched times. nearest reports the single closest point.
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          position: "right",
          labels: { color: TEXT, boxWidth: 12, font: { size: 11 }, filter: (i) => !i.text.startsWith("_") }
        },
        title: { display: true, color: TEXT, text: `15-day ensemble forecast · river ${riverId}` },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toISOString().slice(0, 16).replace("T", " ") + " UTC",
            label: (it) => ` ${it.dataset.label}: ${it.parsed.y.toFixed(2)} m³/s`
          }
        },
        zoom: {
          zoom: {
            drag: { enabled: true, backgroundColor: rgba(SKY, 0.15), borderColor: rgba(SKY, 0.6), borderWidth: 1 },
            wheel: { enabled: false },
            pinch: { enabled: true },
            mode: "xy"
          },
          pan: { enabled: true, mode: "xy", modifierKey: "shift" },
          limits: { x: { min: firstX, max: lastX } }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "day", displayFormats: { day: "MMM d" } },
          min: firstX,
          max: lastX,
          title: { display: true, text: t("charts.axis.datetime"), color: AXIS },
          ticks: { color: AXIS, maxRotation: 0 },
          grid: { color: GRID }
        },
        y: {
          // hydrographs always anchor the y-axis at 0 so discharge magnitude reads honestly
          beginAtZero: true,
          title: { display: true, text: "Discharge (m³/s)", color: AXIS },
          grace: "5%",
          ticks: { color: AXIS },
          grid: { color: GRID }
        }
      }
    }
  });
  return chart;
}
export {
  renderForecastHydrograph
};

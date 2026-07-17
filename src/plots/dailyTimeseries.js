import { Decimation } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { Chart, AXIS, GRID, TEXT, chartCanvas } from "./shared";
import { t } from "../i18n/i18n";
Chart.register(Decimation, zoomPlugin);
function renderDailyTimeseries(host, ts) {
  const tools = document.createElement("div");
  tools.className = "chart-tools";
  host.appendChild(tools);
  const canvas = chartCanvas(host);
  const data = ts.datetime.map((d, i) => ({ x: d.getTime(), y: ts.discharge[i] })).filter((p) => Number.isFinite(p.y));
  const firstX = data.length ? data[0].x : 0;
  const lastX = data.length ? data[data.length - 1].x : firstX;
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label: "Daily mean discharge",
        data,
        parsing: false,
        borderColor: "#38bdf8",
        borderWidth: 1,
        pointRadius: 0,
        pointHitRadius: 4,
        tension: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        title: { display: true, text: `Retrospective daily discharge · river ${ts.riverId}`, color: TEXT },
        decimation: { enabled: true, algorithm: "lttb", samples: 600 },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toISOString().slice(0, 10),
            label: (it) => ` ${it.parsed.y.toFixed(2)} m³/s`
          }
        },
        zoom: {
          // plain click-drag draws a rubber-band box to zoom into a rectangle (both axes);
          // wheel is off so scrolling the modal is never captured
          zoom: {
            drag: { enabled: true, backgroundColor: "rgba(56,189,248,.15)", borderColor: "rgba(56,189,248,.6)", borderWidth: 1 },
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
          time: { unit: "year" },
          min: firstX,
          max: lastX,
          title: { display: true, text: t("charts.axis.datetime"), color: AXIS },
          ticks: { color: AXIS, maxRotation: 0 },
          grid: { color: GRID }
        },
        y: { title: { display: true, text: "Discharge (m³/s)", color: AXIS }, beginAtZero: true, ticks: { color: AXIS }, grid: { color: GRID } }
      }
    }
  });
  const setRange = (years) => {
    const x = chart.options.scales.x;
    if (years === "all") {
      x.min = firstX;
    } else {
      const start = new Date(lastX);
      start.setFullYear(start.getFullYear() - years);
      x.min = Math.max(firstX, start.getTime());
    }
    x.max = lastX;
    chart.update("none");
  };
  const mkBtn = (label, fn) => {
    const b = document.createElement("button");
    b.className = "chart-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  tools.append(
    mkBtn("1y", () => setRange(1)),
    mkBtn("5y", () => setRange(5)),
    mkBtn("10y", () => setRange(10)),
    mkBtn("30y", () => setRange(30)),
    mkBtn("All", () => setRange("all")),
    mkBtn("Reset zoom", () => chart.resetZoom())
  );
  const hint = document.createElement("span");
  hint.className = "chart-hint";
  hint.textContent = "drag a box to zoom · shift-drag to pan";
  tools.appendChild(hint);
  return chart;
}
export {
  renderDailyTimeseries
};

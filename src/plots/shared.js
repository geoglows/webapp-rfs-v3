import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  TimeScale,
  Filler,
  Legend,
  Tooltip,
  Title
} from "chart.js";
import "chartjs-adapter-date-fns";
import { MONTH_NAMES, MONTH_START_DOY } from "./derive";
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, TimeScale, Filler, Legend, Tooltip, Title);
Chart.defaults.plugins.title.font = { ...Chart.defaults.plugins.title.font, size: 18 };
Chart.defaults.plugins.legend.position = "right";
Chart.defaults.scale.title.font = { size: 14, weight: "bold" };
let AXIS = "#94a3b8";
let GRID = "rgba(148,163,184,.12)";
let TEXT = "#e2e8f0";
function refreshChartTheme() {
  const light = document.documentElement.dataset.theme === "light";
  AXIS = light ? "#0f172a" : "#94a3b8";
  TEXT = light ? "#0f172a" : "#e2e8f0";
  GRID = light ? "rgba(15,23,42,.14)" : "rgba(148,163,184,.12)";
}
const VIRIDIS5 = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];
const VIRIDIS7 = ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#bddf26", "#fde725"];
const rgba = (rgb, a) => rgb.replace("rgb(", "rgba(").replace(")", `, ${a})`);
const axis = (text, opts = {}) => ({
  title: { display: true, text, color: AXIS },
  ticks: { color: AXIS },
  grid: { color: GRID },
  ...opts
});
const commonPlugins = (title, legend = true) => ({
  legend: { display: legend, labels: { color: TEXT, boxWidth: 12, font: { size: 11 } } },
  title: { display: true, text: title, color: TEXT }
});
const doyMonthAxis = () => ({
  type: "linear",
  min: 0.5,
  max: 366.5,
  afterBuildTicks: (a) => {
    a.ticks = MONTH_START_DOY.map((value) => ({ value }));
  },
  ticks: { color: AXIS, callback: (v) => MONTH_NAMES[MONTH_START_DOY.indexOf(Number(v))] ?? "" },
  grid: { color: GRID }
});
function chartCanvas(host) {
  const wrap = document.createElement("div");
  wrap.className = "chart-canvas";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  return canvas;
}
export {
  AXIS,
  Chart,
  GRID,
  TEXT,
  VIRIDIS5,
  VIRIDIS7,
  axis,
  chartCanvas,
  commonPlugins,
  doyMonthAxis,
  refreshChartTheme,
  rgba
};

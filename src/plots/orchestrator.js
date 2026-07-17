import { deriveForecast } from "../forecastTimeseries";
import { refreshChartTheme } from "./shared";
import { deriveRetro } from "./derive";
import { renderDailyTimeseries } from "./dailyTimeseries";
import { renderMonthlyStatus } from "./monthlyStatus";
import { renderFlowDurationCurve } from "./flowDurationCurve";
import { renderYearlyVolumes } from "./yearlyVolumes";
import { renderYearlyPeaks } from "./yearlyPeaks";
import { renderRasterHydrograph } from "./rasterHydrograph";
import { renderCumulativeVolume } from "./cumulativeVolume";
import { renderForecastHydrograph } from "./forecastHydrograph";
let activeRetro = [];
let activeForecast = [];
const destroy = (list) => list.forEach((c) => c.destroy());
function clearPlots() {
  destroy(activeRetro);
  activeRetro = [];
  destroy(activeForecast);
  activeForecast = [];
}
function block(root) {
  const host = document.createElement("div");
  host.className = "plot-block";
  root.appendChild(host);
  return host;
}
function plotAllRetro(root, ts) {
  destroy(activeRetro);
  activeRetro = [];
  refreshChartTheme();
  root.innerHTML = "";
  const d = deriveRetro(ts);
  activeRetro.push(
    renderDailyTimeseries(block(root), ts),
    renderMonthlyStatus(block(root), d),
    renderFlowDurationCurve(block(root), d),
    renderYearlyVolumes(block(root), d),
    renderYearlyPeaks(block(root), d),
    renderRasterHydrograph(block(root), d),
    renderCumulativeVolume(block(root), d)
  );
}
function plotAllForecast(root, fc) {
  destroy(activeForecast);
  activeForecast = [];
  refreshChartTheme();
  root.innerHTML = "";
  const b = deriveForecast(fc);
  activeForecast.push(renderForecastHydrograph(block(root), fc.riverId, b));
}
export {
  clearPlots,
  plotAllForecast,
  plotAllRetro
};

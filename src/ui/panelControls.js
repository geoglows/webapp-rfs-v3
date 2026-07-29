import {t} from "../i18n/i18n";

const $ = (id) => document.getElementById(id);

/**
 * The left panel's own controls: forecast-date picker, stream styleset, and the bottom player's
 * visibility toggle. Owns the styleset and slider-visibility state.
 *
 * onForecastDateChange(date) fires when the user picks a new initialization date — the caller is
 * responsible for propagating it (the stream animation and the flood forecast styles both read it).
 */
function createPanelControls({streams, onForecastDateChange}) {
  let currentStyleset = "max-flow";
  let sliderVisible = true;

  // The player (bottom timeseries slider) only makes sense for the animated "15-Day Forecast
  // Timeseries" styleset, and only when the user hasn't toggled it off. Any other styleset
  // disables the toggle and hides the player entirely.
  function updateSliderVisibility() {
    const isTimeseries = currentStyleset === "timeseries";
    const show = isTimeseries && sliderVisible;
    $("player").classList.toggle("hidden", !show);
    if (!show) streams.pause();
    const btn = $("btn-toggle-slider");
    if (!btn) return;
    btn.disabled = !isTimeseries;
    btn.classList.toggle("active", show);
    const label = t(show ? "stream.hideSlider" : "stream.showSlider");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function initStreamStyleControls() {
    const sel = $("stream-style");
    if (sel) {
      sel.value = currentStyleset;
      sel.addEventListener("change", () => {
        currentStyleset = sel.value;
        streams.setStyleset(currentStyleset);
        updateSliderVisibility();
      });
    }
    $("btn-toggle-slider")?.addEventListener("click", () => {
      sliderVisible = !sliderVisible;
      updateSliderVisibility();
    });
    updateSliderVisibility();
  }

  /** Deferred until the map has loaded, since changing the date drives the stream animation. */
  function initForecastDatePicker({defaultDate}) {
    const input = $("forecast-date");
    if (!input) return;
    input.value = defaultDate;
    input.addEventListener("change", () => {
      const date = input.value;
      if (!date) return;
      console.log(`Switching forecast date to ${date}…`);
      void streams.setDate(date);
      onForecastDateChange(date);
    });
  }

  initStreamStyleControls();
  return {initForecastDatePicker, updateSliderVisibility};
}

export {createPanelControls};

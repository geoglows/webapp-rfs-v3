import {setLanguage, t} from "../i18n/i18n";
import {wireMenu} from "../map/menu";
import {DEFAULT_FORECAST_DATE} from "../constants";

const $ = (id) => document.getElementById(id);

/**
 * The left panel's own controls: language picker, forecast-date picker, stream styleset, and the
 * bottom player's visibility toggle. Owns the styleset and slider-visibility state.
 *
 * onForecastDateChange(date) fires when the user picks a new initialization date — the caller is
 * responsible for propagating it (the stream animation and the flood forecast styles both read it).
 */
function createPanelControls({anim, onForecastDateChange, onLanguageChange}) {
  let currentStyleset = "timeseries";
  let sliderVisible = true;

  // The player (bottom timeseries slider) only makes sense for the animated "15 Day Forecast
  // Timeseries" styleset, and only when the user hasn't toggled it off. Any other styleset
  // disables the toggle and hides the player entirely.
  function updateSliderVisibility() {
    const isTimeseries = currentStyleset === "timeseries";
    const show = isTimeseries && sliderVisible;
    $("player").classList.toggle("hidden", !show);
    if (!show) anim.pause();
    const btn = $("btn-toggle-slider");
    if (!btn) return;
    btn.disabled = !isTimeseries;
    btn.classList.toggle("active", show);
    const label = t(show ? "stream.hideSlider" : "stream.showSlider");
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function initLanguagePicker() {
    const menu = $("lang-menu");
    const options = [...menu.querySelectorAll(".layer-opt[data-lang]")];
    const saved = localStorage.getItem("rfs-lang") ?? "en";
    setLanguage(saved);
    // Same dropdown behaviour as the basemap and layer pickers.
    const closeMenu = wireMenu($("btn-language"), menu);
    for (const opt of options) {
      const code = opt.dataset.lang;
      opt.classList.toggle("active", code === saved);
      opt.addEventListener("click", () => {
        setLanguage(code);
        // Re-translates the toggle's title/aria-label in the newly picked language.
        updateSliderVisibility();
        // setLanguage() only walks [data-i18n] elements, which cannot reach text drawn into a
        // canvas — the charts have to be rendered again to change language.
        onLanguageChange?.(code);
        localStorage.setItem("rfs-lang", code);
        options.forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
        closeMenu();
      });
    }
  }

  function initStreamStyleControls() {
    const sel = $("stream-style");
    if (sel) {
      sel.value = currentStyleset;
      sel.addEventListener("change", () => {
        currentStyleset = sel.value;
        anim.setStyleset(currentStyleset);
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
  function initForecastDatePicker() {
    const input = $("forecast-date");
    if (!input) return;
    input.value = DEFAULT_FORECAST_DATE;
    input.addEventListener("change", () => {
      const date = input.value;
      if (!date) return;
      console.log(`Switching forecast date to ${date}…`);
      anim.setDate(date);
      onForecastDateChange(date);
    });
  }

  const legendToggle = $("set-legend");
  legendToggle?.addEventListener("change", () =>
    $("legend-overlay")?.classList.toggle("hidden", !legendToggle.checked));

  initLanguagePicker();
  initStreamStyleControls();

  return {initForecastDatePicker};
}

export {createPanelControls};

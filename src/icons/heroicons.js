import informationCircle from "heroicons/24/outline/information-circle.svg?raw";
import cog6Tooth from "heroicons/24/outline/cog-6-tooth.svg?raw";
import language from "heroicons/24/outline/language.svg?raw";
import sun from "heroicons/24/outline/sun.svg?raw";
import moon from "heroicons/24/outline/moon.svg?raw";
import chartBarSolid from "heroicons/24/solid/chart-bar.svg?raw";
import bookmarkSolid from "heroicons/24/solid/bookmark.svg?raw";
import magnifyingGlassSolid from "heroicons/24/solid/magnifying-glass.svg?raw";
import clockSolid from "heroicons/24/solid/clock.svg?raw";

const ICONS = {
  "information-circle": informationCircle,
  "cog-6-tooth": cog6Tooth,
  language,
  sun,
  moon,
  "chart-bar-solid": chartBarSolid,
  "bookmark-solid": bookmarkSolid,
  "magnifying-glass-solid": magnifyingGlassSolid,
  "clock-solid": clockSolid
};

function heroIcon(name) {
  const tpl = document.createElement("template");
  tpl.innerHTML = ICONS[name].trim();
  return tpl.content.firstElementChild;
}

export {
  heroIcon
};

import {t} from "../i18n/i18n";
import informationCircle from "heroicons/24/outline/information-circle.svg?raw";
import questionMarkCircle from "heroicons/24/outline/question-mark-circle.svg?raw";
import cog6Tooth from "heroicons/24/outline/cog-6-tooth.svg?raw";
import language from "heroicons/24/outline/language.svg?raw";
import sun from "heroicons/24/outline/sun.svg?raw";
import moon from "heroicons/24/outline/moon.svg?raw";
import chartBarSolid from "heroicons/24/solid/chart-bar.svg?raw";
import bookmarkSolid from "heroicons/24/solid/bookmark.svg?raw";
import heart from "heroicons/24/outline/heart.svg?raw";
import heartSolid from "heroicons/24/solid/heart.svg?raw";
import magnifyingGlassSolid from "heroicons/24/solid/magnifying-glass.svg?raw";
import clockSolid from "heroicons/24/solid/clock.svg?raw";
import arrowDownTray from "heroicons/24/outline/arrow-down-tray.svg?raw";
import backspace from "heroicons/24/outline/backspace.svg?raw";
import trash from "heroicons/24/outline/trash.svg?raw";
import mapPin from "heroicons/24/outline/map-pin.svg?raw";
import xMark from "heroicons/24/outline/x-mark.svg?raw";
import magnifyingGlass from "heroicons/24/outline/magnifying-glass.svg?raw";
import chevronDown from "heroicons/24/outline/chevron-down.svg?raw";
import chevronRight from "heroicons/24/outline/chevron-right.svg?raw";

const ICONS = {
  "information-circle": informationCircle,
  "question-mark-circle": questionMarkCircle,
  "cog-6-tooth": cog6Tooth,
  language,
  sun,
  moon,
  "chart-bar-solid": chartBarSolid,
  "bookmark-solid": bookmarkSolid,
  heart,
  "heart-solid": heartSolid,
  "magnifying-glass-solid": magnifyingGlassSolid,
  "clock-solid": clockSolid,
  "arrow-down-tray": arrowDownTray,
  backspace,
  trash,
  "map-pin": mapPin,
  "x-mark": xMark,
  "magnifying-glass": magnifyingGlass,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight
};

function heroIcon(name) {
  const tpl = document.createElement("template");
  tpl.innerHTML = ICONS[name].trim();
  return tpl.content.firstElementChild;
}

/** A button whose face is a heroicon and whose name is a translated title/aria-label. */
const iconButton = (icon, titleKey, className = "") => {
  const btn = document.createElement("button");
  btn.className = `btn icon ${className}`.trim();
  btn.replaceChildren(heroIcon(icon));
  btn.title = t(titleKey);
  btn.setAttribute("aria-label", t(titleKey));
  return btn;
};

/** Fill every element declaring a data-icon-name with its heroicon. Run once at startup. */
const hydrateIcons = () => {
  document
    .querySelectorAll("[data-icon-name]")
    .forEach((el) => {
      const iconName = el.getAttribute("data-icon-name");
      if (iconName) el.replaceChildren(heroIcon(iconName));
    });
}

export {
  heroIcon,
  hydrateIcons,
  iconButton
}

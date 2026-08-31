const GAP = 8;
const EDGE = 8;

function clippingRect(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (style.overflow !== "visible" || style.overflowX !== "visible") return p.getBoundingClientRect();
  }
  return {left: 0, right: window.innerWidth};
}

function placeMenu(btn, menu) {
  const anchor = btn.getBoundingClientRect();
  // Measured while visible — the caller un-hides before placing, and `.hidden` is display:none.
  const {width, height} = menu.getBoundingClientRect();
  const bounds = clippingRect(btn);
  const minLeft = Math.max(0, bounds.left) + EDGE;
  const maxRight = Math.min(window.innerWidth, bounds.right) - EDGE;
  let left = anchor.left;
  if (left + width > maxRight) left = anchor.right - width;
  // Still too wide for the space either way — a menu partly out of reach beats one that is cut off.
  left = Math.min(Math.max(minLeft, left), Math.max(minLeft, maxRight - width));
  let top = anchor.bottom + GAP;
  // Flip above the button when a short viewport leaves no room beneath it.
  if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, anchor.top - GAP - height);
  menu.style.position = "fixed";
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
}

/**
 * Shared behavior for the dropdown menus (basemap picker, layer picker, language picker): clicking
 * the button toggles its menu, clicking anywhere else closes it. Returns the close function so the
 * caller can also close on selection.
 *
 * `anchored` pins the menu to the button in viewport coordinates on each open — see placeMenu(),
 * and pass it for any menu whose button sits inside a clipping container.
 */
function wireMenu(btn, menu, {anchored = false} = {}) {
  const closeMenu = () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => {
    // classList.toggle returns whether the class was added, so `hidden` true means it just closed.
    const hidden = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!hidden));
    if (!hidden && anchored) placeMenu(btn, menu);
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
  });
  // A fixed menu does not follow its button, and the button moves: the panel is half the viewport
  // once a dock opens, and the header relaid out at that width. Re-place rather than close, so a
  // resize behind an open menu doesn't leave it stranded across the screen from its button.
  if (anchored) {
    window.addEventListener("resize", () => {
      if (!menu.classList.contains("hidden")) placeMenu(btn, menu);
    });
  }
  return closeMenu;
}

export {wireMenu};

/**
 * Shared behavior for the map-control dropdowns (basemap picker, layer picker): clicking the
 * button toggles its menu, clicking anywhere else closes it. Returns the close function so the
 * caller can also close on selection.
 */
function wireMenu(btn, menu) {
  const closeMenu = () => {
    menu.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", () => {
    const open = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
  });
  return closeMenu;
}

export {wireMenu};

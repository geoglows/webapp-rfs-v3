/**
 * Shared plumbing for the panels that dock into the left column — the charts dock, the default
 * bookmarks list, and the rivers the user saved. At most one is open at a time: they occupy the
 * same space beneath the hydrology controls and all widen the panel to half the viewport (see the
 * charts dock block in style.css).
 *
 * Each dock `name` has a `#<name>-dock` element in index.html, shown by the `<name>-open` class on
 * <body>; `dock-open` marks "some dock is open" and drives the shared layout rules.
 */
const DOCKS = ["charts", "bookmarks", "saved"];
const cleanups = new Map();

const onDockClosed = (name, fn) => cleanups.set(name, fn)
const isDockOpen= name => document.body.classList.contains(`${name}-open`)

// Each dock's `#btn-<name>` header button is lit while its dock is open, matching the other
// stateful icon buttons (e.g. the player toggle).
const syncDockButton = (name) =>
  document.getElementById(`btn-${name}`)?.classList.toggle("active", isDockOpen(name))

// The MapLibre canvas doesn't track sibling layout changes, so it needs a resize once the panel
// settles at its new width. Resizing every frame of the transition instead would force ~20 full GL
// viewport resets and a layout read apiece; the canvas is stretched by CSS in the meantime, so one
// resize at the end is all that's needed. The timeout is a fallback for when transitionend doesn't
// fire (panel already at its target width, reduced motion, …).
function reflowMap(map, durationMs = 340) {
  const panel = document.getElementById("panel");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    panel?.removeEventListener("transitionend", onEnd);
    map.resize();
  };
  const onEnd = (e) => {
    if (e.propertyName === "flex-basis") finish()
  }
  panel?.addEventListener("transitionend", onEnd);
  setTimeout(finish, durationMs);
}

function openDock(map, name) {
  // Swapping one dock for another leaves the panel at the same width, so only a cold open reflows.
  const wasWide = document.body.classList.contains("dock-open");
  for (const other of DOCKS) {
    if (other === name || !isDockOpen(other)) continue;
    document.body.classList.remove(`${other}-open`);
    syncDockButton(other);
    cleanups.get(other)?.();
  }
  document.body.classList.add("dock-open", `${name}-open`);
  syncDockButton(name);
  if (!wasWide) reflowMap(map);
}

function closeDock(map, name) {
  if (!isDockOpen(name)) return;
  document.body.classList.remove(`${name}-open`, "dock-open");
  syncDockButton(name);
  cleanups.get(name)?.();
  reflowMap(map);
}

function closeAllDocks(map) {
  for (const name of DOCKS) closeDock(map, name);
}

export {closeAllDocks, closeDock, isDockOpen, onDockClosed, openDock};

/**
 * Shared plumbing for the panels that dock into the left column — the charts dock, the default
 * bookmarks list, the rivers the user saved, the help/about text, and the styling options. At most
 * one is open at a time: they occupy the same space beneath the hydrology controls and widen the
 * panel — to half the viewport, or to the narrower width the styling dock asks for (see the dock
 * block in app.css).
 *
 * Each dock `name` has a `#<name>-dock` element in index.html, shown by the `<name>-open` class on
 * <body>; `dock-open` marks "some dock is open" and drives the shared layout rules.
 */
const DOCKS = ["charts", "bookmarks", "saved", "help", "styling"];
const cleanups = new Map();

const onDockClosed = (name, fn) => cleanups.set(name, fn)
const isDockOpen= name => document.body.classList.contains(`${name}-open`)

// Each dock's `#btn-<name>` header button is lit while its dock is open, matching the other
// stateful icon buttons (e.g. the player toggle).
const syncDockButton = (name) =>
  document.getElementById(`btn-${name}`)?.classList.toggle("active", isDockOpen(name))

/**
 * The MapLibre canvas doesn't track sibling layout changes, so it needs a resize once the panel
 * settles at its new width. Resizing every frame of the transition instead would force ~20 full GL
 * viewport resets and a layout read apiece; `dock-resizing` stretches the canvas to its box with
 * CSS for the length of the slide instead, so one resize at the end is all that's needed. The
 * timeout is a fallback for when transitionend doesn't fire (panel already at its target width,
 * reduced motion, …), and is also what takes the class back off in those cases.
 *
 * Resolves once the map is at its final size, which is what a caller wanting to move the camera has
 * to wait for: MapLibre captures the screen point an ease travels toward *before* the animation
 * starts and only recomputes it for an animated padding, so a resize landing mid-flight leaves the
 * target pinned to the pixel that used to be the middle of a wider map. Half the window later that
 * pixel is well off to the side, which is exactly how far off the destination ends up.
 */
function reflowMap(map, durationMs = 580) {
  const panel = document.getElementById("panel");
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      panel?.removeEventListener("transitionend", onEnd);
      // resize first, so the canvas already carries its true size by the time the stretch comes
      // off it — the two land in the same frame and nothing flashes between them.
      map.resize();
      document.body.classList.remove("dock-resizing");
      resolve();
    };
    const onEnd = (e) => {
      if (e.propertyName === "flex-basis") finish()
    }
    document.body.classList.add("dock-resizing");
    panel?.addEventListener("transitionend", onEnd);
    setTimeout(finish, durationMs);
  });
}

// The styling dock widens the panel less than the rest do (see app.css), so it is the one swap
// between two docks that still changes the panel's width.
const NARROW = new Set(["styling"]);

/** Show a dock, resolving once the panel and the map have settled at their new widths. */
function openDock(map, name) {
  // Swapping one dock for another usually leaves the panel at the same width, so only a cold open
  // — or a swap across the narrow/wide line — reflows.
  const open = DOCKS.filter(isDockOpen);
  const sameWidth = open.length > 0 && open.every(other => NARROW.has(other) === NARROW.has(name));
  for (const other of open) {
    if (other === name) continue;
    document.body.classList.remove(`${other}-open`);
    syncDockButton(other);
    cleanups.get(other)?.();
  }
  document.body.classList.add("dock-open", `${name}-open`);
  syncDockButton(name);
  return sameWidth ? Promise.resolve() : reflowMap(map);
}

function closeDock(map, name) {
  if (!isDockOpen(name)) return;
  document.body.classList.remove(`${name}-open`, "dock-open");
  syncDockButton(name);
  cleanups.get(name)?.();
  void reflowMap(map);
}

function closeAllDocks(map) {
  for (const name of DOCKS) closeDock(map, name);
}

export {closeAllDocks, closeDock, isDockOpen, onDockClosed, openDock};

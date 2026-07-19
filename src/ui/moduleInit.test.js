import {beforeAll, describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";

/**
 * Guards the composition-root split (main.js → floodController / chartsDock / panelControls).
 *
 * Each factory wires DOM listeners and runs real init work (setFloodStyle, updateSliderVisibility)
 * the moment it's called, so a typo'd element id or a null-deref there breaks the app on load
 * without failing the build. This boots all three against a stub DOM whose getElementById mirrors
 * the browser — real ids from index.html resolve, anything else is null — then fires every
 * listener they registered.
 */

const ids = new Set([...readFileSync("index.html", "utf8").matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const nodes = new Map();
const listeners = [];

function stubEl(id) {
  if (nodes.has(id)) return nodes.get(id);
  const node = {
    id, style: {}, dataset: {}, options: [], selectedIndex: 0,
    value: "0", textContent: "", innerHTML: "", className: "",
    disabled: false, hidden: false, max: "0",
    classList: {
      add() {
      }, remove() {
      }, toggle() {
      }, contains: () => false
    },
    setAttribute() {
    }, removeAttribute() {
    }, replaceChildren() {
    },
    appendChild() {
    }, remove() {
    },
    addEventListener: (type, fn) => listeners.push([id, type, fn]),
    removeEventListener() {
    },
    querySelectorAll: () => [], querySelector: () => null, contains: () => false
  };
  nodes.set(id, node);
  return node;
}

const anim = {
  pause() {
  }, setDate() {
  }, setStyleset() {
  }, setFloodMode() {
  }, addStreamsLayer() {
  }
};
// Covers every MapLibre method selection.js / tilesLayer.js / overlay.js reach for.
const map = {
  getLayer: () => null, addLayer() {
  }, removeLayer() {
  },
  getSource: () => null, addSource() {
  }, removeSource() {
  },
  setFilter() {
  }, setLayoutProperty() {
  }, queryRenderedFeatures: () => [],
  isStyleLoaded: () => true, getZoom: () => 5,
  resize() {
  }, on() {
  }, once() {
  }
};

beforeAll(() => {
  globalThis.document = {
    documentElement: {
      dataset: {}, setAttribute() {
      }
    },
    body: {
      classList: {
        add() {
        }, remove() {
        }, toggle() {
        }, contains: () => false
      }, appendChild() {
      }
    },
    getElementById: (id) => (ids.has(id) ? stubEl(id) : null),
    createElement: () => stubEl("__detached"),
    querySelectorAll: () => [],
    addEventListener() {
    }
  };
  globalThis.localStorage = {
    getItem: () => null, setItem() {
    }
  };
  globalThis.Worker = class {
    postMessage() {
    }

    terminate() {
    }
  };
});

describe("feature module initialization", () => {
  let flood, dock, panel;

  it("createFloodController initializes and exposes its surface", async () => {
    const {createFloodController} = await import("../map/fim/floodController");
    flood = createFloodController({
      map, anim, getForecastDate: () => "2026-07-18", isMapLoaded: () => true
    });
    expect(flood.isMappingMode()).toBe(false);
    // Each of these is called by main.js — they must survive being hit before any selection exists.
    flood.onMapLoad();
    flood.selectReach(123);
    flood.queryDepth({lng: 0, lat: 0});
    flood.onForecastDateChange();
  });

  it("createChartsDock initializes and exposes its surface", async () => {
    const {createChartsDock} = await import("./chartsDock");
    dock = createChartsDock({map, getForecastDate: () => "2026-07-18"});
    // close() and restyleCharts() must no-op cleanly before any chart has ever been rendered —
    // that is exactly the path that used to fetch the 274 KB chart bundle for nothing.
    dock.close();
    dock.restyleCharts();
  });

  it("createPanelControls initializes and exposes its surface", async () => {
    const {createPanelControls} = await import("./panelControls");
    panel = createPanelControls({
      anim, onForecastDateChange: () => {
      }
    });
    panel.initForecastDatePicker();
  });

  it("every listener the modules wired runs without throwing", () => {
    expect(listeners.length).toBeGreaterThan(10);
    const failures = [];
    for (const [id, type, fn] of listeners) {
      try {
        fn({
          target: stubEl(id), key: "Escape", propertyName: "flex-basis", preventDefault() {
          }
        });
      } catch (e) {
        failures.push(`${id}:${type} → ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("references only element ids that exist in index.html", () => {
    const files = [
      "src/main.js", "src/map/fim/floodController.js",
      "src/ui/chartsDock.js", "src/ui/panelControls.js"
    ];
    const missing = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\$\("([^"`]+)"\)/g)) {
        if (!ids.has(m[1])) missing.push(`${f}: #${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

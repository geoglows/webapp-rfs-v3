import {loadRiverNetwork} from "riverforecastsystem/v3/hydrography";

let loading = null;

/**
 * The river topology behind corridor selection, fetched once and shared.
 *
 * The graph and the traversals over it belong to the package (riverforecastsystem/v3/hydrography); what lives
 * here is only this app's policy about a graph it cannot get: resolve to null rather than throw.
 * Without it the picker falls back to selecting just what was clicked, which is the behaviour that
 * shipped before corridors and is still perfectly usable. Failing the whole flood mode over an
 * optional file is not.
 */
function floodNetwork() {
  if (!loading) {
    loading = loadRiverNetwork()
      .then((net) => {
        console.log(`River topology: ${net.meta?.total_streams?.toLocaleString() ?? "?"} flood-mappable reaches — clicks now select the corridor between them.`);
        return net;
      })
      .catch((e) => {
        console.warn(`River topology unavailable (${e.message}) — clicks select only the reach clicked.`);
        return null;
      });
  }
  return loading;
}

export {floodNetwork};

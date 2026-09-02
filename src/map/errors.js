/**
 * Log what actually failed. MapLibre flattens every failure into a generic `error` event, and the
 * source id and url live on the event rather than in the message.
 */
export function logMapErrors(map) {
  map.on("error", (e) => {
    if (!e?.error) return;
    const where = e.sourceId ? ` [${e.sourceId}]` : "";
    console.error(`map${where}: ${e.error.message}`, e.error.url ?? "");
  });
}

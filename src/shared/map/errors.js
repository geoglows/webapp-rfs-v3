/**
 * Say what actually failed when the map fails.
 *
 * MapLibre flattens every failure into a generic `error` event, so a bad tile fetch arrives as
 * nothing but "Bad response code: 404" — and with no listener at all it reaches the console as a
 * bare `Error` with no message worth reading. The source id and the url live on the event rather
 * than in the message, so logging them is the difference between "something went wrong" and
 * knowing which archive, at which URL.
 */
export function logMapErrors(map) {
  map.on("error", (e) => {
    if (!e?.error) return;
    const where = e.sourceId ? ` [${e.sourceId}]` : "";
    console.error(`map${where}: ${e.error.message}`, e.error.url ?? "");
  });
}

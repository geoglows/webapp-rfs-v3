/**
 * The one element builder, shared by both pages.
 *
 *   el("div", {class: "pick-row"}, [icon, label])
 *   el("button", {class: "btn sm", title: t("picks.remove"), onclick: () => remove(id)})
 *
 * `class`, `text` and `html` set the obvious things; `on*` becomes a listener; anything else an
 * attribute. `null`/`undefined`/`false` skip the attribute rather than rendering `disabled="false"`
 * — which is still disabled. `kids` takes a node or an array and skips falsy entries, so a
 * conditional child can be written inline as `cond && el(...)`.
 *
 * @param {string} tag
 * @param {Object<string, *>} [props]
 * @param {Node|Array<Node|false|null|undefined>} [kids]
 */
export const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of [].concat(kids)) if (kid) n.appendChild(kid);
  return n;
};

/** `type="button"` is the point: a bare <button> in the search forms would submit them. */
export const button = ({class: cls, text, title, onclick, ...rest}) =>
  el("button", {type: "button", class: cls, text, title, onclick, ...rest});

export const $ = (id) => document.getElementById(id);

/** One decimal everywhere, so a cached dataset does not read "38.1 MB" here and "38.20 MB" there. */
export const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

export const fmt = (n) => n.toLocaleString();

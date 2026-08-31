/**
 * The one element builder, shared by both pages.
 *
 * There used to be eight of these: seven copies of a three-argument
 * `el(tag, className, text)` scattered across both apps, and one richer
 * `el(tag, props, kids)` in the styling panel that could also set attributes, wire listeners and
 * take children. The three-argument form is the smaller idea — every time a call site needed an
 * `id`, a `title`, a `disabled`, or a click handler it had to fall out of the helper and set the
 * property on the next line, which is most of why the panel code reads the way it does. So the
 * richer one won and the rest were deleted.
 *
 *   el("div", {class: "pick-row"}, [icon, label])
 *   el("button", {class: "btn sm", title: t("picks.remove"), onclick: () => remove(id)})
 *   el("input", {type: "checkbox", checked: on, disabled: !available})
 *
 * `props` handling, in order: `class` and `text` are the two common cases and get their own
 * branches; `html` exists for the few places that assemble a string of markup and is deliberately
 * ugly to type; anything starting with `on` becomes an event listener; everything else becomes an
 * attribute. `null`, `undefined` and `false` skip the attribute entirely, so `{disabled: !ok}`
 * does the right thing in both directions rather than rendering `disabled="false"` — which is
 * still disabled, and is the bug this rule exists to prevent. `true` renders the bare attribute.
 *
 * `kids` accepts a single node or an array, and skips falsy entries so a conditional child can be
 * written inline as `cond && el(...)` without a filter.
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

/**
 * A button, which is common enough in the panels to be worth its own name.
 *
 * `type="button"` is the point: a bare <button> inside a <form> submits it, and both pages put
 * buttons inside the search forms. Everything else is just el().
 */
export const button = ({class: cls, text, title, onclick, ...rest}) =>
  el("button", {type: "button", class: cls, text, title, onclick, ...rest});

/** `document.getElementById`, which twelve modules had each defined for themselves. */
export const $ = (id) => document.getElementById(id);

/** Bytes as megabytes, for the download sizes both pages report. */
export const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

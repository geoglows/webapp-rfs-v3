import {button, el} from "../dom.js";
import {t} from "../i18n/i18n.js";

export function askConfirm({title, message, confirmKey = "common.confirm", danger = true}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        // Swallowed, so the app's own Escape handling does not also close a dock behind the dialog.
        e.stopPropagation();
        finish(false);
      }
    };

    const cancel = button({class: "btn", text: t("common.cancel"), onclick: () => finish(false)});
    const ok = button({
      class: `btn ${danger ? "danger" : "primary"}`,
      text: t(confirmKey),
      onclick: () => finish(true)
    });

    const card = el("div", {
      class: "card modal confirm",
      role: "alertdialog",
      "aria-modal": "true"
    }, [
      el("div", {class: "modal-head"}, el("h3", {text: title})),
      el("div", {class: "modal-body"}, [
        el("p", {text: message}),
        el("div", {class: "row end confirm-actions"}, [cancel, ok])
      ])
    ]);

    const backdrop = el("div", {class: "backdrop"}, card);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    cancel.focus();
  });
}

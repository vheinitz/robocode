/*
 * Brücke zwischen den Kurs-HTMLs und der RoboCode-App.
 * Die App stellt das Objekt `window.RoboCode` (CourseBridge) bereit. Fehlt es
 * (z. B. beim Testen im normalen Browser), wird nur in die Konsole geloggt.
 *
 * Knöpfe werden über data-Attribute automatisch verdrahtet:
 *   data-code="#id"  [data-tab="main"]  -> Code aus <pre id> in den Reiter legen
 *   data-make='[{"gpio":0,"name":"poti","role":"A"}]' -> Board einrichten
 *   data-open="code|board|terminal|tafel" -> in die App wechseln
 */
(function () {
  var B = window.RoboCode;
  var has = function (fn) { return B && typeof B[fn] === "function"; };

  window.RC = {
    code: function (text, tab) {
      if (has("putCode")) B.putCode(tab || "main", text);
      else console.log("[RC.code]", tab || "main", "\n" + text);
    },
    make: function (cfg) {
      var s = typeof cfg === "string" ? cfg : JSON.stringify(cfg);
      if (has("make")) B.make(s); else console.log("[RC.make]", s);
    },
    open: function (name) {
      if (has("open")) B.open(name); else console.log("[RC.open]", name);
    },
    toast: function (t) { if (has("toastMsg")) B.toastMsg(t); else console.log("[RC.toast]", t); }
  };

  function textOf(sel) {
    if (!sel) return "";
    var el = document.querySelector(sel);
    return el ? el.textContent.replace(/\s+$/, "").replace(/^\n/, "") : "";
  }

  function wire() {
    document.querySelectorAll("[data-code]").forEach(function (el) {
      el.addEventListener("click", function () {
        RC.code(textOf(el.getAttribute("data-code")), el.getAttribute("data-tab") || "main");
        RC.toast("Code eingefügt");
      });
    });
    document.querySelectorAll("[data-make]").forEach(function (el) {
      el.addEventListener("click", function () { RC.make(el.getAttribute("data-make")); });
    });
    document.querySelectorAll("[data-open]").forEach(function (el) {
      el.addEventListener("click", function () { RC.open(el.getAttribute("data-open")); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

import "./style.css";
import { App } from "./app";

App.start(document.getElementById("app")!).catch((e) => {
  document.body.textContent = `Stoa could not start: ${e instanceof Error ? e.message : e}`;
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}

import "./style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Store } from "./db";
import { StoaProvider, loadData } from "./state";

async function start(): Promise<void> {
  const store = await Store.open();
  const initial = await loadData(store);
  createRoot(document.getElementById("app")!).render(
    <StrictMode>
      <StoaProvider store={store} initial={initial}>
        <App />
      </StoaProvider>
    </StrictMode>,
  );
}

start().catch((e) => {
  document.body.textContent = `Stoa could not start: ${e instanceof Error ? e.message : e}`;
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}

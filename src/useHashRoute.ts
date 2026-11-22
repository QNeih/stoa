import { useEffect, useState } from "react";

/** The screen named by the URL hash: `#/log/edit/3` is tab "log", sub "edit", id 3. */
export interface Route {
  tab: string;
  sub?: string;
  id?: number;
}

function parseRoute(): Route {
  const [tab = "today", sub, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { tab: tab || "today", sub, id: id ? Number(id) : undefined };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

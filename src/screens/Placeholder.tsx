import type { ReactNode } from "react";
import { Header } from "../components/Header";

/** A tab that is not built yet. */
export function Placeholder({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <Header title={title} />
      <p className="muted">Coming next.</p>
      {children}
    </div>
  );
}

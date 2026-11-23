import type { KeyboardEvent } from "react";
import { PALETTE, goalColor } from "../palette";
import type { Bucket, Range } from "../stats";
import { formatDuration, parseLocalDate } from "../time";

export interface ChartGoal {
  id: string;
  name: string;
  color: Parameters<typeof goalColor>[0]["color"];
}

const W = 340;
const H = 190;
const LEFT = 44;
const TOP = 8;
const BOTTOM = 24;

/** The short x-axis label of a bucket: day/month of a day or week, month name, or year. */
export function bucketLabel(start: string, range: Range): string {
  const d = parseLocalDate(start);
  if (range === "year") return String(d.getFullYear());
  if (range === "month") return d.toLocaleDateString("en-GB", { month: "short" });
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** A round axis maximum at or above `ms`, and the ticks up to it. */
function axis(ms: number): { max: number; ticks: number[] } {
  const steps = [5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000].map((m) => m * 60_000);
  const step = steps.find((s) => s * 3 >= ms) ?? Math.ceil(ms / 3 / 3_600_000) * 3_600_000;
  return { max: step * 3, ticks: [0, step, step * 2, step * 3] };
}

/**
 * Grouped bar chart of time per bucket: one thin bar per goal, side by side, each goal in the same slot
 * in every bucket (the order of `goals`). A bucket is tapped or focused to select it.
 */
export function TimeChart({
  buckets, goals, range, selected, onSelect, label,
}: {
  buckets: Bucket[];
  goals: ChartGoal[];
  range: Range;
  selected: string | null;
  onSelect: (start: string) => void;
  label: string;
}) {
  const { max, ticks } = axis(Math.max(...buckets.flatMap((b) => goals.map((g) => b.byGoal[g.id] ?? 0)), 1));
  const plotH = H - TOP - BOTTOM;
  const colW = (W - LEFT) / buckets.length;
  // Day and week labels are too wide for every column on a phone: label every second one, the newest included.
  const crowded = (range === "week" || range === "day") && colW < 30;
  const gap = 1;
  const barW = Math.max(1.5, Math.min(6, (colW * 0.75 - gap * (goals.length - 1)) / Math.max(goals.length, 1)));
  const groupW = goals.length * barW + (goals.length - 1) * gap;
  const y = (ms: number) => TOP + plotH - (ms / max) * plotH;
  // A selected bar's label shows even when crowded; its neighbours then give way so labels never overlap.
  const sel = buckets.findIndex((b) => b.start === selected);
  const nextToSelected = (i: number) => sel >= 0 && Math.abs(i - sel) === 1;

  return (
    <svg className="time-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={LEFT - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted)">{formatDuration(t)}</text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x0 = LEFT + i * colW + (colW - groupW) / 2;
        const on = b.start === selected;
        const press = (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(b.start);
          }
        };
        return (
          <g key={b.start} className="bar" role="button" tabIndex={0} aria-pressed={on}
             aria-label={`${bucketLabel(b.start, range)}, ${formatDuration(b.totalMs)}`}
             onClick={() => onSelect(b.start)} onKeyDown={press}>
            <rect x={LEFT + i * colW} y={TOP} width={colW} height={plotH + BOTTOM} fill={on ? "var(--line)" : "transparent"} opacity={0.6} />
            {goals.map((g, k) => {
              const ms = b.byGoal[g.id] ?? 0;
              if (ms <= 0) return null;
              const top = Math.min(y(ms), y(0) - 1.5);
              return <rect key={g.id} x={x0 + k * (barW + gap)} y={top} width={barW} height={y(0) - top} rx={Math.min(1.5, barW / 2)} fill={PALETTE[goalColor(g)]} />;
            })}
            {(on || !crowded || ((buckets.length - 1 - i) % 2 === 0 && !nextToSelected(i))) && (
              <text x={LEFT + i * colW + colW / 2} y={H - 8} textAnchor="middle" fontSize="10" fontWeight={on ? 700 : 400} fill={on ? "var(--text)" : "var(--muted)"}>
                {bucketLabel(b.start, range)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

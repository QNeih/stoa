import { useMemo, useState } from "react";
import { Header } from "../components/Header";
import { TimeChart, bucketLabel } from "../components/TimeChart";
import { PALETTE, goalColor } from "../palette";
import { RANGES, rangesWithData, timeBuckets, type Range } from "../stats";
import { useStoa } from "../state";
import { formatDuration } from "../time";

const RANGE_NAMES: Record<Range, string> = { day: "Day", week: "Week", month: "Month", year: "Year" };
const minutes = (ms: number) => Math.round(ms / 60_000);

/** Time per day, week, month or year, one bar per goal. */
export function TimeScreen() {
  const { config, entries } = useStoa();
  const available = rangesWithData(entries, new Date());
  const [picked, setPicked] = useState<Range>("week");
  const range = available.includes(picked) ? picked : (available[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);

  const total = useMemo(
    () => timeBuckets(config, entries, "year", new Date(), Infinity).reduce((n, b) => n + b.totalMs, 0),
    [config, entries],
  );
  const buckets = useMemo(() => (range ? timeBuckets(config, entries, range, new Date()) : []), [config, entries, range]);

  const goals = [...config.goals].sort((a, b) => a.rank - b.rank).filter((g) => buckets.some((b) => b.byGoal[g.id]));
  const bucket = buckets.find((b) => b.start === selected) ?? null;

  return (
    <div>
      <Header title="Time" />
      {!range ? (
        <p className="muted">Not enough time logged yet. A chart appears once your first session is from before today.</p>
      ) : (
        <>
          <p className="time-total"><strong>{formatDuration(total)}</strong> <span className="muted">in total</span></p>
          <div className="range-buttons" role="group" aria-label="Range">
            {RANGES.filter((r) => available.includes(r)).map((r) => (
              <button key={r} type="button" aria-pressed={r === range} className={r === range ? "on" : ""}
                      onClick={() => { setPicked(r); setSelected(null); }}>
                {RANGE_NAMES[r]}
              </button>
            ))}
          </div>
          <div className="card">
            <TimeChart
              buckets={buckets} goals={goals} range={range} selected={selected} onSelect={setSelected}
              label={`Time per ${range} by goal: ${buckets.map((b) => `${bucketLabel(b.start, range)} ${formatDuration(b.totalMs)}`).join(", ")}`}
            />
            <ul className="legend">
              {goals.map((g) => (
                <li key={g.id}><span className="swatch" style={{ background: PALETTE[goalColor(g)] }} aria-hidden="true" />{g.name}</li>
              ))}
            </ul>
          </div>
          <div className="readout" aria-live="polite">
            {bucket ? (
              <>
                <strong>{bucketLabel(bucket.start, range)}</strong>: {formatDuration(bucket.totalMs)}
                <ul>
                  {goals.filter((g) => bucket.byGoal[g.id]).map((g) => (
                    <li key={g.id}>{g.name}: {minutes(bucket.byGoal[g.id])} min</li>
                  ))}
                </ul>
              </>
            ) : (
              <span className="muted small">Tap a bar to see its goals.</span>
            )}
          </div>
          <div className="sr-only">
          <table>
            <caption>Minutes per goal by {range}</caption>
            <thead>
              <tr><th>{RANGE_NAMES[range]}</th>{goals.map((g) => <th key={g.id}>{g.name}</th>)}<th>Total</th></tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.start}>
                  <th>{bucketLabel(b.start, range)}</th>
                  {goals.map((g) => <td key={g.id}>{minutes(b.byGoal[g.id] ?? 0)}</td>)}
                  <td>{minutes(b.totalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

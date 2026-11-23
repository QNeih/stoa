import { formatDuration } from "../time";
import { TrendDownIcon, TrendFlatIcon, TrendUpIcon } from "./Icons";

/** Up, down or level against all of last week, to the minute. */
export function Trend({ now, before }: { now: number; before: number }) {
  const diff = Math.floor(now / 60_000) - Math.floor(before / 60_000);
  const label =
    diff === 0 ? "Same as last week"
    : `${formatDuration(Math.abs(diff) * 60_000)} ${diff > 0 ? "more" : "less"} than last week`;
  return (
    <span className={`trend ${diff > 0 ? "up" : diff < 0 ? "down" : "flat"}`} role="img" aria-label={label} title={label}>
      {diff > 0 ? <TrendUpIcon /> : diff < 0 ? <TrendDownIcon /> : <TrendFlatIcon />}
    </span>
  );
}

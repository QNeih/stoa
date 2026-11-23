export interface BarSeries {
  key: string;
  color: string;
}

export interface BarBucket {
  label: string;
  /** Value per series key; missing keys count as 0. */
  values: Record<string, number>;
}

const W = 320;
const H = 150;
const TOP = 16;
const LABEL_H = 18;

/**
 * A small bar chart as SVG: one bar per bucket, stacked by series in the order of `series`.
 * `format` writes a value for the top-of-scale label and the bar tooltips; `ariaLabel` names the chart.
 * Every second label is dropped when there are many buckets, so labels never overlap.
 */
export function BarChart({
  buckets,
  series,
  format,
  ariaLabel,
}: {
  buckets: BarBucket[];
  series: BarSeries[];
  format: (value: number) => string;
  ariaLabel: string;
}) {
  const total = (b: BarBucket) => series.reduce((n, s) => n + (b.values[s.key] ?? 0), 0);
  const max = Math.max(1, ...buckets.map(total));
  const plotH = H - TOP - LABEL_H;
  const slot = W / Math.max(buckets.length, 1);
  const barW = Math.min(slot * 0.7, 36);
  const step = buckets.length > 8 ? 2 : 1;
  return (
    <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      <text x={0} y={10} className="chart-text">
        {format(max)}
      </text>
      <line x1={0} x2={W} y1={H - LABEL_H} y2={H - LABEL_H} className="chart-axis" />
      {buckets.map((b, i) => {
        const x = i * slot + (slot - barW) / 2;
        let y = H - LABEL_H;
        return (
          <g key={i}>
            <title>{`${b.label}: ${format(total(b))}`}</title>
            {series.map((s) => {
              const h = ((b.values[s.key] ?? 0) / max) * plotH;
              if (h <= 0) return null;
              y -= h;
              return <rect key={s.key} x={x} y={y} width={barW} height={h} fill={s.color} rx={2} />;
            })}
            {(buckets.length - 1 - i) % step === 0 && (
              <text x={x + barW / 2} y={H - 4} textAnchor="middle" className="chart-text">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

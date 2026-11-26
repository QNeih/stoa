import { useState } from "react";
import { BarChart, type BarBucket } from "../components/BarChart";
import { Header } from "../components/Header";
import { BackIcon } from "../components/Icons";
import { Trend } from "../components/Trend";
import { ItemMenu } from "../components/ItemMenu";
import { goalStyle } from "../format";
import { PALETTE, goalColor } from "../palette";
import { autoResultTotals } from "../results";
import { goalStats, rangesWithData, timeBuckets, type Range } from "../stats";
import { useStoa } from "../state";
import { formatDuration, parseLocalDate } from "../time";
import type { SubGoal } from "../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short bucket label: "23 Nov" for a week, "Nov" for a month, "2026" for a year. */
function bucketLabel(start: string, range: Range): string {
  const d = parseLocalDate(start);
  if (range === "year") return String(d.getFullYear());
  return range === "month" ? MONTHS[d.getMonth()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const hours = (ms: number) => formatDuration(ms);

/** One goal: its time chart, the time per sub-goal (with automatic results) and the archived sub-goals. */
export function GoalDetail({ goalId }: { goalId: string }) {
  const stoa = useStoa();
  const { config, entries } = stoa;
  const goal = config.goals.find((g) => g.id === goalId);
  const [menu, setMenu] = useState<"goal" | SubGoal | null>(null);
  const [picked, setPicked] = useState<Range>("week");
  const now = new Date();

  if (!goal) {
    return (
      <div>
        <Header title="Goal" />
        <p className="muted">This goal does not exist.</p>
        <a href="#/goals">Back to goals</a>
      </div>
    );
  }

  const subGoals = config.subGoals.filter((h) => h.goal === goal.id);
  const archivedSubGoals = subGoals.filter((h) => h.archived);
  const stats = goalStats(config, entries, now).find((s) => s.goal === goal.id);
  const subGoalIds = new Set(subGoals.map((h) => h.id));
  const goalEntries = entries.filter((e) => subGoalIds.has(e.subGoal));
  const ranges = rangesWithData(goalEntries, now);
  const range = ranges.includes(picked) ? picked : ranges[0];
  const buckets: BarBucket[] = range
    ? timeBuckets(config, entries, range, now).map((b) => ({ label: bucketLabel(b.start, range), values: { goal: b.byGoal[goal.id] ?? 0 } }))
    : [];

  return (
    <div style={goalStyle(goal)}>
      <Header title={goal.name}>
        <button className="icon" aria-label="Goal menu" onClick={() => setMenu("goal")}>
          ⋯
        </button>
      </Header>
      <a className="back" href="#/goals">
        <BackIcon />
        Back
      </a>

      {!stats ? (
        <section className="card">
          <p className="muted">This goal is archived. Its time still counts in your totals.</p>
          <button onClick={() => void stoa.setGoalArchived(goal.id, false)}>Restore</button>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="goal-week trend-row">
              {hours(stats.weekMs)} <span className="muted">this week</span>
              <Trend now={stats.weekMs} before={stats.lastWeekMs} />
            </div>
            <div className="muted">{hours(stats.allTimeMs)} all time</div>
          </section>

          <section className="card">
            <h2>Time</h2>
            {range ? (
              <>
                <div className="actions" role="group" aria-label="Chart range">
                  {ranges.map((r) => (
                    <button key={r} aria-pressed={r === range} onClick={() => setPicked(r)}>
                      {r[0].toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
                <BarChart
                  buckets={buckets}
                  series={[{ key: "goal", color: PALETTE[goalColor(goal)] }]}
                  format={hours}
                  ariaLabel={`${goal.name} time per ${range}`}
                />
              </>
            ) : (
              <p className="muted">Not enough time tracked to chart yet.</p>
            )}
          </section>

          <h2>Sub-goals</h2>
          <ul className="list">
            {stats.subGoals
              .filter((s) => !subGoals.find((h) => h.id === s.subGoal)!.archived)
              .map((s) => {
                const subGoal = subGoals.find((h) => h.id === s.subGoal)!;
                const autos = config.results.filter((r) => r.subGoal === subGoal.id && r.type === "auto" && !r.archived);
                return (
                  <li key={subGoal.id} className="sub-goal-row">
                    <div className="row">
                      <strong>{subGoal.name}</strong>
                      <button className="icon" aria-label={`Menu for ${subGoal.name}`} onClick={() => setMenu(subGoal)}>
                        ⋯
                      </button>
                    </div>
                    <div className="muted">
                      {hours(s.weekMs)} this week · {hours(s.allTimeMs)} all time
                    </div>
                    {autos.map((r) => {
                      const t = autoResultTotals(r, entries);
                      return (
                        <div key={r.id} className="auto-result muted">
                          {r.name}: {hours(t.ms)} over {t.days} {t.days === 1 ? "day" : "days"}
                        </div>
                      );
                    })}
                  </li>
                );
              })}
          </ul>
        </>
      )}

      {archivedSubGoals.length > 0 && (
        <section>
          <h2>Archived sub-goals</h2>
          <ul className="list">
            {archivedSubGoals.map((h) => (
              <li key={h.id} className="row">
                <span>{h.name}</span>
                <button className="link" onClick={() => void stoa.setSubGoalArchived(h.id, false)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {menu === "goal" && (
        <ItemMenu
          title={goal.name}
          name={goal.name}
          color={goalColor(goal)}
          onRename={(name) => void stoa.renameGoal(goal.id, name)}
          onColor={(key) => void stoa.setGoalColor(goal.id, key)}
          onArchive={() => {
            void stoa.setGoalArchived(goal.id, true);
            location.hash = "#/goals";
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && menu !== "goal" && (
        <ItemMenu
          title={menu.name}
          name={menu.name}
          onRename={(name) => void stoa.renameSubGoal(menu.id, name)}
          onArchive={() => void stoa.setSubGoalArchived(menu.id, true)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

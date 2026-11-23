import { Header } from "../components/Header";
import { daysAgoText, goalName, habitName } from "../format";
import { useStoa } from "../state";
import { dashboard } from "../stats";
import { formatDuration, formatTime } from "../time";

/** Time today, the done list and the week per goal. */
export function TodayScreen() {
  const { config, entries } = useStoa();
  const now = new Date();
  const d = dashboard(config, entries, now);
  return (
    <div>
      <Header title="Today">
        <span className="muted">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</span>
      </Header>
      <section className="card hero">
        <div className="big">{formatDuration(d.todayMs)}</div>
        <div className="muted">spent on goals today</div>
        <a className="button primary" href="#/plan">
          Start
        </a>
      </section>
      <section>
        <h2>Done today</h2>
        {d.done.length ? (
          <ul className="list">
            {d.done.map(({ session: s, ms }, i) => (
              <li key={`${s.start}-${i}`}>
                <div className="row">
                  <strong>{habitName(config, s.habit)}</strong>
                  <span>{formatDuration(ms)}</span>
                </div>
                {s.task && <div>{s.task}</div>}
                {s.note && <div className="note">{s.note}</div>}
                <div className="muted small">
                  {formatTime(new Date(s.start))}–{formatTime(new Date(s.end))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing logged yet today.</p>
        )}
      </section>
      <section>
        <h2>This week</h2>
        <ul className="list">
          {d.weekByGoal.map((g) => (
            <li key={g.goal}>
              <div className="row">
                <strong>{goalName(config, g.goal)}</strong>
                <span>{formatDuration(g.ms)}</span>
              </div>
              <div className="muted small">{daysAgoText(g.lastSpentDaysAgo)}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

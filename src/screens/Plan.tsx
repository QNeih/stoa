import type { FormEvent } from "react";
import { Header } from "../components/Header";
import { HabitSelect } from "../components/HabitSelect";
import { habitName } from "../format";
import { useStoa } from "../state";
import { planProgress } from "../stats";
import { formatDuration, localDate } from "../time";

/** Today's plan with planned against spent time, and a start for any habit. */
export function PlanScreen() {
  const { config, entries, plan: stored, settings, startTimer } = useStoa();
  const today = localDate(new Date());
  const plan = stored?.date === today ? stored : null;
  const progress = plan ? planProgress(plan, entries, today) : null;
  const hasHabits = config.habits.some((x) => !x.archived);

  const startWithoutPlan = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void startTimer(String(form.get("habit")), String(form.get("task")));
  };

  return (
    <div>
      <Header title="Plan" />
      {plan && progress ? (
        <section>
          <section className="card">
            <div className="row">
              <span>Planned</span>
              <strong>{formatDuration(progress.plannedMs)}</strong>
            </div>
            <div className="row">
              <span>Spent on the plan</span>
              <strong>{formatDuration(progress.onPlanMs)}</strong>
            </div>
            <div className="row muted">
              <span>Spent on other things</span>
              <span>{formatDuration(progress.offPlanMs)}</span>
            </div>
            {plan.time_budget_min * 60_000 !== progress.plannedMs && (
              <div className="muted small">Time budget {formatDuration(plan.time_budget_min * 60_000)}</div>
            )}
          </section>
          {plan.note && <p className="note">{plan.note}</p>}
          <ul className="list">
            {progress.items.map(({ item, spentMs }, i) => (
              <li key={i} className={spentMs >= item.minutes * 60_000 ? "row done" : "row"}>
                <div>
                  <strong>{item.task || habitName(config, item.habit)}</strong>
                  <div className="muted small">
                    {habitName(config, item.habit)} · {Math.floor(spentMs / 60_000)} of {item.minutes} min
                  </div>
                </div>
                <button onClick={() => void startTimer(item.habit, item.task)}>Start</button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="card">
          <p>No plan for today yet.</p>
          <p className="muted small">
            {settings.token
              ? "It comes from the daily check-in with Claude and loads on the next sync."
              : "Connect the data repo in Settings to load plans from the check-in."}
          </p>
        </section>
      )}
      <section>
        <h2>Start without a plan</h2>
        {hasHabits ? (
          <form className="stack" onSubmit={startWithoutPlan}>
            <HabitSelect name="habit" />
            <input name="task" type="text" placeholder="Task (optional)" />
            <button className="primary" type="submit">
              Start
            </button>
          </form>
        ) : (
          <p className="muted">Add a habit under Habits first.</p>
        )}
      </section>
    </div>
  );
}

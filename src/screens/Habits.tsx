import type { ComponentProps, FormEvent } from "react";
import { Header } from "../components/Header";
import { activeGoals, goalName } from "../format";
import { useStoa } from "../state";
import type { Goal } from "../types";

/** Reads the named text field of a submitted form and clears the form; null when the field is blank. */
function takeName(e: FormEvent<HTMLFormElement>): { name: string; form: FormData } | null {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const name = String(form.get("name") ?? "").trim();
  if (!name) return null;
  e.currentTarget.reset();
  return { name, form };
}

function GoalSelect({ goals, ...props }: { goals: Goal[] } & ComponentProps<"select">) {
  return (
    <select {...props}>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

/** Goals (ranked, archived, never deleted) and their habits. */
export function HabitsScreen() {
  const stoa = useStoa();
  const { config: c } = stoa;
  const goals = activeGoals(c);
  const archivedGoals = c.goals.filter((g) => g.archived);
  const archivedHabits = c.habits.filter((x) => x.archived);

  const addHabit = (e: FormEvent<HTMLFormElement>) => {
    const input = takeName(e);
    if (input) void stoa.addHabit(input.name, String(input.form.get("goal")));
  };
  const addGoal = (e: FormEvent<HTMLFormElement>) => {
    const input = takeName(e);
    if (input) void stoa.addGoal(input.name);
  };

  return (
    <div>
      <Header title="Habits" />
      {goals.length > 0 && (
        <form className="card stack" onSubmit={addHabit}>
          <h2>Add a habit</h2>
          <input name="name" type="text" placeholder="New habit" required />
          <GoalSelect name="goal" goals={goals} />
          <button className="primary" type="submit">
            Add habit
          </button>
        </form>
      )}
      {goals.map((g, i) => (
        <section key={g.id} className="card">
          <div className="row">
            <h2>
              {g.rank}. {g.name}
            </h2>
            <span className="actions">
              <button className="icon" disabled={i === 0} aria-label="Move up" onClick={() => void stoa.moveGoal(g.id, -1)}>
                ↑
              </button>
              <button className="icon" disabled={i === goals.length - 1} aria-label="Move down" onClick={() => void stoa.moveGoal(g.id, 1)}>
                ↓
              </button>
            </span>
          </div>
          <ul className="list">
            {c.habits
              .filter((x) => x.goal === g.id && !x.archived)
              .map((x) => (
                <li key={x.id} className="row">
                  <span>{x.name}</span>
                  <span className="actions">
                    <GoalSelect
                      goals={goals}
                      aria-label={`Goal of ${x.name}`}
                      value={x.goal}
                      onChange={(e) => void stoa.setHabitGoal(x.id, e.target.value)}
                    />
                    <button className="link" onClick={() => void stoa.setHabitArchived(x.id, true)}>
                      Archive
                    </button>
                  </span>
                </li>
              ))}
          </ul>
          <button
            className="link"
            onClick={() => {
              if (confirm(`Archive the goal "${g.name}"? Its habits stay as they are.`)) void stoa.setGoalArchived(g.id, true);
            }}
          >
            Archive goal
          </button>
        </section>
      ))}
      <form className="card stack" onSubmit={addGoal}>
        <h2>Add a big goal</h2>
        <input name="name" type="text" placeholder="New big goal" required />
        <button type="submit">Add goal</button>
      </form>
      {(archivedGoals.length > 0 || archivedHabits.length > 0) && (
        <section>
          <h2>Archived</h2>
          <ul className="list">
            {archivedGoals.map((g) => (
              <li key={g.id} className="row">
                <span>{g.name} (goal)</span>
                <button className="link" onClick={() => void stoa.setGoalArchived(g.id, false)}>
                  Restore
                </button>
              </li>
            ))}
            {archivedHabits.map((x) => (
              <li key={x.id} className="row">
                <span>
                  {x.name} · {goalName(c, x.goal)}
                </span>
                <button className="link" onClick={() => void stoa.setHabitArchived(x.id, false)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

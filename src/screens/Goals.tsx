import { useRef, useState } from "react";
import { Header } from "../components/Header";
import { ItemMenu } from "../components/ItemMenu";
import { TrendDownIcon, TrendFlatIcon, TrendUpIcon } from "../components/Icons";
import { daysAgoText, goalStyle } from "../format";
import { goalColor } from "../palette";
import { goalStats, type GoalStats } from "../stats";
import { useStoa } from "../state";
import { formatDuration } from "../time";
import type { Goal } from "../types";
import { GoalDetail } from "./GoalDetail";

const LONG_PRESS_MS = 500;

/** The Goals tab: the goal list, or the detail of the goal in the URL (`#/goals/<id>`). */
export function GoalsScreen({ goalId }: { goalId?: string }) {
  return goalId ? <GoalDetail key={goalId} goalId={goalId} /> : <GoalList />;
}

/** Goals ordered by time this week, with the change against last week and the all-time total. */
function GoalList() {
  const stoa = useStoa();
  const { config, entries } = stoa;
  const [menuFor, setMenuFor] = useState<Goal | null>(null);
  const stats = goalStats(config, entries, new Date());
  const archived = config.goals.filter((g) => g.archived);

  return (
    <div>
      <Header title="Goals" />
      {stats.length === 0 && <p className="muted">No goals yet. The daily check-in creates them.</p>}
      <ul className="plan-list">
        {stats.map((s) => {
          const goal = config.goals.find((g) => g.id === s.goal)!;
          return <GoalCard key={goal.id} goal={goal} stats={s} onMenu={() => setMenuFor(goal)} />;
        })}
      </ul>
      {archived.length > 0 && (
        <section>
          <h2>Archived</h2>
          <ul className="list">
            {archived.map((g) => (
              <li key={g.id} className="row">
                <span>{g.name}</span>
                <button className="link" onClick={() => void stoa.setGoalArchived(g.id, false)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {menuFor && (
        <ItemMenu
          title={menuFor.name}
          name={menuFor.name}
          color={goalColor(menuFor)}
          onRename={(name) => void stoa.renameGoal(menuFor.id, name)}
          onColor={(key) => void stoa.setGoalColor(menuFor.id, key)}
          onArchive={() => void stoa.setGoalArchived(menuFor.id, true)}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}

/** One goal card. A tap opens the detail; a long press (or right click) opens the goal's menu. */
function GoalCard({ goal, stats, onMenu }: { goal: Goal; stats: GoalStats; onMenu: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressed = useRef(false);
  const cancel = () => clearTimeout(timer.current);

  return (
    <li>
      <a
        className="goal-card"
        href={`#/goals/${goal.id}`}
        style={goalStyle(goal)}
        onPointerDown={() => {
          pressed.current = false;
          timer.current = setTimeout(() => {
            pressed.current = true;
            onMenu();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          pressed.current = true;
          onMenu();
        }}
        onClick={(e) => {
          // The press that opened the menu must not also open the detail.
          if (pressed.current) e.preventDefault();
          pressed.current = false;
        }}
      >
        <div className="row">
          <span className="goal-title">{goal.name}</span>
          {stats.neglected && <span className="neglected">Neglected</span>}
        </div>
        <div className="goal-week">
          {formatDuration(stats.weekMs)} <span className="muted">this week</span>
          <Trend now={stats.weekMs} before={stats.lastWeekMs} />
        </div>
        <div className="goal-meta muted">
          <span>{formatDuration(stats.allTimeMs)} all time</span>
        </div>
        {stats.neglected && <div className="goal-meta muted">{daysAgoText(stats.lastSpentDaysAgo)}</div>}
      </a>
    </li>
  );
}

/** Up, down or level against all of last week, to the minute. */
function Trend({ now, before }: { now: number; before: number }) {
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

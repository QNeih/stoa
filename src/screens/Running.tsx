import { useEffect, useState } from "react";
import { habitName, toLocalInput } from "../format";
import { useStoa } from "../state";
import { formatClock, formatTime } from "../time";
import type { RunningTimer } from "../types";

/** Only the task and the clock while a timer runs. */
export function RunningScreen({ timer }: { timer: RunningTimer }) {
  const { config, requestStop, discardTimer, setTimerStart } = useStoa();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const startDate = new Date(timer.start);
  const save = async () => {
    const problem = await setTimerStart(new Date(value));
    setError(problem);
    if (!problem) setEditing(false);
  };
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const habit = habitName(config, timer.habit);
  return (
    <div className="running">
      <div className="muted">{habit}</div>
      <div className="task">{timer.task || habit}</div>
      <div className="clock">{formatClock(now - new Date(timer.start).getTime())}</div>
      {editing ? (
        <div className="stack">
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Start time" />
          {error && (
            <p className="danger small" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button className="primary" onClick={() => void save()}>
              Save
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions" style={{ justifyContent: "center" }}>
          <span className="muted">Started {formatTime(startDate)}</span>
          <button
            onClick={() => {
              setValue(toLocalInput(startDate));
              setError(null);
              setEditing(true);
            }}
          >
            Change
          </button>
        </div>
      )}
      <button className="primary stop" onClick={requestStop}>
        Stop
      </button>
      <button
        className="link"
        onClick={() => {
          if (confirm("Discard this timer without saving?")) void discardTimer();
        }}
      >
        Discard timer
      </button>
    </div>
  );
}

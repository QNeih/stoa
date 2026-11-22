import { useEffect, useState } from "react";
import { habitName } from "../format";
import { useStoa } from "../state";
import { formatClock } from "../time";
import type { RunningTimer } from "../types";

/** Only the task and the clock while a timer runs. */
export function RunningScreen({ timer }: { timer: RunningTimer }) {
  const { config, requestStop, discardTimer } = useStoa();
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

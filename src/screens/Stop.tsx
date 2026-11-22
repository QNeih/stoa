import { useState } from "react";
import { habitName } from "../format";
import { useStoa } from "../state";
import { formatDuration } from "../time";
import type { RunningTimer } from "../types";

/** Asks for an optional one-line note before the session is saved. */
export function StopScreen({ timer, end }: { timer: RunningTimer; end: Date }) {
  const { config, stopTimer, cancelStop } = useStoa();
  const [note, setNote] = useState("");
  const save = () => void stopTimer(note);
  return (
    <div className="running">
      <div className="muted">
        {habitName(config, timer.habit)} · {formatDuration(end.getTime() - new Date(timer.start).getTime())}
      </div>
      <label className="stack">
        What came out of it?
        <input
          type="text"
          placeholder="Optional, one line"
          maxLength={200}
          enterKeyHint="done"
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>
      <button className="primary" onClick={save}>
        Save
      </button>
      <button className="link" onClick={cancelStop}>
        Back to the timer
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../time";
import { subGoalName, toLocalInput } from "../format";
import { useStoa } from "../state";
import type { RunningTimer } from "../types";

/** Asks after 4 hours whether a timer is still running, or when it really ended. */
export function StillGoingDialog({ timer }: { timer: RunningTimer }) {
  const { config, confirmStillGoing, endStillGoing } = useStoa();
  const dialog = useRef<HTMLDialogElement>(null);
  const start = new Date(timer.start);
  const [end, setEnd] = useState(() => toLocalInput(new Date(start.getTime() + 3600_000)));

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  const saveWithEnd = () => {
    const at = new Date(end);
    if (isNaN(at.getTime()) || at <= start) return alert("The end must be after the start.");
    void endStillGoing(at);
  };

  return (
    <dialog ref={dialog} className="modal">
      <h2>Still going?</h2>
      <p>
        {subGoalName(config, timer.subGoal)} started {formatDuration(Date.now() - start.getTime())} ago.
      </p>
      <button className="primary" onClick={() => void confirmStillGoing()}>
        Yes, still going
      </button>
      <button onClick={() => void endStillGoing(new Date())}>Stop now</button>
      <label>
        It ended at
        <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <button onClick={saveWithEnd}>Save with that end</button>
    </dialog>
  );
}

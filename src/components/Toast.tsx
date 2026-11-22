import { useStoa } from "../state";

/** The latest short message, with Undo when the action can be taken back. */
export function Toast() {
  const { toast, dismissToast } = useStoa();
  if (!toast) return null;
  const { text, undo } = toast;
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {undo && (
        <button
          className="link"
          onClick={() => {
            dismissToast();
            undo();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

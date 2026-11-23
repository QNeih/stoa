import { useState } from "react";
import { PALETTE, PALETTE_KEYS, type PaletteKey } from "../palette";

/**
 * A bottom sheet of actions for a goal or sub-goal: rename, change colour (goals only, when `color`
 * is given) and archive. Nothing is deleted; archived items can be restored from the list.
 */
export function ItemMenu({
  title,
  name,
  color,
  onRename,
  onColor,
  onArchive,
  onClose,
}: {
  title: string;
  name: string;
  color?: PaletteKey;
  onRename: (name: string) => void;
  onColor?: (key: PaletteKey) => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"main" | "rename" | "color">("main");
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {view === "main" && (
          <div className="stack">
            <button onClick={() => setView("rename")}>Rename</button>
            {onColor && <button onClick={() => setView("color")}>Change colour</button>}
            <button
              onClick={() => {
                onArchive();
                onClose();
              }}
            >
              Archive
            </button>
          </div>
        )}
        {view === "rename" && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed) onRename(trimmed);
              onClose();
            }}
          >
            <input aria-label="Name" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <button className="primary" type="submit" disabled={!trimmed}>
              Save
            </button>
          </form>
        )}
        {view === "color" && onColor && (
          <div className="swatches">
            {PALETTE_KEYS.map((key) => (
              <button
                key={key}
                className="pick"
                aria-pressed={key === color}
                onClick={() => {
                  onColor(key);
                  onClose();
                }}
              >
                <span className="swatch" style={{ background: PALETTE[key] }} />
                {key[0].toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        )}
        <button className="link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

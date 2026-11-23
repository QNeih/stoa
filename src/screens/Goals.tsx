import { HabitsScreen } from "./Habits";

/**
 * Goal stats are not built yet. Until then this tab keeps the old goal and sub-goal management,
 * so sub-goals can still be added, moved and archived.
 */
export function GoalsScreen() {
  return <HabitsScreen title="Goals" />;
}

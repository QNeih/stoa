import { activeGoals, habitName } from "../format";
import { useStoa } from "../state";

/** Active habits grouped by goal. An archived habit stays selectable when it is the current value. */
export function HabitSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const { config } = useStoa();
  const archivedSelected = defaultValue && !config.habits.some((x) => x.id === defaultValue && !x.archived);
  return (
    <select name={name} required defaultValue={defaultValue}>
      {activeGoals(config).map((g) => (
        <optgroup key={g.id} label={g.name}>
          {config.habits
            .filter((x) => x.goal === g.id && !x.archived)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </optgroup>
      ))}
      {archivedSelected && <option value={defaultValue}>{habitName(config, defaultValue)}</option>}
    </select>
  );
}

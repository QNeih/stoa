import { activeGoals, subGoalName } from "../format";
import { useStoa } from "../state";

/** Active sub-goals grouped by goal. An archived sub-goal stays selectable when it is the current value. */
export function SubGoalSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const { config } = useStoa();
  const archivedSelected = defaultValue && !config.subGoals.some((x) => x.id === defaultValue && !x.archived);
  return (
    <select name={name} required defaultValue={defaultValue}>
      {activeGoals(config).map((g) => (
        <optgroup key={g.id} label={g.name}>
          {config.subGoals
            .filter((x) => x.goal === g.id && !x.archived)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </optgroup>
      ))}
      {archivedSelected && <option value={defaultValue}>{subGoalName(config, defaultValue)}</option>}
    </select>
  );
}

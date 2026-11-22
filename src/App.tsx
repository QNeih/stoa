import { Nav } from "./components/Nav";
import { StillGoingDialog } from "./components/StillGoingDialog";
import { Toast } from "./components/Toast";
import { HabitsScreen } from "./screens/Habits";
import { LogScreen } from "./screens/Log";
import { PlanScreen } from "./screens/Plan";
import { RunningScreen } from "./screens/Running";
import { SessionForm } from "./screens/SessionForm";
import { SettingsScreen } from "./screens/Settings";
import { StopScreen } from "./screens/Stop";
import { TodayScreen } from "./screens/Today";
import { useStoa } from "./state";
import { useHashRoute, type Route } from "./useHashRoute";

/** A running timer takes the whole screen; otherwise the hash picks a tab. */
export function App() {
  const { timer, stopEnd, stillGoingOpen } = useStoa();
  const route = useHashRoute();
  return (
    <>
      {timer && stopEnd ? (
        <StopScreen timer={timer} end={stopEnd} />
      ) : timer ? (
        <RunningScreen timer={timer} />
      ) : (
        <div className="shell">
          <main>
            <TabScreen route={route} />
          </main>
          <Nav active={route.tab} />
        </div>
      )}
      {timer && stillGoingOpen && <StillGoingDialog timer={timer} />}
      <Toast />
    </>
  );
}

function TabScreen({ route }: { route: Route }) {
  switch (route.tab) {
    case "plan":
      return <PlanScreen />;
    case "log":
      // Keyed so switching between sessions starts the form afresh.
      return route.sub ? <SessionForm key={`${route.sub}/${route.id}`} id={route.id} /> : <LogScreen />;
    case "habits":
      return <HabitsScreen />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <TodayScreen />;
  }
}

import { Nav } from "./components/Nav";
import { StillGoingDialog } from "./components/StillGoingDialog";
import { Toast } from "./components/Toast";
import { GoalsScreen } from "./screens/Goals";
import { LogScreen } from "./screens/Log";
import { ResultsScreen } from "./screens/Results";
import { SessionForm } from "./screens/SessionForm";
import { SettingsScreen } from "./screens/Settings";
import { TimeScreen } from "./screens/Time";
import { TodayScreen } from "./screens/Today";
import { useStoa } from "./state";
import { useHashRoute, type Route } from "./useHashRoute";

/** The URL hash picks a tab; a running timer shows on its Today card, never over other tabs. */
export function App() {
  const { timer, stillGoingOpen } = useStoa();
  const route = useHashRoute();
  return (
    <>
      <div className="shell">
        <main>
          <TabScreen route={route} />
        </main>
        <Nav active={route.tab} />
      </div>
      {timer && stillGoingOpen && <StillGoingDialog timer={timer} />}
      <Toast />
    </>
  );
}

function TabScreen({ route }: { route: Route }) {
  switch (route.tab) {
    case "time":
      return <TimeScreen />;
    case "goals":
      return <GoalsScreen goalId={route.sub} />;
    case "results":
      return <ResultsScreen />;
    case "log":
      // Keyed so switching between sessions starts the form afresh.
      return route.sub ? <SessionForm key={`${route.sub}/${route.id}`} id={route.id} /> : <LogScreen />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <TodayScreen />;
  }
}

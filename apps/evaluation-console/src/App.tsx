import { AlertTriangle, Loader2 } from "lucide-react";
import { useStore } from "./store";
import { useKeybindings } from "./hooks/useKeybindings";
import { ActionBar, Rail, TopStrip } from "./components/Shell";
import { Stream } from "./components/Stream";
import { ReviewInspector, ReviewStage } from "./components/Review";
import { OptimizeInspector, OptimizeStage } from "./components/Optimize";
import { DecideInspector, DecideStage } from "./components/Decide";
import { EvaluateOverview, PromotePanel } from "./components/Overview";
import { CompareStation } from "./components/Compare";
import { DashboardStation } from "./components/Dashboard";
import { LiveStation } from "./components/Live";
import { Overlays, Toasts } from "./components/Overlays";

function Body() {
  const { station } = useStore();

  if (station === "dashboard") {
    return (
      <div className="body body--wide">
        <Rail />
        <DashboardStation />
      </div>
    );
  }
  if (station === "live") {
    return (
      <div className="body body--wide">
        <Rail />
        <LiveStation />
      </div>
    );
  }
  if (station === "evaluate") {
    return (
      <div className="body body--wide">
        <Rail />
        <EvaluateOverview />
      </div>
    );
  }
  if (station === "compare") {
    return (
      <div className="body body--wide">
        <Rail />
        <CompareStation />
      </div>
    );
  }
  if (station === "promote") {
    return (
      <div className="body body--wide">
        <Rail />
        <PromotePanel />
      </div>
    );
  }

  let stage = <ReviewStage />;
  let inspector = <ReviewInspector />;
  if (station === "optimize") {
    stage = <OptimizeStage />;
    inspector = <OptimizeInspector />;
  } else if (station === "decide") {
    stage = <DecideStage />;
    inspector = <DecideInspector />;
  }

  return (
    <div className="body">
      <Rail />
      <Stream />
      {stage}
      {inspector}
    </div>
  );
}

export default function App() {
  const store = useStore();
  useKeybindings(store);

  if (store.loading) {
    return (
      <div className="center-state">
        <Loader2 className="spin" size={26} />
        <div>Reading scorecard, renders, and optimization history…</div>
      </div>
    );
  }
  if (store.error) {
    return (
      <div className="center-state error">
        <AlertTriangle size={28} />
        <div>{store.error}</div>
        <button className="pill" onClick={() => void store.reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <TopStrip />
      <Body />
      <ActionBar />
      <Overlays />
      <Toasts />
      <div className="sr-only" aria-live="polite">
        {store.liveMessage}
      </div>
    </div>
  );
}

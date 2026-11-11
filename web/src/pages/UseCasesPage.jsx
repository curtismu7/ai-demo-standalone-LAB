// ui-pattern: allow P3 the catalog needs the wide frame; the dashboard rebuild narrows it in a later phase
import { useEffect, useRef, useState, useCallback } from "react";
import PolicyGate, { CatalogList, UseCaseDetail } from "../components/PolicyGate";
import { getCatalog } from "../api";
import Launcher from "./Launcher.jsx";
import { visible } from "../safeText";

/** The use-cases page: the stage-1 catalog and run panel, moved unchanged in behaviour from the old Dashboard tab. */
export default function UseCasesPage({ story, resetSignal, requestedId, onSelect, onRunHere }) {
  const [catalog, setCatalog] = useState(null);
  const [selectedUc, setSelectedUc] = useState(null);
  const selected = catalog ? (catalog.useCases.find((u) => u.id === (selectedUc?.id ?? selectedUc)) ?? null) : null;
  useEffect(() => { getCatalog().then(setCatalog, () => setCatalog(null)); }, []);
  useEffect(() => { setSelectedUc(null); }, [resetSignal]);
  useEffect(() => { if (requestedId) setSelectedUc(null); }, [requestedId]);
  return (
    <div className="use-cases" data-testid="use-cases-page">
      <h1>Use cases</h1>
      <Launcher onRunHere={onRunHere} />
      {story ? <PolicyGate story={story} resetSignal={resetSignal} requestedId={requestedId} onSelect={onSelect} /> : null}
      {selected && <UseCaseDetail uc={selected} onClose={() => setSelectedUc(null)} />}
      {catalog && <CatalogList catalog={catalog} onSelect={(u) => setSelectedUc(u.id)} selectedUc={selectedUc?.id ?? selectedUc} />}
    </div>
  );
}

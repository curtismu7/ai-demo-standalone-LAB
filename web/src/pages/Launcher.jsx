// The P5 launcher strip for the Use Cases page: every catalog use case with a route chip —
// "Runs here", "Runs here + deeper", "Opens <app>", or "Guide". The full runner below (the
// stage-1 catalog, tabs and obligation resolution) is untouched. "Runs here" navigates to
// the dashboard with that use case preselected (the assistant turn runs it there). "Opens
// <app>" navigates in the SAME tab to <proxyPath>?from=ai-demo-standalone&uc=<id> — ids
// only; the lab proxy keeps one lab cookie per browser, so never a second tab. Behind a
// plain port (no proxy path prefix) the button reads "Start <app> from the Shelf" and
// carries no link. The href comes only from the server's fixed PROXY_PATHS allow-list,
// never from anything typed or read from the address bar, so there is no open redirect.
import { useEffect, useMemo, useState } from "react";
import { getUseCases } from "../api";
import { visible } from "../safeText";

export const proxied = () => /^\/ai-demo-standalone\//.test(window.location.pathname.replace(/\/{2,}/g, "/"));

export const chipFor = (row) => {
  if (row.runsHere) return { kind: "here", label: row.apps.length ? "Runs here + deeper" : "Runs here" };
  if (row.route === "Hand off" && row.apps.length) return { kind: "open", label: `Opens ${row.apps[0]}`, app: row.apps[0], apps: row.apps };
  return { kind: "guide", label: "Guide" };
};

export default function Launcher({ onRunHere }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const onProxy = proxied();

  useEffect(() => { getUseCases().then((r) => setRows(r.body?.rows ?? []), () => setRows([])); }, []);

  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => !needle || `${r.id} ${r.title ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const click = (row) => {
    const chip = chipFor(row);
    if (chip.kind === "here") { onRunHere?.(row.id); return; }
    if (chip.kind !== "open" || !onProxy) return;
    getUseCases(row.id, chip.app).then((r) => {
      if (r.body?.href) window.location.assign(r.body.href); // same tab: one lab cookie per browser
    }, () => {});
  };

  const chipName = (row, chip, shelfOnly) =>
    chip.kind === "here" ? `Run ${row.title} here`
      : shelfOnly ? `Start ${chip.app} from the Shelf`
      : chip.kind === "open" ? `Open ${row.title} in ${chip.app}`
      : `Guide: ${row.title}`;

  return (
    <section className="uc-launcher" aria-labelledby="uc-launcher-h" data-testid="uc-launcher">
      <h2 id="uc-launcher-h">Every use case, one click</h2>
      <input
        type="search"
        placeholder="Search by id or title"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the use cases"
        data-testid="uc-search"
      />
      <p className="sr-only" role="status" aria-live="polite" data-testid="uc-count">
        {rows.length ? `${shown.length} of ${rows.length} use cases shown` : ""}
      </p>
      <ul className="uc-rows" data-testid="uc-rows">
        {shown.map((row) => {
          const chip = chipFor(row);
          const shelfOnly = chip.kind === "open" && !onProxy;
          return (
            <li key={row.id} data-testid={`uc-row-${row.id}`}>
              <span className="uc-id">{row.id}</span>
              <span className="uc-title">{visible(row.title)}</span>
              <button
                type="button"
                className={`uc-chip uc-chip--${chip.kind}`}
                disabled={chip.kind === "guide"}
                onClick={() => click(row)}
                aria-label={chipName(row, chip, shelfOnly)}
                title={shelfOnly ? `Start ${chip.app} from the Shelf (open the shelf to launch it)` : undefined}
                data-testid={`uc-chip-${row.id}`}
              >
                {shelfOnly ? `Start ${chip.app} from the Shelf` : chip.label}
              </button>
            </li>
          );
        })}
      </ul>
      {!rows.length && <p className="muted" data-testid="uc-launcher-empty">The route chips load here. Is the server running?</p>}
    </section>
  );
}

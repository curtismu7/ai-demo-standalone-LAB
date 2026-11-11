// Customer Agent LAB hands a use case here with ?from=customer-agent&uc=<id>&vertical=<id> (read by the vendored return-link module).
// Preselect only where the catalog id obviously maps to this lab's own scenario; anything else opens the defaults (strip only).
// UC37 (signed agent assertion) also routes here but has no matching scenario, so it gets the strip only.
// The lab has ONE airline cast now (P1), so verticalFor is kept for compatibility but always maps to the airline cast id.
export const UC_SCENARIO = Object.freeze({ UC1: "uc1", UC9: "uc9", UC9A: "uc9a", UC21: "uc21-tool", UC6: "uc6-rogue", UC32: "uc32-upstream" });
export const scenarioFor = (ctx) => (ctx && Object.hasOwn(UC_SCENARIO, ctx.uc) ? UC_SCENARIO[ctx.uc] : null);

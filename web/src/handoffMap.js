// Customer Agent LAB hands a use case here with ?from=customer-agent&uc=<id>&vertical=<id> (read by the vendored return-link module).
// Preselect only where the catalog id obviously maps to this lab's own scenario or vertical; anything else opens the defaults (strip only).
// UC37 (signed agent assertion) also routes here but has no matching scenario, so it gets the strip only.
export const UC_SCENARIO = Object.freeze({ UC1: "uc1", UC9: "uc9", UC9A: "uc9a", UC21: "uc21-tool", UC6: "uc6-rogue", UC32: "uc32-upstream" });
export const VERTICAL_MAP = Object.freeze({ banking: "finance", healthcare: "health", retail: "retail" });
export const scenarioFor = (ctx) => (ctx && Object.hasOwn(UC_SCENARIO, ctx.uc) ? UC_SCENARIO[ctx.uc] : null);
export const verticalFor = (ctx) => (ctx && ctx.vertical && Object.hasOwn(VERTICAL_MAP, ctx.vertical) ? VERTICAL_MAP[ctx.vertical] : null);

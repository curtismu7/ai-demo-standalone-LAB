// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: "A mock of the AI-DEMO2 dashboard as one standalone app. It carries the dashboard's whole use-case catalog (87 use cases in 8 tracks) and runs them against one mock policy decision point (PDP). Nothing calls a real identity provider, gateway or tenant: the PDP, the directory and every token are mock values, labelled as such. PingFederate, PingGateway and PingOne Authorize appear only as named stand-ins."
  },
  {
    heading: "Measured vs UNVERIFIED",
    body: "Everything on the dashboard is the lab's own model of the flows — the four-stage decision engine (token, gateway act chain, policy, obligation layer), the receipt rules and the A2A hand-off are simulated in this process. Product claims about the H2 2026 release, if any appear, are Ping's and UNVERIFIED on our tenant. No part of this page is a statement about real product behaviour, defaults or licensing."
  },
  {
    heading: "How to use the page",
    body: [
      "Nav sections: \"Dashboard\", \"Use Cases\", \"Observability\", \"Guide\", \"Welcome\", \"Airline\".",
      "The Dashboard has 11 scenario chips, one per wired scenario — e.g. \"Balance read (delegated token)\", \"MFA step-up\", \"HITL approval\", \"Group gate\", \"Directory flip\", \"Premium tool gate\", \"Tier promotion\", \"Tier ceiling\", \"Rogue agent\", \"Upstream audience\", \"CIBA\". Press one to run the scenario end to end.",
      "Use Cases owns the full runner over all 87 use cases; Observability shows what each layer logged for a run; the Guide explains the flows. The header has the Mock/Real toggle, theme, font size, Presenter, talk track and Reset."
    ]
  },
  {
    heading: "Mode honesty",
    body: "Mock mode is fully simulated: tokens, the PDP, the directory and the OTP (mock code 123123) are all in-process stand-ins, and every token and hop is labelled mock. Real mode, when configured (AIDEMOLAB_REAL_*), activates the dashboard's \"Real PingOne exchange\" panel — a real PingOne token exchange — while the policy engine stays the mock PDP. If Real is not configured the toggle says so and stays on Mock."
  },
  {
    heading: "HITL, receipts and reset",
    body: "A call the policy would permit can still pause as an OBLIGATION (CONFIRM, STEP_UP, HITL_CONSENT or CIBA). Challenges and receipts are issued and checked by the server; a receipt permits one call, is bound to the user, tool, amount and obligation, and expires in 5 minutes. Reset clears this workspace's challenges, receipts and directory edits."
  }
];

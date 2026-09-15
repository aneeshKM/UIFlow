# Computer Use browser layer

This standalone TypeScript project controls the Northstar bank app through a live Playwright Chromium session. It has no LLM or agent dependencies.

## Setup

From `computer-use/`:

```bash
npm ci
npx playwright install chromium
cp .env.example .env
```

The bank frontend must run on port `5174`, which its backend allows through CORS. Start the bank app in two terminals as described in [`bank-app/README.md`](../bank-app/README.md): backend on `8001`, frontend on `5174`. The example environment already uses those ports. Set `HEADLESS=true` when no visible browser is available.

## Run

```bash
npm run browser:smoke
npm test
npm run typecheck
```

The smoke script signs in with the app's simulated login, searches for member `12345`, opens their profile, prints the accessible page snapshot and savings available balance, and writes a screenshot and trace to `evidence/`. Action failures also write screenshots. Tests exercise the browser abstraction against the running bank app, including the unknown-member state using ID `99999`.

The backend does not define a `NOT_FOUND` admin scenario. Searching for an unknown ID is the supported way to trigger that UI state. The browser session owns one context and page throughout a run, so later discovery and replay code can reuse the same action API.

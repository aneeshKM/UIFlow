# Computer Use capability system

This TypeScript project discovers a browser workflow with an OpenAI model, compiles the successful run into a reusable capability artifact, and replays that artifact deterministically against the synthetic Northstar Credit Union app. The implemented capability looks up a member and returns the available balance of their savings account.

The three durable records have separate purposes:

```text
DiscoveryRun        what the model observed and did
CapabilityArtifact validated semantic workflow, inputs, outputs, and checkpoint
ReplayResult        deterministic execution result and business outcome
```

## Architecture

```text
                           ActionPolicy
                    origin, route, action, risk
                                  |
                 +----------------+----------------+
                 |                |                |
            Discovery          Replay         Human operator
                 |                |                |
                 +----------------+----------------+
                                  |
                         BrowserActions
                         SessionControl
                                  |
                 BrowserSession + LocatorResolver
                                  |
                         EvidenceWriter
                                  |
                              Redactor
```

Discovery is the only model-driven execution path. Replay contains no model, prompt, or discovery dependency. All three actors use the same `ActionPolicy`, `BrowserActions`, live browser session, ownership control, and evidence writer. Semantic targets such as `{ role: "button", name: "Search" }` keep artifacts independent of Playwright source code.

## Prerequisites

- Node.js and npm
- Python 3.10 or newer
- A Chromium browser installed through Playwright
- An OpenAI API key for discovery only

## Install

From `computer-use/`:

```bash
npm ci
npx playwright install chromium
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. The file is ignored by git. Replay does not read or call the OpenAI client, so it also works with an invalid or absent key.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BANK_APP_URL` | `http://localhost:5174` | Frontend URL |
| `BANK_API_URL` | `http://localhost:8001` | API health-check URL |
| `ALLOWED_ORIGINS` | `BANK_APP_URL` | Comma-separated browser origin allowlist |
| `ALLOWED_ROUTES` | `/login,/dashboard,/members` | Comma-separated route-prefix allowlist |
| `HEADLESS` | `false` | Run Chromium without a visible window when `true` |
| `OPENAI_API_KEY` | empty | Required only by `discover` |
| `OPENAI_MODEL` | `gpt-5.6-terra` | Discovery model |
| `AGENT_MAX_STEPS` | `20` | Discovery action limit |
| `AGENT_TIMEOUT_MS` | `120000` | Discovery deadline |

## Start the demo application

Open two terminals from `bank-app/`.

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8001
```

Frontend:

```bash
npm ci
npm run dev -- --port 5174
```

The backend seeds fictitious data on first start. Member `12345` has a savings available balance of `$4,281.50`. See [the bank app README](../bank-app/README.md) for routes and failure scenarios.

## Validate the project

With the frontend and backend running:

```bash
npm run typecheck
npm test
```

The suite uses a mocked model and consumes no API calls. Most tests are isolated; `tests/browser.spec.ts` is the live browser integration suite and checks that both demo services are available.

## Run discovery and build an artifact

```bash
npm run discover -- \
  "Look up member 12345 and read their current savings balance"
```

The command establishes the simulated login in trusted code, starts tracing, and runs the bounded model loop. It writes a redacted discovery JSON record, screenshot, and trace under `evidence/discovery/`. The checked-in canonical discovery can be built with this copy-pastable command:

```bash
npm run artifact:build -- \
  evidence/discovery/discovery-success.json
```

For a new discovery, replace that path with the UUID-named JSON path printed by `discover`. The builder parameterizes discovered inputs, removes model reasoning and concrete outputs, creates semantic steps and checkpoints, and validates the final artifact before an atomic owner-only write. The checked-in example is `artifacts/get-member-savings-balance.v1.json`.

## Run deterministic replay

Success:

```bash
npm run replay -- \
  artifacts/get-member-savings-balance.v1.json \
  --memberId 12345
```

Known business outcome:

```bash
npm run replay -- \
  artifacts/get-member-savings-balance.v1.json \
  --memberId 99999
```

The first command returns `success` and `savingsBalance: "$4,281.50"`. The second returns the valid business outcome `MEMBER_NOT_FOUND` with a successful process exit. Replay validates the artifact and runtime inputs, applies policy before every step, retries a recoverable locator failure once, detects known application states, and evaluates the final checkpoint.

To prove that replay is model-independent:

```bash
OPENAI_API_KEY=invalid npm run replay -- \
  artifacts/get-member-savings-balance.v1.json \
  --memberId 12345
```

## Run the human escalation demo

```bash
npm run replay -- \
  artifacts/get-member-savings-balance.v1.json \
  --memberId 12345 \
  --headed \
  --demo-failure click-search
```

After the forced locator retry is exhausted, enter:

```text
observe
click
button
Search
complete
```

Press Enter for the optional note. The same browser session transfers exclusively to the human, records the constrained operator actions, returns control to automation, and continues from the next step. A run allows at most three interventions and each handoff expires after 15 minutes.

## Evidence

Every run uses a consistent record with IDs, status, actions or completed steps, outputs or failure, duration, intervention count, and evidence paths. JSON passes through `EvidenceWriter` and the recursive `Redactor` before reaching disk. Operator typed values are always recorded as `[REDACTED]`; observations redact form-control values. Screenshots and traces contain only the synthetic demo application and must receive deployment-specific retention and access controls with real customer data.

The small checked-in review set is indexed in [evidence/README.md](evidence/README.md). New UUID-named run files remain ignored so routine demos do not pollute the repository.

## Safety

- The action schema exposes only observe/read, click, type, wait, allowed navigation, finish, and fail semantics. It exposes no JavaScript, shell, upload, download, or arbitrary Playwright execution.
- `ActionPolicy` is the single authority for allowed actions, origins, route prefixes, and risk. Requested navigation is checked before execution and the resulting URL is checked after navigation or redirects.
- Safe actions execute automatically. State-changing actions return `POLICY_REQUIRES_HUMAN`. Irreversible actions return `POLICY_BLOCKED` for automation and humans.
- Discovery, replay, setup actions, observation, screenshots, and the operator console all pass through the policy-bound browser layer. `SessionControl` prevents concurrent human and automation ownership.
- Artifacts are schema-validated on load and again by `ReplayEngine`; their own allowlist cannot expand the runtime policy.
- Key-based recursive redaction covers passwords, API keys, authorization headers, cookies, session IDs, tokens, and client secrets, with value-pattern checks as defense in depth.
- Evidence stores observations, selected actions, targets, and outcomes. It does not request or persist model chain-of-thought.

## Limitations

The demo uses synthetic banking data and a simulated frontend-only login. Screenshots and Playwright traces are binary evidence and are not pixel-redacted. The redactor is defensive code rather than an institution-specific data-classification system. Production deployment would add enterprise secret management, encrypted evidence storage, retention policy, RBAC, audit export, stronger PII classification, and isolated tenant execution.

Native desktop control, tenant override storage, cross-version artifact resolution, distributed workers, and a web operator dashboard are intentionally outside this vertical slice. The semantic artifact and browser boundary provide the adapter seam for those additions.

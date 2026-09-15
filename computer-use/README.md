# Computer Use discovery, artifact, and replay layers

This standalone TypeScript project discovers browser workflows against the Northstar bank app, turns successful discovery runs into reusable capability artifacts, and replays those artifacts deterministically. Discovery uses an OpenAI model. Artifact construction and replay do not call a model.

The three data products have separate responsibilities:

```text
DiscoveryRun        evidence of what the model observed and did
CapabilityArtifact reusable, validated automation definition
ReplayResult        deterministic execution result
```

## Setup

From `computer-use/`:

```bash
npm ci
npx playwright install chromium
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. Discovery defaults to `gpt-5.6-terra`, 20 steps, and a 120-second overall timeout. `.env` is ignored by git.

The bank frontend must run on port `5174`, which its backend allows through CORS. Start the bank app in two terminals as described in [`bank-app/README.md`](../bank-app/README.md): backend on `8001`, frontend on `5174`. The example environment already uses those ports. Set `HEADLESS=true` when no visible browser is available.

## Run

```bash
npm run browser:smoke
npm test
npm run typecheck
npm run discover -- "Look up member 12345 and read their current savings balance."
npm run artifact:build -- evidence/discovery/discovery-<run-id>.json
npm run replay -- artifacts/get-member-savings-balance.v1.json --memberId 12345
npm run replay -- artifacts/get-member-savings-balance.v1.json --memberId 99999
```

The discovery script establishes the app's simulated session in trusted code before the model loop starts. Credentials are never included in model prompts or discovery evidence. A completed run writes redacted JSON, a final screenshot, and a Playwright trace under `evidence/discovery/`.

`artifact:build` accepts one successful discovery JSON file and writes a versioned artifact to `artifacts/`. For the savings-balance flow, its output is `artifacts/get-member-savings-balance.v1.json`. The builder converts the discovered member number into the required `memberId` input, declares `currentSavingsBalance` as an output, replaces blind waits with a semantic wait when the next control is known, and adds an explicit final checkpoint. Concrete input and output values and the model's reasoning are excluded.

Every artifact is checked before it is saved. Validation covers the schema and capability versions, unique step and field names, declared input and output references, supported actions, semantic locators, policy allowlisting, a nonempty checkpoint, an extraction step for every output, and common secret patterns. JSON writes are atomic and use owner-only file permissions.

## Deterministic replay

Replay validates the artifact and all runtime inputs before starting the browser. It then executes each declared action through `BrowserActions` and `LocatorResolver`, observes runtime states through `SurfaceObserver`, stores declared extraction outputs, and evaluates the final checkpoint. Replay has no `OpenAIModel`, `DiscoveryAgent`, or prompt dependency.

The current runtime outcomes are:

- A valid member returns `success` with `currentSavingsBalance`.
- An unknown member returns `business_outcome` with `MEMBER_NOT_FOUND`. This is a valid domain result and uses a successful process exit code.
- Session expiry, a persistent loading state, an application error, a missing locator, an action error, or a failed checkpoint returns a structured `failure` and a nonzero process exit code.

Replay retries a failed locator after one refreshed observation and checks a transient loading state once. It does not apply generic retries to hard failures. Each browser-backed replay writes `replay-<runId>.json`, `replay-<runId>.png`, and `replay-<runId>-trace.zip` under `evidence/replay/`. JSON evidence records input names without recording their values.

The model can request only `click`, `type`, `read`, `navigate`, `wait`, `finish`, or `fail`. Targets use ARIA roles and accessible names or exact visible text. The policy rejects external navigation and controls associated with destructive or record-creating operations. Model output never reaches Playwright without schema and policy validation.

The smoke script signs in with the app's simulated login, searches for member `12345`, opens their profile, prints the accessible page snapshot and savings available balance, and writes a screenshot and trace to `evidence/`. Action failures also write screenshots. Tests exercise both the browser abstraction and agent orchestration. The real LLM is mocked in orchestration tests so the suite remains deterministic and does not consume API calls.

The backend does not define a `NOT_FOUND` admin scenario. Searching for an unknown ID is the supported way to trigger that UI state. The browser session owns one context and page throughout discovery or replay.

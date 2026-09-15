# Computer Use discovery and capability artifact layers

This standalone TypeScript project runs an LLM-driven discovery loop against the Northstar bank app and turns a successful run into a reusable capability artifact. Discovery observes the live page through Playwright accessibility snapshots, requests one structured OpenAI decision, validates that decision with a local policy, executes it through the semantic browser layer, and repeats until success or a bounded stop. Artifact construction is deterministic and does not call the model.

The three data products have separate responsibilities:

```text
DiscoveryRun        evidence of what the model observed and did
CapabilityArtifact reusable, validated automation definition
ReplayResult        deterministic execution result (next milestone)
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
```

The discovery script establishes the app's simulated session in trusted code before the model loop starts. Credentials are never included in model prompts or discovery evidence. A completed run writes redacted JSON, a final screenshot, and a Playwright trace under `evidence/discovery/`.

`artifact:build` accepts one successful discovery JSON file and writes a versioned artifact to `artifacts/`. For the savings-balance flow, its output is `artifacts/get-member-savings-balance.v1.json`. The builder converts the discovered member number into the required `memberId` input, declares `currentSavingsBalance` as an output, replaces blind waits with a semantic wait when the next control is known, and adds an explicit final checkpoint. Concrete input and output values and the model's reasoning are excluded.

Every artifact is checked before it is saved. Validation covers the schema and capability versions, unique step and field names, declared input and output references, supported actions, semantic locators, policy allowlisting, a nonempty checkpoint, an extraction step for every output, and common secret patterns. JSON writes are atomic and use owner-only file permissions.

The model can request only `click`, `type`, `read`, `navigate`, `wait`, `finish`, or `fail`. Targets use ARIA roles and accessible names or exact visible text. The policy rejects external navigation and controls associated with destructive or record-creating operations. Model output never reaches Playwright without schema and policy validation.

The smoke script signs in with the app's simulated login, searches for member `12345`, opens their profile, prints the accessible page snapshot and savings available balance, and writes a screenshot and trace to `evidence/`. Action failures also write screenshots. Tests exercise both the browser abstraction and agent orchestration. The real LLM is mocked in orchestration tests so the suite remains deterministic and does not consume API calls.

The backend does not define a `NOT_FOUND` admin scenario. Searching for an unknown ID is the supported way to trigger that UI state. The browser session owns one context and page throughout a run. Deterministic replay and its runtime outcome handling remain the next milestone.

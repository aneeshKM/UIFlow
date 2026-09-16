# Computer-Use Automation System

This repository is a complete take-home submission for the interface.ai computer-use automation assignment. It contains a synthetic banking application and a TypeScript automation system that uses an LLM for workflow discovery, compiles the successful run into a typed capability artifact, and replays that artifact deterministically without a model in the decision loop.

## Submission map

- [Computer-use implementation and full operating guide](computer-use/README.md)
- [Design report](REPORT.md)
- [Canonical evidence index](evidence/README.md)
- [Synthetic Northstar Credit Union application](bank-app/README.md)
- [Saved callable artifact](computer-use/artifacts/get-member-savings-accounts.v1.json)

## Architecture at a glance

```text
Natural-language goal
        |
        v
LLM discovery loop -----> redacted discovery evidence
        |
        v
typed capability artifact
        |
        v
deterministic replay ----> success | business outcome | failure
        |
        +---------------> same-session human intervention
```

Discovery, replay, and human intervention share the same policy-controlled browser layer. Replay does not import or invoke the model. The recorded artifact uses semantic targets, typed parameters and outputs, ordered steps, expectations, and a final checkpoint.

## Prerequisites

- Node.js and npm
- Python 3.10 or newer
- An OpenAI API key for live discovery only
- Playwright Chromium

## Setup

Install the automation dependencies and browser:

```bash
cd computer-use
npm ci
npx playwright install chromium
cp .env.example .env
```

Set `OPENAI_API_KEY` in `computer-use/.env` for discovery. Deterministic replay does not require an OpenAI key.

Start the synthetic banking backend from the repository root:

```bash
cd bank-app/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8001
```

In another terminal, start the frontend:

```bash
cd bank-app
npm ci
npm run dev -- --port 5174
```

The app will be available at `http://localhost:5174`. All seeded members and financial records are fictitious.

## Demo path

From `computer-use/`, run genuine model-driven discovery:

```bash
npm run discover -- \
  "Look up member 23457 and return every Savings account with its masked account number, available balance as a currency string including the dollar sign, and status."
```

Build a reusable artifact from the discovery JSON path printed by the command:

```bash
npm run artifact:build -- \
  evidence/discovery/<run-folder>/discovery_<run-id>.json
```

Replay the saved artifact deterministically:

```bash
npm run replay -- \
  artifacts/get-member-savings-accounts.v1.json \
  --memberId 12345
```

Exercise a known business outcome:

```bash
npm run replay -- \
  artifacts/get-member-savings-accounts.v1.json \
  --memberId 99999
```

Exercise same-session human takeover and resume:

```bash
npm run replay -- \
  artifacts/get-member-savings-accounts.v1.json \
  --memberId 12345 \
  --headed \
  --demo-failure click-search
```

The detailed operator commands and additional scenarios are documented in the [implementation README](computer-use/README.md#run-the-human-escalation-demo).

## Validation

With both demo services running:

```bash
cd computer-use
npm run typecheck
npm test
```

The test suite uses a mocked model and makes no OpenAI API calls. It includes live-browser coverage for deterministic success, multiple outputs, slow responses, business outcomes, operational failures, safety policy, and human control transfer.

The frontend can be independently type-checked and built with:

```bash
cd bank-app
npm run build
```

## Configuration and offline boundaries

Environment settings are documented in [`computer-use/.env.example`](computer-use/.env.example). Discovery requires the local demo application and an OpenAI API key. Replay requires the local demo application but no model service. Unit tests use model and browser-layer test doubles; the explicitly live browser tests require the frontend and backend.

## Safety note

The demo uses synthetic records. JSON evidence passes through centralized redaction, artifacts reject common secret fields and values, navigation is constrained by origin and route allowlists, and risky actions require human review or are blocked. Binary screenshots and Playwright traces are retained only as synthetic demonstration evidence; production deployment would require content-aware redaction, encryption, retention controls, tenant isolation, and RBAC.

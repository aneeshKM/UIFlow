# Canonical evidence

This directory contains one deliberately reviewed end-to-end evidence set. Each run uses a UTC-named folder under `discovery/` or `replay/`: `YYYY-MM-DD_HH-mm-ss__<short-run-id>`.

| Scenario | Files | Verified result |
| --- | --- | --- |
| Genuine LLM discovery | `discovery/2026-09-16_13-04-11__28bb96b9/` | The model selects `read_many` and returns both Savings records for member `23457`; a model-timeout intervention is also preserved. |
| Exact generated artifact | `artifacts/get-member-savings-accounts.v1.json` | `metadata.sourceRunId` equals discovery run `28bb96b9-9b0d-4e1d-9f5d-91d3dd2a6abe`. |
| One-account replay success | `replay/2026-09-16_13-08-47__a39bf8fc/` | Nine deterministic steps return the single Savings record for member `12345`. |
| Multi-account replay success | `replay/2026-09-16_13-08-49__6f791177/` | Member `23457` returns both Savings records, `****5005` and `****5006`, in order. |
| Missing-member business outcome | `replay/2026-09-16_13-08-51__fa81ad15/` | `business_outcome: MEMBER_NOT_FOUND` at `click-search`. |
| Empty-account business outcome | `replay/2026-09-16_13-08-52__d7be1f2b/` | Member `23458` returns `business_outcome: NO_ACCOUNTS_FOUND` at `click-view`. |
| Injected hard failure | `replay/2026-09-16_13-08-54__6906706d/` | `failure: LOCATOR_NOT_FOUND` includes step, expected target, screenshot, and trace. |
| Human handoff and resume | `replay/2026-09-16_13-09-19__9222b992/` | The operator uses the same session, completes Search, returns control, and all nine replay steps succeed with one intervention. |

The artifact under `evidence/artifacts/` is byte-for-byte identical to the callable artifact under `artifacts/`. JSON evidence is sanitized before persistence. Screenshots and traces contain only synthetic demo data and require deployment-specific retention, encryption, access control, and redaction for real customer data.

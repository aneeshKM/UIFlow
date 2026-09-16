# Canonical evidence

The reviewed evidence is stored with the automation implementation under [`computer-use/evidence/`](../computer-use/evidence/). This root-level index provides the assignment's required `/evidence/` entry point without duplicating large screenshots and Playwright traces.

| Scenario | Evidence | Verified result |
| --- | --- | --- |
| Genuine LLM discovery | [Discovery run](../computer-use/evidence/discovery/2026-09-16_13-04-11__28bb96b9/) | The model completes a live multi-step member lookup and extracts two Savings records. |
| Generated capability | [Saved artifact](../computer-use/evidence/artifacts/get-member-savings-accounts.v1.json) | Typed, versioned artifact derived from the discovery run. |
| One-account replay | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-08-47__a39bf8fc/) | Nine deterministic steps return one Savings record. |
| Multi-account replay | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-08-49__6f791177/) | The same artifact returns two ordered Savings records. |
| Missing-member outcome | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-08-51__fa81ad15/) | Returns `MEMBER_NOT_FOUND` as a business outcome. |
| Empty-account outcome | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-08-52__d7be1f2b/) | Returns `NO_ACCOUNTS_FOUND` as a business outcome. |
| Injected hard failure | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-08-54__6906706d/) | Returns a structured `LOCATOR_NOT_FOUND` failure with screenshot and trace. |
| Human handoff and resume | [Replay evidence](../computer-use/evidence/replay/2026-09-16_13-09-19__9222b992/) | A human takes over the same session, completes the blocked step, and returns control for successful replay. |

The detailed evidence manifest, including provenance and data-handling notes, is [computer-use/evidence/README.md](../computer-use/evidence/README.md).

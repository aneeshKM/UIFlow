# Phase 4 report

## 1. Architecture

The system is a small vertical slice with three execution modes: model-guided discovery, deterministic replay, and same-session human intervention. They converge at one `ActionPolicy`, one ownership-aware browser layer, and one evidence path. `BrowserSession` owns a single Playwright context and page. `BrowserActions` exposes bounded semantic operations, `LocatorResolver` translates semantic targets, and `SurfaceObserver` returns the URL, title, visible text, and accessibility snapshot.

Discovery records a successful path. `ArtifactBuilder` turns that record into a reusable capability. Replay validates and executes the capability without an LLM. `SessionControl` grants exclusive ownership to automation or a human; `InterventionManager` captures the state before transferring control and returns ownership before automation resumes. This design prevents an execution mode from acquiring separate, less constrained browser access.

The current surface adapter is Playwright. The artifact does not contain `page.locator(...)`, JavaScript, CSS selectors, or coordinates, so browser-specific interpretation remains in the browser package. A future `Surface` adapter could expose `observe()` and `execute(action)` over desktop accessibility APIs or a screenshot/coordinate fallback while retaining policy and evidence above that boundary.

## 2. Artifact schema

The versioned JSON artifact contains capability identity, target application and base URL, typed runtime inputs and outputs, ordered semantic steps, per-step expectations and timeouts, a final checkpoint, policy metadata, and source metadata. The current identity is capability ID plus capability version; future registry identity would add vendor, product, and product version.

Supported artifact actions are `navigate`, `click`, `type`, `extract`, `wait_for`, and `assert`. Targets prefer ARIA role and accessible name, with label, text, placeholder, test ID, and ordered semantic fallbacks. Runtime values are input references or templates. Outputs are created only by declared extraction steps.

`ArtifactValidator` enforces schema version, supported actions, unique step/input/output names, valid references, output-producing extraction steps, checkpoints, regular-expression validity, and secret rejection. Replay revalidates the file because an artifact can be edited after discovery. The artifact's own action list can narrow execution but cannot expand the runtime `ActionPolicy`.

## 3. Determinism & error handling

Replay has no model or prompt dependency. It resolves inputs, executes steps in order, stores declared outputs, checks step expectations, detects application outcomes, and evaluates the final checkpoint. A missing member returns `MEMBER_NOT_FOUND`, a successful business outcome rather than an automation failure.

Locator timeouts receive one refreshed observation and one retry. Hard failures are not retried generically. Structured failures distinguish invalid input, missing locator, timeout, action failure, policy rejection, session expiry, unexpected state, checkpoint failure, and human abort. External destinations are rejected before navigation; the actual URL is checked after navigation to catch redirects. Replay succeeds with an invalid OpenAI key, demonstrating that learned behavior resides in the artifact rather than an inference-time model call.

## 4. Heterogeneity & multi-tenant

For well-marked-up web applications, resolution follows semantic target to ARIA/DOM to Playwright. A legacy adapter could try accessibility semantics, visible text and relationships, a restricted DOM fallback, and finally screenshot coordinates. A desktop adapter could map the same logical actions and targets to OS accessibility APIs. Coordinate fallbacks would be lower-confidence and should require tighter checkpoints or human review.

At scale, a vendor/product/product-version base capability would be separate from tenant overrides. An override could replace `Search` with `Find Member` for one tenant without copying the whole artifact. Replay would select the base capability, apply a version-compatible tenant override, and validate the merged result. Drift signals would include locator-resolution failures, declining checkpoint success, a changed UI fingerprint, or different product-version metadata. Unknown drift would escalate for re-recording instead of silently broadening locators.

This submission implements neither desktop automation nor tenant infrastructure. The semantic artifact and isolated surface layer make that extension credible without destabilizing the working browser slice.

## 5. Escalation & handoff

Discovery escalates when the model is stuck or times out, and replay escalates recoverable locator, state, retry, and checkpoint failures. Review-risk artifacts also require a human decision before capability steps run. Blocked-risk artifacts cannot be approved.

The intervention record includes intervention/run IDs, source, capability and failed step where available, reason, current URL, redacted observation, ownership transition timestamps, structured human actions, resolution, and before/after evidence. The terminal operator can observe, click, type, read, retry, mark a step complete, or abort. Those commands use the same `BrowserActions` and policy. Human ownership permits review-class actions but never blocked actions, arbitrary navigation, raw JavaScript, or unsupported selectors.

## 6. Safety

`ActionPolicy` centralizes the action allowlist, configured origin and route-prefix allowlists, and `SAFE`, `REQUIRES_HUMAN`, and `BLOCKED` decisions. Browser actions check ownership and policy before touching the page, then verify the resulting URL. Discovery validates model decisions before execution. Replay validates both the artifact and every step. Operator commands stay inside the same browser boundary.

`EvidenceWriter` sanitizes JSON before persistence through one recursive `Redactor`. Key-based rules cover passwords, passcodes, API keys, authorization, cookies, session IDs, tokens, and client secrets; pattern rules cover common bearer/API-key strings and selected PII formats. Operator typed values and form-control observations receive contextual redaction. Evidence records observable state, chosen actions, targets, results, and failures rather than chain-of-thought. Artifact validation rejects sensitive fields and common secret values.

The demo data is synthetic. Binary screenshots and traces are not content-redacted, and the current redactor is not a replacement for institution-specific data classification. A production system needs encrypted evidence, retention and deletion controls, tenant isolation, enterprise secret management, RBAC, and audit review.

## 7. Cuts

The implementation omits native desktop control, a tenant override engine and registry, production multi-tenant storage, distributed workers, bounded LLM recovery during replay, cross-tenant artifact canonicalization, a web operator dashboard, enterprise RBAC, and secret-manager integration. These features were cut to keep the submission focused on one complete capability whose discovery, artifact, replay, escalation, safety, and evidence behavior can be run and reviewed locally.

The next engineering step would be an artifact registry keyed by vendor/product/product version/capability version, with signed tenant overrides and replay telemetry for drift. After that, a second surface adapter would validate that the artifact boundary is truly independent of Playwright.

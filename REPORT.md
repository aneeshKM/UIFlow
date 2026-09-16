# Design report

## 1. Architecture

The system implements one end-to-end vertical slice with three execution modes: model-guided discovery, deterministic replay, and same-session human intervention. They converge on one action policy, one ownership-aware browser layer, and one evidence path. `BrowserSession` owns the Playwright context and page. `BrowserActions` exposes bounded semantic operations, `LocatorResolver` translates semantic targets, and `SurfaceObserver` captures the URL, title, visible text, and accessibility snapshot.

Discovery is the only model-driven path. It observes the live banking UI, asks the model for one structured action, validates that action against policy, executes it, and records the result until the goal succeeds or a stopping condition is reached. `ArtifactBuilder` converts the successful run into a reusable capability. `ReplayEngine` validates and executes that capability without a model. `SessionControl` grants exclusive ownership to automation or a human so both cannot manipulate the browser concurrently.

The current surface adapter is Playwright. Browser-specific interpretation stays below the artifact boundary: artifacts contain semantic targets rather than Playwright code, CSS selectors, JavaScript, or coordinates. The trade-off is that the working slice favors accessible web semantics; lower-quality legacy and desktop surfaces would require additional adapters.

The full implementation guide is in [computer-use/README.md](computer-use/README.md).

## 2. Artifact schema

The versioned JSON artifact contains capability identity, target application and base URL, typed runtime inputs and outputs, ordered semantic steps, per-step expectations and timeouts, a final checkpoint, policy metadata, and discovery provenance. Runtime values are represented as input references, templates, or reviewed literals. Outputs are produced only by declared extraction steps.

Targets prefer ARIA role and accessible name, with schema support for label, text, placeholder, test ID, and ordered semantic fallbacks. The demonstrated output is a typed list of Savings-account records rather than an unstructured text blob.

`ArtifactValidator` checks the schema version, action support, unique names and step IDs, references, output-producing steps, checkpoint references, regular expressions, action allowlists, and common secret fields or values. Replay validates again on load because an artifact may have been edited after discovery. The artifact can narrow runtime policy but cannot expand it. Operational model summaries and concrete discovery-time outputs are deliberately excluded.

The canonical example is [get-member-savings-accounts.v1.json](computer-use/artifacts/get-member-savings-accounts.v1.json).

## 3. Determinism & error handling

Replay has no model or prompt dependency. It validates inputs before browser execution, resolves values, executes steps in order, stores declared outputs, verifies step expectations, inspects application state after each step, and evaluates the final checkpoint.

The result contract separates `success`, `business_outcome`, and `failure`. Missing members and empty account collections return typed business outcomes. Slow or loading states receive bounded waiting. Locator timeouts use semantic fallbacks, one refreshed observation, and a bounded retry. Session expiry, application errors, policy rejection, invalid input, locator failure, timeout, checkpoint failure, and human abort remain explicit hard failures with step, expected state, observed state, and a diagnostic message where available.

Requested and resulting URLs are both checked, protecting against redirects outside the allowlist. Saved evidence demonstrates one- and multi-account success, missing-member and empty-account outcomes, an injected locator failure, and successful replay after human intervention.

## 4. Heterogeneity & multi-tenant

For a well-marked-up web app, resolution proceeds from semantic target to accessibility/DOM semantics to Playwright. A legacy-web adapter could attempt accessibility semantics, visible text and relationships, a restricted DOM fallback, and finally screenshot coordinates. A desktop adapter could map the same logical actions and targets to operating-system accessibility APIs. Low-confidence coordinate targeting should require tighter checkpoints or human review.

At scale, a vendor/product/product-version base capability would be separated from tenant overrides. An override could replace a label or locator for one institution without copying the full artifact. Replay would select a compatible base artifact, apply signed tenant-specific overrides, and validate the merged capability. Locator failures, declining checkpoint success, changed UI fingerprints, and product-version metadata would provide drift signals. Unknown drift should escalate for review rather than silently broaden targeting.

Desktop automation and tenant infrastructure are intentionally not implemented; the semantic artifact and isolated surface boundary are the extension seams.

## 5. Escalation & handoff

Discovery escalates on stuck or timed-out execution. Replay escalates recoverable locator, state, retry, and checkpoint failures, while review-risk artifacts require a human decision before capability steps execute. Blocked actions cannot be approved through the operator path.

An intervention request records the source, capability or goal, failed step, reason, current URL, redacted observation, screenshot, and timestamps. Automation pauses, `SessionControl` transfers exclusive ownership to the human, and the terminal operator can observe, click, type, read, retry, mark the failed step complete, or abort. These commands use the same live `BrowserSession`, `BrowserActions`, and policy as automation. The manager captures human actions and before/after evidence, returns ownership to automation, and replay resumes at the appropriate step.

The terminal console is deliberately minimal; the control-transfer model is real even though a production co-browsing dashboard is out of scope.

## 6. Safety

`ActionPolicy` centralizes allowed actions, origins, route prefixes, and `SAFE`, `REQUIRES_HUMAN`, or `BLOCKED` decisions. It applies to discovery, replay, observations, setup actions, screenshots, and operator commands. Browser actions also validate the resulting URL after navigation. Raw CSS, arbitrary JavaScript, shell access, upload, download, and unrestricted browser execution are unavailable to the model and operator.

JSON evidence is sanitized by one recursive writer. Credentials, passwords, API keys, authorization headers, cookies, session identifiers, tokens, selected PII formats, and operator-entered values are redacted. Artifacts reject sensitive fields and common secret values. Discovery does not request or persist private chain-of-thought; it stores only a short, redacted operational decision summary alongside observable state and action results.

The committed demonstration uses entirely synthetic data. Binary screenshots and traces are not content-redacted, and the defensive redactor is not a complete institution-specific classification system. Production requires content-aware PII controls, encrypted evidence, retention and deletion policy, RBAC, audit review, isolated tenant execution, and enterprise secret management.

## 7. Cuts

The submission omits native desktop control, tenant override storage and resolution, production multi-tenant infrastructure, distributed workers, bounded model recovery during replay, cross-tenant canonicalization, a web operator dashboard, enterprise RBAC, and secret-manager integration. These were cut to keep the implementation focused on a complete, reviewable capability spanning discovery, artifact construction, deterministic replay, exceptional outcomes, safety, escalation, and evidence.

The next engineering step would be an artifact registry keyed by vendor, product, product version, and capability version, with signed tenant overrides and replay telemetry for drift. A second surface adapter would then test whether the semantic artifact boundary is genuinely independent of Playwright.

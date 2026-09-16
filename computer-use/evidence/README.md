# Canonical evidence

This directory keeps one deliberate review set. UUID-named files from routine local runs are ignored.

| Scenario | Files | Expected result |
| --- | --- | --- |
| Discovery success | `discovery/discovery-success.json`, `.png`, `-trace.zip` | Model discovers the parameterized savings-balance workflow. |
| Replay success | `replay/replay-success.json`, `.png`, `-trace.zip` | `success`, six completed steps, `$4,281.50`. |
| Known business outcome | `replay/replay-member-not-found.json`, `.png`, `-trace.zip` | `business_outcome: MEMBER_NOT_FOUND`. |
| Human escalation | `escalation/intervention.json`, `-before.png`, `-after.png` | Same-session operator completes the forced Search action and returns control. |

All data belongs to the synthetic Northstar application. JSON evidence is sanitized before persistence. Screenshots and traces are binary review artifacts and require stricter controls if the system is connected to real customer data.

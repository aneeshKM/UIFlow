# Canonical evidence

This directory keeps one deliberate review set. Each run has a UTC-named folder in `discovery/` or `replay/`: `YYYY-MM-DD_HH-mm-ss__<first-eight-run-id-characters>`. JSON keeps full run and intervention UUIDs. Routine local run folders are ignored.

| Scenario | Files | Expected result |
| --- | --- | --- |
| Discovery success | `discovery/2026-09-16_01-52-48__b7389084/discovery_b7389084.json`, `.png`, `-trace.zip` | Model discovers the parameterized savings-balance workflow. |
| Replay success | `replay/2026-09-16_02-32-08__baf38893/replay_baf38893.json`, `.png`, `-trace.zip` | `success`, six completed steps, `$4,281.50`. |
| Known business outcome | `replay/2026-09-16_02-32-08__8da22f9f/replay_8da22f9f.json`, `.png`, `-trace.zip` | `business_outcome: MEMBER_NOT_FOUND`. |
| Human escalation | `replay/2026-09-15_22-58-15__e9379153/interventions/int-7951/intervention.json`, `before.png`, `after.png` | Same-session operator completes the forced Search action and returns control. |

The discovery sample used its `startedAt` timestamp. The replay samples do not record `startedAt`, so their migrated folder timestamps use the original evidence commit time. The intervention-only review sample used its `createdAt` timestamp; its parent replay record was not part of the original review set. New runs use their actual run start time for the folder name.

Replay and discovery interventions are written under the parent run's `interventions/<short-intervention-id>/` directory. Existing external flat evidence should be moved or archived manually if it must be retained; the new writer does not auto-migrate historical files.

All data belongs to the synthetic Northstar application. JSON evidence is sanitized before persistence. Screenshots and traces are binary review artifacts and require stricter controls if the system is connected to real customer data.

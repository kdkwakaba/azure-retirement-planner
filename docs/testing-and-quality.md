# Testing and assessment quality

This document describes the checks used to maintain the application and the additional evidence needed before relying on model judgments in a particular organization.

## Automated repository checks

Run `npm ci --ignore-scripts` and `npm run verify`. CI checks formatting, lint, types, unit and contract behavior, build, documentation links, runtime/artifact constraints, and npm advisories. Bicep files are compiled and checked in CI. Cloud changes, paid model calls, and GitHub export are excluded from routine CI.

Synthetic fixtures exercise boundary cases without storing real tenant identifiers, documents, model prompts, or outputs in the repository. Fixture success proves only the exercised contract or rule behavior.

## Test dimensions

- Lifecycle classification: deprecation, creation stop, support end, retirement, updates, cancellation, ambiguous and missing dates.
- Discovery: complete pagination, multiple subscriptions, unsupported profiles, explicit targets, unknown attributes, partial failures, permission errors, and empty results.
- Decision and policy: impact axes, priority boundaries, deadlines, unknown values, model abstention, ties, rule floors, and work required/recommended distinctions.
- Evidence and versioning: missing or wrong-scope references, source updates, human corrections, changed hashes, approval expiry, and immutable history.
- SharePoint: folder permissions, limits, changed/deleted documents, extraction failures, citation location, fact correction/exclusion, source class separation, and invalid dependency graphs.
- Authorization: unauthenticated requests, user/application token separation, and role-specific read, correction, governance, synchronization, notification, and export access.
- Export: no approval, stale version, duplicate request, partial Issue/Project success, retry, response loss, and safe error handling.
- Resilience: queue retry, poison handling, storage conflict, timeout, throttling, malformed provider response, and unavailable model.

## Model quality evaluation

The repository includes metric and manifest validation utilities for a versioned evaluation set. A result set should identify source class, source/version references, assessment date, input hash, model/deployment/prompt/rule/schema versions, invocation time, reviewer count/state, and expected human judgments. Raw production payloads and personal data must remain in protected storage and must not be committed or attached to CI artifacts.

Use independent scenarios that vary service, environment, impact, deadline, business context, completeness, and response path. Keep all versions of the same lifecycle event in one evaluation split. Repeated runs of the same input measure model variability; they are not additional independent scenarios.

Report at least:

| Measure | Purpose |
|---|---|
| Resource candidate precision/recall | Measure candidate coverage and false positives by notice/profile |
| Impact and priority agreement | Compare with independent human judgments, including severe underestimation |
| Owner assignment agreement | Separate correct assignments, multiple candidates, and abstentions |
| Unsupported claims and references | Count unsupported claims, fabricated IDs, missing evidence, and invalid citations |
| Work-item precision/recall | Compare proposed actions with an approved required set; assess additional recommended work separately |
| Override and abstention | Track disagreement, human corrections, and model abstention by decision field |
| Operational quality | Measure latency, failure rate, review time, and cost per assessment |

Model-reported scores are not accuracy or calibrated confidence. Small evaluation sets cannot establish performance across all Azure services or organizations. Agree on acceptance thresholds, independent ground truth, data governance, and monitoring with the adopting organization before using automated output to reduce review.

## Required safety properties

- Unsupported resource IDs, dates, successors, costs, and business facts are not accepted as confirmed evidence.
- Unknown and incomplete retrieval are never silently converted into no impact.
- Stale approvals and stale assessment hashes are rejected.
- No Azure resource change occurs through the assessment workflow.
- No unapproved, duplicate, or out-of-scope work item is exported.
- Partial external success is reconciled before retry and is not represented as complete.

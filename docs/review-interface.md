# Review interface behavior and acceptance checks

This document defines the interface and API behavior expected from a review operation. Checks that write data or call external services must use an explicitly authorized environment and target.

## Read access

- An authenticated user with `Reader` can open the assessment list, summary, selected assessment, evidence, and source status.
- An unauthenticated request receives an authentication response and does not expose assessment content or resource identifiers.
- A list refresh updates displayed records without changing the assessment, evidence, work items, approvals, or external systems.
- Selecting a notice displays only the corresponding event/workload assessment and its current version.
- Partial discovery, Unknown classifications, missing evidence, and model invocation failures remain visible as such.

## Correction and review

- Only `Reviewer` or `Governance` can submit corrections; only `Governance` can manage business context and SharePoint facts/sources.
- A correction requires a reason and evidence where the operation changes scope or a confirmed fact. It creates a new immutable assessment version.
- Unknown, incomplete, or conflicting evidence remains reviewable; it is not changed to unaffected solely to permit approval.
- Approval requires at least one current work item, a reason, and a matching assessment version/hash. Partial approval applies only to selected work IDs.
- Defer, return for correction, and no-action outcomes require a reason. No-action hides an assessment from the normal list but retains the record and evidence.
- Changes to decision-relevant evidence, dates, scope, impact, priority, ownership, work, or package hash reject affected stale approvals.

## External operations

- Synchronization requires `Operator` or `Governance` and an enabled source setting.
- Notice ingestion accepts only an application token with `NotificationSender` and only when ingestion is enabled.
- GitHub export requires export to be enabled, an approved current work item, valid configuration, and a usable credential.
- Issue creation and Project item updates are separate stages. If the second stage fails after the first succeeds, the existing issue is reconciled rather than duplicated.
- Project progress synchronization is separately controlled and does not change assessment decisions or approval state.

## Security and safety checks

Verify both the UI behavior and direct API behavior. Hiding a control is not an authorization check. For every write route, check the allowed role, current-version/hash guard, required reason/evidence, and expected response for unauthorized or stale requests.

Do not use a real customer workload to test destructive, correction, approval, or export paths without explicit authorization. Never add real resource IDs, payloads, tokens, screenshots, or document excerpts to test results or public issues.

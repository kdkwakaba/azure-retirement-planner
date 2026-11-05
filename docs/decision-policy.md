# Decision and approval policy

This policy defines how the application separates notice scope, Azure resource applicability, business impact, priority, and human approval. It is not an organization-wide standard until an organization adopts and configures it.

## Notice scope

The source's official lifecycle category is retained separately from a human scope disposition. The application does not exclude a notice using a keyword alone. A reviewer may mark a notice out of scope only with a reason and human evidence. Out-of-scope assessments do not retain active priority or work items and cannot be approved or exported. Reconsideration creates a new assessment version.

## Impact axes

The application records two independent impact judgments:

| Level | Risk if unaddressed | Impact during and after response |
|---|---|---|
| Low | Limited operational inconvenience; business effects are minor | Change effects, cost, or operational differences are within confirmed tolerances |
| Medium | Partial feature, monitoring, cost, or service degradation; a workaround may exist | Bounded outage, differences, or workload that can be managed using a confirmed plan |
| High | Important business capability may stop or materially degrade, or a substantial cost/operational effect may occur | Important capabilities may be interrupted or require significant mitigation |
| Critical | Continuity, major data, regulatory, or contractual exposure is supported by evidence | A comparable severe effect during or after the response is supported by evidence |
| Unknown | Available information cannot support a level | Available information cannot support a level |

Do not average away a severe dimension. Unknown is not Low. Critical workload designations require a human-confirmed source. Change size and business impact are different judgments. Missing alternatives alone do not establish Critical impact.

If workload-specific dependency data is unavailable, the interface may show a conditional general lifecycle narrative. It must not invent business process names, outage duration, costs, or migration requirements. A document statement does not establish current runtime use.

## Priority and timing

Priority is the urgency of planning and decision-making; P1 does not authorize an immediate production change.

| Priority | Meaning |
|---|---|
| P1 | Decide or start planning urgently; confirm feasibility or risk acceptance |
| P2 | Establish the plan early; begin investigation, design, and staffing |
| P3 | Include in a normal change plan and track progress |
| P4 | Limited impact and adequate lead time; monitor or plan later |

Where the required deadline and approved work durations are available, planning margin is the latest feasible start date minus assessment date. Critical path, dependencies, blackout periods, staffing, and contingency must be considered. If dates or durations are missing, do not invent plan dates. The current deployment conservatively uses a P2 floor for important unresolved cases and P1 for an unresolved overdue or near-term deadline; see the rule implementation for exact conditions.

For deadlines that require a response, the baseline matrix is:

| Unaddressed impact | 0 days or less | 1–30 days | 31–90 days | 91+ days |
|---|---:|---:|---:|---:|
| Critical | P1 | P1 | P2 | P2 |
| High | P1 | P1 | P2 | P3 |
| Medium | P1 | P2 | P3 | P3 |
| Low | P1 | P2 | P3 | P4 |

These are planning thresholds, not universal business requirements. A confirmed high or critical response impact without an approved mitigation has a P2 floor. Rules set lower bounds; the model cannot reduce priority below the applicable floor. A human records the reason for an approved reduction.

The model may return `Immediate`, `Within 30 days`, `Within 90 days`, `Within 180 days`, `Later`, `No action`, or `Unknown` for the beginning of the overall program. This is not a calculated start date for each work item. `No action` is a reasoned candidate, not a blank or an incomplete review.

## Lifecycle dates

Keep deprecation start, new creation stop, support end, retirement date, and other response deadlines separate. Do not reuse a deprecation start date or migration deadline as a retirement date. If a retirement date is not explicitly supported by an authoritative structured field or narrowly recognized official retirement statement, leave it unknown. Conflicting or ambiguous dates require human review.

An unannounced retirement date remains null. This alone does not establish overdue status or mandatory migration. A later official update creates a new event/assessment version; affected approvals expire. Similar titles or names are not sufficient to merge events.

## Resource classification

Resource applicability is recorded per Azure resource, separately from business impact.

| Classification | Use |
|---|---|
| Confirmed | Service Health or Advisor explicitly identifies the resource. Preserve the explicit evidence even if other attributes require review. |
| Probable | A resource matches an enabled, versioned notice applicability profile and its documented conditions. |
| Possible | Direct Azure configuration evidence supports a relationship, without sufficient basis for a stronger result. |
| Verification Required | A concrete unknown can be resolved through a defined human check. State the missing attribute and the check. |
| Not Impacted | Required attributes and scope are complete and an approved profile or official exclusion establishes non-applicability. |
| Unknown | Applicability cannot be determined and no specific verification route is known. |

The current profile registry covers Basic Load Balancer, Storage GPv1, Application Insights URL ping tests, and classic Foundry Agent Service. Profile coverage is not exhaustive. Profiles select candidate resource types; matching does not prove runtime use. Explicit Service Health/Advisor resources are retained even outside these profiles.

An unsupported profile results in `ProfileUnavailable` review rather than a claim of no impact. A complete search with zero candidates is distinct from incomplete discovery, all resources explicitly not impacted, and an unsupported profile. `No resources found` is not equivalent to no business impact or no action.

## Review requirements

Human review is required when uncertainty can change the conclusion, including:

- Unknown, Possible, Verification Required, or relevant incomplete discovery;
- missing deadline, criticality, scope, migration duration, or alternative that affects feasibility;
- a material conflict between official evidence and configuration/business records;
- assumptions that could change priority or response choice;
- Critical workloads or high-risk model disagreement, low scores, or tied leading categories;
- work-item approval, scope disposition, or external registration.

Decision score distributions are not calibrated confidence. High model scores do not replace review. The UI may allow assessment review to be skipped for a fully scoped, completely retrieved, clearly non-applicable case, but this does not approve work, declare no business impact, or permit an export.

## Work and approval

Work items distinguish evidence-backed required tasks from recommended investigations. Uncertain migration is not a required migration. Impact Verification items are confirmation tasks and do not authorize production changes.

Approvals are bound to the current assessment version and package hash. Partial approval applies only to selected items. Correction, re-evaluation, evidence changes, material dates, scope, impact, priority, owner, schedule, or acceptance-criteria changes invalidate affected approvals. Old assessments and source records remain immutable history.

The review outcomes are approve, partial approve, return for correction, defer, and no action. No action hides an event/workload from the normal list but preserves the notice, evidence, assessment, and review history. It does not close GitHub work or change Azure.

## Evidence and reassessment

Store official source, source version/hash, observation time, scope completeness, decision and explanation invocation records, human corrections, and approval identity/time. Do not fabricate resource IDs, dates, prices, successors, or owners. A source update or human correction creates a new version; it never overwrites prior evidence or silently carries forward an invalid approval.

# Architecture decisions

This document records current, implementation-relevant decisions. It replaces historical discussion notes and environment-specific operating records.

## Adopted decisions

| Area | Decision |
|---|---|
| Product boundary | Support lifecycle impact assessment and planning; do not perform incident recovery or modify assessed resources. |
| Data sources | Use Azure Service Health, Resource Graph, selected Advisor/control-plane data, and explicitly configured SharePoint sources. Preserve source, time, scope, and retrieval completeness. |
| Identity | Use Entra authentication and API role checks for users, Managed Identity for Azure service access, and OIDC for deployment automation. |
| Decision ownership | Microsoft-Decision-1 returns typed proposals; deterministic rules enforce policy constraints; explanation generation organizes evidence; humans confirm business facts and approve work. |
| Uncertainty | Unknown and incomplete evidence are explicit states. Missing data is not interpreted as no impact. |
| Impact | Keep risk if unaddressed separate from impact during and after response. Do not equate technical change size with business impact. |
| Assessment identity | Assessments are versioned by lifecycle event and workload. Corrections and source updates create new versions and invalidate affected approvals. |
| Evidence | Preserve immutable source evidence, model invocation metadata, human corrections, and approval hashes. Do not create unsupported dates, IDs, costs, owners, or successor services. |
| SharePoint | Read only configured folders using selected Graph access. Require human confirmation of extracted facts and explicit dependency links before using them as assessment evidence. |
| External work | Export only human-approved work items. GitHub Issue creation and Project item updates are separate and retryable stages. Closing an external issue does not automatically complete internal work. |
| Infrastructure | Manage the Planner's own infrastructure through Bicep and reviewed release workflows. Keep bootstrap permissions separate from routine deployment. |
| Test data | Keep isolated synthetic records distinct from live notices and resources. Test-only endpoints require explicit configuration and are disabled when test mode is off. |

## Decisions that deployments must supply

- Target tenant and subscription scopes, required roles, and identity assignments.
- Applicable resource profiles, business ownership, criticality, task durations, calendars, and review responsibilities.
- SharePoint sites, folders, file limits, retention, and which confirmed facts may enter assessments.
- Model deployments, region, quota, cost controls, retention, and approved data egress.
- GitHub owner, repository, Project, token scope, export enablement, and retention policy.
- Network isolation, disaster recovery, operational SLOs, security response ownership, and regulatory requirements.

These values are environment-specific; do not put production identifiers or credentials in the public repository. Review the current implementation limits in [Implementation status](implementation-backlog.md).

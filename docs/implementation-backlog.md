# Implementation status

This page summarizes the code at the current `main` revision and the maintained deployment configuration. It does not include environment-specific identifiers. Settings in other deployments may differ.

## Implemented capabilities

| Area | Current behavior |
|---|---|
| API and interface | Azure Functions API with Entra authentication, role-based authorization, and React review interface |
| Intake and discovery | Service Health notices, Azure Resource Graph inventory, selected Advisor and control-plane data; source-specific completeness and failure metadata are retained |
| Assessment | Workload-scoped immutable assessments, notice-specific resource profiles, two impact axes, priority rules, human review, evidence, corrections, and re-evaluation history |
| Decision model | Microsoft-Decision-1 typed decision adapter; score distributions and invocation status are stored with the assessment |
| Explanation | Configured GPT-6 Luna deployment and a separate deterministic general-impact narrative path. An assessment records whether its explanation invocation succeeded; the narrative is not an LLM fallback. |
| SharePoint | Microsoft Graph folder synchronization, immutable document snapshots, DOCX/XLSX text extraction, fact proposals, Governance review, and confirmed facts/dependency paths as workload evidence |
| Review and approval | Version-specific correction, partial approval, defer, and no-action handling. Approval does not grant permission to change Azure resources. |
| GitHub | Queued export of approved work items to Issues and Projects, with reconciliation and retry handling. Project progress synchronization is separately configured. |
| Infrastructure and release | Bicep-managed Azure resources, OIDC release identity, artifact hash verification, What-If plan hash, and manual apply workflow |
| Security checks | Runtime checks, npm audit, unit/contract tests, Bicep static checks, and dependency/action pinning in CI |

## Maintained deployment configuration

The current maintained deployment is configured as follows. These are values read from deployment variables, not Bicep defaults:

| Setting | Current value/effect |
|---|---|
| Test mode | Disabled |
| SharePoint synchronization | Enabled |
| Live SharePoint sources | Enabled |
| SharePoint fact extraction | Enabled |
| GitHub work-item export | Enabled |
| Project progress synchronization | Disabled |
| Decision re-evaluation endpoint | Unavailable while test mode is disabled |
| Synthetic assessment endpoint | Unavailable while test mode is disabled |

The Bicep parameter file defaults synchronization, ingestion, export, test-only operations, and SharePoint features to disabled unless deployment variables opt in. Do not treat the current hosted values as defaults for new installations.

## Boundaries and remaining product work

- The application can only assess information available from configured Azure scopes, approved notice/resource profiles, and confirmed workload data. It cannot prove runtime usage from control-plane inventory alone.
- Broader applicability-profile coverage and independent review of profile conditions remain necessary as supported Azure services expand.
- Business ownership, criticality, business hours, RTO/RPO, approved response strategies, and task durations are not automatically sourced from a CMDB or ServiceNow. Explicitly confirmed SharePoint facts can inform assessments, but document statements still require human review.
- Source configuration is folder-based. Multi-folder discovery, per-folder access boundaries, source precedence, and conflict resolution need further product design.
- Decision probability calibration and domain-level agreement with independent human judgments require a representative, versioned evaluation set. Model schema compliance alone is not an accuracy measure.
- GitHub export currently uses a GitHub token stored in Key Vault. GitHub App installation-token authentication and organization-specific permission/retention policy are not implemented by the current adapter.
- Project progress synchronization is disabled in the maintained deployment. Notification webhook delivery and all destination-specific authorization settings must be enabled and verified independently.
- The base Bicep templates permit public network access. Private networking, disaster recovery, and organization-specific retention/compliance controls require deployment-specific configuration.

## Release verification

The release workflow validates a successful `main` CI run and artifact hashes, recomputes What-If, compares the reviewed hash before apply, and optionally deploys both Function packages from the same artifact. A successful release workflow does not prove model accuracy, completeness of every Azure data source, or business correctness of an assessment.

# Azure Retirement Planner

Azure Retirement Planner collects Azure lifecycle notices, discovers potentially affected Azure resources, and prepares evidence-linked assessments and work proposals for human review. It does not modify, migrate, or delete assessed Azure resources.

The repository contains a TypeScript and React application, Azure Functions APIs, Bicep infrastructure, and GitHub Actions workflows. It integrates with Azure Service Health, Resource Graph, Microsoft-Decision-1, Azure AI Foundry, SharePoint document sources, and the review interface. Capability and deployment settings vary by environment; this repository does not include tenant-specific identifiers or credentials.

## Capabilities

- Collect lifecycle notices and Azure configuration through read-only Azure APIs.
- Evaluate resource applicability separately from business impact, preserve missing information, and present evidence and Microsoft source links.
- Use Microsoft-Decision-1 for typed decision proposals, deterministic rules for policy constraints, and a separately configured explanation model. Invocation status is recorded per assessment.
- Read configured SharePoint folders through Microsoft Graph, extract DOCX/XLSX text and fact proposals, and require a Governance user to confirm facts and dependency links before they are used as assessment evidence.
- Review, correct, approve, defer, or mark an assessment as requiring no action. Approval applies to a specific assessment version and does not authorize changes to assessed Azure resources.
- Export only approved work items to configured GitHub Issues and Projects. Export and Project progress synchronization are independently configurable.

## Architecture and operation

| Document | Description |
|---|---|
| [System design](docs/design.md) | Current components, data flow, requirements, and limitations |
| [Architecture and decision model](docs/architecture-and-decision-model.md) | Runtime architecture, model roles, evidence, and assessment behavior |
| [Decision policy](docs/decision-policy.md) | Impact axes, priority, resource classification, and review rules |
| [Workflow configuration](docs/workflow-configuration.md) | Team routing, coordination, approvals, and task dependencies |
| [SharePoint integration](docs/sharepoint-document-impact-plan.md) | Document ingestion, fact review, grounding, and current limits |
| [SharePoint connection guide](docs/sharepoint-connection-guide.md) | Graph IDs, permissions, source setup, and synchronization |
| [Testing and quality](docs/testing-and-quality.md) | Automated checks, model quality evaluation, and safety criteria |
| [Review interface behavior](docs/review-interface.md) | Authorization, correction, approval, and export behavior |
| [User guide](docs/user-operations-guide.md) | Sign-in, synchronization, assessment review, and approvals |
| [Operations runbook](docs/runbook.md) | Bootstrap, release, access, monitoring, and recovery |
| [Implementation status](docs/implementation-backlog.md) | Implemented capabilities and remaining product limitations |
| [CI failure agent](docs/ci-failure-agent.md) | Automated CI failure triage and patch workflow |

## Security and limitations

- Assessed subscriptions are read-only. The system's own resource group is managed separately through a reviewed Bicep deployment workflow.
- The base deployment uses public Azure endpoints protected by Entra authentication and API authorization. Private networking must be designed and configured for environments that require it.
- SharePoint access is explicitly scoped; the application identity requires both the Graph `Sites.Selected` permission and a site-level grant. The site-level grant covers the site, even when a single folder is configured in the application.
- Azure resource presence does not prove runtime use or business criticality. The system does not inspect guest operating systems, application code, or data planes.
- Decision probabilities are model-reported distributions, not calibrated confidence or accuracy. Human review remains required for uncertain or policy-sensitive decisions.
- GitHub export uses a credential stored in Key Vault. The current adapter does not use a GitHub App installation token.
- Operators must configure identity, data retention, network controls, policies, quotas, model deployments, and external integrations for their environment.

## Development

Use the Node.js and npm versions in `.node-version` and `package.json`.

```sh
npm ci --ignore-scripts
npm run verify
```

The verification command runs formatting, lint, type checking, unit and contract tests, build, documentation checks, runtime checks, artifact checks, and dependency audit. Azure changes, model calls, and GitHub exports are not part of routine CI.

The manual release workflow deploys only a successful `main` CI artifact. It recomputes Bicep What-If, checks the reviewed plan hash for apply, and can deploy the API and exporter packages from the same artifact. See the operations runbook before using it.

## Configuration

Infrastructure parameters and runtime flags are supplied through Bicep parameters and deployment variables. Features are disabled by default unless explicitly enabled. Do not commit tenant IDs, subscription IDs, SharePoint IDs, resource identifiers, credentials, real payloads, or model inputs/outputs. Use a private, approved operational store for environment-specific configuration and records.

See [Implementation status](docs/implementation-backlog.md) for current deployment-specific behavior and outstanding limitations.

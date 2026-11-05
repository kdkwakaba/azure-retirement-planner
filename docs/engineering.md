# Engineering and operations standards

This repository is a TypeScript/React monorepo with Azure Functions, Bicep, and GitHub Actions. The Node.js/npm versions in `.node-version` and `package.json` are authoritative.

## Repository structure

- `apps/assessment-api`: authenticated API, synchronization, assessment, review, and React UI delivery.
- `apps/work-item-exporter`: queued GitHub work-item export.
- `apps/review-web`: React review interface built into the API artifact.
- `packages/contracts`: versioned request, response, and persisted-record schemas.
- `packages/domain`: deterministic business rules and model-independent assessment logic.
- `packages/adapters`: Azure, Microsoft Graph, model, storage, and GitHub integrations.
- `infra`: Bicep deployment modules, environment parameters, and privileged bootstrap templates.
- `validation`: separate Azure workload templates for resource-discovery exercises.

Keep cloud SDKs, HTTP clients, credentials, and environment-variable access outside `packages/domain`. Preserve existing file formatting and avoid adding dependencies without a concrete gap.

## Change and verification workflow

Use a short-lived branch and pull request. Review changes to shared contracts with all dependent applications. Preserve immutable source records and backward reads when changing storage schemas; document migration behavior for breaking changes.

Before submitting a change, run:

```sh
npm ci --ignore-scripts
npm run verify
```

`npm run verify` runs formatting, lint, type checks, tests, build, documentation checks, runtime/artifact checks, and dependency audit. Bicep templates must also compile. The CI workflow uses non-production fixtures; it does not call paid models, change Azure resources, or register work in GitHub.

## Release and identity

The release workflow accepts only a successful `main` CI artifact, verifies artifact hashes, recomputes Bicep What-If, and requires the same plan hash for apply. Application packages are deployed from that artifact. Bootstrap role assignments are separate from ordinary releases. Do not grant the release identity broad subscription permissions.

Use Entra authentication for users and API authorization for every protected operation. Use Managed Identity between Azure services and OIDC for GitHub Actions-to-Azure. The assessed subscriptions are read-only. Never use UI visibility as an authorization boundary.

The base Bicep deployment enables public network access to the app and supporting services. Deployments requiring private connectivity, specific residency, disaster recovery, or organization-specific retention need additional design and configuration.

## Data and model handling

Treat Microsoft and internal documents as untrusted input. Do not execute document instructions, follow arbitrary links, or send unapproved fields to models. Keep source evidence, model output, explanations, human corrections, and approvals as distinct records. Record model, prompt, schema, rule, source, and assessment versions where applicable.

Do not commit secrets, tokens, connection strings, tenant/subscription/resource identifiers from a real environment, SharePoint IDs, real payloads, personal data, or model inputs/outputs. CI fixtures must contain only synthetic or approved anonymized data. Operational records belong in approved protected storage.

## Dependencies and security

Check Node.js, Azure Functions, direct and transitive npm dependencies, GitHub Actions, Bicep, Azure CLI, and test tooling for support status and known vulnerabilities. Actions are pinned to full commit SHAs and still require regular updates. A failed security check is not a pass. Do not bypass advisories with blanket ignores or reduced thresholds.

Use `npm audit --audit-level=low` as wired through `npm run verify`. Review the current advisory output before release; an audit cannot guarantee that no unknown vulnerability exists.

## Cost, retention, and resource lifecycle

Model-call limits and cost alerts are operational controls, not exact spend guarantees. Storage, logging, network, and delayed billing may continue after inference is stopped. Check current pricing, quotas, and region availability before changing deployment settings.

Maintain an inventory of dedicated resources, identities, grants, external Project items, retention settings, and dependencies. Decommission only resources explicitly owned by this application after checking scope and dependencies. Do not delete assessed or shared resources. Report service-side retention or deletion delays rather than claiming immediate erasure.

## Documentation and completion

Document current runtime behavior separately from optional configuration and future work. Do not publish tenant-specific resource names, IDs, URLs, user names, tokens, or operational traces. Do not describe an integration as active solely because code or an IaC resource exists; distinguish the adapter, configuration, and observed behavior.

Report the changed behavior, relevant requirements, checks run, checks not run, and material limitations. Do not describe a deployment, live integration, or model-quality result as successful unless it was actually observed.

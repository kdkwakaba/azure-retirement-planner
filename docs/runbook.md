# Operations runbook

This runbook describes deployment and service operations. Replace angle-bracket placeholders with values approved for your environment. Never commit resulting IDs, endpoints, tokens, or payloads.

## 1. Local verification

Use the Node.js and npm versions defined in `.node-version` and `package.json`.

```sh
npm ci --ignore-scripts
npm run verify
az bicep build --file infra/main.bicep --stdout
az bicep build --file infra/ingestion.bicep --stdout
az bicep build --file infra/evaluation-subscription.bicep --stdout
az bicep build --file infra/bootstrap/oidc.bicep --stdout
az bicep build --file infra/bootstrap/foundry.bicep --stdout
az bicep build --file infra/bootstrap/permissions.bicep --stdout
az bicep build --file infra/bootstrap/sharepoint/permissions.bicep --stdout
```

The CI artifact contains application code and dependencies only. It must not include real Azure records, model inputs/outputs, credentials, or environment snapshots.

## 2. Bootstrap and identity

1. Select the Planner's resource group, deployment subscription, tenant, location, storage endpoint, target subscription list, and model endpoints. Confirm policy, quota, runtime support, cost, and name availability.
2. Create a single-tenant Entra application and define `Reader`, `Reviewer`, `Operator`, and `Governance` user roles plus the application-only `NotificationSender` role. Require assignment and assign only the needed users/groups.
3. Configure the authentication callback as `https://<api-name>.azurewebsites.net/.auth/login/aad/callback`. Verify the web identity and API's audience, issuer, tenant, token type, and role checks.
4. Use `infra/bootstrap/oidc.bicep` to establish a GitHub main-branch deployment identity. Use the repository and owner IDs returned by GitHub; keep the subject restricted to the intended branch and repository.
5. Give the deployment identity only the permissions needed for reviewed deployments to the Planner's resource group. Do not grant it target-subscription role-assignment privileges.
6. Apply the main Bicep template, then use the separate bootstrap templates for storage, Key Vault, Translator, Foundry, SharePoint Graph permission, and target-scope Reader role assignments as needed.
7. Store Entra client secrets and the GitHub token in Key Vault. The current GitHub adapter reads a token from Key Vault; a GitHub App installation-token flow is not implemented. Record secret owner, expiry, permissions, and rotation date without recording the value.

The deployment identity must not receive permissions used only by privileged bootstrap operations. Do not grant the API or exporter write access to assessed subscriptions.

## 3. Repository variables and secrets

Repository variables provide non-secret deployment parameters such as Azure client/tenant/subscription, resource group, location, target scopes, storage endpoint, Entra client ID, model endpoints/deployment/version, GitHub destination identifiers, and feature flags.

The environment parameter file uses conservative defaults: absent feature variables resolve to `false`. Keep environment values in protected GitHub/Azure settings, not in Bicep source, Markdown, or committed parameter files.

Store secret values only in Key Vault. Do not put tokens, client secrets, signing keys, or access tokens in GitHub Variables, command history, CLI arguments, logs, screenshots, or this runbook.

## 4. Target-subscription access and notifications

The Planner's deployment subscription is separate from the assessed subscription list. `infra/evaluation-subscription.bicep` grants the API Managed Identity `Reader` at the selected target subscription and can create a monitoring resource group, Action Group, and Activity Log alert. It does not grant exporter access or alter workload resources.

Run the template for each target subscription. Review the complete What-If and ensure it contains only the intended Reader assignment and monitoring resources before applying. The operator needs permission to create the monitoring resources and role assignment; the routine deployment identity must not hold this authority.

Use placeholders and select the subscription explicitly:

```powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$monitoringResourceGroup = '<MONITORING_RESOURCE_GROUP>'
$apiPrincipalId = '<API_MANAGED_IDENTITY_PRINCIPAL_ID>'
$apiOrigin = 'https://<api-name>.azurewebsites.net'
$tenantId = '<TENANT_ID>'
$applicationId = '<ENTRA_APPLICATION_CLIENT_ID>'
$applicationObjectId = '<ENTRA_APPLICATION_OBJECT_ID>'
$location = '<AZURE_LOCATION>'

az deployment sub what-if `
  --subscription $targetSubscriptionId `
  --location $location `
  --template-file infra/evaluation-subscription.bicep `
  --parameters monitoringResourceGroupName=$monitoringResourceGroup `
    location=$location apiPrincipalId=$apiPrincipalId apiOrigin=$apiOrigin `
    tenantId=$tenantId apiApplicationId=$applicationId `
    apiApplicationObjectId=$applicationObjectId enableNotifications=false

# Apply only after reviewing the complete What-If.
```

Notification Action Group and alert resources default to disabled. Before enabling them, verify the sending identity, `NotificationSender` app role, audience, API `INGEST_ENABLED` setting, authentication, and a controlled delivery path. Do not expose an anonymous ingest endpoint.

## 5. Release workflow

1. Merge the reviewed change to `main` and confirm its CI workflow succeeds.
2. Start `.github/workflows/deploy.yml` with the successful main CI run ID and `phase=plan`.
3. Review the complete What-If output, identify every resource and property change, and record the plan SHA256.
4. Start the same workflow using the same CI run, `phase=apply`, and the reviewed hash. Choose `infrastructure_only=true` when only settings/infrastructure should change; use `false` to also deploy the API and exporter packages.
5. Confirm the workflow summary reports the expected infrastructure and package deployment outcomes.
6. Verify API health, Entra authentication, role checks, configuration values, processing status, and the feature that changed. A successful deployment is not evidence of model accuracy or business correctness.

The workflow validates the source CI run and artifact hash and recomputes What-If. It refuses an apply if the current plan hash differs from the reviewed plan. Do not make direct portal changes that Bicep will later overwrite.

## 6. Feature settings

The following settings are separate and default to disabled when absent: synchronization, notification ingestion, SharePoint synchronization, fact extraction, live SharePoint sources, GitHub export, and Project progress synchronization. Enable only the settings needed for the approved operation, update Bicep deployment variables, and apply through the reviewed release workflow.

Before enabling GitHub export, inspect all pending outbox records. Enabling export can release existing eligible items, not only the most recent assessment. Confirm destination, repository/Project fields, token permissions, current assessment hash, and pending-item scope first. Project progress sync only reads Project status and is separately configured.

## 7. SharePoint access

Use the [SharePoint connection guide](sharepoint-connection-guide.md) to obtain Site, Drive, and Folder IDs; configure Graph `Sites.Selected`; grant site-level read; enable the desired source mode; register a folder; and inspect synchronization/extraction status. The API Graph permission and the site grant are separate. The site grant is broader than a single configured folder.

Live document sources require test mode off, live-source enablement, and synchronization enablement. Fact extraction additionally requires its feature setting and Governance review. Do not feed unconfirmed document statements to ordinary assessment inputs.

## 8. Monitoring and recovery

Application logs record safe stage, correlation ID, error category, HTTP status, and model invocation metadata. They do not normally record full resource IDs, provider exception messages, document bodies, model prompts, or model outputs. Use correlation IDs to trace a processing failure across logs and queue state.

For a failed source, check source settings, role, identity access, provider status, request limits, and the recorded failure category. For queued assessments or exports, inspect the queue and poison queue before retry. Reconcile any external GitHub Issue that may have been created before a Project update failed. Retry is idempotent and must not duplicate work.

When manually inspecting Azure Tables, grant `Storage Table Data Reader` only to the intended table and operator identity using `infra/bootstrap/outbox-table-reader.bicep`. Review What-If and remove the temporary grant after its purpose is complete. Never copy full production row contents into a public issue or repository.

## 9. Retention, costs, and decommissioning

Model-call limits, cost alerts, and runtime scale limits reduce risk but are not exact spend guarantees. Billing can be delayed; storage, telemetry, and network charges may continue after inference stops. Re-check provider prices, quota, and region availability before changing models, capacity, or extraction limits.

Before decommissioning, inventory Planner-owned resources, external Project items, role grants, Graph permissions, app registrations, federations, secrets, snapshots, and backups. Verify the exact scope and dependencies. Remove only dedicated resources and permissions approved for removal; never remove assessed or shared resources. Report data-retention delays or service-side soft-delete windows.

## References

- [GitHub Actions OIDC with Azure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure)
- [Azure Functions Flex Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Microsoft Graph Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [SharePoint connection guide](sharepoint-connection-guide.md)

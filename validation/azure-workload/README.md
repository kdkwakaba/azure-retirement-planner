# Reference Azure workload deployment

The Bicep templates in this directory create a separately scoped Azure workload with common platform resources, application hosting, data services, monitoring, and a Foundry account/project. The templates apply tags for workload, owner team, environment, management source, and purpose. They do not deploy application code, business data, or business transactions.

This is a tagged reference workload for exercising Resource Graph discovery and workload/resource relationships. It is not a production application architecture. Review the template and pricing for every resource before deployment; some resources can incur ongoing charges.

## Scope and parameters

`main.bicep` is a subscription-scope deployment. It creates a dedicated resource group and deploys `workload.bicep` into it. The workload template assigns the Planner API Managed Identity a Reader role only on that resource group. It also configures a Microsoft Entra administrator for the SQL resource. `foundry.bicep` deploys an Azure AI Foundry account and project within the same group.

The default resource group, workload labels, and resource names in the templates are reference defaults. Change them before deployment if they conflict with your naming policy. Use a globally unique suffix only where the template requires one, and keep the SharePoint workload ID, resource tags, and document references consistent.

## Before deployment

1. Sign in to the intended tenant and select the exact target subscription ID. Do not select by a display name that may be ambiguous.
2. Confirm subscription ownership, allowed regions, resource provider registration, service availability, quotas, and estimated charges.
3. Obtain the Planner API Managed Identity principal ID, SQL Microsoft Entra administrator object ID/type/display name, and tenant ID.
4. Choose a dedicated resource group name and a workload ID. Confirm no existing resources or role assignments will be replaced unexpectedly.
5. Review all default SKUs, tags, public network settings, and role assignments in the templates.

## Preview and deploy

Use a local parameter file outside the repository, or pass explicit parameters in a protected shell. Do not commit tenant, subscription, object, or principal IDs.

```powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$deploymentLocation = '<AZURE_LOCATION>'
$resourceGroupName = '<DEDICATED_RESOURCE_GROUP>'
$apiPrincipalId = '<PLANNER_API_MANAGED_IDENTITY_PRINCIPAL_ID>'
$sqlAdminObjectId = '<SQL_ENTRA_ADMIN_OBJECT_ID>'
$sqlAdminDisplayName = '<SQL_ENTRA_ADMIN_DISPLAY_NAME>'
$tenantId = '<TENANT_ID>'
$workloadId = '<WORKLOAD_ID>'

az account set --subscription $targetSubscriptionId
az account show --query '{subscription:id,tenant:tenantId}' --output table

az deployment sub what-if `
  --subscription $targetSubscriptionId `
  --location $deploymentLocation `
  --template-file validation/azure-workload/main.bicep `
  --parameters resourceGroupName=$resourceGroupName `
    location=$deploymentLocation apiPrincipalId=$apiPrincipalId `
    sqlEntraAdminObjectId=$sqlAdminObjectId `
    sqlEntraAdminDisplayName=$sqlAdminDisplayName tenantId=$tenantId `
    workloadId=$workloadId

# Apply only after reviewing the full What-If and confirming the target scope.
```

Use `az deployment sub create` with the exact same subscription, location, template, and parameters after review. The operator needs resource creation permission and permission to create the template's Reader role assignment. Do not grant those permissions to the Planner runtime identity.

## Connect the workload to the Planner

1. Add the selected subscription to the Planner's target subscription configuration without removing other approved scopes.
2. Apply the subscription Reader assignment through the Planner's reviewed deployment procedure.
3. In the SharePoint folder source, use the same workload ID and link only the approved document folder.
4. Run synchronization and review discovered resource candidates. Azure resource discovery alone does not confirm business usage.
5. Review extracted document facts, evidence locations, and dependencies before allowing them to inform an assessment.

## Cleanup

Delete only a resource group created specifically for this reference workload. First confirm the selected subscription, group name, contents, ownership tags, and dependencies. Never delete the Planner's own resource group, an assessed shared resource, or a resource group that contains unrelated resources.

```powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$resourceGroupName = '<DEDICATED_RESOURCE_GROUP>'
az group show --subscription $targetSubscriptionId --name $resourceGroupName
# After confirming the group is dedicated and approved for removal:
az group delete --subscription $targetSubscriptionId --name $resourceGroupName --yes
```

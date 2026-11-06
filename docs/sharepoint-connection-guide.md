# SharePoint folder connection guide

This guide explains how to configure a SharePoint document folder as a source. Source records contain tenant, site, drive, folder item, workload, allowed extensions, and a configuration version. Do not commit real IDs or URLs to this repository.

For the complete build sequence, including Bicep deployment, Azure RBAC, live SharePoint Source setup, and evaluation, see the [end-to-end deployment and SharePoint evaluation guide](deployment-and-sharepoint-evaluation.md).

## Requirements

- A SharePoint administrator or site owner who can grant the API Managed Identity read access to the target site.
- A Microsoft Graph Explorer account that can access the site and consent to the delegated permissions needed for ID discovery.
- The API Function App's system-assigned Managed Identity and its Client ID/App ID.
- A folder that contains only documents the application is permitted to read. The Graph grant is site-scoped even when the application is configured for one folder.
- `.docx` or `.xlsx` documents. Files and text are subject to the limits in [SharePoint integration](sharepoint-document-impact-plan.md).

## 1. Find the Site ID

In Graph Explorer, sign in with an account that can read the target site. Use the site's hostname and server-relative path:

```http
GET https://graph.microsoft.com/v1.0/sites/{hostname}:/{server-relative-path}?$select=id,displayName,webUrl
```

For a site at `https://contoso.sharepoint.com/sites/Architecture`, use `contoso.sharepoint.com` as the hostname and `sites/Architecture` as the server-relative path. Save the full response `id`; a Site ID commonly has the form `hostname,guid,guid`.

## 2. Find the Drive ID

List the site's document libraries:

```http
GET https://graph.microsoft.com/v1.0/sites/{Site ID}/drives?$select=id,name,webUrl,driveType
```

Choose the library whose `name` and `webUrl` contain the target folder. Save its complete `id`. Do not substitute a list ID for a Drive ID. `/sites/{Site ID}/drive` returns only the default library.

## 3. Find the folder item ID and confirm its contents

Use the folder's path relative to the selected library root:

```http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/root:/{folder-path}?$select=id,name,folder,webUrl
```

Save the full `id` and confirm the result includes `folder`. Then check the folder's children:

```http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/items/{Folder Item ID}/children?$select=id,name,folder,file,size,webUrl
```

The returned items should be the files and folders expected for this source. A `list` ID is not a `drive` ID or a folder item ID.

## 4. Resolve discovery errors

| Result | Checks |
|---|---|
| 403 | Confirm Graph Explorer delegated permission and user access to the site. A Global Administrator role alone does not grant the user access to the site's content. |
| `itemNotFound` / “The specified list was not found” | Confirm that the complete Drive ID came from `/sites/{Site ID}/drives`; do not pass a SharePoint list ID. |
| `/drives` returns 200 with an empty `value` | Verify the Site ID and the signed-in account's site access. Check the default drive and list metadata, but do not use a list ID as a Drive ID. |
| Folder lookup returns 404 | Confirm the path is relative to the library root and matches the selected drive's `webUrl`. |

When sharing diagnostics, include only the HTTP status, request URL without access tokens, `error.code`, and `error.message`. Do not share bearer tokens or document contents.

## 5. Grant application access

The signed-in Graph Explorer user is not the identity used by the application. Synchronization runs as the API Function App's system-assigned Managed Identity.

### Graph application permission

The dedicated `infra/bootstrap/sharepoint/permissions.bicep` template assigns the Graph `Sites.Selected` application permission to the API Managed Identity. Run this privileged bootstrap separately from the normal application release. The operator needs the required Microsoft Graph application-role assignment privileges. Do not grant those privileges to the runtime identity or routine GitHub deployment identity.

Read the API principal ID from the deployment output, resolve its client ID, and apply the template to the Planner resource group:

```powershell
$resourceGroup = '<PLANNER_RESOURCE_GROUP>'
$apiPrincipalId = az deployment group show `
  --resource-group $resourceGroup `
  --name arp-release `
  --query properties.outputs.apiPrincipalId.value `
  --output tsv
$apiClientId = az ad sp show --id $apiPrincipalId --query appId --output tsv

az deployment group what-if `
  --resource-group $resourceGroup `
  --template-file infra/bootstrap/sharepoint/permissions.bicep `
  --parameters apiPrincipalId=$apiPrincipalId

# After reviewing the What-If, apply the same template and parameters.
az deployment group create `
  --resource-group $resourceGroup `
  --template-file infra/bootstrap/sharepoint/permissions.bicep `
  --parameters apiPrincipalId=$apiPrincipalId
```

The `apiPrincipalId` is the Managed Identity's object/principal ID; `apiClientId` is its application/client ID. The site grant below uses the client ID.

### Site-level read grant

The Graph Bicep extension in this repository manages the app-role assignment, but the selected site's individual `read` grant is a separate administrative step. The user making this request needs sufficient Microsoft Graph permissions and administrative access to the site.

1. Check existing grants:

   ```http
   GET https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions
   ```

2. If the API Managed Identity does not already have `read`, create the grant:

   ```http
   POST https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions
   Content-Type: application/json
   ```

   ```json
   {
     "roles": ["read"],
     "grantedToIdentities": [
       {
         "application": {
           "id": "<API Managed Identity Client ID>",
           "displayName": "<API Function App name>"
         }
       }
     ]
   }
   ```

3. Confirm `201 Created` and `roles: ["read"]` in the response. Do not grant `Sites.FullControl.All` to the API Managed Identity. The higher permission needed to create a site grant belongs only to the authorized administrator doing this one-time step.

## 6. Enable and configure a source

SharePoint features are configured through deployment variables and Bicep. Missing variables default to `false`.

| Repository variable | Required for live document use |
|---|---|
| `ARP_TEST_MODE_ENABLED` | `false` |
| `ARP_SHAREPOINT_SYNC_ENABLED` | `true` |
| `ARP_SHAREPOINT_LIVE_SOURCES_ENABLED` | `true` |
| `ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED` | `true` to extract fact proposals; otherwise synchronization only |

Submit the variables through the repository's reviewed deployment workflow: run `deploy.yml` with phase `plan`, inspect What-If, and run phase `apply` with the same successful main CI run and reviewed plan hash. Do not change Function App settings directly in the Azure portal; the next deployment may overwrite them.

In the authenticated application, a Governance user opens the collapsed SharePoint section and registers a source using the full Site ID, Drive ID, Folder Item ID, workload ID, a unique source ID, and a new configuration version. In live mode, the source must be marked as live (`sampleOnly: false`). An Operator or Governance user can start synchronization. The source listing and sync status show whether synchronization succeeded and which documents were captured.

Synchronization only reads and stores document snapshots. It does not automatically use extracted text as confirmed evidence. A Governance user must explicitly extract and review fact proposals. A confirmed live-source fact becomes eligible for a later assessment of the same workload.

## Data classes and gating

An installation can register one source per data class: live or synthetic. They cannot be processed simultaneously. Synthetic source processing requires test mode. Live source processing requires test mode off and the live-source setting on. Fact extraction additionally requires the fact-extraction setting. Turning test mode off hides synthetic records from the ordinary assessment list but does not delete them.

## Microsoft references

- [Get a SharePoint site by path](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0)
- [List drives in a site](https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0)
- [List children of a drive item](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)
- [Selected permissions overview](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [Microsoft Graph Bicep templates](https://learn.microsoft.com/en-us/graph/templates/bicep/overview-bicep-templates-for-graph)
- [Create a site permission](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0)

targetScope = 'resourceGroup'

extension microsoftGraphV1

@description('System-assigned managed identity principal/object ID of the Azure Retirement Planner API Function App.')
param apiPrincipalId string

resource graphServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' existing = {
  appId: '00000003-0000-0000-c000-000000000000'
}

// Microsoft Graph application permission ID for Sites.Selected.
var sitesSelectedApplicationRoleId = '883ea226-0bf2-4a8f-9f9d-92c9162a727d'

resource apiSharePointReadPermission 'Microsoft.Graph/appRoleAssignedTo@v1.0' = {
  appRoleId: sitesSelectedApplicationRoleId
  principalId: apiPrincipalId
  resourceDisplayName: 'Microsoft Graph'
  resourceId: graphServicePrincipal.id
}

output assignedGraphPermission string = 'Sites.Selected'

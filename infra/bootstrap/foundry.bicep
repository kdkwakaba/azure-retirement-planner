targetScope = 'resourceGroup'
param accountName string
param projectName string = 'retirement-planner'
param location string

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  tags: { application: 'azure-retirement-planner', environment: 'poc', managedBy: 'bicep', lifecycle: 'delete-after-poc' }
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: account
  name: projectName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: { displayName: 'Azure Retirement Planner PoC', description: 'Lifecycle impact assessment; no agent hosting or model invocation enabled by bootstrap.' }
}
output accountId string = account.id
output accountName string = account.name
output projectId string = project.id

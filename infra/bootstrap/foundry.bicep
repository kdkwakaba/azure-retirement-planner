targetScope = 'resourceGroup'
param accountName string
param projectName string = 'retirement-planner'
param decisionDeploymentName string = 'arp-decision-1'
param decisionModelVersion string = '1'
param decisionCapacity int = 500

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' existing = {
  parent: account
  name: projectName
}
resource decisionModel 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: decisionDeploymentName
  sku: { name: 'DataZoneStandard', capacity: decisionCapacity }
  properties: {
    currentCapacity: decisionCapacity
    model: { format: 'Microsoft', name: 'Microsoft-Decision-1', version: decisionModelVersion }
    raiPolicyName: 'Microsoft.DefaultV2'
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}
output accountId string = account.id
output accountName string = account.name
output projectId string = project.id
output decisionDeploymentId string = decisionModel.id
output decisionEndpoint string = account.properties.endpoint

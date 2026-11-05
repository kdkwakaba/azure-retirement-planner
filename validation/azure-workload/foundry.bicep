targetScope = 'resourceGroup'

@description('配置するリージョン。')
param location string

@description('Azureリソースに付けるWorkload識別子。')
@minLength(1)
@maxLength(200)
param workloadId string

var foundryName = 'orders-foundry-${uniqueString(subscription().id, resourceGroup().id)}'
var foundryTags = {
  WorkloadId: workloadId
  OwnerTeam: 'cloud-platform-operations'
  Environment: 'test'
  ManagedBy: 'bicep'
  Purpose: 'sharepoint-impact-validation'
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: foundryName
  location: location
  kind: 'AIServices'
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'S0'
  }
  tags: foundryTags
  properties: {
    allowProjectManagement: true
    customSubDomainName: foundryName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource foundryProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: 'orders-management-validation'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  tags: foundryTags
  properties: {
    displayName: 'Orders Management Validation'
    description: 'Foundry project for evaluating Azure resource retirement impact against the validation workload.'
  }
}

output foundryAccountResourceId string = foundry.id
output foundryProjectResourceId string = foundryProject.id
output foundryProjectEndpoint string = foundry.properties.endpoint

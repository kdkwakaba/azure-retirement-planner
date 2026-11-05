targetScope = 'resourceGroup'

param location string
param apiPrincipalId string
param sqlEntraAdminObjectId string
param sqlEntraAdminPrincipalType string
param sqlEntraAdminDisplayName string
param tenantId string
param workloadId string
param ownerTeam string
param globalNameSuffix string

var workloadTags = {
  WorkloadId: workloadId
  OwnerTeam: ownerTeam
  Environment: 'test'
  ManagedBy: 'bicep'
  Purpose: 'sharepoint-impact-validation'
}
var applicationTags = union(workloadTags, { OwnerTeam: 'application-operations' })
var databaseTags = union(workloadTags, { OwnerTeam: 'database-operations' })
var platformTags = union(workloadTags, { OwnerTeam: 'cloud-platform-operations' })
var monitoringTags = union(workloadTags, { OwnerTeam: 'monitoring-operations' })
var dataTags = union(workloadTags, { OwnerTeam: 'data-operations' })

var storageName = 'ordval${uniqueString(subscription().id, resourceGroup().id)}'
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'
var dispatchDeploymentContainerName = 'deploy-orders-dispatch'
var reportDeploymentContainerName = 'deploy-orders-report'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'orders-validation-log'
  location: location
  tags: monitoringTags
  properties: {
    retentionInDays: 30
    features: {
      searchVersion: 1
    }
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'orders-monitor-prod${globalNameSuffix}'
  location: location
  kind: 'web'
  tags: monitoringTags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableLocalAuth: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: platformTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
  resource blobServices 'blobServices' = {
    name: 'default'
    resource dispatchDeploymentContainer 'containers' = {
      name: dispatchDeploymentContainerName
      properties: {
        publicAccess: 'None'
      }
    }
    resource reportDeploymentContainer 'containers' = {
      name: reportDeploymentContainerName
      properties: {
        publicAccess: 'None'
      }
    }
    resource reportsContainer 'containers' = {
      name: 'reports'
      properties: {
        publicAccess: 'None'
      }
    }
  }
  resource queueServices 'queueServices' = {
    name: 'default'
    resource dispatchQueue 'queues' = {
      name: 'orders-queue-prod'
    }
  }
}

resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'orders-function-identity'
  location: location
  tags: applicationTags
}

resource functionBlobOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageBlobDataOwnerRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionQueueContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageQueueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionTableContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, storageTableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appInsightsMetricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(applicationInsights.id, functionIdentity.id, monitoringMetricsPublisherRoleId)
  scope: applicationInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, apiPrincipalId, readerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRoleId)
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Azure Retirement Planner may read only this validation Resource Group.'
  }
}

resource webPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'orders-web-plan-test'
  location: location
  tags: applicationTags
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource ordersWeb 'Microsoft.Web/sites@2024-04-01' = {
  name: 'orders-web-prod${globalNameSuffix}'
  location: location
  tags: applicationTags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: webPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      alwaysOn: true
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' = {
  name: 'orders-sql-validation${globalNameSuffix}'
  location: location
  tags: databaseTags
  properties: {
    administrators: any({
      login: sqlEntraAdminDisplayName
      sid: sqlEntraAdminObjectId
      tenantId: tenantId
      principalType: sqlEntraAdminPrincipalType
      azureADOnlyAuthentication: true
    })
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
    version: '12.0'
  }
}

resource ordersDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: 'orders-db-prod'
  location: location
  tags: databaseTags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
    readScale: 'Disabled'
    zoneRedundant: false
  }
}

resource functionPlanDispatch 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'orders-dispatch-plan-test'
  location: location
  kind: 'functionapp'
  tags: applicationTags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionPlanReport 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'orders-report-plan-test'
  location: location
  kind: 'functionapp'
  tags: dataTags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource ordersDispatch 'Microsoft.Web/sites@2024-04-01' = {
  name: 'orders-dispatch-prod${globalNameSuffix}'
  location: location
  kind: 'functionapp,linux'
  tags: applicationTags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: functionPlanDispatch.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${dispatchDeploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: functionIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
  dependsOn: [
    functionBlobOwner
    functionQueueContributor
    functionTableContributor
    appInsightsMetricsPublisher
  ]
  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage__accountName: storage.name
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: functionIdentity.properties.clientId
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${functionIdentity.properties.clientId};Authorization=AAD'
    }
  }
}

resource ordersReport 'Microsoft.Web/sites@2024-04-01' = {
  name: 'orders-report-prod${globalNameSuffix}'
  location: location
  kind: 'functionapp,linux'
  tags: dataTags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: functionPlanReport.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${reportDeploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: functionIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
  dependsOn: [
    functionBlobOwner
    functionQueueContributor
    functionTableContributor
    appInsightsMetricsPublisher
  ]
  resource appSettings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage__accountName: storage.name
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: functionIdentity.properties.clientId
      APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${functionIdentity.properties.clientId};Authorization=AAD'
    }
  }
}

output webResourceId string = ordersWeb.id
output sqlDatabaseResourceId string = ordersDatabase.id
output dispatchFunctionResourceId string = ordersDispatch.id
output reportFunctionResourceId string = ordersReport.id
output queueResourceId string = '${storage.id}/queueServices/default/queues/orders-queue-prod'
output applicationInsightsResourceId string = applicationInsights.id
output workloadId string = workloadId

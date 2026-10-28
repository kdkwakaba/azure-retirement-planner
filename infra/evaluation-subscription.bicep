targetScope = 'subscription'

@description('専用監視リソースグループ。評価対象ワークロードとは分離する。')
param monitoringResourceGroupName string = 'rg-arp-monitoring'

@description('評価対象サブスクリプション内で監視リソースを作成するリージョン。Action GroupとAlert自体はglobal。')
param location string

@description('ARP API Function Appのシステム割り当てマネージドIDのPrincipal ID。')
param apiPrincipalId string

@description('ARP APIのHTTPS Origin。')
param apiOrigin string

@description('API EntraアプリケーションのTenant ID。')
param tenantId string

@description('API EntraアプリケーションのClient ID。')
param apiApplicationId string

@description('API EntraアプリケーションのObject ID。Secure Webhookのaudience設定に使う。')
param apiApplicationObjectId string

@description('Secure Webhookの認証・受信試験完了後にのみtrueへ変更する。')
param enableNotifications bool = false

var readerRoleDefinitionId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

resource monitoringResourceGroup 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: monitoringResourceGroupName
  location: location
  tags: {
    application: 'azure-retirement-planner'
    purpose: 'service-health-monitoring'
    managedBy: 'bicep'
  }
}

resource apiReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, apiPrincipalId, readerRoleDefinitionId)
  properties: {
    principalId: apiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRoleDefinitionId)
    description: 'Read-only inventory and Service Health assessment for Azure Retirement Planner.'
  }
}

module ingestion './ingestion.bicep' = {
  name: 'arp-ingestion-${uniqueString(subscription().id, monitoringResourceGroupName)}'
  scope: monitoringResourceGroup
  params: {
    name: 'arp-service-health'
    apiOrigin: apiOrigin
    tenantId: tenantId
    apiApplicationId: apiApplicationId
    apiApplicationObjectId: apiApplicationObjectId
    enabled: enableNotifications
  }
}

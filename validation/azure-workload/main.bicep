targetScope = 'subscription'

@description('検証専用Resource Group。Azure Retirement Planner本体のリソースグループとは分離する。')
param resourceGroupName string = 'rg-arp-validation-orders'

@description('検証用リソースを配置するリージョン。')
param location string = 'japaneast'

@description('ARP APIのシステム割り当てマネージドID Principal ID。空欄は禁止し、検証用RGだけにReaderを付与する。')
@minLength(36)
@maxLength(36)
param apiPrincipalId string

@description('Azure SQLのMicrosoft Entra管理者Object ID。Test Subscriptionで管理者として使うユーザーまたはグループ。')
@minLength(36)
@maxLength(36)
param sqlEntraAdminObjectId string

@description('Azure SQLのMicrosoft Entra管理者種別。')
@allowed([
  'User'
  'Group'
  'Application'
])
param sqlEntraAdminPrincipalType string = 'User'

@description('Azure SQLのMicrosoft Entra管理者表示名。')
@minLength(1)
param sqlEntraAdminDisplayName string

@description('Azure SQL Entra管理者のTenant ID。')
@minLength(36)
@maxLength(36)
param tenantId string

@description('文書と評価データを結び付けるWorkload ID。SharePoint SourceのWorkload IDにも同じ文字列を設定する。')
@minLength(1)
@maxLength(200)
param workloadId string = 'orders-management-validation'

@description('Azureリソースに付ける担当チーム。')
@minLength(1)
param ownerTeam string = 'application-operations'

@description('文書記載名との一致を保つため、通常は空欄。グローバル名が取得済みの場合だけ末尾へ短い一意文字列を追加し、SharePoint文書側も同じ名前へ更新する。')
@maxLength(8)
param globalNameSuffix string = ''

resource validationResourceGroup 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: {
    WorkloadId: workloadId
    OwnerTeam: ownerTeam
    Environment: 'test'
    ManagedBy: 'bicep'
    Purpose: 'sharepoint-impact-validation'
  }
}

module workload './workload.bicep' = {
  name: 'orders-workload-validation-${uniqueString(subscription().id, validationResourceGroup.id)}'
  scope: validationResourceGroup
  params: {
    location: location
    apiPrincipalId: apiPrincipalId
    sqlEntraAdminObjectId: sqlEntraAdminObjectId
    sqlEntraAdminPrincipalType: sqlEntraAdminPrincipalType
    sqlEntraAdminDisplayName: sqlEntraAdminDisplayName
    tenantId: tenantId
    workloadId: workloadId
    ownerTeam: ownerTeam
    globalNameSuffix: globalNameSuffix
  }
}

output validationResourceGroupId string = validationResourceGroup.id
output workloadId string = workloadId

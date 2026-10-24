targetScope = 'resourceGroup'
param name string = 'arp-service-health'
param apiOrigin string
param tenantId string
param apiApplicationId string
param apiApplicationObjectId string
param enabled bool = false

// 対象Subscriptionごとの承認済み監視RGへ配置する。既存ワークロードを変更しない。
// Secure Webhookのservice principalにNotificationSender application roleとidtyp claimを別途設定する。
resource group 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: name
  location: 'global'
  properties: {
    groupShortName: 'arp-health'
    enabled: enabled
    webhookReceivers: [{ name: 'arp', serviceUri: '${apiOrigin}/api/ingest', useCommonAlertSchema: true, useAadAuth: true, tenantId: tenantId, identifierUri: 'api://${apiApplicationId}', objectId: apiApplicationObjectId }]
  }
}
resource alert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: name
  location: 'global'
  properties: {
    enabled: enabled
    scopes: [subscription().id]
    // ActionRequired・Informationalのうちライフサイクル以外は受付後の分類確認へ。
    condition: { allOf: [ { field: 'category', equals: 'ServiceHealth' }, { anyOf: [ { field: 'properties.incidentType', equals: 'ActionRequired' }, { field: 'properties.incidentType', equals: 'Informational' } ] } ] }
    actions: { actionGroups: [{ actionGroupId: group.id }] }
  }
}

targetScope = 'resourceGroup'
param apiName string
param workspaceName string
resource api 'Microsoft.Web/sites@2024-11-01' existing = { name: apiName }
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: workspaceName }
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'arp-auth-diagnostics'
  scope: api
  properties: {
    workspaceId: workspace.id
    logAnalyticsDestinationType: 'Dedicated'
    logs: [{ category: 'AppServiceAuthenticationLogs', enabled: true }]
  }
}

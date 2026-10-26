targetScope = 'resourceGroup'

@minLength(3)
@maxLength(7)
param prefix string = 'arp'
param location string = resourceGroup().location
param hostStorageBlobEndpoint string
param tenantId string
param entraClientId string
param targetSubscriptionIds array
param decisionEndpoint string = ''
param decisionDeployment string = ''
param decisionModelVersion string = ''
param explanationEndpoint string = ''
param explanationDeployment string = ''
@minValue(0)
@maxValue(200)
param maxModelCallsPerDay int = 0
param githubOwner string = ''
param githubRepository string = ''
param githubProjectId string = ''
param githubProjectStatusFieldId string = ''
param githubProjectStatusTodoOptionId string = ''
param githubProjectPriorityFieldId string = ''
param githubProjectPriorityP1OptionId string = ''
param githubProjectPriorityP2OptionId string = ''
param githubProjectPriorityP3OptionId string = ''
param githubProjectPriorityP4OptionId string = ''
param githubProjectDueDateFieldId string = ''
param syncEnabled bool = false
param projectProgressSyncEnabled bool = false
param ingestEnabled bool = false
param exportEnabled bool = false
param processingFailureAlertsEnabled bool = false
param processingFailureAlertActionGroupId string = ''

var suffix = uniqueString(resourceGroup().id)
var tags = { application: 'azure-retirement-planner', environment: 'poc', managedBy: 'bicep' }

resource hostStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${prefix}host${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { allowBlobPublicAccess: false, allowSharedKeyAccess: false, minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true }
}
resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${prefix}data${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { allowBlobPublicAccess: false, allowSharedKeyAccess: false, minimumTlsVersion: 'TLS1_2', supportsHttpsTrafficOnly: true }
}
resource hostBlob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: hostStorage, name: 'default', properties: { cors: { corsRules: [] }, deleteRetentionPolicy: { allowPermanentDelete: false, enabled: false } } }
resource deployContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in ['api-package','exporter-package']: { parent: hostBlob, name: name, properties: { publicAccess: 'None', defaultEncryptionScope: '$account-encryption-key', denyEncryptionScopeOverride: false } }]
resource dataBlob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = { parent: dataStorage, name: 'default', properties: { cors: { corsRules: [] }, deleteRetentionPolicy: { allowPermanentDelete: false, enabled: false } } }
resource records 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: dataBlob, name: 'records', properties: { publicAccess: 'None', defaultEncryptionScope: '$account-encryption-key', denyEncryptionScopeOverride: false } }
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = { parent: dataStorage, name: 'default' }
resource state 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = { parent: tableService, name: 'ArpState' }
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' existing = { parent: dataStorage, name: 'default' }
resource queues 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = [for name in ['assessments','assessments-poison','exports','exports-poison']: { parent: queueService, name: name }]
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${prefix}-kv-${suffix}'
  location: location
  tags: tags
  properties: { tenantId: tenantId, sku: { family: 'A', name: 'standard' }, enableRbacAuthorization: true, enableSoftDelete: true, softDeleteRetentionInDays: 7, publicNetworkAccess: 'Enabled' }
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: 1 } }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-insights-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id, IngestionMode: 'LogAnalytics', Flow_Type: null, Request_Source: null }
}
resource processingFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (processingFailureAlertsEnabled) {
  name: '${prefix}-processing-failure-${suffix}'
  location: 'global'
  kind: 'LogAlert'
  properties: {
    displayName: 'ARP processing failures'
    description: 'Detects sanitized ProcessingFailure records emitted by ARP Functions.'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    scopes: [insights.id]
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: '''
            traces
            | where message contains '"event":"ProcessingFailure"'
            | summarize FailureCount = count()
          '''
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'FailureCount'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: empty(processingFailureAlertActionGroupId)
        ? []
        : [processingFailureAlertActionGroupId]
    }
  }
}
resource plans 'Microsoft.Web/serverfarms@2024-11-01' = [for name in ['api','exporter']: {
  name: '${prefix}-${name}-plan-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}]
resource functions 'Microsoft.Web/sites@2024-11-01' = [for (name,i) in ['api','exporter']: {
  name: '${prefix}-${name}-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plans[i].id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      runtime: { name: 'node', version: '24' }
      deployment: { storage: { type: 'blobContainer', value: '${hostStorageBlobEndpoint}${name}-package', authentication: { type: 'SystemAssignedIdentity' } } }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048, triggers: { http: { perInstanceConcurrency: 4 } } }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: hostStorage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'DATA_QUEUE__queueServiceUri', value: dataStorage.properties.primaryEndpoints.queue }
        { name: 'DATA_QUEUE__credential', value: 'managedidentity' }
        { name: 'DATA_STORAGE_ACCOUNT', value: dataStorage.name }
        { name: 'TENANT_ID', value: tenantId }
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        { name: 'ENTRA_CLIENT_SECRET', value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=entra-client-secret)' }
        { name: 'TARGET_SUBSCRIPTION_IDS', value: join(targetSubscriptionIds, ',') }
        { name: 'APP_ORIGIN', value: 'https://${prefix}-api-${suffix}.azurewebsites.net' }
        { name: 'DECISION_ENDPOINT', value: decisionEndpoint }
        { name: 'DECISION_DEPLOYMENT', value: decisionDeployment }
        { name: 'DECISION_MODEL_VERSION', value: decisionModelVersion }
        { name: 'EXPLANATION_ENDPOINT', value: explanationEndpoint }
        { name: 'EXPLANATION_DEPLOYMENT', value: explanationDeployment }
        { name: 'MAX_MODEL_CALLS_PER_DAY', value: string(maxModelCallsPerDay) }
        { name: 'EXPORT_ENABLED', value: toLower(string(exportEnabled)) }
        { name: 'SYNC_ENABLED', value: toLower(string(syncEnabled)) }
        { name: 'PROJECT_PROGRESS_SYNC_ENABLED', value: toLower(string(projectProgressSyncEnabled)) }
        { name: 'INGEST_ENABLED', value: toLower(string(ingestEnabled)) }
        { name: 'GITHUB_OWNER', value: githubOwner }
        { name: 'GITHUB_REPOSITORY', value: githubRepository }
        { name: 'GITHUB_PROJECT_ID', value: githubProjectId }
        { name: 'GITHUB_PROJECT_STATUS_FIELD_ID', value: githubProjectStatusFieldId }
        { name: 'GITHUB_PROJECT_STATUS_TODO_OPTION_ID', value: githubProjectStatusTodoOptionId }
        { name: 'GITHUB_PROJECT_PRIORITY_FIELD_ID', value: githubProjectPriorityFieldId }
        { name: 'GITHUB_PROJECT_PRIORITY_P1_OPTION_ID', value: githubProjectPriorityP1OptionId }
        { name: 'GITHUB_PROJECT_PRIORITY_P2_OPTION_ID', value: githubProjectPriorityP2OptionId }
        { name: 'GITHUB_PROJECT_PRIORITY_P3_OPTION_ID', value: githubProjectPriorityP3OptionId }
        { name: 'GITHUB_PROJECT_PRIORITY_P4_OPTION_ID', value: githubProjectPriorityP4OptionId }
        { name: 'GITHUB_PROJECT_DUE_DATE_FIELD_ID', value: githubProjectDueDateFieldId }
        { name: 'GITHUB_TOKEN', value: '@Microsoft.KeyVault(VaultName=${vault.name};SecretName=github-token)' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
      ]
    }
  }
}]
resource auth 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: functions[0]
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    globalValidation: { requireAuthentication: true, unauthenticatedClientAction: 'RedirectToLoginPage', redirectToProvider: 'azureactivedirectory' }
    identityProviders: { azureActiveDirectory: { enabled: true, registration: { openIdIssuer: uri(environment().authentication.loginEndpoint, '${tenantId}/v2.0'), clientId: entraClientId, clientSecretSettingName: 'ENTRA_CLIENT_SECRET' }, validation: { allowedAudiences: [entraClientId] } } }
    login: { tokenStore: { enabled: true } }
    httpSettings: { requireHttps: true }
  }
}

// RBACはbootstrap/permissions.bicepで管理。通常CDへ権限付与の権限を持たせない。
output apiName string = functions[0].name
output exporterName string = functions[1].name
output apiPrincipalId string = functions[0].identity.principalId
output exporterPrincipalId string = functions[1].identity.principalId
output hostStorageName string = hostStorage.name
output dataStorageName string = dataStorage.name
output vaultName string = vault.name
output apiUrl string = 'https://${functions[0].properties.defaultHostName}'

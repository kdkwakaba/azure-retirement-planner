targetScope = 'resourceGroup'
param hostStorageName string
param dataStorageName string
param vaultName string
param apiPrincipalId string
param exporterPrincipalId string
param foundryAccountName string
param translatorAccountName string

resource host 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: hostStorageName }
resource data 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: dataStorageName }
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource entraClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'entra-client-secret' }
resource githubTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = { parent: vault, name: 'github-token' }
resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = { name: foundryAccountName }
resource translator 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = { name: translatorAccountName }
var principals = [apiPrincipalId,exporterPrincipalId]
var dataRoles = ['ba92f5b4-2d11-453d-a403-e96b0029c9fe','974c5e8b-45b9-4653-ba55-5f855dd0fb88','0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3']
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var assignments = [for i in range(0, length(principals) * length(dataRoles)): { principal: principals[i / length(dataRoles)], role: dataRoles[i % length(dataRoles)] }]
resource dataPermissions 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for item in assignments: {
  name: guid(data.id,item.principal,item.role)
  scope: data
  properties: { principalId: item.principal, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions',item.role) }
}]
resource hostBlobPermissions 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in principals: {
  name: guid(host.id,principal,'blob-owner')
  scope: host
  properties: { principalId: principal, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','b7e6dc6d-f1e8-4753-8033-0f276bb0955b') }
}]
resource hostQueuePermissions 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for principal in principals: {
  name: guid(host.id,principal,'queue')
  scope: host
  properties: { principalId: principal, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','974c5e8b-45b9-4653-ba55-5f855dd0fb88') }
}]
resource apiEntraSecretPermission 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(entraClientSecret.id, apiPrincipalId, keyVaultSecretsUserRoleId)
  scope: entraClientSecret
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId) }
}
resource apiGitHubSecretPermission 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(githubTokenSecret.id, apiPrincipalId, keyVaultSecretsUserRoleId)
  scope: githubTokenSecret
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId) }
}
resource exporterGitHubSecretPermission 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(githubTokenSecret.id, exporterPrincipalId, keyVaultSecretsUserRoleId)
  scope: githubTokenSecret
  properties: { principalId: exporterPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId) }
}

resource apiFoundryInference 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundry.id, apiPrincipalId, 'cognitive-services-user')
  scope: foundry
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908') }
}
resource apiTranslatorUse 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(translator.id, apiPrincipalId, 'cognitive-services-user')
  scope: translator
  properties: { principalId: apiPrincipalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908') }
}

// Incremental deployments do not remove the former vault-wide assignments.
// Export their deterministic names so operators can remove them during migration.
output legacyApiVaultSecretsUserAssignmentName string = guid(vault.id, apiPrincipalId, 'secrets')
output legacyExporterVaultSecretsUserAssignmentName string = guid(vault.id, exporterPrincipalId, 'secrets')


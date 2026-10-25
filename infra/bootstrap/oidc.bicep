targetScope = 'resourceGroup'
param identityName string
param githubOwner string
param githubRepository string
param location string = resourceGroup().location

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: identityName, location: location }
resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: identity
  name: 'github-main'
  properties: { issuer: 'https://token.actions.githubusercontent.com', subject: 'repo:${githubOwner}/${githubRepository}:ref:refs/heads/main', audiences: ['api://AzureADTokenExchange'] }
}
// このIdentityへ専用RGの必要な構築・配置権限を管理者が付与する。Ownerは付与しない。
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId

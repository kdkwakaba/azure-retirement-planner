targetScope = 'resourceGroup'

@description('Existing Azure Retirement Planner data Storage Account.')
param dataStorageName string

@description('Microsoft Entra object ID of the operator who will inspect pending Outbox rows.')
param principalObjectId string

var tableDataReaderRoleId = '76199698-9eea-4c19-bc75-cec21354c6b6'

resource dataStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: dataStorageName
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' existing = {
  parent: dataStorage
  name: 'default'
}

resource stateTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  parent: tableService
  name: 'ArpState'
}

resource outboxTableReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(stateTable.id, principalObjectId, tableDataReaderRoleId)
  scope: stateTable
  properties: {
    principalId: principalObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataReaderRoleId)
    description: 'Read-only inspection of Azure Retirement Planner Outbox state.'
  }
}

output assignmentId string = outboxTableReader.id
output assignmentScope string = stateTable.id

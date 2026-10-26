using '../main.bicep'
param tenantId = readEnvironmentVariable('ARP_TENANT_ID')
param entraClientId = readEnvironmentVariable('ARP_ENTRA_CLIENT_ID')
param targetSubscriptionIds = split(readEnvironmentVariable('ARP_TARGET_SUBSCRIPTION_IDS'), ',')
param location = readEnvironmentVariable('ARP_LOCATION')
param hostStorageBlobEndpoint = readEnvironmentVariable('ARP_HOST_STORAGE_BLOB_ENDPOINT')
param prefix = 'arp'
param decisionEndpoint = readEnvironmentVariable('ARP_DECISION_ENDPOINT')
param decisionDeployment = 'arp-decision-1'
param decisionModelVersion = '1'
param maxModelCallsPerDay = 200

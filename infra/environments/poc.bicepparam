using '../main.bicep'
param tenantId = readEnvironmentVariable('ARP_TENANT_ID')
param entraClientId = readEnvironmentVariable('ARP_ENTRA_CLIENT_ID')
param targetSubscriptionIds = split(readEnvironmentVariable('ARP_TARGET_SUBSCRIPTION_IDS'), ',')
param location = readEnvironmentVariable('ARP_LOCATION')
param prefix = 'arp'
param maxModelCallsPerDay = 0

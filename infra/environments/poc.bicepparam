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
param githubOwner = readEnvironmentVariable('ARP_GITHUB_OWNER', '')
param githubRepository = readEnvironmentVariable('ARP_GITHUB_REPOSITORY', '')
param githubProjectId = readEnvironmentVariable('ARP_GITHUB_PROJECT_ID', '')
param githubProjectStatusFieldId = readEnvironmentVariable('ARP_GITHUB_PROJECT_STATUS_FIELD_ID', '')
param githubProjectStatusTodoOptionId = readEnvironmentVariable('ARP_GITHUB_PROJECT_STATUS_TODO_OPTION_ID', '')
param exportEnabled = toLower(readEnvironmentVariable('ARP_EXPORT_ENABLED', 'false')) == 'true'
param syntheticUatEnabled = toLower(readEnvironmentVariable('ARP_SYNTHETIC_UAT_ENABLED', 'false')) == 'true'
param projectProgressSyncEnabled = toLower(readEnvironmentVariable('ARP_PROJECT_PROGRESS_SYNC_ENABLED', 'false')) == 'true'
param maxModelCallsPerDay = 200

# AzureとSharePointの構築から評価まで

この手順では、Azure Retirement Plannerを新しいAzure環境へ配置し、実環境のAzure情報とSharePoint文書を使ったAssessmentを確認する。値はすべて利用環境のものに置き換える。Tenant ID、Subscription ID、Resource ID、SharePoint ID、URL、秘密値はGitへ保存しない。

## 構築する範囲と担当

| 範囲 | 管理方法 | 主な作業者 |
|---|---|---|
| PlannerのFunction Apps、Storage、Key Vault、Translator、監視 | `infra/main.bicep` と手動リリースWorkflow | Azureデプロイ担当 |
| GitHub ActionsからAzureへのOIDC | `infra/bootstrap/oidc.bicep` とAzure RBAC | Entra／Azure管理者 |
| API・Exporterのデータアクセス、Foundry、Translator権限 | `infra/bootstrap/permissions.bicep` | 権限付与可能なAzure管理者 |
| 評価対象SubscriptionのReaderと通知リソース | `infra/evaluation-subscription.bicep` | 対象Subscriptionの権限付与担当 |
| FoundryアカウントとProject | 既存アカウントを利用するか、組織のFoundryリソース作成手順で用意 | Foundry管理者 |
| Decision-1／説明モデルDeployment | `infra/bootstrap/foundry.bicep` | Foundry管理者 |
| Graph `Sites.Selected` | `infra/bootstrap/sharepoint/permissions.bicep` | Graphアプリ権限を割り当てられる管理者 |
| 対象サイトの`read`許可 | Microsoft Graphのサイト権限APIで一度設定 | SharePoint／Graph管理者 |
| SharePoint Source、文書Factの確認、Assessment | Plannerの認証済み画面 | Governance、Operator、Reviewer |

`infra/main.bicep`はFoundryアカウントやProjectを作成しない。モデル用アカウント／Projectは別途用意する。現在の`infra/bootstrap/foundry.bicep`と`infra/bootstrap/permissions.bicep`はデプロイ先Resource Group内にあるFoundryアカウントを参照するため、この手順ではFoundryアカウントとProjectもPlanner用Resource Groupに置く。別Resource GroupのFoundryを使うには、テンプレートに明示的なScope指定を追加する必要がある。リポジトリのBicepが作成するAzureサービスのネットワーク設定は公開エンドポイントが基本である。Private Linkや組織固有ポリシーが必要な環境では、別途ネットワーク設計とIaC変更が必要。

## 1. 配置先と評価対象を決める

1. Planner本体を配置するSubscriptionと専用Resource Groupを決める。
2. Plannerが読み取る評価対象Subscriptionを決める。配置先Subscriptionと同一でもよいが、構成上の役割は分けて管理する。
3. Azure Policy、利用リージョン、Functions Flex Consumption、Translator、Foundryモデルの提供状況とQuota、保存期間、予算を確認する。
4. Planner専用Resource Groupを作成する。既存の業務用Resource Groupや評価対象のResource Groupを配置先に流用しない。

PowerShellの例：

```powershell
$deploymentSubscriptionId = '<PLANNER_SUBSCRIPTION_ID>'
$tenantId = '<ENTRA_TENANT_ID>'
$entraClientId = '<USER_LOGIN_APP_CLIENT_ID>'
$resourceGroup = '<PLANNER_RESOURCE_GROUP>'
$location = '<AZURE_LOCATION>'

az account set --subscription $deploymentSubscriptionId
az group create --name $resourceGroup --location $location
```

## 2. Entraアプリと利用者ロールを用意する

Entra管理センターで単一テナントのApp registrationを作成し、Client IDとTenant IDを控える。`ENTRA_CLIENT_ID`はこのアプリのClient IDである。GitHub Actions用OIDC IDのClient ID（`AZURE_CLIENT_ID`）とは別の値。

アプリ登録の**App roles**に次を定義する。値はAPIが確認するロール値と一致させる。

| ロール値 | 許可するメンバー | 用途 |
|---|---|---|
| `Reader` | Users/Groups | Assessmentと根拠の参照 |
| `Reviewer` | Users/Groups | 訂正、レビュー、承認 |
| `Operator` | Users/Groups | 同期の開始と実行状況の確認 |
| `Governance` | Users/Groups | SharePoint Source／Fact管理、同期、訂正、レビュー |
| `NotificationSender` | Applications | Service Health通知の認証済み受付 |

利用者とグループには必要なUserロールを割り当てる。通常の文書同期・評価だけなら、通知受付の`NotificationSender`ロールや通知Webhookは不要。

アプリのClient Secretを発行する。値は後の手順でKey Vaultへ安全に登録し、GitHubのVariables、Bicep、コマンド引数、ログには置かない。アプリが作成されただけでは利用者にアクセス権は付かない。

## 3. Foundryアカウントとモデルを準備する

Microsoft FoundryポータルでProjectを作成し、Advanced optionsで1節のPlanner用Resource Groupを選ぶ。FoundryリソースとProjectがそのResource Groupに作成されたことを確認する。組織のポリシーでポータル作成が禁止されている場合は、リソース作成担当が承認済みのFoundry用IaCで同じScopeに作る。このRepositoryにはFoundryアカウント自体を作るBicepは含まれない。[MicrosoftのFoundryリソース作成手順](https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources?tabs=portal)を参照する。

Decision-1と説明モデルを利用できるリージョン／SKU／Quotaを確認する。既存の組織アカウントを利用する場合も、対象ProjectとモデルDeploymentを確認する。

このリポジトリの`infra/bootstrap/foundry.bicep`は既存のアカウントとProjectを参照し、モデルDeploymentを作成または更新する。既定のProject名は`retirement-planner`。以降のコマンドはこの名前のProjectがある前提である。別名ならWhat-IfとApplyの両方に同じ`projectName=<PROJECT_NAME>`を追加する。既定のDeploymentはMicrosoft-Decision-1（`arp-decision-1`、Model version `1`、capacity `500`）とgpt-6-luna（`arp-explanation-gpt-6-luna`、Model version `2026-09-22`、capacity `3`）、SKUは`DataZoneStandard`。Quotaと現行の提供状況を事前に確認し、値を変える場合は実際のDeployment名・版・endpointをGitHub Variablesにも反映する。まずWhat-Ifを確認する。

```powershell
$foundryAccountName = '<FOUNDRY_ACCOUNT_NAME>'

az deployment group what-if `
  --resource-group $resourceGroup `
  --template-file infra/bootstrap/foundry.bicep `
  --parameters accountName=$foundryAccountName
```

差分を確認後、同じ対象・パラメーターで適用する。

```powershell
$foundryDeployment = az deployment group create `
  --resource-group $resourceGroup `
  --name arp-foundry-models `
  --template-file infra/bootstrap/foundry.bicep `
  --parameters accountName=$foundryAccountName `
  --output json | ConvertFrom-Json

$decisionEndpoint = $foundryDeployment.properties.outputs.decisionEndpoint.value
$explanationDeployment = 'arp-explanation-gpt-6-luna'
$explanationModelVersion = '2026-09-22'
```

説明Deployment名と版はこのBicepの既定値。モデル名、版、Capacityはテンプレートの現行値とテナント内のQuotaを照合する。変更した場合は、以降で設定するRepository Variablesを実際のDeploymentと一致させる。Deploymentが成功したことだけで、評価品質や業務適合性が確認されたことにはならない。

## 4. GitHub Actions OIDCと必要なRepository Variablesを設定する

### 4.1 OIDC IDを作成

GitHub ActionsからAzureへ長期Client Secretなしで接続するため、専用User Assigned Managed Identityを`infra/bootstrap/oidc.bicep`で作成する。Owner／Repository IDはGitHub APIで確認する。

```powershell
$owner = '<GITHUB_OWNER>'
$repository = '<GITHUB_REPOSITORY>'
$identityName = '<DEPLOYMENT_IDENTITY_NAME>'
$repositoryInfo = gh api "repos/$owner/$repository" | ConvertFrom-Json
$ownerId = [string]$repositoryInfo.owner.id
$repositoryId = [string]$repositoryInfo.id

az deployment group what-if `
  --resource-group $resourceGroup `
  --template-file infra/bootstrap/oidc.bicep `
  --parameters identityName=$identityName githubOwner=$owner `
    githubRepository=$repository githubOwnerId=$ownerId `
    githubRepositoryId=$repositoryId location=$location
```

What-Ifを確認後、同じパラメーターでデプロイし、出力からIDを取り出す。

```powershell
$identityDeployment = az deployment group create `
  --resource-group $resourceGroup `
  --name arp-github-oidc `
  --template-file infra/bootstrap/oidc.bicep `
  --parameters identityName=$identityName githubOwner=$owner `
    githubRepository=$repository githubOwnerId=$ownerId `
    githubRepositoryId=$repositoryId location=$location `
  --output json | ConvertFrom-Json

$deploymentClientId = $identityDeployment.properties.outputs.clientId.value
$deploymentPrincipalId = $identityDeployment.properties.outputs.principalId.value
$resourceGroupScope = az group show --name $resourceGroup --query id --output tsv

az role assignment create `
  --assignee-object-id $deploymentPrincipalId `
  --assignee-principal-type ServicePrincipal `
  --role Contributor `
  --scope $resourceGroupScope
```

出力の`$deploymentClientId`を`AZURE_CLIENT_ID`に登録する。`Contributor`はPlanner専用Resource Groupだけに割り当てる。評価対象Subscriptionへ権限を付けない。

### 4.2 Host Storage endpointを得る

Parameter fileが必要とするHost Storage Blob endpointは、Resource Group ID由来のBicep名から作られる。初回配置前に、次の一時Bicepを使ってendpointを出力する。リソースは作成せず、Resource GroupのDeployment記録だけが追加される。

```powershell
$endpointTemplate = Join-Path $env:TEMP 'arp-host-endpoint.bicep'
@'
targetScope = 'resourceGroup'
param prefix string = 'arp'
var suffix = uniqueString(resourceGroup().id)
output hostStorageBlobEndpoint string = 'https://${prefix}host${suffix}.blob.core.windows.net/'
'@ | Set-Content -LiteralPath $endpointTemplate -Encoding utf8

$hostStorageBlobEndpoint = az deployment group create `
  --resource-group $resourceGroup `
  --name arp-host-endpoint `
  --template-file $endpointTemplate `
  --query properties.outputs.hostStorageBlobEndpoint.value `
  --output tsv
```

`$hostStorageBlobEndpoint`は末尾が`/`のHTTPS Blob endpointになる。実際のリソース作成後に、デプロイ出力のHost Storage名とendpointが一致することも確認する。

### 4.3 Repository Variables

GitHub Repositoryの**Settings → Secrets and variables → Actions → Variables**に次を登録する。秘密値はVariablesに登録しない。

| Variable | 値 |
|---|---|
| `AZURE_CLIENT_ID` | 4.1で作成したGitHub OIDC User Assigned Managed IdentityのClient ID |
| `AZURE_TENANT_ID` | Azure／Entra Tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Planner本体の配置先Subscription ID |
| `AZURE_RESOURCE_GROUP` | Planner専用Resource Group名 |
| `AZURE_LOCATION` | 配置リージョン |
| `AZURE_HOST_STORAGE_BLOB_ENDPOINT` | 4.2で出力したBlob endpoint |
| `ENTRA_CLIENT_ID` | 2で作成した利用者ログイン用アプリのClient ID |
| `TARGET_SUBSCRIPTION_IDS` | 評価対象Subscription ID。複数はカンマ区切り |
| `DECISION_ENDPOINT` | FoundryアカウントのModel endpoint |
| `EXPLANATION_ENDPOINT` | 説明モデルのendpoint。両モデルが同じFoundryアカウントなら通常は同じendpoint |
| `EXPLANATION_DEPLOYMENT` | 説明モデルDeployment名。Foundry Bicepの`explanationDeploymentName`と一致させる |
| `EXPLANATION_MODEL_VERSION` | 説明モデルDeploymentの実際のモデル版。Foundry Bicepの`explanationModelVersion`と一致させる |

SharePoint連携を有効化するときに追加するVariable：

| Variable | 実文書評価の値 |
|---|---|
| `ARP_TEST_MODE_ENABLED` | `false` |
| `ARP_SHAREPOINT_SYNC_ENABLED` | `true` |
| `ARP_SHAREPOINT_LIVE_SOURCES_ENABLED` | `true` |
| `ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED` | `true` |

初期配置では未設定の任意機能は無効（`false`）のままにする。GitHub Issue／ProjectへのExport、通知受信、Project進捗同期、合成データ処理は、このSharePoint評価には不要なので有効化しない。

## 5. Planner本体をBicepで配置する

GitHub Actionsの**Actions**から`.github/workflows/deploy.yml`に対応するWorkflowを開く。実行Branchは`main`とし、同じ成功済みmain CI run IDをplanとapplyの両方で使う。

1. **Run workflow**で`phase=plan`、`infrastructure_only=true`を選び、成功済みCI run IDを指定する。
2. WorkflowのPlan summaryに表示されるResource ID、change type、Plan Hashを記録する。現在のWorkflow summaryはプロパティ差分を出力しないため、apply前に`.github/workflows/deploy.yml`のWhat-Ifコマンドを同じVariables・Parameterで実行し、Resourceごとの完全な変更内容を確認する。想定しない変更・削除・評価不能がある場合や差分を確認できない場合はapplyしない。
3. Plan出力のSHA256を記録する。
4. 同じmain CI run IDで`phase=apply`、`infrastructure_only=true`、`expected_plan_hash`にそのSHA256を指定する。
5. SummaryでBicep apply成功を確認する。ここではFunction Appのアプリパッケージをまだ配置しない。

GitHub Variablesを変更した場合は必ずplanからやり直す。Apply時にPlan Hashが一致しない場合は、以前のHashを再利用しない。

この手順ではAzure情報の取得は画面から手動で開始する。現行デプロイWorkflow／Parameter fileでは日次同期の`SYNC_ENABLED`をRepository Variableとして公開していないため、自動日次同期は有効にならない。

## 6. マネージドIDの権限とKey Vaultを設定する

本体Bicepのデプロイ完了後、出力を取得する。

```powershell
$deployment = az deployment group show `
  --resource-group $resourceGroup `
  --name arp-release `
  --output json | ConvertFrom-Json

$apiPrincipalId = $deployment.properties.outputs.apiPrincipalId.value
$exporterPrincipalId = $deployment.properties.outputs.exporterPrincipalId.value
$hostStorageName = $deployment.properties.outputs.hostStorageName.value
$dataStorageName = $deployment.properties.outputs.dataStorageName.value
$vaultName = $deployment.properties.outputs.vaultName.value
$translatorName = $deployment.properties.outputs.translatorName.value
```

`infra/bootstrap/permissions.bicep`に対してWhat-Ifを行い、適用する。このBootstrapはAPI／ExporterのStorageアクセス、Key Vault Secret読み取り、APIのFoundry推論とTranslator使用を割り当てる。デプロイ担当者には該当Resource ScopeでRole Assignmentを作成する権限が必要。通常のGitHub Actions OIDC IDやAPI Managed Identityに権限付与権限は与えない。

```powershell
$permissionParameters = @(
  "hostStorageName=$hostStorageName"
  "dataStorageName=$dataStorageName"
  "vaultName=$vaultName"
  "apiPrincipalId=$apiPrincipalId"
  "exporterPrincipalId=$exporterPrincipalId"
  "foundryAccountName=$foundryAccountName"
  "translatorAccountName=$translatorName"
)

az deployment group what-if `
  --resource-group $resourceGroup `
  --template-file infra/bootstrap/permissions.bicep `
  --parameters $permissionParameters

az deployment group create `
  --resource-group $resourceGroup `
  --name arp-runtime-permissions `
  --template-file infra/bootstrap/permissions.bicep `
  --parameters $permissionParameters
```

Key VaultにSecret名`entra-client-secret`を作り、2で発行したEntraアプリのClient Secret値を登録する。Azure PortalのKey Vault **Secrets → Generate/Import**を使い、値をコマンドラインや履歴へ出さない。

## 7. 評価対象Subscriptionを読み取り専用で接続する

各評価対象Subscriptionに対し`infra/evaluation-subscription.bicep`を使用する。これはAPI Managed IdentityへSubscription Scopeの`Reader`を付け、専用監視Resource Groupを作る。Exporterには評価対象への権限を付けない。通知Action Group／Alertは初期状態で無効。

```powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$apiUrl = $deployment.properties.outputs.apiUrl.value
$apiApplicationObjectId = az ad app show --id $entraClientId --query id --output tsv

$targetParameters = @(
  "monitoringResourceGroupName=<MONITORING_RESOURCE_GROUP>"
  "location=$location"
  "apiPrincipalId=$apiPrincipalId"
  "apiOrigin=$apiUrl"
  "tenantId=$tenantId"
  "apiApplicationId=$entraClientId"
  "apiApplicationObjectId=$apiApplicationObjectId"
  'enableNotifications=false'
)

az deployment sub what-if `
  --subscription $targetSubscriptionId `
  --location $location `
  --template-file infra/evaluation-subscription.bicep `
  --parameters $targetParameters

az deployment sub create `
  --subscription $targetSubscriptionId `
  --location $location `
  --template-file infra/evaluation-subscription.bicep `
  --parameters $targetParameters
```

評価対象の構成変更は行わない。評価対象のWorkload IDはResource Graphの`tags.WorkloadId`から読み取られ、未設定のリソースは`unassigned`にまとめられる。Workload単位に文書を関連付ける場合は、リソース所有者がリソース作成時に適切な`WorkloadId`タグを設定する。Planner自身はタグを変更しない。Subscription ScopeへのRole Assignment権限はこの手順を実行する管理者にだけ必要であり、常設のCD権限には含めない。

## 8. Entra認証を完成させ、Function Appを配置する

1. デプロイ出力の`apiUrl`を使い、Entraアプリ登録の**Authentication → Web → Redirect URI**に`<apiUrl>/.auth/login/aad/callback`を設定する。
2. EntraアプリClient SecretがKey Vaultの`entra-client-secret`に登録され、API Managed IdentityがKey Vault Secrets User権限を得ていることを確認する。
3. GitHub ActionsのDeployment workflowを再度`phase=plan`で実行し、差分を確認する。
4. 同じ成功CI run IDとplan SHA256で`phase=apply`、`infrastructure_only=false`を実行し、API／Exporterパッケージも配置する。
5. SummaryでBicep、API Package、Exporter Packageの各結果を確認する。
6. `apiUrl`へアクセスしてEntraログインできること、割り当てた利用者ロールが画面とAPIで反映されることを確認する。

## 9. SharePoint Graph権限とフォルダを設定する

### 9.1 Graphの`Sites.Selected`とサイト`read`

1. API Managed Identityの`apiPrincipalId`を使い、`infra/bootstrap/sharepoint/permissions.bicep`のWhat-Ifと適用を実施する。Graph Bicep拡張によるApplication permission割当てには、Microsoft Graphアプリロール割当てを行える管理者権限が必要。
2. API Managed IdentityのClient ID/App IDを`az ad sp show --id $apiPrincipalId --query appId --output tsv`で得る。Object/Principal IDとは異なる。
3. Graph ExplorerでサイトIDの`/permissions`を照会し、同じアプリに`read`が既に付いていないか確認する。
4. サイトの権限付与にはGraphの委任権限`Sites.FullControl.All`を使う管理者操作が必要。API Managed Identityにこの権限を付けない。
5. サイト許可APIへ`roles: ["read"]`とAPI Managed IdentityのClient ID/App IDを指定して登録し、`201 Created`と`roles: ["read"]`を確認する。

Graph ExplorerでのSite／Drive／Folder ID取得コマンド、権限同意とエラー切り分けは[SharePoint接続ガイド](sharepoint-connection-guide.md)に記載する。Graphのサイト許可はサイト単位であり、Plannerにフォルダを登録してもGraphの許可境界はフォルダ単位にはならない。対象サイト内の文書全体をAPI Managed Identityが読める前提で、利用可否を確認する。

### 9.2 SharePointの設定を反映

GitHub Variablesに次を設定する。

```text
ARP_TEST_MODE_ENABLED=false
ARP_SHAREPOINT_SYNC_ENABLED=true
ARP_SHAREPOINT_LIVE_SOURCES_ENABLED=true
ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED=true
```

設定変更後はWorkflowを`phase=plan`から実行し、What-Ifを確認してから同じCI runとPlan Hashで`phase=apply`を実行する。SharePointのSite ID、Drive ID、Folder Item IDはアプリのSource設定に保存し、Bicepや公開Repositoryへ固定しない。

## 10. 実文書を同期し、Factを評価へ反映する

### 10.1 先にWorkload IDを取得

1. OperatorまたはGovernanceで画面へサインインする。
2. **Azure情報を取得・評価**を押し、対象Subscriptionから通知とAzure構成を取得する。対象Subscriptionに対する読取だけを行う。
3. キュー処理が終わったら**評価結果を更新**する。
4. Azure Resource Graph Explorerで対象リソースの`tags.WorkloadId`を調べ、評価画面に出たWorkload単位と照合する。該当Workload IDをSource設定用に控える。WorkloadIdタグがないリソースは`unassigned`としてまとめられるため、複数Workloadを含み得る範囲にSharePoint文書を紐付けない。

評価対象に該当通知がなく、Assessmentもない場合は、SharePoint Factを結び付ける実通知のWorkloadがない。架空の通知を作ったり、サンプルSourceを実文書Sourceとして扱ったりせず、対象通知が取得できてから続ける。

### 10.2 Source登録と同期

1. 画面下部の折り畳み**SharePoint設計書（同期・Fact確認）**を開く。
2. Governanceユーザーで**SharePointフォルダを登録・更新**を開き、**新規入力**を押す。画面のデータ区分が**実業務文書**になっていることを確認してから以下を入力する。
   - Source ID：このPlanner環境内で重複しない短い識別子
   - 表示名：チームが区別できる名称
   - データ区分：`ARP_TEST_MODE_ENABLED=false`かつLive Sources有効時は実業務文書となる（画面表示を確認）
   - Site ID、Drive ID、Folder Item ID：SharePoint接続ガイドで確認した完全な各ID
   - Workload ID：10.1で確認したID。複数対象ならカンマ区切り
   - 設定版：初回は`1`など、更新時に増やす版識別子
4. **Source設定を保存**し、登録済みSource一覧に表示されたことを確認する。
5. OperatorまたはGovernanceで該当Sourceを選び、**SharePointから同期**を実行する。
6. 同期状態が`Succeeded`になり、Snapshotに対象DOCX／XLSXが表示されることを確認する。

### 10.3 文書Factを人が確認

1. 対象Workloadと通知のAssessmentを選択し、SharePointパネルで対象文書の**文書から事実候補を抽出**を押す。
2. 文書名、見出し・シート、記載箇所と内容を原本に照合する。自動抽出候補をそのまま業務事実として扱わない。
3. Governanceユーザーが誤記を修正し、根拠があるFactだけを**確認済みにする**。誤りや裏付けのない候補は**候補から除外**する。
4. Resource／Feature／Business Process間の依存関係を使う場合、画面上で該当Factと同じAssessment内のResourceを明示的に選択して保存する。文書に名前があることだけでAzureリソースの使用実態を確定しない。
5. Factの出典、内容、Workload、確認者、設定版を確認する。必要なFactが未確認なら、Assessmentへの反映へ進まない。

### 10.4 SharePoint Factを使ったAssessmentを確認

1. Fact確認後、**Azure情報を取得・評価**をもう一度実行し、Azure構成と通知を再取得する。
2. キューが完了してから**評価結果を更新**し、対象通知／同一Workloadの最新Assessmentを開く。
3. EvidenceにSharePoint文書由来の確認済みFactが記録され、依存リンクが正しいResourceへ結び付いていることを確認する。
4. リスク（未対応時）、対応時・対応後の影響、優先度、Decision-1のScore、説明LLM呼出し状態、確認が必要な理由を、Microsoft公式情報・Azure構成Evidence・SharePoint Evidenceと照合する。
5. FactによりAssessmentが更新されていない、Resourceに誤結合した、または根拠のない影響が出た場合は承認しない。Scope、Workload ID、Fact確認状態、同期Snapshot、Assessment作成時刻、モデル呼出し状態を調べて修正後に再取得する。

この操作はAssessmentを作成・更新するが、評価対象Azureリソースは変更しない。モデルの出力は提案であり、人間が最終判断する。GitHub Project登録は本手順に含めず、承認・Export機能を別途設定・確認する。

## 完了チェック

- [ ] Planner本体のWhat-Ifを確認してBicep applyが成功した。
- [ ] APIとExporterのパッケージを同一CI成果物から配置し、Entraログインとロールを確認した。
- [ ] API／ExporterのStorage・Key Vault権限、APIのFoundry・Translator権限を確認した。
- [ ] API Managed Identityだけに評価対象SubscriptionのReaderを付与し、Azure取得が成功した。
- [ ] Foundry Decision-1と説明モデルDeploymentがあり、API Managed Identityの推論権限と接続先が一致した。
- [ ] Graph `Sites.Selected`と対象サイトの`read`が別々に設定されている。
- [ ] Live SharePoint Sourceを登録し、同期Snapshotに対象文書がある。
- [ ] GovernanceがFactとResource依存を確認し、そのFactを使う最新Assessmentを確認した。
- [ ] Gitに環境固有ID、秘密、文書本文、モデル入出力を追加していない。

## つまずいたとき

| 症状 | 確認箇所 |
|---|---|
| WorkflowのAzure Loginが失敗 | `AZURE_CLIENT_ID`がEntraアプリではなくOIDC Managed IdentityのClient IDか、Tenant／SubscriptionとFederation subjectが正確か確認 |
| Plan Hashが一致しない | Variables、CI run、Branch、What-If結果を確認し、最新planからやり直す |
| APIが起動しない／Storage接続失敗 | `AZURE_HOST_STORAGE_BLOB_ENDPOINT`とBicep生成名、権限Bootstrapの結果、Key Vault参照を確認 |
| SharePoint同期が403 | Graph `Sites.Selected` Application permission、サイト単位の`read`、API Managed IdentityのClient IDとPrincipal IDの使い分けを確認 |
| Drive／Folderが見つからない | Site／Drive／FolderのID組合せとGraph Explorerでの`children`照会を[SharePoint接続ガイド](sharepoint-connection-guide.md)で確認 |
| 同期は成功したがFact候補がない | 対応拡張子、Snapshot、抽出設定、説明モデル接続と呼出状態を確認 |
| FactがAssessmentに出ない | Sourceのlive区分、Workload ID一致、Factの確認済み状態、依存リンク、同期後にAssessmentを再取得したか確認 |
| Assessmentが0件 | Entraロール、`TARGET_SUBSCRIPTION_IDS`、API Reader、Azure同期状況、対象通知とResource Profileの対応／取得不完全を確認 |

## 関連手順

- [SharePoint接続ガイド](sharepoint-connection-guide.md)：Graph ExplorerでのID取得、委任同意、`Sites.Selected`とサイト許可
- [運用Runbook](runbook.md)：What-If／Apply、監視、復旧、Feature flag、保管と撤去
- [利用者向けガイド](user-operations-guide.md)：Assessmentの確認、訂正、レビューと承認
- [実装状況](implementation-backlog.md)：設定の既定値、現行機能と製品上の制約

## Microsoft公式資料

- [GitHub ActionsからAzureへのOIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Azure FunctionsのEntra認証](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad)
- [Microsoft Graph Selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)

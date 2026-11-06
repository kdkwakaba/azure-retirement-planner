# 参照Azure Workloadの配置

このDirectory内のBicep Templateは、共通Platform Resource、Application Host、Data Service、監視、Foundry Account／Projectを含む、別ScopeのAzure Workloadを作ります。Workload、Owner Team、Environment、管理元、用途のTagを設定します。Application Code、業務Data、業務処理は配置しません。

Resource Graph DiscoveryとWorkload／Resourceの関連を確認するためのTag付きReference Workloadです。本番Application Architectureではありません。配置前に各Resourceと費用を確認してください。一部Resourceは継続課金されます。

## ScopeとParameter

main.bicepはSubscription Scopeの配置です。専用Resource Groupを作成し、workload.bicepをその中へ配置します。Workload TemplateはPlanner API Managed Identityへ、そのResource Group範囲だけのReader Roleを設定します。SQL ResourceにはMicrosoft Entra Administratorも設定します。foundry.bicepは同じResource Group内にAzure AI Foundry AccountとProjectを配置します。

Resource Group、Workload Label、Resource Nameの既定値はReference用です。命名規則と衝突する場合は配置前に変更します。Templateが必要とするNameだけ一意Suffixを使い、SharePoint Workload ID、Resource Tag、文書Referenceを一致させます。

## 配置前の確認

1. 対象Tenantにサインインし、対象Subscription IDを明示して選択する。曖昧な表示名で選ばない。
2. Subscription所有者、許可Region、Resource Provider登録、Service提供、Quota、見積費用を確認する。
3. Planner API Managed IdentityのPrincipal ID、SQL Entra管理者のObject ID／Type／Display Name、Tenant IDを取得する。
4. 専用Resource Group NameとWorkload IDを決める。既存ResourceやRole Assignmentが意図せず置換されないことを確認する。
5. Templateの既定SKU、Tag、Public Network設定、Role Assignmentを確認する。

## What-Ifと配置

Repository外のLocal Parameter Fileを使うか、保護されたShellからParameterを渡します。Tenant、Subscription、Object、Principal IDをCommitしないでください。

~~~powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$deploymentLocation = '<AZURE_LOCATION>'
$resourceGroupName = '<DEDICATED_RESOURCE_GROUP>'
$apiPrincipalId = '<PLANNER_API_MANAGED_IDENTITY_PRINCIPAL_ID>'
$sqlAdminObjectId = '<SQL_ENTRA_ADMIN_OBJECT_ID>'
$sqlAdminDisplayName = '<SQL_ENTRA_ADMIN_DISPLAY_NAME>'
$tenantId = '<TENANT_ID>'
$workloadId = '<WORKLOAD_ID>'
$params = @(
  "resourceGroupName=$resourceGroupName"
  "location=$deploymentLocation"
  "apiPrincipalId=$apiPrincipalId"
  "sqlEntraAdminObjectId=$sqlAdminObjectId"
  "sqlEntraAdminDisplayName=$sqlAdminDisplayName"
  "tenantId=$tenantId"
  "workloadId=$workloadId"
)

az account set --subscription $targetSubscriptionId
az account show --query '{subscription:id,tenant:tenantId}' --output table
az deployment sub what-if --subscription $targetSubscriptionId --location $deploymentLocation --template-file validation/azure-workload/main.bicep --parameters $params

# What-If全体と対象Scopeを確認してからApplyする。
~~~

Review後、同じSubscription、Location、Template、Parameterでaz deployment sub createを実行します。実行者にはResource作成とTemplate内Reader Role Assignmentの権限が必要です。Planner Runtime Identityへその権限を与えないでください。

## PlannerへWorkloadを接続

1. 承認済みScopeを削除せず、対象SubscriptionをPlannerのTarget Subscription設定へ追加する。
2. Plannerのレビュー済み配置手順でSubscription Readerを割り当てる。
3. SharePoint Folder Sourceに同じWorkload IDを設定し、許可された文書Folderだけを紐付ける。
4. 同期し、検出Resource候補を確認する。Azure Resource検出だけでは業務利用を確定できない。
5. 抽出Fact、Evidence位置、依存関係をReviewしてからAssessmentに使う。

## Cleanup

このReference Workload専用に作成したResource Groupだけを削除します。対象Subscription、Group名、内容、所有Tag、依存を確認してください。Planner自身のResource Group、評価対象の共有Resource、無関係なResourceを含むGroupは削除しないでください。

~~~powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$resourceGroupName = '<DEDICATED_RESOURCE_GROUP>'
az group show --subscription $targetSubscriptionId --name $resourceGroupName

# 専用Groupであり削除承認済みと確認した後に実行
az group delete --subscription $targetSubscriptionId --name $resourceGroupName --yes
~~~

# SharePoint影響評価用Azureワークロード

Azure Retirement Planner本体の配置先・Bicepとは独立した、検証用システム構成です。`infra/`配下に置かず、通常のARPデプロイWorkflowからも呼び出しません。

このテンプレートは、SharePointにある受注管理基盤の構成文書が参照するAzureリソースをTest Subscriptionに作り、ARPのResource Graph収集とWorkloadタグ付けを検証するためのものです。Web／Functionのアプリケーションコード、SQLの業務データ、実際の受注処理は配備しません。したがって、実システムの稼働や業務処理を模擬した検証にはなりません。

## 作成するもの

- `orders-web-prod` App ServiceとLinux App Service Plan（既定F1、必要ならB1を選択可能）
- `orders-sql-validation` Azure SQL論理サーバーと`orders-db-prod` Basic Database
- SQLへのMicrosoft Entra管理者設定とEntra専用認証
- `orders-dispatch-prod`、`orders-report-prod` Function AppとFlex Consumption Plan
- Storage V2、`orders-queue-prod` Queue、Functions配備用Blob Container、レポート用Blob Container
- Application InsightsとLog Analytics Workspace
- Azure AI Foundryアカウント（AIServices S0）とWorkload用Project。モデルデプロイ、Agent、データ接続は作成しない
- Function用User Assigned Managed Identityと、同じ検証Storage／Application Insightsに限った必要ロール
- ARP API Managed IdentityへのReader。スコープはこの検証用Resource Groupのみ

すべての評価対象リソースに同じタグを設定します。

| タグ | 値 | 目的 |
|---|---|---|
| `WorkloadId` | `orders-management-validation` | SharePoint Sourceと評価対象を結び付ける |
| `OwnerTeam` | リソース別に設定 | 担当チームの候補 |
| `Environment` | `test` | Test Subscriptionの検証リソースであることを識別 |
| `ManagedBy` | `bicep` | IaC管理を識別 |
| `Purpose` | `sharepoint-impact-validation` | 検証用Resource Group内での用途を識別 |

Foundryは構成評価の対象候補として表示できるようアカウントとProjectのみを作成します。Project作成要件に合わせアカウントのシステム割り当てマネージドIDを有効化しますが、ロールは付与しません。モデルをデプロイしないため、推論呼出しやモデル品質は検証しません。アカウント作成だけではMicrosoft-Decision-1の利用やClassic Agent Service APIの利用を意味しません。ネットワークは現行の検証構成に合わせてPublic Network Accessを有効にし、ローカル認証は無効にします。

Azure Queueの個別リソースはResource Managerタグをサポートしないため、タグは親Storage Accountへ付けます。ARPのResource GraphクエリはQueueの親Storage AccountからWorkload ID、環境、担当チームを引き継ぎます。担当チームはWeb／出荷処理=`application-operations`、SQL=`database-operations`、Queue／Storage=`cloud-platform-operations`、監視=`monitoring-operations`、日次レポート=`data-operations`です。

## デプロイ前にそろえる値

1. `az account list --all --query "[?name=='Test Subscription' && state=='Enabled'].id | [0]" -o tsv` でTest Subscription IDを確認します。
2. API Function Appのシステム割り当てIdentity `principalId` を取得します。ARPの配置先と対象Subscriptionは別なので、ARPのAPI Function Appから取得したIDを使います。
3. Test Subscription上でSQL ServerのMicrosoft Entra管理者にするユーザーまたはグループのObject IDと表示名を取得します。
4. Subscriptionの`Microsoft.Web`、`Microsoft.Sql`、`Microsoft.Storage`、`Microsoft.Insights`、`Microsoft.OperationalInsights`プロバイダー登録と、選択リージョンでのSKU／クォータを確認します。現在のTest SubscriptionはJapan EastのF1／B1 quotaが0でしたが、Japan WestではWhat-Ifの事前検証が通ったため既定リージョンをJapan Westにしています。受注Webは構成収集向けのLinux F1です。B1のApp Service構成を確認する場合は、Microsoft.WebのJapan West B1 quotaを1以上へ増やした後、`webPlanSku='B1'`を指定します。

実リソース名が他テナントで既に使用されている場合は、`globalNameSuffix`へ短い一意値を指定します。その場合、SharePoint文書内の`orders-web-prod`、`orders-dispatch-prod`、`orders-report-prod`も同じ末尾へ変更してから同期・Fact確認してください。SQL Database名とQueue名はこのテンプレートでは変更しません。

## What-Ifと配置

最初にSubscriptionを確認してから、専用Resource Group名と全リソースの差分をWhat-Ifで確認します。組織の実行環境にAzure PowerShell (`Az.Resources`) がある場合、SecureStringでパスワードを受け取り、`New-AzSubscriptionDeployment`へ渡すと、パスワードをファイルやコマンド履歴に置かずに実行できます。`sqlAdministratorLoginPassword`は必ずSecureStringとして渡してください。

```powershell
$testSubscriptionId = az account list --all --query "[?name=='Test Subscription' && state=='Enabled'].id | [0]" -o tsv
az account set --subscription $testSubscriptionId
az account show --query "{name:name,id:id,state:state}" -o table

$apiPrincipalId = '<ARP API Function AppのsystemAssigned principalId>'
$sqlAdminObjectId = '<SQL Entra管理者のObject ID>'
$sqlAdminDisplayName = '<SQL Entra管理者の表示名>'
$tenantId = az account show --query tenantId -o tsv
$deploymentParameters = @{
  resourceGroupName = 'rg-arp-validation-orders'
  location = 'japanwest'
  apiPrincipalId = $apiPrincipalId
  sqlEntraAdminObjectId = $sqlAdminObjectId
  sqlEntraAdminPrincipalType = 'User'
  sqlEntraAdminDisplayName = $sqlAdminDisplayName
  tenantId = $tenantId
  workloadId = 'orders-management-validation'
  ownerTeam = 'application-operations'
}

New-AzSubscriptionDeployment `
  -Name 'orders-validation-whatif' `
  -Location 'japanwest' `
  -TemplateFile './validation/azure-workload/main.bicep' `
  -TemplateParameterObject $deploymentParameters `
  -WhatIf
```

What-Ifに問題がなければ、同じSubscription、パラメーターで`-WhatIf`だけを外して`New-AzSubscriptionDeployment`を実行します。作成権限に加えてResource Group上のReader role assignmentを作成できる権限が必要です。BicepはARP本体のRGや他のSubscriptionへ変更を行いません。

Microsoft LearnのAzure SQL手順に沿い、論理サーバー作成時にMicrosoft Entra管理者とEntra専用認証を同時設定します。SQL認証用ログイン／パスワードを作らないため、資格情報を保管する手順はありません。

## ARPとSharePointでの確認

1. `TARGET_SUBSCRIPTION_IDS`にTest Subscription IDを追加して、ARPの設定をWhat-If後に反映します。既存の対象Subscriptionは残します。
2. ARPのAzure情報同期を実行し、この専用Resource Group内のリソースだけがWorkload `orders-management-validation`で収集されることを確認します。
3. SharePoint SourceはサンプルSourceとは別の新規IDで登録し、既知のSite ID、Drive ID、Folder Item IDを使います。`workloadIds`に`orders-management-validation`を指定します。
4. 同期したWord／ExcelのFactを出典位置と照合してGovernanceで確認します。文書内のリソース名とAzureの実名が一致していることを確かめます。
5. Assessment上でFactとResource IDの関係を明示し、退役イベントに該当するAzureリソースがある場合に再評価します。対応する実通知がなければ、構成の読取・Fact抽出までの確認にとどまり、退役影響評価の実証とは記録しません。

## 検証後の削除

このBicep専用の`rg-arp-validation-orders`を削除します。削除前にResource Group名、Subscription ID、所属リソースがこの検証専用であることを確認してください。ARP本体のリソースグループには適用しないでください。

```powershell
az group delete --subscription $testSubscriptionId --name 'rg-arp-validation-orders' --yes
```

## 参照

- [Azure FunctionsのBicep IaCとFlex Consumption構成](https://learn.microsoft.com/azure/azure-functions/functions-infrastructure-as-code)
- [Microsoft.Web/sitesのBicepリファレンス](https://learn.microsoft.com/azure/templates/microsoft.web/sites)
- [Microsoft.Sql/servers/databasesのBicepリファレンス](https://learn.microsoft.com/azure/templates/microsoft.sql/servers/databases)
- [Azure SQLのMicrosoft Entra専用認証](https://learn.microsoft.com/azure/azure-sql/database/authentication-azure-ad-only-authentication)

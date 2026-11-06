# 運用Runbook

本書は配置とサービス運用を説明します。山括弧のPlaceholderは、環境で承認された値に置き換えてください。実ID、Endpoint、Token、Payloadをコミットしないでください。

Azure作成からSharePoint文書を使うAssessmentまでの初回構築は、[構築・SharePoint評価ガイド](deployment-and-sharepoint-evaluation.md)を参照してください。本書は個別の運用手順と復旧を扱います。

## 1. ローカル検証

.node-versionとpackage.jsonに記載されたNode.js／npmを使います。

~~~sh
npm ci --ignore-scripts
npm run verify
az bicep build --file infra/main.bicep --stdout
az bicep build --file infra/ingestion.bicep --stdout
az bicep build --file infra/evaluation-subscription.bicep --stdout
az bicep build --file infra/bootstrap/oidc.bicep --stdout
az bicep build --file infra/bootstrap/foundry.bicep --stdout
az bicep build --file infra/bootstrap/permissions.bicep --stdout
az bicep build --file infra/bootstrap/sharepoint/permissions.bicep --stdout
~~~

CI ArtifactにはApplication CodeとDependencyだけを含めます。実Azure Record、Model入力／出力、認証情報、環境Snapshotは含めません。

## 2. BootstrapとIdentity

1. Planner用Resource Group、配置Subscription、Tenant、Location、Storage Endpoint、対象Subscription一覧、Model Endpointを決める。Policy、Quota、Runtimeサポート、費用、Name利用可否を確認する。
2. 単一TenantのEntra Appを作成し、利用者Role Reader、Reviewer、Operator、Governanceと、Application専用Role NotificationSenderを定義する。割当を必須にし、必要な利用者／Groupだけ割り当てる。
3. Callbackをhttps://<api-name>.azurewebsites.net/.auth/login/aad/callbackに設定する。Web IdentityとAPIのAudience、Issuer、Tenant、Token種別、Role検査を確認する。
4. infra/bootstrap/oidc.bicepでGitHub main Branch用配置Identityを作る。GitHubから取得したRepository／Owner IDを使い、Subjectを対象BranchとRepositoryに限定する。
5. 配置IdentityにはPlanner専用Resource Groupへのレビュー済み配置に必要なPermissionだけを付与する。対象SubscriptionのRole Assignment権限は付与しない。
6. Main Bicepを配置し、必要に応じてStorage、Key Vault、Translator、Foundry、SharePoint Graph Permission、対象Scope ReaderのBootstrap Templateを別途適用する。
7. Entra Client SecretとGitHub TokenをKey Vaultに保存する。現行GitHub AdapterはKey VaultのTokenを読む。GitHub App Installation Token方式は未実装。Secret値を記録せず、所有者、期限、Permission、Rotation日を台帳管理する。

配置Identityに特権Bootstrap専用Permissionを与えないでください。API／Exporterに評価対象Subscriptionへの書込権限を付けないでください。

## 3. Repository VariablesとSecret

Repository VariableはAzure Client／Tenant／Subscription、Resource Group、Location、対象Scope、Storage Endpoint、Entra Client ID、Model Endpoint／Deployment／Version、GitHub接続先、Feature Flagなど秘密ではない配置値に使います。

環境Parameter Fileは保守的な既定値を使い、Feature Variableがなければfalseになります。環境値は保護されたGitHub／Azure設定に置き、Bicep Source、Markdown、Commit済みParameter Fileに記載しません。

SecretはKey Vaultにだけ保存します。Token、Client Secret、Signing Key、Access TokenをGitHub Variable、Command History、CLI引数、Log、Screenshot、Runbookに記載しないでください。

## 4. 評価対象SubscriptionのAccessと通知

Planner配置Subscriptionと評価対象Subscription一覧は別に管理します。infra/evaluation-subscription.bicepは選択した対象SubscriptionにAPI Managed IdentityのReaderを付与し、Monitoring Resource Group、Action Group、Activity Log Alertを作成できます。Exporter権限やWorkload変更は行いません。

各対象SubscriptionにTemplateを適用します。Apply前にWhat-If全体を確認し、意図したReader割当とMonitoring Resourceだけであることを確認する必要があります。実行者にはMonitoring Resource作成とRole Assignment権限が必要ですが、通常の配置Identityには付与しません。

Placeholderを使い、対象Subscriptionを明示してください。

~~~powershell
$targetSubscriptionId = '<TARGET_SUBSCRIPTION_ID>'
$monitoringResourceGroup = '<MONITORING_RESOURCE_GROUP>'
$apiPrincipalId = '<API_MANAGED_IDENTITY_PRINCIPAL_ID>'
$apiOrigin = 'https://<api-name>.azurewebsites.net'
$tenantId = '<TENANT_ID>'
$applicationId = '<ENTRA_APPLICATION_CLIENT_ID>'
$applicationObjectId = '<ENTRA_APPLICATION_OBJECT_ID>'
$location = '<AZURE_LOCATION>'
$params = @(
  "monitoringResourceGroupName=$monitoringResourceGroup"
  "location=$location"
  "apiPrincipalId=$apiPrincipalId"
  "apiOrigin=$apiOrigin"
  "tenantId=$tenantId"
  "apiApplicationId=$applicationId"
  "apiApplicationObjectId=$applicationObjectId"
  "enableNotifications=false"
)

az deployment sub what-if --subscription $targetSubscriptionId --location $location --template-file infra/evaluation-subscription.bicep --parameters $params
~~~

通知Action GroupとAlertは既定で無効です。有効化前に送信Identity、NotificationSender App Role、Audience、APIのINGEST_ENABLED、認証、制御された配送経路を確認する。匿名Ingest Endpointを公開しないでください。

## 5. Release Workflow

1. レビュー済み変更をmainへMergeし、CI成功を確認する。
2. .github/workflows/deploy.ymlを成功済みmain CI Run IDとphase=planで起動する。
3. What-Ifを確認し、Resource／Property変更とPlan SHA256を記録する。
4. 同じWorkflowとCI Runでphase=apply、レビュー済みHashを指定する。設定／Infrastructureだけならinfrastructure_only=true、API／Exporter Packageも配置するならfalseを指定する。
5. Workflow SummaryでInfrastructureとPackageの期待結果を確認する。
6. API Health、Entra認証、Role、設定値、処理状態、変更対象Featureを確認する。配置成功はModel精度や業務判断の正しさを証明しない。

WorkflowはSource CI RunとArtifact Hashを検証し、What-Ifを再計算します。現在Plan Hashがレビュー済みPlanと異なるとApplyを拒否します。次回Bicepで上書きされるPortal直接変更をしないでください。

## 6. Feature設定

以下は独立設定で、Variable未設定時は無効です：同期、通知受信、SharePoint同期、Fact抽出、Live SharePoint Source、GitHub Export、Project進捗同期。承認された処理に必要な設定だけを有効化し、Bicep配置Variableを更新してレビュー済みRelease Workflowで適用します。

GitHub Export有効化前にPending Outboxをすべて確認してください。最新Assessment以外の既存Eligible Itemも送信される場合があります。Destination、Repository／Project Field、Token Permission、Assessment Hash、Pending対象を先に確認します。Project進捗同期はProject Statusを読み取る別設定です。

## 7. SharePoint Access

Site／Drive／Folder ID取得、Graph Sites.Selected、Site read許可、Source Mode、Folder登録、同期／抽出状態は[SharePoint接続ガイド](sharepoint-connection-guide.md)を参照してください。APIのGraph PermissionとSite許可は別です。Site許可は1 Folderより広い範囲です。

Live文書SourceにはTest Mode無効、Live Source有効、同期有効が必要です。Fact抽出には追加Feature FlagとGovernance Reviewが必要です。未確認文書記載を通常Assessmentへ渡さないでください。

## 8. 監視と復旧

Application Logには安全なStage、Correlation ID、Error Category、HTTP Status、Model呼出Metadataを記録します。通常、完全なResource ID、Provider例外全文、文書本文、Model Prompt／Outputは記録しません。Correlation IDでLogとQueue状態を追跡します。

Source失敗時は設定、Role、Identity Access、Provider状態、Request上限、記録済みFailure Categoryを確認します。Assessment／Export Queueの再試行前に通常QueueとPoison Queueを確認します。Project更新前に外部GitHub Issueが作成された可能性があれば照合します。RetryはIdempotentにし、Work Itemを重複させないでください。

Azure Tableを手動で調べる場合、infra/bootstrap/outbox-table-reader.bicepで対象Tableと担当IdentityだけにStorage Table Data Readerを付与します。What-Ifを確認し、調査後に一時Grantを削除します。本番Row全文を公開IssueやRepositoryへ貼らないでください。

## 9. 保持、費用、撤去

Model呼出上限、Cost Alert、Runtime Scale上限はRiskを減らす制御であり、正確な費用上限ではありません。課金反映は遅れることがあります。推論停止後もStorage、Telemetry、Network費用が続く場合があります。Model、Capacity、抽出上限変更前にProvider価格、Quota、Region提供状況を確認します。

撤去前にPlanner所有Resource、外部Project項目、Role Grant、Graph Permission、App Registration、Federation、Secret、Snapshot、Backupを棚卸しします。正確なScopeと依存関係を確認します。撤去承認済みの専用Resource／Permissionだけを削除し、評価対象や共有Resourceは削除しません。Data保持遅延やサービス側Soft Delete期間があれば報告します。

## 参考資料

- [GitHub Actions OIDCとAzure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure)
- [Azure Functions Flex Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan)
- [Microsoft Graph Selected Permission](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [SharePoint接続ガイド](sharepoint-connection-guide.md)

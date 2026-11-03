# 初期構築・検証・運用手順

初期構築、手動CD、Azure連携、復旧・撤去の運用Runbook。過去の配置・検証記録は本書末尾に記録するが、最新の稼働状態は[実装バックログ](implementation-backlog.md)と照合する。対象Azureリソースは読み取りのみ。本システム用の専用RG、評価Scope、通知配置Scopeを台帳で区別する。画面を使う日常操作は[利用者向け操作ガイド](user-operations-guide.md)を参照する。

## 1. ローカル・CIでコードを確認

Nodeは`.node-version`、npmは`package.json`を使用する。

```sh
npm ci --ignore-scripts
npm run verify
az bicep build --file infra/main.bicep --stdout
az bicep build --file infra/ingestion.bicep --stdout
az bicep build --file infra/evaluation-subscription.bicep --stdout
az bicep build --file infra/bootstrap/oidc.bicep --stdout
az bicep build --file infra/bootstrap/foundry.bicep --stdout
az bicep build --file infra/bootstrap/permissions.bicep --stdout
```

`verify`はruntime/format/lint/typecheck/test/build/artifacts/docs/auditを順に実行。アプリはAzure配信を標準とし、ローカル認証回避・サンプル自動表示は実装しない。`.artifacts/`はコードのみの配置成果物、実入出力は含めない。各アプリの`host.json`、独立したruntime依存、UIを同梱する。CIのPRではAzure・モデル・GitHub登録を呼ばない。

## 2. 管理者によるBootstrap

1. 既存Subscriptionに専用RGを作る前にID・リージョン・Tenantを確定。Azure Policy、Flex Node24の提供、課金枠、既存資源との区別を確認する。
2. Entraの単一テナントApp登録を作成し、`Reader`、`Reviewer`、`Governance`、`Operator`（User）と`NotificationSender`（Application）のApp rolesを定義する。割当必須としユーザーを割り当てる。APIの許可表はReader=読取、Reviewer=読取＋訂正／レビュー、Operator=読取＋同期、Governance=読取＋同期＋訂正／レビュー、NotificationSender=Application限定の通知受付。ユーザー用APIは`kind=User`、通知受付は`kind=Application`も検証する。WebリダイレクトURIは`https://<api>.azurewebsites.net/.auth/login/aad/callback`。ID Tokenを使用するUIと、aud/issuer/tid/rolesを検証するAPIの両方を試験する。
3. Secure Webhookは専用サービスプリンシパルのアプリ権限に限定。Access Token v2と`idtyp=app`のoptional claim、audienceを合わせる。Action Groupsの実際の送信主体へのApp role割当をSP-03で確認する。未設定のまま匿名受付へ緩和しない。
4. `infra/bootstrap/oidc.bicep`でGitHub main branch subjectのUAMI/Federationを作成。GitHub APIから取得した`githubOwnerId`と`githubRepositoryId`も渡す。新規Repositoryのsubjectは`repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:ref:refs/heads/main`であり、azure/loginが記録する実際のsubjectと完全一致させる。旧形式を使うRepositoryは実際の形式を確認してテンプレートを調整し、ワイルドカードへ緩和しない。通常CDのIdentityへ専用RGの必要なデプロイ権限を別途付与。Owner／権限付与権限は通常CDへ付けない。
5. Repository Variablesに`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`、`AZURE_RESOURCE_GROUP`、`AZURE_LOCATION`、`AZURE_HOST_STORAGE_BLOB_ENDPOINT`、`ENTRA_CLIENT_ID`、`TARGET_SUBSCRIPTION_IDS`（カンマ区切り）、`DECISION_ENDPOINT`を設定する。`AZURE_SUBSCRIPTION_ID`はARP本体の配置先、`TARGET_SUBSCRIPTION_IDS`は評価対象であり、別の役割である。評価対象を分離するときは後者だけを評価用Subscription IDへ変更する。いずれも非機密設定で、秘密はVariablesへ入れない。
6. mainのCI合格後、Manual PoC deploymentの`plan`を起動して差分とHashを確認し、同じCI runで`apply`、`infrastructure_only=true`を起動。最初はアプリ配置を行わずMIと保管先を作る。
7. 管理者がoutputsを用いて`infra/bootstrap/permissions.bicep`を適用。データ用Blob/Queue/Table、ホストStorage、Key Vaultに用途別ロールを付与する。TranslatorもF0を既定としてデプロイする。リージョンリソースではBicepのlocationをTRANSLATOR_REGIONとしてAPIへ渡し、グローバルTranslator endpointでEntra認証、Ocp-Apim-Subscription-Regionヘッダーを利用する。出力の`translatorName`を`translatorAccountName`へ渡してAPI Managed IdentityへTranslatorリソース範囲の`Cognitive Services User`を付与する。Subscriptionに既存F0がある場合はS1等への変更費用を確認し、未確認のまま適用しない。ホストBlob OwnerはFunctionsホストの要件であり、評価対象へのOwnerではない。評価対象SubscriptionへのAPI MIのReader割当は、次項の`infra/evaluation-subscription.bicep`で評価対象Subscriptionスコープに宣言する。Exporterには評価対象読取を与えない。Foundry呼出ロールはAPIのMIに対象Foundryアカウント範囲で付与する。
8. `entra-client-secret`をKey Vaultに直接保存。GitHub連携を使う場合、GitHub TokenはGitHub側で人間が発行し、その値をKey Vaultの`github-token` Secretへ手動登録する。BicepやアプリはGitHub PATを発行できず、現在のアプリ実装も静的な`github-token` Secretを読む方式である。Secret名だけをBicepで用意しても値は設定されない。発行日、有効期限、権限、更新担当を秘密値なしで台帳へ記録する。値をログ・CLI引数・Git・チャットへ出さない。Secretを完全排除した設計とは主張しない。
9. Entraのcallbackを更新し、再度plan/applyを確認して`infrastructure_only=false`で検査済みの同一ZIPを配置。`infrastructure_only=true`のapplyはBicepだけを適用し、API／ExporterのZIPを配置しない。GitHub ActionsのManual deployment summaryでInfrastructure apply stepとAPI／Exporter package deploymentの各outcomeを確認する。RBAC伝播・Key Vault参照成功を確認する。

## 3. 評価対象SubscriptionへのReader・通知設定

アプリ配置先は`AZURE_SUBSCRIPTION_ID`、評価対象は`TARGET_SUBSCRIPTION_IDS`で分離する。複数の評価対象がある場合、このsubscription-scopeテンプレートを各Subscriptionへ個別に適用する。

`infra/evaluation-subscription.bicep`は、(1)評価対象Subscription直下へのAPI Function Appのシステム割り当てID用Reader role assignment、(2)専用の`rg-arp-monitoring`、(3)Service Health Action GroupとActivity Log Alertを作成する。既存ワークロードは変更しない。テンプレートを実行する人には対象Subscription上でResource Group作成とrole assignment作成の両方が必要である。通常のGitHub CD identityにはこれらの権限を付与しない。

API配置後、管理者端末で以下を実行する。初回は必ずWhat-Ifを確認し、Reader以外のロールや対象外リソースへの変更がないことを確認する。Action GroupとAlertはデフォルトで無効であり、通知認証を確認するまでは有効化しない。

```sh
TARGET_SUBSCRIPTION_ID=7a23c246-5790-47a5-8d1a-21b21c706c76
API_PRINCIPAL_ID=$(az deployment group show --resource-group "$ARP_RESOURCE_GROUP" --name arp-release --query properties.outputs.apiPrincipalId.value -o tsv)
API_ORIGIN=$(az deployment group show --resource-group "$ARP_RESOURCE_GROUP" --name arp-release --query properties.outputs.apiUrl.value -o tsv)
API_APPLICATION_OBJECT_ID=$(az ad app show --id "$ARP_ENTRA_CLIENT_ID" --query id -o tsv)

az deployment sub what-if \
  --subscription "$TARGET_SUBSCRIPTION_ID" \
  --location "$ARP_LOCATION" \
  --template-file infra/evaluation-subscription.bicep \
  --parameters monitoringResourceGroupName=rg-arp-monitoring \
    location="$ARP_LOCATION" apiPrincipalId="$API_PRINCIPAL_ID" \
    apiOrigin="$API_ORIGIN" tenantId="$ARP_TENANT_ID" \
    apiApplicationId="$ARP_ENTRA_CLIENT_ID" \
    apiApplicationObjectId="$API_APPLICATION_OBJECT_ID" \
    enableNotifications=false

# What-Ifが想定どおりの場合のみ同じ引数でcreateを実行する
az deployment sub create \
  --subscription "$TARGET_SUBSCRIPTION_ID" \
  --location "$ARP_LOCATION" \
  --template-file infra/evaluation-subscription.bicep \
  --parameters monitoringResourceGroupName=rg-arp-monitoring \
    location="$ARP_LOCATION" apiPrincipalId="$API_PRINCIPAL_ID" \
    apiOrigin="$API_ORIGIN" tenantId="$ARP_TENANT_ID" \
    apiApplicationId="$ARP_ENTRA_CLIENT_ID" \
    apiApplicationObjectId="$API_APPLICATION_OBJECT_ID" \
    enableNotifications=false
```

Readerは評価対象Subscription範囲のみで、APIのシステム割り当てIDへ付与する。CD用ID、Exporter、ワークロードの変更権限は追加しない。Bicepを適用する人には`Contributor`相当のリソース作成権限と`Role Based Access Control Administrator`（または同等のrole assignment権限）が必要になる。これは一時的な人間の実行権限として扱い、通常CDへ恒常付与しない。

通知を有効化する前に、RunbookのSecure Webhook手順（Action Group送信主体、`NotificationSender` app role、audience、API側の`INGEST_ENABLED`）を実環境で検証する。完了後、同じテンプレートを`enableNotifications=true`でWhat-Ifし、Action GroupとAlertを有効化する。APIの`INGEST_ENABLED`がfalseの間は受信時に503となるため、両側の設定を同時に確認する。配送テストは実Retirement情報の検知・評価確認とは分けて記録する。

## 4. 実接続を有効にする順序

- モデル接続リリース後は`MAX_MODEL_CALLS_PER_DAY=200`、同期/通知/外部登録はfalse。要求単位のToken上限は設定しない。`infra/main.bicep`とパラメーターへ構成を記録し、ポータル手修正を次のCDで消さない。
- 現在のARGはBasic LB、GPv1、URL pingに加え、Foundry `AIServices`アカウント／project、Classic Foundryのhub／projectを取得する。通知候補は検出したイベントプロファイルのResource Typeに絞る。同じResource Typeの未知SKU／kindはUnknownとして残し、明示されたService Health／Advisor対象は種別を問わず保持する。対応プロファイルがない通知は明示対象だけを候補にし、それ以外のインベントリは表示せず`ProfileUnavailable`として人間レビューへ送る。対象外とは判定しない。FoundryとStorageの関連付け項目も制御プレーンから収集するが、関係だけで影響を確定せず、利用状況は人が確認する。Owner/Workloadのタグは`OwnerTeam`、`WorkloadId`、環境は`Environment`。データプレーンは取得しない。
- UIの「Azure情報を取得・評価」で実取得を開始し、Queue処理後に更新する。API読取権限、ARGページング、Service Health/Advisorの実データShapeをSP-02で確認する。Service HealthのTracking IDはimpacted-resource IDから完全一致で抽出し、Advisorメタデータと推奨を`recommendationTypeId`で関連付ける。Advisorの有効状態は`recommendationStatus`を用い、`platformState`や`customerState`に依存しない。いずれかの取得に失敗した場合も他方の対象結果を保持し、評価Scopeを不完全としてレビューへ送る。
- Health Advisoryの非推奨・Retirement以外を含む入口は`infra/ingestion.bicep`。承認済み監視RGへSubscriptionごとに配置する。通知Payloadは原本保存後、ARGから正規情報を再読取する。受信本文のIDや日付を正本として使わない。配送試験を実Retirement取得と同一視しない。
- Decision-1のDeployment、API設定、API MIへのFoundry限定推論権限を反映済み。実データ通知1件のv1応答に加え、合成3事例×3回の型・確率契約検証を完了（9/9成功、9/9 Unknownを含みAbstained相当）。これは判断精度の実証ではない。CLI利用者のCognitive Services UserはFoundryアカウント範囲に限定。説明モデルと実環境精度評価は未完了。応答契約不一致は原応答をAzureへ保存してUnavailable＋人間判断。採用契約は`packages/adapters/src/models.ts`、Prompt/Rule Versionはコードで追跡する。別モデルへの自動切替はない。
- Unknown／Possible／Verification Requiredまたは確認フラグ付きConfirmedは分類理由・不足属性をレビュー欄に示す。説明モデル未設定・利用不可の場合は、未確定理由とEvidenceから確認タスクを決定的に生成する。いずれもRecommendedの確認であり、移行必須やAzure変更ではない。
- Microsoft公式Evidenceの「日本語の参考訳を表示」は利用者操作時だけ実行する。訳文はAzure内に版付きでキャッシュされ、判断・Evidence・承認Hashには使わない。原文と公式リンクを必ず残し、判断時は原文を確認する。翻訳の失敗・未設定は原文表示を維持し、公式Evidenceの取得失敗として扱わない。
- 無関係なHealth Advisoryを自動的に対象外へ分類しない。Reviewerが訂正欄で対象外を選ぶ場合、公式分類は保持し、理由をHuman Evidenceとして記録する。対象外の新版は優先度・作業案を空にし、承認・外部登録を拒否する。誤判定を訂正するときは根拠を確認して対象／未確定へ再評価し、以前の承認を再利用しない。
- 説明モデルはJSON Schema対応とMIを確認。Resource/Workload/Ownerは別名化し、選別済み構成属性だけ送る。公式本文に機密が混ざらないことをSP-04で確認する。現在は外部URL本文の自動取得を行わない。
- 外部Issue作成の成否が不明でOutboxが`Sending`の場合、Queue再試行で`<!-- arp:<Work Item ID> -->`をIssue一覧から照合する。見つかった場合のみ既存Issue IDを保存してProject追加へ進み、見つからない／一覧検索が不完全な場合は状態を`Sending`のまま保留し、新規Issueを作成しない。検索可能範囲・権限エラーを確認し、安易にOutboxを`Pending`へ戻さない。Issueが`IssueCreated`でProject追加だけ失敗した場合は保存済みIDからProject追加を再試行する。
- 日付は人間が公式情報を確認して訂正画面へ入力。4マイルストーンを分離し、適用期限・必要日数で余裕と優先度を再計算する。訂正は新版になり旧承認は使えない。原モデル判断・説明は原出力として別欄に残る。
- 個人の非公開Projectを作成し、GitHub Tokenの最小権限をSP-05で試験。RepositoryのIssue作成権限と個人Projectの追加権限は別。`GITHUB_OWNER/REPOSITORY/PROJECT_ID`を設定し、モデルの意味的根拠と作業をレビューした後に外部登録を有効化する。
- 承認済み作業Issueは作業項目のタイトル、説明、完了条件、前提、依存ID、担当候補、日程、根拠IDを日本語で表示し、対象Resource IDとメールアドレスは本文から伏せる。自由文はGitHubへ複製されるため、Issueは非公開Repositoryを使い、公開前に出力範囲を確認する。人が編集する本文領域は管理領域の外に残す。
- Issue階層は「Retirement×Workloadの親Issue → 影響確認／設計／変更／テストのフェーズIssue → 承認済みWork Item Issue」。作業カテゴリとフェーズの対応表は`packages/adapters/src/github.ts`を参照する。作業がないフェーズIssueは作らない。親・フェーズIssueは作業Issueと同じRepository／Projectへ追加する。Projectで親子関係を見せる場合は`Parent issue`と`Sub-issues progress`も表示する。
- 優先度ラベルはP1=`Priority: High`、P2/P3=`Priority: Medium`、P4=`Priority: Low`。未確定はラベルを付けない。ARPが必要なRepositoryラベルを不足時に作成し、Issueへ追加する。Projectの単一選択Priorityフィールド（P1〜P4）は別属性として従来通り同期する。ProjectのLabels列を表示すると優先度ラベルを確認できる。
- 親・フェーズIssueにも安定相関マーカーを付け、Table OutboxへIssue ID、数値ID、Issue番号、URLを保存する。`Sending`中に作成応答が不明になった場合はマーカー検索で再照合し、見つからなければ再作成せず保留する。Sub-Issue追加とProject登録は毎回既存関係／Project itemを照合してから実行する。親またはフェーズIssueのCloseだけでWork Itemを完了扱いしない。
- 現在、GitHub Issue labelの読取・追加・削除、Repository label作成、Sub-Issue参照・作成にRepositoryのIssues writeが必要。Project登録・項目更新は別途Project writeが必要。PoCのclassic PATは現行の`repo`／`project`権限で必要範囲を含む。実運用GitHub Appには対象RepositoryのIssues writeとProject writeを設定する。
- ProjectのStatusフィールドは15分ごとに任意同期できる。`PROJECT_PROGRESS_SYNC_ENABLED`は既定でfalse。設定済みStatus field IDだけを読み、Issueと対応する内部Outboxへ外部Status名・option ID・取得時刻を別属性として保存する。承認・評価状態・Issue本文は変更せず、ProjectのDoneだけで自動クローズしない。認証済み`GET /api/project-progress`とレビュー画面の各作業項目で取得済みStatusを確認できる。未同期は完了を意味しない。

## 5. リリースと障害対応

CI成果物はmain push成功のrun IDに結び付く。手動CDは現在mainと同じSHAだけを受け付け、What-ifのHashを再計算。想定しない削除・不明差分は適用しない。What-ifは権限を要する処理でありPR CIでは実行しない。初回後もBootstrapのロール変更は通常CDに含めない。

Storage Queueの再試行は5回で`assessments-poison`／`exports-poison`へ。原因・相関を確認してから再投入する。受信OutboxはPendingを定期配送する。評価はイベント版と構成Hashで重複を抑止。古い通知は現行評価を巻き戻さない。現状は全件100評価をUIの上限とするため、増加時はページングを追加する。

GitHubはIssue作成前にOutboxを`Sending`へ条件更新する。作成応答不明でSendingが残った場合は盲目的再作成しない。許可された管理者が相関マーカー`<!-- arp:<id> -->`で対象Repositoryを照合し、Issue IDを記録して`IssueCreated`からProject追加だけ再開する。見つからなくても、作成されていないことを確認してから再実行する。Project失敗は保存済Issue IDで再開する。同じ作業への再承認でIssueを増やさない。

API・評価Queue・日次同期・Receipt/Export outboxの処理失敗は、App InsightsへJSONの`ProcessingFailure`として`stage`、`correlationId`、`errorType`のみ記録する。例外メッセージ、スタック、要求本文、Resource IDはログへ出さない。APIは同じ相関IDを503応答に返す。背景処理は記録後に例外を再送出し、Functionsの5回再試行とPoison Queueへの移動を維持する。App Insightsで`ProcessingFailure`、401/403、429、Poison、依存待ちを監視する。Queue invocation IDとアプリ相関IDの実環境での結合、Poison再投入、業務KPIのDashboard／通知／専用画面は未検証。実PayloadはBlob/Tableのみ、CI成果物には残さない。

## 6. 費用と撤去

APIの日次モデル呼出枠は200件で、同時予約をETagで制御する。要求ごとのToken上限は設けない。PoC累計20,000円は利用者がCost Managementで監視する。アプリによる金額ハード停止は実装しない。Cost ManagementのBudgetは通知用で、利用量停止機能ではなく課金データも遅延する。Foundryモデルの費用とFunctions、Storage、ログを含むRG費用を手動で確認する。

作成台帳は許可Azure保存先で、ID/Scope/所有者/専用・共有/削除方法/資格情報/依存を記録する。PoC終了時に専用RG、別Scopeの通知・RBAC・Federation・App登録、個人Project/Issue、秘密・実データを照合して削除する。自動的なRG削除Workflowは作らない。Key VaultのSoft Deleteは7日であり即時物理削除を保証しない。サービス側保持と残費用を記録する。コード・設計・合成fixtureを残す。

## 参考・未確認

- [Functions Flex](https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to)、[MIのプラットフォームHTTP仕様](https://learn.microsoft.com/azure/app-service/overview-managed-identity)。MIは公式のローカルEndpointを使用し、CLI/環境SecretへのFallbackを持たせない。@azure/identityの依存監査に不適合があり、当該依存を採用しなかった。公開EndpointへTokenを要求しない試験を持つ。
  - [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)。モデル配置・API Managed Identity推論・v1応答契約を実データで確認済み。合成3事例×3回の契約検証も合格。実環境の判断品質評価は未完了。
- [ARG REST](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources)。APIの実契約とライブ可否はSP-02で照合する。
- [Service Health Tracking IDとAdvisor対象のARG関連付け](https://learn.microsoft.com/azure/service-health/service-retirement-unified-impact-queries)、[Advisor recommendationStatus](https://learn.microsoft.com/azure/advisor/advisor-azure-resource-graph)。公開仕様に基づくKQL契約テストは実施済み。2026-10-26に構成SubscriptionのARG REST集計でretirement recommendationはCompleted 1件、New／InProgress／Postponed 0件、retirement metadataは0件だった。正の関連付けはないため、trackingId→recommendationTypeIdの実データShape・精度・網羅性は未検証であり、結果0件を影響なしと解釈しない。
- 機能の詳細な残作業は[実装バックログ](implementation-backlog.md)。本Runbookを完了していない段階で登壇デモやPoC成立を宣言しない。

## Foundry Bootstrap

`infra/bootstrap/foundry.bicep`は既存Foundry／Projectを参照し、Microsoft-Decision-1と説明用GPT-6 Lunaのdeploymentを宣言する。Lunaは`gpt-6-luna` version `2026-09-22`、`DataZoneStandard`、capacity 3を既定とする。既存リソースのサーバー管理プロパティを削除しないことをWhat-ifで確認する。deployment変更は容量・価格・利用可能性に影響するため、適用前にカタログ、クォータ、費用を確認する。API Managed Identityの推論ロールは`infra/bootstrap/permissions.bicep`がFoundryアカウント範囲で付与する。アプリから説明LLMを有効化するには、deploymentのRunning確認後、Repository Variablesの`EXPLANATION_ENDPOINT`（Foundry account endpoint）、`EXPLANATION_DEPLOYMENT`（deployment名）、`EXPLANATION_MODEL_VERSION`（モデル版）を設定し、通常のPoC CDで反映する。

### 2026-11-03 GPT-6 Luna 配置・接続確認

- Foundry `arp-foundry-0e2e4716`（East US 2）のカタログに`gpt-6-luna` version `2026-09-22`、`DataZoneStandard`があり、モデル情報の`maxCapacity`は3。capacity 1のWhat-IfはLuna deployment作成のみで、Decision-1に変更なし。
- `infra/bootstrap/foundry.bicep`で`arp-explanation-gpt-6-luna`を作成。deploymentは`Succeeded`／`Running`、SKU `DataZoneStandard`、capacity 1。Bicep What-Ifは両モデルdeploymentがNoChange。
- API Function Appへ説明Endpoint／Deployment／Model Versionを反映し、Manual PoC deployment run [41467404738](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41467404738)が成功。API Managed IdentityのFoundryアカウント範囲`Cognitive Services User`割当を確認。
- Azure CLI利用者の委任トークンで合成テキストを送り、Chat CompletionsとJSON Schema応答を確認（172 tokens）。これはAPI Managed Identity経由の呼出しや、アプリ固有の説明Schema／実通知の説明品質を検証したものではない。既存の合成UATは引き続きDecision-1のみを呼び説明LLMを呼ばない。Governance限定の実通知再評価をDecision-1と説明LLMの両方を呼ぶ検証経路として拡張中。

### 2026-11-03 PR #102 配置後の実通知再評価

- main commit `1ded83af9162e237143b66858277582613086613`のCI [#41547228604](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41547228604)成功成果物を使用。CD Plan [#41547452148](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41547452148)のWhat-If SHA256は`5f5608b59adc90956c198cb769e4ae719cc99f65281d655a1ff4021d3d1d05db`。専用RG内Application Insights／API Function／Exporter Functionの3件Modify、Create／Deleteなし。ApplyとAPI／Exporter配置は[CD #41547772735](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41547772735)で成功。
- APIのtest mode／decision reevaluationはtrue。Decision-1 endpoint／deployment／versionとGPT-6 Luna endpoint／deployment`arp-explanation-gpt-6-luna`／version`2026-09-22`をFunction App設定で確認。モデル呼出し上限は200/日。
- Governance利用者がAPIへテスト再評価を1回依頼し、保存済み実通知・構成候補を用いた。対象Azureへの再取得・変更、作業承認、GitHub登録はなし。Decision-1はSucceeded／Abstained、説明LLMはFailed／HTTP 400／InvalidResponse、Assessment検証エラー0件。元の実通知と履歴は保持。
- 保存された失敗記録にはモデル応答本文がなく、Application Insightsにも対象のHTTP dependency記録を確認できなかった。アプリのZod Schemaをローカル生成して調べると、Azure Structured Outputsで非対応と記載された`maxItems`、`minLength`、`pattern`、`format`、数値境界等の制約が含まれ、さらに`workflowRouting`が任意プロパティだった。MicrosoftはStructured Outputsで全プロパティをrequiredとし、JSON Schemaの一部キーワードを使わないよう案内している（[公式仕様](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs)）。これをHTTP 400の有力原因と推定するが、非記録のprovider error bodyを根拠とする確定診断ではない。
- SchemaをAzure互換に整形して送信し、内部routingはモデル出力から除外、受信結果は既存Zod Schemaで引き続き完全検証する修正を作成中。修正版がmainへマージ・配置され、実通知再評価で説明LLM Succeeded、10区分と作業案がSchema検証を通るまで、API MI説明生成と実説明品質は未完了として扱う。

### 2026-11-03 PR #103 配置後の再評価とGPT-6 Luna容量

- PR #103のStructured Outputs Schema修正を含むmain commit `612a56b4c2bbd0fa13e1e438d4f814cd64396c4c`を[CI #41550736477](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41550736477)と[CD #41551188892](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41551188892)で検査・配置。
- 2026-11-03に保存済み実通知1件をAPI Managed Identity経由で再評価。Decision-1はSucceeded／Abstained。説明LLMはHTTP 429／Throttledとなり、Structured Outputs応答の受信・Schema検証には到達しなかった。実説明品質とSchema互換性の実呼出し確認は未完了。
- Foundry上でGPT-6 Lunaの旧容量1、DataZoneStandardクォータ上限100・使用1、モデルカタログの最大容量3を確認。PR #104のBicep変更を適用し、容量3、3 requests/minute・3,000 tokens/minute、deployment Running／Succeededを確認。適用What-IfはDecision-1 NoChange、Lunaの`sku.capacity`と`properties.currentCapacity`のみModify、Create／Deleteなし。クォータ使用量は3/100。
- PR #104の追加変更では、GPT-6 Lunaを維持したまま`max_completion_tokens`を1,500へ下げ、モデルへの作業案を重要度順で最大5件・簡潔な記述に制限する。10区分のExplanation Schemaと元通知／Evidence入力は維持し、繰り返されるClaim定義をJSON Schema `$defs`参照へまとめてSchemaを7,402から3,579文字へ縮小する。MicrosoftはStructured Outputsの`$defs`／`$ref`をサポート対象としている（[公式仕様](https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs)）。これは容量3（3,000 TPM）に合わせる要求量調整であり、prompt token数もレート制限見積もりに含まれるため、HTTP 429解消を保証しない。PR merge・配置後、実通知再評価でExplanation SucceededとSchema検証通過を確認するまで未解決として扱う。

### 2026-11-03 GPT-6 Luna説明要求の入力圧縮

- PR #104配置後の実通知再評価もHTTP 429／Throttledとなったため、説明モデル要求だけに適用する長文抜粋を実装。通知本文、Evidence fact、milestone scope、リソース分類理由を先頭／末尾中心に制限し、Decision確率分布と説明に不要なモデル／Prompt／Rule識別子を送信対象から除く。
- 元Assessment、保存Evidence、Decision-1入力、Evidence ID・公式URL・全Evidence行・構成識別／型付き属性・選択済みDecision項目は保持する。抜粋したテキストは省略部分を推測しないようモデルへ明示する。これは要求のトークン量を抑える対策であり、3,000 TPM内に収まることや429解消を保証しない。
- PR #105をmain commit `24999ec7771cd487bbb5939564f761f8d66a9e69`でマージ。main CI [#41563758186](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41563758186)成功後、手動CD Plan [#41563890450](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41563890450)とApply／API・Exporter配置 [#41564072345](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/41564072345)が成功した。Plan Hashは`5f5608b59adc90956c198cb769e4ae719cc99f65281d655a1ff4021d3d1d05db`で、専用RG内Modify 3、NoChange 19、Ignore 5。Create／Delete／Unsupported／Deployはなし。
- 配置後、サイトHTTP 200、認証済みAPIでtest mode／decision reevaluation／Governance権限を確認。保存済み実通知の現行1件を再評価（Run `3f488fd2-4f9c-4a05-9d3b-dfbbdb2e5fac`）。Decision-1はSucceeded、説明段階は`InvalidResponse`／HTTP statusなしでRun Failed。HTTP 429は再現しなかったが、説明LLMの10区分／作業案Schema検証には到達したと確認できず、実説明品質も未確認。Snapshot保持、Assessment検証エラー0、作業項目1件（フォールバック）を確認。Azure対象再取得・変更、承認、GitHub登録はなし。
- Application Insightsの直近traces／exceptions／dependenciesには該当記録がなかった。原因確認のため、Bicepで`records`コンテナの該当`model-raw` Blob 1個だけを直接読める条件付きStorage Blob Data Readerを一時付与し、`Blob.List`を拒否した状態で診断した。確認後すぐにロール割当を削除し、恒久的なRBAC変更はない。モデル本文は出力・転記していない。
- 保存応答の安全なメタデータは`finish_reason=length`、本文0文字、拒否応答なし、prompt 2,425 tokens、completion上限1,500 tokensの全量がreasoning、合計3,925 tokensだった。`max_completion_tokens`はreasoningと可視回答に共通の上限であり、reasoningが全枠を消費して空の本文を返し、その後のJSON解析が`InvalidResponse`となったことが失敗原因。Microsoft公式仕様はChat Completionsでreasoning tokensも`max_completion_tokens`に含まれること、`reasoning_effort`が利用量を抑える制御であることを説明している（[Reasoning models](https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning)）。
- 修正として説明要求に`reasoning_effort=low`を明示し、`finish_reason=length`／空本文をJSON解析前に検出して失敗を明確にする。出力上限1,500、10区分Schema、作業案上限5件は維持する。修正版PRのCI後、マージ・配置した上で保存済み実通知を1件だけ再評価し、可視応答・Schema検証・Token使用内訳を確認する。実際の修正後応答と説明品質は未確認。

[GitHub OIDCのimmutable subject仕様](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)

## 認証障害の診断

`infra/bootstrap/auth-diagnostics.bicep`にAPI名と既存Workspace名を渡すと、AppServiceAuthenticationLogsだけを専用Log Analyticsへ送信する。認証コールバックの障害はアプリの手前で発生するため、App Insightsの例外0件だけでは正常と判断しない。初回同意後のコールバック、API内のJWT検証、Storage読取をそれぞれ確認する。認証ログは実環境の監査データとしてAzure内で管理し、GitやCI成果物へ複製しない。

BicepのbooleanをApp Settingsへ渡す際は`toLower(string(value))`で`true`/`false`へ統一する。アプリの厳密比較と表記が一致することを実設定でも確認する。

## Service Healthの実応答形式

ServiceHealthResourcesの`LastUpdateTime`は数値で返る場合がある。ARGの投影で`tostring(todatetime(tolong(properties.LastUpdateTime)))`をISO日時へ変換し、JavaScriptへ渡す前に大きな整数の精度損失を避ける。ISO文字列の応答も保持する。識別子・日時が不正な通知は推測で補完せず部分失敗として扱い、画面に取得範囲の不完全性を表示する。更新日時はRetirement日として使用しない。

[Microsoft公式のService Healthクエリ例](https://learn.microsoft.com/azure/service-health/resource-graph-samples)

## 2026-10-26 実データ確認

専用PoC環境へmainの検査済み成果物を再配置し、Entra認証済み画面で「Azure情報を取得・評価」を実行。Health Advisory 7件と対象Subscription内の構成2件を取得した。Service Healthの`LastUpdateTime`は数値ticksを含み、ARGで日時へ変換してから処理する。初回の7評価はモデル接続前のUnavailableとして保存された。接続後に再同期し、通知一覧と評価詳細を更新した。実データの1評価で`microsoft-decision-1 / 1 · Abstained`を表示し、判断確率の人間確認を残した。これはモデル疎通と応答処理の確認であり、3事例×3回の品質評価完了を意味しない。説明モデルは未接続。外部Project登録、Advisor明示関連、Action Group配送、Poison Queue復旧、業務訂正／承認のUATは未検証。画面上の実データやResource IDをログ・Gitへ転記しない。

## 2026-10-26 Microsoft-Decision-1配置

`arp-foundry-0e2e4716` に `arp-decision-1`（Microsoft-Decision-1 version 1、DataZoneStandard、capacity 500）を配置し、Runningを確認した。Deploymentのサービスレートは500 requests/minute・500,000 tokens/minuteで、要求ごとの生成トークン上限ではない。API endpoint／deployment／model versionをBicepへ設定し、API Managed IdentityへFoundryアカウント範囲のCognitive Services Userを付与した。実通知の1評価でversion 1の有効応答（Abstained）を確認し、合成3事例×3回も9/9契約検証を通過した。後者は精度保証ではなく、結果詳細は`docs/spike-and-testing.md`に記録する。CLI利用者へはCognitive Services UserをFoundryアカウント範囲で付与した。Unknownや不確実性を解消せず、すべての作業項目は引き続き人間承認を要する。説明用LLMは未設定。モデル呼出枠は200/日、要求単位Token capなし。利用者がPoC累計20,000円をCost Managementで確認し、アプリ側の金額ハード停止は実装しない。Cost Managementのbudgetは通知用で、課金停止機能ではなく反映に遅延がある。

## テストモードと実通知1件のモデル再評価

- `ARP_TEST_MODE_ENABLED`、`ARP_SYNTHETIC_UAT_ENABLED`、`ARP_DECISION_REEVALUATION_ENABLED`はRepository Variablesで指定し、すべて未設定時false。合成UATとモデル再評価の各操作は、共通の`ARP_TEST_MODE_ENABLED=true`に加えて個別フラグもtrueの場合だけ画面へ表示される。変更はBicep経由の手動CDが必要。
- 再評価はGovernance App roleのユーザーだけが実行可能。最新の実Service Health評価レコード1件（通知・Workload単位）を指定し、理由を入力する。合成UAT、対象外、非Current、調査範囲Snapshotのない旧レコードは拒否する。
- キュー処理は保存済みAssessmentのResource/Evidence/scopeを読み、Decision-1と説明LLMを最大各1回呼ぶ。モデル入力ではResource ID、Owner Team、Workload IDを別名化し、Resourceのopen-ended propertiesは送らない。通知本文・根拠・型付き構成属性・判断を送信する。ARG再取得、評価対象変更、作業承認、GitHub登録は実行しない。日次モデル呼出枠を使用し、両方の呼出とSchema検証が成功した場合だけ再評価RunをCompletedにする。結果は新Assessmentとして保存し、旧承認は再利用できない。
- テスト再評価Assessmentは参照専用。画面の訂正・承認操作を隠し、APIでも訂正と承認を拒否する。Store層も再評価Assessmentから外部Outboxを作らない。
- 同じAssessmentに対する並列再評価はTable lockで防止する。処理が20分以上停止した場合は失敗状態として記録し、自動でモデル再実行はしない。必要なら画面から新しい理由で明示的に再依頼する。
- 実施前に`MAX_MODEL_CALLS_PER_DAY`とPoC累計予算の残額を確認する。Decisionと説明のためモデル呼出枠を最大2件消費する。PoC上限のCost Management確認と無断増額禁止は従来どおり。呼出上限到達・モデル失敗は実行記録に失敗理由を残す。
- 表示専用のテストモードであり、データ分離や削除は行わない。フラグを無効化すると合成UAT関連画面は通常一覧・集計から隠れるが、記録自体は保持される。

### Decision-1を含む合成UAT

- `ARP_TEST_MODE_ENABLED=true`と`ARP_SYNTHETIC_UAT_ENABLED=true`で有効化する。画面の「合成UATを作成・Decision-1評価」は最大1回のDecision-1推論を実行し、通常のモデル呼出枠を使用する。成功済みの合成評価がある場合は再利用し、二重推論しない。
- `groundedInput`で架空Resource IDを別名化し、Service Health本番経路と同じ`decide`アダプター、Decision応答Schema、原応答／結果保存、Decision監査、ルールによる優先度適用を通す。イベントは`ARP-SYNTHETIC-UAT-001`、EvidenceはInternalのまま保持する。
- Azure通知取得、Resource Graph実インベントリ取得、説明LLMはこの経路では行わない。説明LLMを`NotRequired`として記録し、Decision-1の型付き結果を合成作業項目・Issue本文へ表示する。これは実通知・実環境・公式事実の検証ではない。
- 人間が合成UAT作業を承認するまでGitHub登録は拒否する。承認後も通常Outboxは使用せず、専用UAT Exporterで親／フェーズ／作業Issue、Sub-Issue関係、Project登録を実行する。Issue登録前にDecision呼出成功を検証する。
- 合成UAT記録でのみGitHub接続確認を行う。実リソースや実通知と混同しない。標準手順と確認項目は[合成UAT手順](synthetic-uat.md)を参照する。

## GitHub Project フィールド同期

- PoCのGitHub Project設定はRepository VariablesからBicepへ渡す。`ARP_GITHUB_OWNER`、`ARP_GITHUB_REPOSITORY`、`ARP_GITHUB_PROJECT_ID`、`ARP_GITHUB_PROJECT_STATUS_FIELD_ID`、`ARP_GITHUB_PROJECT_STATUS_TODO_OPTION_ID`を設定し、GitHub TokenはAzure Key Vaultの`github-token` secretにのみ保存する。`ARP_EXPORT_ENABLED=true`はレビュー済み作業からIssue／Project itemを作るための明示的な有効化で、未設定時はfalseとして扱う。`ARP_PROJECT_PROGRESS_SYNC_ENABLED=true`は15分ごとのStatus読取を有効化する。デプロイworkflowは外部登録／進捗同期が有効な場合に必須設定を事前検査する。
- PoCのProjectにはStatusフィールドのみ設定する。Priority欄にP3／P4 optionがないProjectではPriority field IDを渡さず、項目同期失敗を防ぐ。Status初期値には`Backlog` optionを使う。PriorityやDue date同期を追加する場合は、対応する全option／field IDが存在することを確認してから設定する。
- GitHub Tokenは対象RepositoryのIssue作成・読取と、対象Projectの読取・追加・項目更新に必要な権限を持たせる。CLIの認証TokenとAzure Key Vaultの`github-token`は別の資格情報である。Tokenの値をRepository Variables、Source、CLI引数、ログに出さない。
- 現在のPoCの`test-project`は個人所有Projectである。PoCではGitHubのSettings → Developer settings → Personal access tokens → Tokens (classic)から専用PATを人間が発行し、`repo`と`project`スコープを付ける。`repo`は対象Repositoryだけでなく、PAT所有者がアクセスできる非公開Repository全般への権限を含むため、短い有効期限を設定し、必要期間だけ使用してPoC終了後に失効させる。`gist`、`read:org`、`workflow`はこのアプリ連携には付与しない。Fine-grained PATは非公開RepositoryのIssue作成には使えるが、個人所有Project V2のREST APIに制約があるため、現行の個人Project構成ではclassic PATを使用する。
- GitHub CLIで`gh auth status`が成功しても、それはCLIの認証確認であり、Azureアプリが使う`github-token` Secretの存在・値・権限を証明しない。CLI Tokenをアプリへ流用せず、専用PATを発行する。発行者がGitHub画面からToken値をコピーし、Azure PortalのKey Vault → Secrets → Generate/ImportでSecret name=`github-token`として登録する。既存Secretがある場合は新しいversionを作成する。値はこの手順書や運用記録に記載しない。
- Key VaultのSecret登録後、APIのManaged IdentityによるSecret読取権限とFunction AppのKey Vault参照解決を確認する。GitHub Tokenを登録しただけではIssue登録は開始されない。`ARP_EXPORT_ENABLED`はfalseを維持し、Outboxの未配送件数・対象を確認してから、明示的に有効化する。既存の承認済みOutboxがある場合、trueへの変更でそれらも配送対象となり得るため、今回のテスト分だけに限定できる状態を先に確認する。

### 未配送Outboxを確認する

`ARP_EXPORT_ENABLED=true`を適用する前に、`ArpState`テーブルのPending Outboxを確認する。APIの承認処理は外部登録が無効な間もOutbox行を保存する。APIの5分タイマーは外部登録が有効ならPending行をすべてExporter Queueへ送るため、対象が今回の作業だけだと確認できるまで有効化しない。

1. `az account set --subscription 0e2e4716-cd54-4047-91c2-de3cc0efc760`で配置先Subscriptionを選び、`az account show --query '{subscription:id,tenant:tenantId,user:user.name}' --output json`でサインイン主体を確認する。
2. `az functionapp config appsettings list --name arp-api-dxkm4fajusgd4 --resource-group rg-ms-decisions-test --query "[?name=='DATA_STORAGE_ACCOUNT'].value | [0]" --output tsv`でデータStorage Account名を取得する。現行名は`arpdatadxkm4fajusgd4`。
3. 読取主体のObject IDを`az ad signed-in-user show --query id --output tsv`で取得する。`infra/bootstrap/outbox-table-reader.bicep`はそのユーザーに対し、`ArpState`テーブルだけをScopeとした`Storage Table Data Reader`を付与する。`az deployment group what-if --resource-group rg-ms-decisions-test --template-file infra/bootstrap/outbox-table-reader.bicep --parameters dataStorageName=<DATA_STORAGE_ACCOUNT> principalObjectId=<USER_OBJECT_ID>`で、追加されるRole Assignmentがこのテーブルとユーザーに限定されることを確認してから、同じ引数で`az deployment group create`を実行する。実行者にはこのScope以上で`Microsoft.Authorization/roleAssignments/write`が必要。通常CDのIdentityには付与しない。
4. RBAC伝播を待ってから、次の読取クエリを実行する。`--query`はOutboxの確認に必要な列だけを表示する。

   ```powershell
   $dataStorageAccount = 'arpdatadxkm4fajusgd4'
   az storage entity query --account-name $dataStorageAccount --table-name ArpState --auth-mode login --filter "entityKind eq 'outbox' and state eq 'Pending'" --query "items[].{state:state,assessmentId:assessmentId,itemId:itemId,approvalId:approvalId}" --output table
   ```

5. Pending件数と対象Work Itemを照合し、今回承認した1件だけであることを確認する。別の項目があれば、登録対象を整理してから進める。結果には内部IDが含まれるため、チャット、Issue、PR、CIログへ貼り付けない。
6. 確認後も読み取り権限が不要なら、`az role assignment delete --scope <assignmentScope> --name <assignmentId>`で付与を取り消す。Object ID、Scope、Assignment IDはBicep出力で確認し、広いScopeで削除しない。

- 本番運用では個人PATの常設を避け、対象Repositoryへ限定してインストールするGitHub Appへ移行する。Appの作成・権限承認・秘密鍵の初回登録は管理者が行い、アプリ側をInstallation Tokenの短期発行・更新方式へ改修する必要がある。これは現在の静的`github-token`方式では未実装。
- 外部Issue／Projectへの登録は既定で無効のまま。実運用前にProjectのStatus、Priority、Due dateフィールドを用意し、field IDと各Status/Priority option IDを検証する。
- IDは`GITHUB_PROJECT_*`のBicepパラメーター／Function App設定で管理する。Tokenや秘密はKey Vaultに置き、フィールドIDは機密情報として扱わない。既存Project itemの照合にはGitHub ProjectのRead権限（`read:project`相当）が必要で、Issue更新にはRepository Issues write、Project更新にはProject write権限が必要。
- Priority option IDはP1〜P4を個別に設定する。Due dateは公式に確認された期限だけを設定する。未確定値や空値はProjectへ書き込まない。
- Statusの初期値はProject itemの新規追加時だけ設定する。再承認や改訂ではStatusを上書きせず、担当者がProjectで進めた状態を保つ。
- Issue本文は`<!-- arp:managed:start -->`と`<!-- arp:managed:end -->`の間だけ更新する。前回Hashと異なる管理領域の変更を検知した場合は停止し、外部本文を上書きしない。区切りのない既存Issueは自動更新せず、人間による移行が必要。
- Issue更新後は管理本文HashをOutboxに先に保存し、Project APIが一時失敗してもIssueを重複作成・再更新しない。Project登録を再試行する際はProject内の既存Issueを照合する。
- GitHub ProjectのフィールドIDやoption ID、外部APIのアクセス権が未検証の場合、ExportはエラーとしてQueue再試行／Poisonへ流す。設定不足を空の成功として扱わない。


### GitHub Project進捗の取込

- 進捗の読取は`PROJECT_PROGRESS_SYNC_ENABLED=false`が既定。Project IDとStatusフィールドID、およびTokenのProject読取権限を確認してから、個別に有効化する。
- 15分ごとにProject itemを全ページ読取し、設定されたStatusフィールド値だけを内部Outboxへ保存する。Issue内容・承認・作業の完了状態は更新しない。
- Status optionの表示名とoption IDをそのまま監査用進捗として保存する。企業固有の値をARPの承認・検証状態へ自動変換しない。
- `/api/project-progress`はEntra認証を要求し、レビュー画面に登録済作業項目ごとの最終取込Statusを表示する。`未同期`は未登録、未出力、同期無効、同期未実行のいずれかであり、完了を意味しない。
- Project read権限不足、API制限、ページング不備は同期失敗として記録し、前回値を保持する。失敗時にProject状態を空にしない。

### 2026-11-02 実環境検証記録

- 保存済みのFoundry Agent Service実通知1件を、認証済みAPIから再取得・再評価した。事前にPending Outboxが0件であることを確認し、対象Assessment IDだけを指定した。同期APIはHTTP 202、現行Health Advisory 0件、Resource Graph inventory 5件、再評価対象1件、`scopeComplete=true`、取得失敗0件を返した。
- Queue完了後の新版にはCognitive Services account 1件とCognitive Services project 1件のみが候補として表示された。両候補は`Verification Required`、Decision-1はSucceeded／Abstained、説明LLMはNotConfigured、レビュー必須、検証エラー0件。これは候補フィルターと評価の実動作を確認した結果であり、対象影響の確定やAdvisor正相関の証明ではない。
- 既存の合成UATは`Exported`／`completed`で親・フェーズ・作業Issueの3リンクを保持していた。認証済みAPIから同じ登録を再送するとHTTP 200と`alreadyExported=true`が返り、重複Issueを作成しなかった。GitHub CLIへProject readを追加後、GraphQLで`test-project`を直接読取し、Issue item 7件・次ページなしを確認した。現在の親Issue #82、フェーズIssue #84、作業Issue #85に加え、旧合成テストIssue #66もProject内に残っていた。合成UAT関連4件のStatusはすべて`Backlog`。旧Issueは削除していない。
- この時点で`PROJECT_PROGRESS_SYNC_ENABLED=false`。15分周期のProject Status取込は起動せず、ARPによる実Status同期とレビュー画面の同期表示は未検証。GitHub CLIでのProject直接読取は可能だが、設定変更・デプロイは行っていない。


## ProcessingFailure監視とPoison Queue復旧

- `processingFailureAlertsEnabled`は既定false。専用RGの運用監視を整えた後、`processingFailureAlertActionGroupId`にAction GroupのResource IDを指定して有効化する。Action Group未設定時はAzure Monitor上のAlertだけが作成され、通知先はない。アラートはApp Insightsの直近5分にあるサニタイズ済み`ProcessingFailure`を検知する。
- KQLで対象記録を調べる（本文、Resource ID、例外メッセージを追加でログ出力しない）。

```kusto
traces
| where timestamp > ago(24h)
| where message contains '"event":"ProcessingFailure"'
| summarize Failures=count() by bin(timestamp, 15m), tostring(customDimensions.stage), tostring(customDimensions.errorType)
| order by timestamp desc
```

- Poison Queueは`assessments-poison`と`exports-poison`をStorage Queue metrics／Portalで別々に確認する。Queue本文には識別情報があるため、画面共有・チケット・ログへ貼り付けない。
- 再投入前にfailure stage、Functions invocation、Storage Queueのdequeue count、Outbox state、承認Hashを照合する。ExporterではGitHub Issueのmarkerと保存済Issue IDを先に照合し、`Sending`が未解決の場合は再投入しない。IssueCreatedのProject失敗は既存Issueを確認してからProject段階のみを再開する。
- 原因を直し、対象メッセージが現行承認・現行評価へ結び付くことを確認後、OperatorがPoison Queueから個別に再投入する。再投入後に重複Issue、承認外登録、対象リソース変更がないことを確認し、時刻・相関ID・件数・結果を運用記録へ残す。現状、専用の自動再投入UI/APIはない。
- Alert発報は障害の調査開始を示すだけで、処理失敗の全件捕捉やPoison Queue到達を保証しない。Functions失敗、Queue深度、ARG throttling、GitHub 403/429と合わせて確認する。


## 2026-10-29 PR #56 配置記録

- main commit: `df34d2046202338a6a28f155ca8b86917cc97c2d`。CI run [#40792872416](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40792872416) 成功成果物を使用。
- What-if [#40793055079](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40793055079): 専用Resource Group内のApplication Insights、API Function App、Exporter Function Appの3件Modify、19件NoChange、5件Ignore。Create／Deleteなし。Plan SHA256 `5f5608b59adc90956c198cb769e4ae719cc99f65281d655a1ff4021d3d1d05db`。
- Apply／アプリ配置 [#40793281310](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40793281310) 成功。Bicep apply、API ZIP、Exporter ZIPの各stepが成功。
- 配置後の未認証GETはAPI root HTTP 401、Exporter root HTTP 200。これは匿名経路の認証応答確認であり、Entra認証済み画面、実データ評価、モデル品質のUATではない。
- PR #56の合成業務ワークフロープロファイル／テンプレートは実行時ポリシーでは無効。実在Workloadへのサンプル業務情報の適用や実Issue登録は行っていない。

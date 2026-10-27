# 初期構築・検証・運用手順

コードを動かすための手順。デプロイ済みという記録ではない。対象Azureリソースは読み取りのみ。本システム用の専用RGと、評価Scope、通知配置Scopeを台帳で区別する。

## 1. ローカル・CIでコードを確認

Nodeは`.node-version`、npmは`package.json`を使用する。

```sh
npm ci --ignore-scripts
npm run verify
az bicep build --file infra/main.bicep --stdout
az bicep build --file infra/ingestion.bicep --stdout
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
5. Repository Variablesに`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`、`AZURE_RESOURCE_GROUP`、`AZURE_LOCATION`、`AZURE_HOST_STORAGE_BLOB_ENDPOINT`、`ENTRA_CLIENT_ID`、`TARGET_SUBSCRIPTION_IDS`（カンマ区切り）、`DECISION_ENDPOINT`を設定。いずれも非機密設定で、秘密はVariablesへ入れない。
6. mainのCI合格後、Manual PoC deploymentの`plan`を起動して差分とHashを確認し、同じCI runで`apply`、`infrastructure_only=true`を起動。最初はアプリ配置を行わずMIと保管先を作る。
7. 管理者がoutputsを用いて`infra/bootstrap/permissions.bicep`を適用。データ用Blob/Queue/Table、ホストStorage、Key Vaultに用途別ロールを付与する。TranslatorもF0を既定としてデプロイし、出力の`translatorName`を`translatorAccountName`へ渡してAPI Managed IdentityへTranslatorリソース範囲の`Cognitive Services User`を付与する。Subscriptionに既存F0がある場合はS1等への変更費用を確認し、未確認のまま適用しない。ホストBlob OwnerはFunctionsホストの要件であり、評価対象へのOwnerではない。評価対象はAPIのMIに許可Subscription/MGのReaderを別途付与。Exporterには評価対象読取を与えない。Foundry呼出ロールはAPIのMIに対象Foundryアカウント範囲で付与する。
8. `entra-client-secret`をKey Vaultに直接保存。PoCのGitHub Tokenも必要になった時点で`github-token`へ保存し、有効期限と実権限を台帳へ記録。秘密をログ・CLI引数・Gitへ残さない。Secretを完全排除した設計とは主張しない。
9. Entraのcallbackを更新し、再度plan/applyを確認して`infrastructure_only=false`で検査済みの同一ZIPを配置。RBAC伝播・Key Vault参照成功を確認する。

## 3. 実接続を有効にする順序

- モデル接続リリース後は`MAX_MODEL_CALLS_PER_DAY=200`、同期/通知/外部登録はfalse。要求単位のToken上限は設定しない。`infra/main.bicep`とパラメーターへ構成を記録し、ポータル手修正を次のCDで消さない。
- 許可するサービスはBasic LB、GPv1、URL pingの3種。現在のARGは3リソースTypeを取得する。未知の条件の構成もUnknownとして残し、0件を影響なしにしない。Owner/Workloadのタグは`OwnerTeam`、`WorkloadId`、環境は`Environment`。データプレーンは取得しない。
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
- 現在のIssueは相関ID・分類・優先度・日程・Evidence IDのみを送り、自由文・実Resource IDを複製しない。詳細は認証画面で確認する。ProjectのStatusフィールドは15分ごとに任意同期できる。`PROJECT_PROGRESS_SYNC_ENABLED`は既定でfalse。設定済みStatus field IDだけを読み、Issueと対応する内部Outboxへ外部Status名・option ID・取得時刻を別属性として保存する。承認・評価状態・Issue本文は変更せず、ProjectのDoneだけで自動クローズしない。認証済み`GET /api/project-progress`とレビュー画面の各作業項目で取得済みStatusを確認できる。未同期は完了を意味しない。

## 4. リリースと障害対応

CI成果物はmain push成功のrun IDに結び付く。手動CDは現在mainと同じSHAだけを受け付け、What-ifのHashを再計算。想定しない削除・不明差分は適用しない。What-ifは権限を要する処理でありPR CIでは実行しない。初回後もBootstrapのロール変更は通常CDに含めない。

Storage Queueの再試行は5回で`assessments-poison`／`exports-poison`へ。原因・相関を確認してから再投入する。受信OutboxはPendingを定期配送する。評価はイベント版と構成Hashで重複を抑止。古い通知は現行評価を巻き戻さない。現状は全件100評価をUIの上限とするため、増加時はページングを追加する。

GitHubはIssue作成前にOutboxを`Sending`へ条件更新する。作成応答不明でSendingが残った場合は盲目的再作成しない。許可された管理者が相関マーカー`<!-- arp:<id> -->`で対象Repositoryを照合し、Issue IDを記録して`IssueCreated`からProject追加だけ再開する。見つからなくても、作成されていないことを確認してから再実行する。Project失敗は保存済Issue IDで再開する。同じ作業への再承認でIssueを増やさない。

API・評価Queue・日次同期・Receipt/Export outboxの処理失敗は、App InsightsへJSONの`ProcessingFailure`として`stage`、`correlationId`、`errorType`のみ記録する。例外メッセージ、スタック、要求本文、Resource IDはログへ出さない。APIは同じ相関IDを503応答に返す。背景処理は記録後に例外を再送出し、Functionsの5回再試行とPoison Queueへの移動を維持する。App Insightsで`ProcessingFailure`、401/403、429、Poison、依存待ちを監視する。Queue invocation IDとアプリ相関IDの実環境での結合、Poison再投入、業務KPIのDashboard／通知／専用画面は未検証。実PayloadはBlob/Tableのみ、CI成果物には残さない。

## 5. 費用と撤去

APIの日次モデル呼出枠は200件で、同時予約をETagで制御する。要求ごとのToken上限は設けない。PoC累計20,000円は利用者がCost Managementで監視する。アプリによる金額ハード停止は実装しない。Cost ManagementのBudgetは通知用で、利用量停止機能ではなく課金データも遅延する。Foundryモデルの費用とFunctions、Storage、ログを含むRG費用を手動で確認する。

作成台帳は許可Azure保存先で、ID/Scope/所有者/専用・共有/削除方法/資格情報/依存を記録する。PoC終了時に専用RG、別Scopeの通知・RBAC・Federation・App登録、個人Project/Issue、秘密・実データを照合して削除する。自動的なRG削除Workflowは作らない。Key VaultのSoft Deleteは7日であり即時物理削除を保証しない。サービス側保持と残費用を記録する。コード・設計・合成fixtureを残す。

## 参考・未確認

- [Functions Flex](https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to)、[MIのプラットフォームHTTP仕様](https://learn.microsoft.com/azure/app-service/overview-managed-identity)。MIは公式のローカルEndpointを使用し、CLI/環境SecretへのFallbackを持たせない。@azure/identityの依存監査に不適合があり、当該依存を採用しなかった。公開EndpointへTokenを要求しない試験を持つ。
  - [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)。モデル配置・API Managed Identity推論・v1応答契約を実データで確認済み。合成3事例×3回の契約検証も合格。実環境の判断品質評価は未完了。
- [ARG REST](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources)。APIの実契約とライブ可否はSP-02で照合する。
- [Service Health Tracking IDとAdvisor対象のARG関連付け](https://learn.microsoft.com/azure/service-health/service-retirement-unified-impact-queries)、[Advisor recommendationStatus](https://learn.microsoft.com/azure/advisor/advisor-azure-resource-graph)。公開仕様に基づくKQL契約テストは実施済み。2026-10-26に構成SubscriptionのARG REST集計でretirement recommendationはCompleted 1件、New／InProgress／Postponed 0件、retirement metadataは0件だった。正の関連付けはないため、trackingId→recommendationTypeIdの実データShape・精度・網羅性は未検証であり、結果0件を影響なしと解釈しない。
- 機能の詳細な残作業は[実装バックログ](implementation-backlog.md)。本Runbookを完了していない段階で登壇デモやPoC成立を宣言しない。

## Foundry Bootstrap

`infra/bootstrap/foundry.bicep`は既存Foundry／Projectを参照し、Microsoft-Decision-1 deploymentだけを宣言する。既存リソースのサーバー管理プロパティを削除しないことをWhat-ifで確認する。deployment変更は容量・価格・利用可能性に影響するため、変更前にカタログ、クォータ、費用を確認する。API Managed Identityの推論ロールは`infra/bootstrap/permissions.bicep`がFoundryアカウント範囲で付与する。

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

`[foundry-resource-name-removed]` に `arp-decision-1`（Microsoft-Decision-1 version 1、DataZoneStandard、capacity 500）を配置し、Runningを確認した。Deploymentのサービスレートは500 requests/minute・500,000 tokens/minuteで、要求ごとの生成トークン上限ではない。API endpoint／deployment／model versionをBicepへ設定し、API Managed IdentityへFoundryアカウント範囲のCognitive Services Userを付与した。実通知の1評価でversion 1の有効応答（Abstained）を確認し、合成3事例×3回も9/9契約検証を通過した。後者は精度保証ではなく、結果詳細は`docs/spike-and-testing.md`に記録する。CLI利用者へはCognitive Services UserをFoundryアカウント範囲で付与した。Unknownや不確実性を解消せず、すべての作業項目は引き続き人間承認を要する。説明用LLMは未設定。モデル呼出枠は200/日、要求単位Token capなし。利用者がPoC累計20,000円をCost Managementで確認し、アプリ側の金額ハード停止は実装しない。Cost Managementのbudgetは通知用で、課金停止機能ではなく反映に遅延がある。

## GitHub Project フィールド同期

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


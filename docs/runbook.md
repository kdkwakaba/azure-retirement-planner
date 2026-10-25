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
2. Entraの単一テナントApp登録を作成し、`Reader`、`Reviewer`、`Governance`、`Operator`（User）と`NotificationSender`（Application）のApp rolesを定義する。割当必須としユーザーを割り当てる。WebリダイレクトURIは`https://<api>.azurewebsites.net/.auth/login/aad/callback`。ID Tokenを使用するUIと、aud/issuer/tid/rolesを検証するAPIの両方を試験する。
3. Secure Webhookは専用サービスプリンシパルのアプリ権限に限定。Access Token v2と`idtyp=app`のoptional claim、audienceを合わせる。Action Groupsの実際の送信主体へのApp role割当をSP-03で確認する。未設定のまま匿名受付へ緩和しない。
4. `infra/bootstrap/oidc.bicep`でGitHub main branch subjectのUAMI/Federationを作成。GitHub APIから取得した`githubOwnerId`と`githubRepositoryId`も渡す。新規Repositoryのsubjectは`repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID:ref:refs/heads/main`であり、azure/loginが記録する実際のsubjectと完全一致させる。旧形式を使うRepositoryは実際の形式を確認してテンプレートを調整し、ワイルドカードへ緩和しない。通常CDのIdentityへ専用RGの必要なデプロイ権限を別途付与。Owner／権限付与権限は通常CDへ付けない。
5. Repository Variablesに`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`、`AZURE_RESOURCE_GROUP`、`AZURE_LOCATION`、`ENTRA_CLIENT_ID`、`TARGET_SUBSCRIPTION_IDS`（カンマ区切り）を設定。秘密はVariablesへ入れない。
6. mainのCI合格後、Manual PoC deploymentの`plan`を起動して差分とHashを確認し、同じCI runで`apply`、`infrastructure_only=true`を起動。最初はアプリ配置を行わずMIと保管先を作る。
7. 管理者がoutputsを用いて`infra/bootstrap/permissions.bicep`を適用。データ用Blob/Queue/Table、ホストStorage、Key Vaultに用途別ロールを付与する。ホストBlob OwnerはFunctionsホストの要件であり、評価対象へのOwnerではない。評価対象はAPIのMIに許可Subscription/MGのReaderを別途付与。Exporterには評価対象読取を与えない。Foundry呼出ロールは対象モデルの実仕様確認後、APIのMIに対象Foundryだけで付与。
8. `entra-client-secret`をKey Vaultに直接保存。PoCのGitHub Tokenも必要になった時点で`github-token`へ保存し、有効期限と実権限を台帳へ記録。秘密をログ・CLI引数・Gitへ残さない。Secretを完全排除した設計とは主張しない。
9. Entraのcallbackを更新し、再度plan/applyを確認して`infrastructure_only=false`で検査済みの同一ZIPを配置。RBAC伝播・Key Vault参照成功を確認する。

## 3. 実接続を有効にする順序

- 最初は`MAX_MODEL_CALLS_PER_DAY=0`、同期/通知/外部登録はfalse。`infra/main.bicep`とパラメーターへ構成を記録し、ポータル手修正を次のCDで消さない。
- 許可するサービスはBasic LB、GPv1、URL pingの3種。現在のARGは3リソースTypeを取得する。未知の条件の構成もUnknownとして残し、0件を影響なしにしない。Owner/Workloadのタグは`OwnerTeam`、`WorkloadId`、環境は`Environment`。データプレーンは取得しない。
- UIの「Azure情報を取得・評価」で実取得を開始し、Queue処理後に更新する。API読取権限、ARGページング、Service Health/Advisorの実データShapeをSP-02で確認する。通知と構成の取得は部分失敗を表示する。
- Health Advisoryの非推奨・Retirement以外を含む入口は`infra/ingestion.bicep`。承認済み監視RGへSubscriptionごとに配置する。通知Payloadは原本保存後、ARGから正規情報を再読取する。受信本文のIDや日付を正本として使わない。配送試験を実Retirement取得と同一視しない。
- Decision-1の利用可否、Endpoint・Deployment・版を確認し、APIのMIで3事例×3回を実行。応答契約不一致は原応答をAzureへ保存してUnavailable＋人間判断。採用契約は`packages/adapters/src/models.ts`、Prompt/Rule Versionはコードで追跡する。別モデルへの自動切替はない。
- 説明モデルはJSON Schema対応とMIを確認。Resource/Workload/Ownerは別名化し、選別済み構成属性だけ送る。公式本文に機密が混ざらないことをSP-04で確認する。現在は外部URL本文の自動取得を行わない。
- 日付は人間が公式情報を確認して訂正画面へ入力。4マイルストーンを分離し、適用期限・必要日数で余裕と優先度を再計算する。訂正は新版になり旧承認は使えない。原モデル判断・説明は原出力として別欄に残る。
- 個人の非公開Projectを作成し、GitHub Tokenの最小権限をSP-05で試験。RepositoryのIssue作成権限と個人Projectの追加権限は別。`GITHUB_OWNER/REPOSITORY/PROJECT_ID`を設定し、モデルの意味的根拠と作業をレビューした後に外部登録を有効化する。
- 現在のIssueは相関ID・分類・優先度・日程・Evidence IDのみを送り、自由文・実Resource IDを複製しない。詳細は認証画面で確認する。Projectのフィールド更新・進捗同期はIMP-16で追加する。

## 4. リリースと障害対応

CI成果物はmain push成功のrun IDに結び付く。手動CDは現在mainと同じSHAだけを受け付け、What-ifのHashを再計算。想定しない削除・不明差分は適用しない。What-ifは権限を要する処理でありPR CIでは実行しない。初回後もBootstrapのロール変更は通常CDに含めない。

Storage Queueの再試行は5回で`assessments-poison`／`exports-poison`へ。原因・相関を確認してから再投入する。受信OutboxはPendingを定期配送する。評価はイベント版と構成Hashで重複を抑止。古い通知は現行評価を巻き戻さない。現状は全件100評価をUIの上限とするため、増加時はページングを追加する。

GitHubはIssue作成前にOutboxを`Sending`へ条件更新する。作成応答不明でSendingが残った場合は盲目的再作成しない。許可された管理者が相関マーカー`<!-- arp:<id> -->`で対象Repositoryを照合し、Issue IDを記録して`IssueCreated`からProject追加だけ再開する。見つからなくても、作成されていないことを確認してから再実行する。Project失敗は保存済Issue IDで再開する。同じ作業への再承認でIssueを増やさない。

アプリ側エラーは秘密を含めない。App InsightsでQueue失敗、401/403、429、Poison、依存待ちを監視する。業務KPIのDashboardや通知、ProcessingError専用画面はまだない。APIの相関IDとFunctions invocation IDの追跡性は実接続で確認する。実PayloadはBlob/Tableのみ、CI成果物には残さない。

## 5. 費用と撤去

日次モデル回数制限は同時予約をETagで制御するが、円単位の予算ではない。有料評価前に予算通知・累計見積・Token計測・停止のIMP-18を完了する。Functions、Storage、ログの残費用も対象。5千円/2万円は期間累計。

作成台帳は許可Azure保存先で、ID/Scope/所有者/専用・共有/削除方法/資格情報/依存を記録する。PoC終了時に専用RG、別Scopeの通知・RBAC・Federation・App登録、個人Project/Issue、秘密・実データを照合して削除する。自動的なRG削除Workflowは作らない。Key VaultのSoft Deleteは7日であり即時物理削除を保証しない。サービス側保持と残費用を記録する。コード・設計・合成fixtureを残す。

## 参考・未確認

- [Functions Flex](https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to)、[MIのプラットフォームHTTP仕様](https://learn.microsoft.com/azure/app-service/overview-managed-identity)。MIは公式のローカルEndpointを使用し、CLI/環境SecretへのFallbackを持たせない。@azure/identityの依存監査に不適合があり、当該依存を採用しなかった。公開EndpointへTokenを要求しない試験を持つ。
- [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)。型付き判断・確率の提供は文書確認、実環境の版・権限・応答契約は未確認。
- [ARG REST](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources)。APIの実契約とライブ可否はSP-02で照合する。
- 機能の詳細な残作業は[実装バックログ](implementation-backlog.md)。本Runbookを完了していない段階で登壇デモやPoC成立を宣言しない。

## Foundry Bootstrap

`infra/bootstrap/foundry.bicep`は新規FoundryとProjectを専用RGへ作成する。アカウント名とリージョンをパラメーターで渡し、What-ifで確認してから管理者が適用する。キー認証を無効にし、モデル配置・有料推論・アプリへの利用権限付与は含めない。モデル提供・クォータ・Previewの期限は実環境で別途確認する。

[GitHub OIDCのimmutable subject仕様](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims)

## 認証障害の診断

`infra/bootstrap/auth-diagnostics.bicep`にAPI名と既存Workspace名を渡すと、AppServiceAuthenticationLogsだけを専用Log Analyticsへ送信する。認証コールバックの障害はアプリの手前で発生するため、App Insightsの例外0件だけでは正常と判断しない。初回同意後のコールバック、API内のJWT検証、Storage読取をそれぞれ確認する。認証ログは実環境の監査データとしてAzure内で管理し、GitやCI成果物へ複製しない。

BicepのbooleanをApp Settingsへ渡す際は`toLower(string(value))`で`true`/`false`へ統一する。アプリの厳密比較と表記が一致することを実設定でも確認する。

## Service Healthの実応答形式

ServiceHealthResourcesの`LastUpdateTime`は数値で返る場合がある。ARGの投影で`tostring(todatetime(tolong(properties.LastUpdateTime)))`をISO日時へ変換し、JavaScriptへ渡す前に大きな整数の精度損失を避ける。ISO文字列の応答も保持する。識別子・日時が不正な通知は推測で補完せず部分失敗として扱い、画面に取得範囲の不完全性を表示する。更新日時はRetirement日として使用しない。

[Microsoft公式のService Healthクエリ例](https://learn.microsoft.com/azure/service-health/resource-graph-samples)

## 2026-10-26 実データ確認

専用PoC環境へmainの検査済み成果物を再配置し、Entra認証済み画面で「Azure情報を取得・評価」を実行。Health Advisory 7件と対象Subscription内の構成2件を取得した。Service Healthの`LastUpdateTime`は数値ticksを含み、ARGで日時へ変換してから処理する。7評価がQueue経由で作成され、全件で取得範囲完了・Schema validation errors 0を確認した。モデル上限0のためDecision-1/説明モデルは呼び出しておらず、評価はUnavailable・人間レビュー待ちとなる。外部Project登録、Advisor明示関連、Action Group配送、Poison Queue復旧、業務訂正／承認のUATは未検証。画面上の実データやResource IDをログ・Gitへ転記しない。

## 2026-10-26 Microsoft-Decision-1配置

`arp-foundry-0e2e4716` に `arp-decision-1`（Microsoft-Decision-1 version 1、DataZoneStandard、capacity 500）を配置し、Runningを確認した。Deploymentのサービスレートは500 requests/minute・500,000 tokens/minuteで、要求ごとの生成トークン上限ではない。Decision-1のEndpoint・Deployment・Model Versionはアプリ設定へまだ接続しておらず、Managed Identityの推論権限も未付与。アプリのモデル呼び出し上限0を維持し、推論呼び出しは未実施。モデル配置自体の費用はCost Managementで照合する。利用者が定めたPoC累計20,000円は予算目標として記録する。Cost Management budgetは通知であり課金を停止しないため、ハード上限として保証しない。Azure Cost Managementの累計反映も遅延するため、金額制御が未確認のままモデル呼び出しを有効にしない。

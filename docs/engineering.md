# 開発・運用基準

このリポジトリはAzure Functions、Bicep、GitHub Actionsを使うTypeScript／Reactモノレポです。Node.jsとnpmの正本は.node-versionとpackage.jsonです。

## リポジトリ構成

- apps/assessment-api：認証済みAPI、同期、評価、レビュー、React画面の配信。
- apps/work-item-exporter：Queue経由のGitHub作業項目登録。
- apps/review-web：API Artifactに含めて配信するReact画面。
- packages/contracts：版管理されたRequest、Response、保存RecordのSchema。
- packages/domain：決定的な業務規則とModel非依存の評価処理。
- packages/adapters：Azure、Microsoft Graph、Model、Storage、GitHubの接続処理。
- infra：Bicep配置Module、環境Parameter、権限付きBootstrap Template。
- validation：別管理のAzure Workload Template。

Cloud SDK、HTTP Client、認証情報、環境変数の参照をpackages/domainに置かない。既存書式を維持し、具体的な不足がない限り依存を追加しない。

## 変更と検証

短期間のBranchを使い、Pull Requestで変更をレビューする。共有Contractを変える場合は依存する全アプリを確認する。保存Schemaを変える場合は不変Recordと後方互換Readを維持し、破壊的変更の移行方法を記録する。

提出前に次を実行する。

~~~sh
npm ci --ignore-scripts
npm run verify
~~~

npm run verifyはFormat、Lint、型検査、Test、Build、文書検査、Runtime／Artifact検査、依存監査を実行する。Bicep Templateもコンパイルする。CIでは本番外Fixtureを使い、有料Modelを呼ばず、Azureを変更せず、GitHubへ作業を登録しない。

## リリースとID

リリースWorkflowはmainで成功したCI Artifactだけを受け付け、Artifact Hashを検証し、Bicep What-Ifを再計算してApply時に同一Plan Hashを要求する。アプリPackageはそのArtifactから配置する。権限付与Bootstrapは通常のリリースと分離する。リリースIdentityへ広範なSubscription権限を与えない。

利用者認証にはEntraを使い、保護された全APIで認可を検証する。Azureサービス間はManaged Identity、GitHub ActionsからAzureへはOIDCを使う。画面上で操作を隠すだけでは認可にならない。

標準Bicep配置はアプリと関連サービスのPublic Network Accessを有効にする。Private Network、特定のデータ所在地、災害復旧、組織固有の保持要件がある環境では追加設計と設定が必要。

## データとModelの扱い

Microsoft文書と社内文書を信頼できない入力として扱う。文書内の命令を実行せず、任意リンクをたどらず、未承認の項目をModelへ送らない。Source Evidence、Model Output、説明、人の訂正、承認を別Recordとして保持する。該当するModel、Prompt、Schema、Rule、Source、Assessmentの版を記録する。

Secret、Token、接続文字列、実環境のTenant／Subscription／Resource ID、SharePoint ID、実Payload、個人情報、Model入出力をコミットしない。CI Fixtureは合成データまたは承認済み匿名データだけを使う。運用Recordは承認済みの保護された保存先に置く。

## 依存関係とセキュリティ

Node.js、Azure Functions、npmの直接・間接依存、GitHub Actions、Bicep、Azure CLI、Test Toolのサポート状況と既知脆弱性を調べる。Actionsは完全なCommit SHAで固定し、定期更新する。検査失敗を無視や閾値引き下げで回避しない。

npm run verifyに組み込まれたnpm audit --audit-level=lowを使う。リリース前に最新のAdvisory結果を確認する。監査の合格は未知の脆弱性がないことを保証しない。

## 費用、保持、リソースのライフサイクル

Model呼出上限、Cost Alert、Runtime Scale上限は運用上の制御であり、正確な支出上限ではない。推論停止後もStorage、Log、Network、遅延計上の費用が発生する可能性がある。配置設定を変える前に価格、Quota、リージョン提供状況を確認する。

専用Resource、Identity、Grant、外部Project項目、保持設定、依存関係を台帳で管理する。所有範囲と依存を確認した上で、本アプリが所有するResourceだけを撤去する。評価対象や共有Resourceは削除しない。サービス側の保持期間やSoft Deleteの遅延を明記する。

## 文書と完了報告

現行のRuntime動作、任意設定、将来対応を分けて記載する。Tenant固有のResource名、ID、URL、利用者名、Token、運用ログを公開しない。CodeやIaCにAdapterがあるだけで、連携が稼働中だと記載しない。Adapter、設定、実際に確認した動作を区別する。

変更内容、要件、実施した検査、未実施の検査、重要な制約を報告する。実際に確認していない配置、Live連携、Model品質を成功と記載しない。

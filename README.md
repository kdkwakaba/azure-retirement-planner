# Azure Retirement Planner

Azure Retirement Plannerは、Azureのライフサイクル通知を収集し、影響を受ける可能性のあるAzureリソースを調査し、根拠に基づく評価と作業案を人が確認できる形で提示します。評価対象のAzureリソースを変更、移行、削除する機能はありません。

このリポジトリには、TypeScript／Reactアプリ、Azure Functions API、Bicepによるインフラ、GitHub Actions Workflowが含まれます。Azure Service Health、Resource Graph、Microsoft-Decision-1、Azure AI Foundry、SharePoint文書、レビュー画面と連携します。機能や配置設定は環境ごとに異なります。このリポジトリにはテナント固有のIDや認証情報を含めません。

## 主な機能

- 読み取り専用のAzure APIからライフサイクル通知とAzure構成を取得します。
- リソースが通知の対象に該当するかと、業務への影響を分けて評価します。不足情報を保持し、根拠とMicrosoft公式情報へのリンクを提示します。
- 型付き判断案にはMicrosoft-Decision-1を使い、ポリシー制約には決定的なルールを適用します。説明モデルは別に設定し、呼び出し状況を評価ごとに記録します。
- Microsoft Graph経由で設定済みのSharePointフォルダを読み取り、DOCX／XLSXから文章と事実候補を抽出します。Governanceユーザーが事実と依存関係を確認してから、評価根拠として使います。
- 評価を確認、訂正、承認、保留、対応不要として記録できます。承認は特定の評価版に対するもので、Azureリソースを変更する許可にはなりません。
- 承認済み作業だけを、設定済みのGitHub IssueおよびProjectへ登録できます。作業登録とProject進捗の同期は個別に設定します。

## 構成と運用

| 文書 | 内容 |
|---|---|
| [システム設計](docs/design.md) | 現行コンポーネント、データフロー、要件、制約 |
| [アーキテクチャと判断モデル](docs/architecture-and-decision-model.md) | 実行構成、各モデルの役割、根拠、評価動作 |
| [判断ポリシー](docs/decision-policy.md) | 影響軸、優先度、リソース分類、レビュー規則 |
| [Workflow設定](docs/workflow-configuration.md) | チーム振り分け、調整、承認、作業依存関係 |
| [SharePoint連携](docs/sharepoint-document-impact-plan.md) | 文書取得、事実確認、根拠、現行上限 |
| [SharePoint接続ガイド](docs/sharepoint-connection-guide.md) | Graph ID、権限、Source設定、同期 |
| [テストと品質](docs/testing-and-quality.md) | 自動チェック、モデル品質評価、安全要件 |
| [レビュー画面の動作](docs/review-interface.md) | 認可、訂正、承認、外部登録 |
| [利用者向けガイド](docs/user-operations-guide.md) | サインイン、同期、評価確認、承認 |
| [運用Runbook](docs/runbook.md) | Bootstrap、リリース、アクセス、監視、復旧 |
| [構築・SharePoint評価ガイド](docs/deployment-and-sharepoint-evaluation.md) | Azure配置、Graph権限、SharePoint設定、評価までの一連の手順 |
| [実装状況](docs/implementation-backlog.md) | 実装済み機能と製品上の制約 |
| [CI失敗エージェント](docs/ci-failure-agent.md) | CI失敗の自動調査と修正PR作成 |

## セキュリティと制約

- 評価対象Subscriptionは読み取り専用です。本システム自身のResource Groupは、レビュー済みのBicep配置Workflowで別途管理します。
- 標準配置ではEntra認証とAPI認可で保護した公開Azure Endpointを使います。Private Networkが必要な環境では、別途設計・設定が必要です。
- SharePoint権限の対象を明示します。アプリのManaged IdentityにはGraphのSites.Selectedとサイト単位の許可が必要です。アプリに単一フォルダを設定しても、サイト単位の許可範囲はサイト全体です。
- Azure上にリソースが存在することだけでは、実行時の利用状況や業務上の重要度を証明できません。ゲストOS、アプリケーションコード、データプレーンは調査しません。
- 判断モデルが返す確率分布は、校正済みの信頼度や正解率ではありません。不確実な判断やポリシーに関わる判断は人が確認します。
- GitHub登録にはKey Vaultに保管した認証情報を使います。現行アダプターはGitHub AppのInstallation Token方式ではありません。
- 運用者は、利用環境に合わせてID、データ保持、ネットワーク制御、ポリシー、Quota、モデル配置、外部連携を設定します。

## 開発

Node.jsとnpmは、.node-versionおよびpackage.jsonに記載された版を使います。

~~~sh
npm ci --ignore-scripts
npm run verify
~~~

verifyは、Format、Lint、型検査、Unit／Contract Test、Build、文書リンク、Runtime／Artifact検査、依存パッケージ監査を実行します。通常のCIではAzure変更、有料モデル呼び出し、GitHubへの作業登録を行いません。

手動リリースWorkflowは、mainの成功済みCI Artifactだけを配置します。Bicep What-Ifを再計算し、Apply時にレビュー済みPlan Hashを照合します。同一ArtifactからAPIとExporterのパッケージを配置できます。詳細は運用Runbookを参照してください。

## 設定

インフラパラメーターと実行時Feature Flagは、Bicepパラメーターと配置変数から設定します。明示的に有効化しない機能は無効です。Tenant ID、Subscription ID、SharePoint ID、Resource ID、認証情報、実データ、モデル入出力をコミットしないでください。環境固有の設定や記録は、承認済みの非公開運用先に保管してください。

環境固有の現行設定と製品上の制約は[実装状況](docs/implementation-backlog.md)を参照してください。

# 実装状況

本書は現在のmainのCodeと保守対象Deployment設定をまとめます。環境固有IDは含みません。他の配置先では設定値が異なる場合があります。

## 実装済み機能

| 領域 | 現行動作 |
|---|---|
| API／画面 | Entra認証、Role認可、Reactレビュー画面を備えたAzure Functions API |
| 受付・調査 | Service Health通知、Azure Resource Graph Inventory、一部Advisor／Control Plane情報を取得。Sourceごとの完全性と失敗Metadataを保持 |
| Assessment | Workload単位の不変Assessment、通知別Resource Profile、2つの影響軸、優先度Rule、人のReview、Evidence、訂正、再評価履歴 |
| 判断Model | Microsoft-Decision-1型付き判断Adapter。Score分布と呼出状態をAssessmentに保存 |
| 説明 | 設定済みGPT-6 Luna Deploymentと、独立した決定的な一般影響説明経路。AssessmentにLLM呼出成功状況を記録し、一般説明をLLMの代替にしない |
| SharePoint | Microsoft GraphによるFolder同期、不変Document Snapshot、DOCX／XLSX文章抽出、Fact候補、Governance Review、確認済みFact／依存経路のWorkload Evidence利用 |
| Review／承認 | 版単位の訂正、部分承認、保留、対応不要。承認はAzure Resource変更を許可しない |
| GitHub | 承認済み作業のIssue／ProjectへのQueue登録、照合、再試行。Project進捗同期は個別設定 |
| Infrastructure／Release | Bicep管理Resource、OIDC Release Identity、Artifact Hash検証、What-If Plan Hash、手動Apply Workflow |
| Security検査 | Runtime検査、npm audit、Unit／Contract Test、Bicep静的検査、依存／Action固定 |

## 保守対象Deploymentの設定

次の値はBicep既定値ではなく、Deployment Variableから読み取った保守対象環境の値です。

| 設定 | 現在値／効果 |
|---|---|
| Test Mode | 無効 |
| SharePoint同期 | 有効 |
| Live SharePoint Source | 有効 |
| SharePoint Fact抽出 | 有効 |
| GitHub作業Export | 有効 |
| Project進捗同期 | 無効 |
| Decision再評価Endpoint | Test Mode無効時は利用不可 |
| 合成Assessment Endpoint | Test Mode無効時は利用不可 |

Bicep Parameter FileはVariableがない場合、同期、通知受信、Export、Test専用機能、SharePoint機能を無効にします。現在のHosted設定を新規配置の既定値とみなさないでください。

## 境界と残作業

- 評価可能なのは設定されたAzure Scope、対応する通知／Resource Profile、確認済みWorkload情報の範囲です。Control Plane Inventoryだけで実行時利用を証明できません。
- 対応Azure Serviceが増えるにつれ、適用Profileの拡充と条件の独立レビューが必要です。
- 業務Owner、重要度、営業時間、RTO／RPO、承認済み対応、作業期間をCMDB／ServiceNowから自動取得しません。確認済みSharePoint Factは利用できますが、文書記載には人の確認が必要です。
- Source設定はFolder単位です。複数Folder検出、Folder別アクセス境界、Source優先順位、競合解決は今後の設計が必要です。
- Decision確率の校正と独立した人の判断との一致度を評価するには、版管理された代表的な評価セットが必要です。Schema適合だけでは正確性を測れません。
- GitHub Exportは現在Key Vault内のGitHub Tokenを使います。GitHub App Installation Token認証や組織固有Permission／保持Policyは現行Adapterにありません。
- 保守対象DeploymentではProject進捗同期が無効です。通知Webhookと各Destinationの認可設定は個別に有効化・確認が必要です。
- 基本BicepはPublic Network Accessを許可します。Private Network、災害復旧、組織固有の保持／Compliance制御には環境別設定が必要です。

## Release検証

Release Workflowはmainの成功CI RunとArtifact Hashを検証し、What-Ifを再計算してApply前にレビュー済みHashと比較します。同一ArtifactからFunction Packageを配置できます。Release成功だけではModel精度、Azure Data Sourceの完全性、業務上の正しさを証明しません。

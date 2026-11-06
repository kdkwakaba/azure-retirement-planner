# アーキテクチャと判断モデル

本書はRepository内の実装を説明します。配置固有の値は別に設定し、Source Controlへコピーしないでください。

## コンポーネント

~~~mermaid
flowchart LR
  User[Entra認証済みReviewer] --> UI[Reactレビュー画面]
  UI --> API[Assessment API / Azure Functions]
  SH[Azure Service Health] --> API
  ARG[Azure Resource Graph] --> API
  ARM[Azure Resource Manager] --> API
  SP[SharePoint / Microsoft Graph] --> API
  API --> Q[Azure Storage Queue]
  API --> DB[(Azure Storage Table / Blob)]
  API --> D1[Microsoft-Decision-1]
  API --> EX[設定済み説明Model]
  API --> TR[Azure AI Translator]
  API --> EXP[Work Item Exporter / Azure Functions]
  EXP --> GH[GitHub Issues and Projects]
  GH --> EXP
~~~

React画面はAssessment APIと一緒にBuildし、API Function Appから配信します。Exporterは別Function Appです。両方のAzure Service接続にはSystem-assigned Managed Identityを使います。GitHub Actionsは配置用IdentityにOIDCで接続します。利用者、Application、配置のIdentityは別々です。

基本Bicep配置ではFunction Appと関連EndpointのPublic Network Accessを有効にし、Private EndpointとNetwork分離を既定設定しません。

## RequestとAssessmentの流れ

1. Entra App Roleが割り当てられた利用者がReview画面を開く。Easy AuthとAPIのToken／Role検査で保護する。
2. 認可されたOperatorが同期を依頼する。Service Health通知、Resource Graph Inventory、Advisor情報、設定済みSharePoint Sourceを独立Adapterで取得する。
3. Source、時刻、Scope、完全性、失敗、版、Evidenceを記録する。取得不完全や失敗を空または影響なしと扱わない。
4. 明示Targetと有効なResource適用Profileから候補を選ぶ。Profileで定義された場合はResource Type、SKU、Region、Kindなどを検討する。不明AttributeはReview対象として残す。
5. Lifecycle Event／WorkloadごとにAssessmentを作る。通知、Resource Fact、確認済みEvidenceをModel入力の根拠にし、Outputを検証して決定的Ruleを適用する。
6. UIに影響、Evidence、不確実性、Resource候補、作業案を表示する。人は不変版のAssessmentを訂正・Reviewできる。
7. 承認済みWork Itemは独立したQueue経由でExporterへ送る。ExporterはGitHub Issue／Project項目を作成または更新する前に既存状態を照合する。Issue作成とProject項目更新は別処理で、一部だけ成功することがある。

Azure同期は評価対象Subscriptionを読み取るだけです。Azure Resource、Tag、Permission、Workloadは変更しません。Planner自身のInfrastructure配置は、レビュー済みBicepで別途行います。

## 判断責務

| 構成要素 | 責務 | 判断しないこと |
|---|---|---|
| Azure Service | 通知、推奨、Resource Inventory、Control Plane Attributeを提供 | 業務重要度、Owner、移行計画 |
| 適用Profile | 通知ごとの条件から候補Resourceを特定 | 実行時利用や業務影響の単独判定 |
| Microsoft-Decision-1 | 影響、優先度、時期、複雑さ、Project要否の型付き選択とScore分布を返す | Evidenceの真偽、チーム割当、承認、Azure変更 |
| 決定的Rule | Deadline、優先度下限、完全性制約、Review要件を適用 | 業務受容や最終的なPolicy例外 |
| 説明Model | 設定済みの場合、Evidenceの範囲内で説明と作業案を生成 | 公式日付、Resource ID、承認、根拠のないFact |
| Validator | Schema、Evidence Reference、ID、日付、Workload Link、依存Graph、承認Hashを検査 | 形式上有効な作業案が妥当であることの保証 |
| 人間のReviewer | 業務Fact、適用性、影響、作業、Owner、例外、外部登録を確認 | — |

Decision-1のScore分布は順序尺度のModel Outputです。UIは最高Scoreの影響Categoryを表示し、同点なら複数Categoryを示す場合があります。正解の校正済み確率ではありません。Score、Unknown、Abstainedだけでは作業を承認したり、Resourceを影響なしと確定したりできません。

2つの影響軸は異なる判断です。

- **未対応時のリスク**：該当機能が使用中のまま退役した場合に想定される結果。
- **対応時・対応後の影響**：Upgrade、Migration、切替などの対応作業中および完了後に想定される結果。

業務固有の依存情報がなければ、UIにLifecycle一般論の影響説明を示す場合があります。特定業務処理や停止時間を示すものではありません。確認済みSharePoint FactはWorkload Evidenceを補えますが、文書記載だけでは現在の実行時利用を証明しません。Fact候補はGovernanceが内容を確認し、依存先を明示的にLinkする必要があります。

## EvidenceとModel入力

AssessmentにはSource・観測Metadata、Evidence ID、Model呼出状態、Model／Prompt版、入力／結果Hash、Assessment版を保持します。Model入力ではResource IDとTeam名を別名化し、ARMのproperties全体を渡しません。Microsoft文書と社内文書は信頼できない入力であり、埋め込み命令は実行しません。

説明は2経路に分かれます。説明Deploymentは個別に設定し、Assessmentごとに呼出状態を記録します。一般的な影響説明は決定的に生成し、説明Modelが失敗・利用不能な場合の代用にしません。Microsoft Fact、Evidence、公式URLは生成説明と分けて保持します。日付処理でMigration Deadlineや非推奨開始を退役日に変換しません。

## SharePoint文書フロー

APIはManaged IdentityでMicrosoft Graphを使い、設定済みSharePoint Folderを読み取ります。File一覧とSnapshotを不変で保存します。対応形式はDOCXとXLSXで、File、Page、Batch、Textの各上限があります。Fact抽出は出典位置とContent Hashを持つ候補を作ります。Governance Reviewerは候補を修正、確認、除外できます。確認済みFactと明示的な依存Linkは版管理され、WorkloadにScopeされます。確認済みLive Source Factだけが通常Assessmentへ入り、隔離されたSynthetic Source Factとは分離します。

GraphのSites.Selected Application PermissionとSite単位のread許可の両方が必要です。Folderを設定してもGraph許可は狭まりません。許可境界が広すぎる場合は専用Siteを使います。

## 環境制御

同期、通知受信、SharePoint同期・抽出・Live Source、GitHub Export、Project進捗同期、隔離Assessmentには個別設定があります。Bicep Parameter FileはDeployment Variableから明示的に有効化されない場合、これらを無効にします。現行配置はTest Modeを無効、Live SharePoint同期・Fact抽出とGitHub Exportを有効、Project進捗同期を無効にしています。別環境では異なる場合があります。

## 既知の制約

- Resource GraphとControl Plane調査だけでは、すべてのケースで実行時利用を証明できません。Data Plane、Guest OS、Application Code、Connection Stringは調査しません。
- 適用Profileは設定済みResource Typeと条件を対象にします。Profileがない場合はReviewにし、全体を影響なしと判断しません。
- 業務Owner、重要度、RTO／RPO、変更可能期間、承認済みMigration、作業期間には明示された業務情報または人の確認が必要です。
- SharePoint Sourceは現在Folderと配下を対象にします。任意URLの巡回はしません。複数Folderや高度なSource統制を統合検索する機能ではありません。
- GitHub Exportには設定済みTokenとPermissionが必要です。現行AdapterはKey VaultからGitHub Tokenを読みます。GitHub App Installation Token方式はありません。
- 通知配送、Export、進捗同期は個別に有効化します。CodeやInfrastructureに実装があるだけでは、全環境でDestination／Roleが設定済みとは限りません。

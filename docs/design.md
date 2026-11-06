# システム設計

Azure Retirement Plannerは、ライフサイクル通知、Azureインベントリ、承認済み業務情報、作業計画上の判断を、根拠にひも付けたAssessmentとしてまとめます。人によるレビューと任意の作業登録を支援します。移行、Resourceの修復、Incident対応は実行しません。

本書はRepository内の実装を説明します。環境固有のIdentity、Scope、Model Endpoint、Network境界、外部接続先は配置時に設定します。

## 目標と対象外

### 目標

- Microsoft Azureの情報源からライフサイクル情報を取得し、取得完了、一部取得、取得失敗を区別する。
- Azure Resourceの候補を特定する。インベントリだけで実際の利用を断定しない。
- 未対応時のリスクと対応中・対応後の影響を分けて記録する。
- 公式情報、設定済み業務情報、Model結果、人の訂正、承認履歴を保持する。
- 不足日付、Owner、影響、計画を創作せず、不確実性と具体的な確認作業を示す。
- 特定Assessment版に対して選択・承認された作業だけを外部登録する。

### 対象外

- 評価対象Azure Resourceの修復、移行、タグ付け、削除、その他の変更。
- Guest OS、アプリケーションコード、認証情報、接続文字列、Data Planeの調査。
- Azure Service Health、Advisor、Resource Graph、Azure Policy、CMDB、ServiceNow、組織の変更管理の置き換え。
- 業務上の重要度、実行時利用、所有者、承認済み代替策、移行完了の自動証明。
- 状態変更だけを根拠とする内部・外部作業の自動完了。

## 実行時アーキテクチャ

モノレポにはAssessment APIと画面、独立したWork Item Exporter、共有Contract／Domain／Adapter、Bicep配置Templateが含まれます。

~~~mermaid
flowchart TB
  Reviewer[Entra利用者] --> UI[React画面]
  UI --> API[Assessment API]
  SH[Service Health] --> API
  ARG[Resource Graph / Advisor] --> API
  SP[SharePoint via Graph] --> API
  API --> Models[判断・説明Model]
  API --> Store[(Queue、Table、Blob)]
  Store --> Exporter[Work Item Exporter]
  Exporter --> GitHub[GitHub Issues / Projects]
~~~

API Function AppがReact Buildを配信します。APIとExporterは別々のSystem-assigned Managed Identityを使います。GitHub Actionsは別のOIDC配置Identityを使います。基本Bicep配置ではFunctionsと関連サービスのPublic Network Accessを有効にします。Private EndpointとNetwork分離は追加設定が必要です。

## Identityと認可

利用者TokenのTenant、Audience、Issuer、User／Application種別、Roleを検証します。APIのRoleはReader、Reviewer、Operator、Governance、NotificationSenderです。最後のRoleはApplication専用です。画面で操作を隠していてもAPIで認可を再確認します。

API Managed Identityは設定済みAzure Scopeを読み、設定済みServiceを呼び出します。Exporter Identityは登録に必要なDataとSecretだけへアクセスします。評価対象Azure ScopeにはReaderを付与し、Contributorは付与しません。GitHub Actionsの配置権限はPlanner専用Resource Group内に限定し、権限付きBootstrapは別Templateと別認可で実行します。

## データフロー

1. 利用者が認証済み画面から同期やレビューを依頼する。
2. 独立AdapterがService Health通知、Resource Graph／Advisor情報、設定済みSharePoint Folder、関連するControl Plane属性を取得する。
3. 原Recordと不変版をBlobに保存する。Index、Status、Outbox、現行版の参照先はAzure Tableに保存し、非同期処理はStorage Queueで実行する。
4. 取得Source、Query、Scope、時刻、完全性、安全な失敗分類を記録する。取得失敗を空の結果として扱わない。
5. Assessment ServiceはLifecycle EventをWorkloadごとにまとめ、Resource Profileを適用し、根拠に基づくModel入力を作成する。型付き判断を検証し、決定的ルールを適用する。
6. レビュー画面にResource候補、2つの影響軸、優先度、Evidence Link、Model呼出状態、不足情報、作業案を表示する。
7. Reviewerは現行版／Hashに対するAssessment訂正または選択作業の承認を行える。ExporterはGitHub IssueとProject項目を個別に照合する。

## Assessmentと判断Contract

AssessmentはLifecycle Event版とWorkloadでScopeを定めます。Source情報、Evidence、Resource候補、取得結果、判断・説明の呼出、Rule結果、作業項目、訂正、Review状態、Package Hashを保持します。

Microsoft-Decision-1は未対応時の影響、対応時の影響、優先度、開始時期、複雑さ、Project化要否の型付き値を提案します。Score分布はModel Outputとして保存し、校正済み信頼度として扱いません。決定的RuleはPolicy下限と完全性制約を適用します。Unknown、Abstained、低いScore、首位Categoryの同点、重大な不一致はReviewを必要とする場合があります。Resource変更を許可するものではありません。

非推奨開始、新規作成停止、サポート終了、退役、対応期限は別の日付です。実装は対応する公式Signalがあるときだけ退役日を設定します。欠落・競合する日付は未確定のままです。

説明生成は独立して設定します。一般的なLifecycle影響文は決定的に生成され、説明Modelが使えない場合の代替ではありません。保存前に主張とEvidenceのLinkを検査します。裏付けのない主張、架空ID、参照のないCitation、根拠のない計画日は確認済みFactとして採用しません。

## Azure Resource調査

候補Resourceは公式情報に明示された対象と、版管理された適用Profileから特定します。現行Profile RegistryはBasic Load Balancer、Storage GPv1、Application Insights URL ping test、Classic Foundry Agent Serviceを含みます。Profileは該当Resource Typeと条件を選びますが、実行時利用を証明しません。通知ProfileがないResource Typeを影響なしとは扱いません。

分類はConfirmed、Probable、Possible、Verification Required、Not Impacted、Unknownを区別し、業務影響とは別に保持します。Scopeの完全性と取得失敗も表示します。関連StorageのようなControl Plane上の関係だけでは、アプリがそのResourceを使うとは断定しません。

## SharePoint文書連携

SharePoint SourceにはTenant、Site、Document Library、Folder Item、Workload、Source区分を設定します。APIはMicrosoft Graphで指定Folder配下のFileを読み、任意URLを巡回しません。DOCX／XLSXから上限内で文章を抽出します。原本とSnapshotは不変です。

Model抽出は出典位置とHashを伴うFact候補を作ります。Governance利用者は候補を修正、確認、除外できます。確認済みのLive Source FactはWorkload Evidenceとして利用できます。関連FactとAzure ResourceのLinkは人が明示し、APIがWorkload、Resource所属、Evidence、版、依存Graphの整合性を検証します。合成Source Factは通常Assessment入力と分離します。

Graph権限にはAPI IdentityへのApplication Permission Sites.Selectedと、Site単位のread許可が必要です。許可ScopeはFolderではなくSiteです。アプリ内のFolder指定はGraph権限範囲を狭めません。

## Review、Export、版管理

訂正は実行者、理由、時刻、Evidenceを持つ不変のAssessment版を作ります。重要変更は影響する承認を無効化します。対応不要の状態は通常一覧からAssessmentを隠しますが、通知、Evidence、履歴を保持します。

承認は1つのAssessment版／Hash内で選択した作業項目に適用され、評価対象Azureを変更する許可ではありません。GitHub Exportは別Feature Flagで制御します。親／Phase／作業Issueの階層とProject項目の更新にはIdempotencyと照合を使います。一部失敗は段階ごとに記録し、成功と決めつけず再試行します。

## 環境設定

配置Parameterは同期、通知受信、Model呼出上限、SharePoint Live Sourceと抽出、作業Export、進捗同期、隔離Assessmentを制御します。Variable未設定時のBicep Parameter File既定値は安全側で無効です。現行の保守対象環境ではLive SharePoint同期・Fact抽出、GitHub Exportを有効にし、Test ModeとProject進捗同期を無効にしています。GPT-6 Lunaの説明Deploymentを設定しています。これらは環境固有の値であり、全環境の既定値として扱いません。

## プライバシーと運用

実Resource ID、通知Payload、SharePoint ID、Token、個人情報、Model Prompt／Outputをコミットしません。Logには生Payloadではなく安全なError Category、Status、Stage、Correlation Metadataを記録します。運用Storage、保持、削除、Legal Holdは配置組織が設定します。

標準配置だけでは、全組織共通のCompliance、Private Network、災害復旧、校正済みAI精度は提供しません。配置前に要件、Providerのサポート、リージョン、Quota、価格、Data Processing条件を確認してください。

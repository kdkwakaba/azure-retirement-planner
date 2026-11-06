# SharePoint文書とWorkload影響

Applicationは設定済みSharePoint Folderを読み、DOCX／XLSXからFact候補を抽出し、人が確認したFactをWorkload単位のEvidenceとして利用できます。これはApplication管理のMicrosoft Graph連携です。Foundry Data SourceとしてSharePointを接続しません。

## 現行フロー

1. Governance利用者がTenant、Site、Drive、Folder Item、Workload、許可拡張子、Source区分、設定版を含むSourceを登録する。
2. SharePoint同期が有効なら、OperatorまたはGovernance利用者が同期を開始する。
3. APIが設定Folderと配下を列挙し、許可文書を取得して不変のSource版／Snapshotを保存する。
4. Governance利用者が選択文書のFact抽出を依頼する。抽出文にはSource位置とContent Hashが付く。
5. Reviewerが候補を編集、確認、除外する。Reviewer Identityと時刻を新しい不変Grounding版に保存する。
6. Reviewerが関連Factと、Resource依存Factを選択Assessment内のAzure Resourceへ明示Linkする。APIはWorkload、Evidence、Resource、依存Graph制約を検証する。
7. 確認済みLive Source Factは同一Workloadの後続Assessmentへ含められる。Source、確認Fact、依存Linkの変更は新しいAssessment Input版を作る。Synthetic Source Factは分離する。

## Fileと上限

- 対応拡張子：.docx、.xlsx。
- Folder探索深度：最大8階層。列挙項目：最大2,000件。
- Snapshot上限：最大100文書、1文書10 MiB、合計50 MiB。
- 抽出文章：1文書あたり最大200,000文字。Spreadsheetは最大20,000 Cell。
- Fact抽出は最大1,500 Input文字、最大60 Block、最大134 Batchに分割する。Model Callは共通の日次上限を使い、Completionは最大1,000 Token、BatchあたりFact候補は最大5件。
- HTTP 429はProviderのRetry-After値に従って1回再試行する。上限超過や抽出失敗時、文書全体を評価済みとして扱わない。

画面最下部にSharePoint管理用の折り畳みPanelがあります。Source設定とFact ReviewはGovernanceのみ、同期はOperatorまたはGovernanceです。Sourceは区分（Live／Synthetic）ごとに1つ登録できます。各Sourceは1 Folderを示し、配下を含められます。

## Access境界

API Managed IdentityにはMicrosoft Graph Application Permission Sites.Selectedと、対象Siteへの別個のread許可が必要です。Permission割当は専用Graph Bicep Bootstrapで管理できます。Site read許可は別途管理者が行い、Azure RBACでも通常Application Releaseの一部でもありません。

アプリが1 Folderを指定しても、Site許可はSite全体に及びます。Applicationが読むべきでない文書を含むSiteを使用しないでください。必要なら専用Siteまたはより狭いGraph Permissionを検討します。文書中の任意Linkを巡回しません。

## Assessmentに使う際の信頼規則

- 抽出文章は候補であり、確認済みFactではない。
- 文書のResource Nameや利用記述は、現在そのResourceが存在・利用中である証明にならない。
- Governanceが確認し、依存経路を明示したFactだけをAssessment Evidenceにできる。
- ClaimごとにSource、文書版、Content Hash、位置、Reviewer、確認時刻を保持する。
- 曖昧なNameを自動解決しない。Resource Linkは選択したAssessment内のResourceを参照する。
- Source区分は明示的に管理する。Synthetic Source Dataは通常のLive Assessmentに使えない。Live Source DataはTest Mode無効かつLive Source Feature有効の場合だけ受け付ける。
- Test Modeを無効にすると隔離Recordは通常一覧から隠れるが、保存Recordは削除しない。

## 現行の制約

- Site、Drive、Folder IDは管理者が取得・入力する。URLから自動解決しない。
- Source設定はFolder単位で、Data区分ごとに1 Sourceに限る。複数Folder検出、Source間の優先順位／競合解決は未実装。
- DOCX／XLSX抽出はExtractorが対応する構造内でParagraph、Sheet、Cellの出典を記録する。LayoutやTable解釈の完全性は保証しない。
- 抽出品質、Factの正確さ、業務影響の正確さは、Source文書と人によるReviewに依存する。Schema適合は意味の正しさを保証しない。
- 文書を読み取るのみで、SharePointへの書き戻しやCMDB／ServiceNow同期は行わない。

ID取得、アクセス設定、運用方法は[SharePoint接続ガイド](sharepoint-connection-guide.md)を参照してください。

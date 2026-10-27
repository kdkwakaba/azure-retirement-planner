# 実装タスクと検証状態

2026-10-26。状態はコードの実装と接続検証を分ける。ローカル検査合格はPoC成功・実環境動作・モデル品質の証明ではない。

| ID | Epic / 作業・成果物 | 依存 | 完了条件 | 状態 | Size / Role / 並列可 |
|---|---|---|---|---|---|
| IMP-01 | Foundation: npm workspaces、TS/React、整形・型・Lint・Lockfile | — | 再現可能なインストールと検査 | 実装済 | M / Dev / Yes |
| IMP-02 | Security: Node24、完全SHA Actions、全npm依存監査、日次保守 | 01 | 既知脆弱性0、EOL拒否、検査障害は失敗 | 実装済。ActionsのAdvisory調査はリリース時にも確認 | M / Security / Yes |
| IMP-03 | Foundation: Schema、Evidence、Hash、元データ・原出力保存 | 01 | 厳密Schema、承認変更検知、原出力の保存 | 実装済。実データ取得後のQueue評価・Blob/Table保存を確認 | M / Dev / Yes |
| IMP-04 | IaC: Flex2アプリ、Storage、Key Vault、監視、MI、Entra設定 | 01 | 静的コンパイル＋対象RGで疎通 | 専用Azure環境へ配置・再配置済。Entra認証、実通知・構成取得、Queue評価、永続化を確認 | L / Cloud / Yes |
| IMP-05 | Release: OIDC Bootstrap、CI成果物Hash、What-if手動CD | 02,04 | main CI成果物のみ、差分Hash一致、権限分離 | main CI→OIDC→What-if/Hash→手動CDを実行・成功 | L / Cloud / Yes |
| IMP-06 | Ingestion: Secure Webhook、原本受付、Queue/Outbox | 03,04 | アプリ権限検証、重複・停止・再開・Poison確認 | 受付経路は実装済。Service Health実通知7件をARG取得しQueue評価を確認。Action Groupの実配送は未検証 | L / Dev+Cloud / Yes |
| IMP-07 | Discovery: ARG Health Advisory、Advisor関連、3サービス構成 | 03 | 全ページ、部分失敗、公式明示対象・不明を区別 | Service Health実データ7件・構成2件を確認。AdvisorのTracking ID→recommendationTypeId→New／InProgress／Postponed推奨を関連付け、両ソースの部分失敗時に他方の結果を保持する契約試験を追加。2026-10-26の実ARG集計はAdvisor retirement recommendation Completed 1件、active 0件、metadata 0件で正の相関未検証。全ページ網羅・実環境精度も未評価 | L / Dev / Yes |
| IMP-08 | Normalization: 非推奨ほか4種、版・旧通知・不明日付 | 07 | 非推奨開始日を廃止日にせず旧版巻戻し拒否 | TST-11/12を回帰確認。公式分類を保持しHuman scope dispositionで無関係通知を理由・根拠付き対象外にできるUI、作業・優先度抑止、承認ガードを追加。自動除外はしない。Health AdvisoryのImpactMitigationTimeに加え、Retirement subtypeの公式表題／本文で廃止に日付が直接結び付く限定表現を解析し、Evidenceへ根拠を保持する実装・合成試験を追加。非Retirement、移行期限、競合・複数日付は未確定のまま維持。正規化バージョン変更はsource hashと分離した新EventVersionを生成する。2026-10-27のLive UIではタイトル記載日が公式期限欄に出ず、値の不在か正規化漏れか未判定。PRマージ後に実通知の取得・期限反映・再評価を再検証 | M / Dev / No |
| IMP-09 | Context: タグ集約、未設定Owner・業務情報の確認 | 07 | 構成は実値、業務値は推測しない | Unknown／Possible／Verification Requiredの理由と不足属性を表示し、説明モデル停止時もEvidence付きImpact Verification作業を決定的に生成。評価結果をCandidatesFound／NoResourcesDetected／NoImpactMatched／ProfileUnavailable／Incompleteに分け、Scope・Resource Type・適用プロファイルID／版を保存。完全取得済みの該当なし／対象外のみではモデル呼出と汎用作業を省略し、評価レビュー省略可と表示。CMDB、依存探索、RTO/RPO・提供時間等の構造化入力は追加対象 | M / Dev+Architect / Yes |
| IMP-09a | Workflow Policy: 構造化設定、役割参照検証、担当・調整候補、承認段階表示、作業依存適用、版Hash記録 | 03,09 | Schema／参照／DAG検証、曖昧・不足は人間確認、Ownerを推測しない | ランタイム適用・UI表示・合成テスト実装済。組織固有設定、運用者レビュー、認証ロール別承認は未実施 | M / Dev+Governance / Yes |\n| IMP-10 | Spike: Decision-1と説明モデルの利用条件・MI・応答契約 | 04,05 | SP-01/04。3事例×3回、確率・版・費用の実測 | Decision-1 v1 DataZoneStandard capacity 500、API設定、Foundry限定MIロールを反映済。実データ1件の応答に加え、合成3事例×3回で契約・確率検証合格。判断品質・説明モデルは未完了 | L / AI+Cloud / Yes |
| IMP-11 | Decision: 影響2軸、P1〜P4、余裕、低確率・欠損レビュー | 03 | 境界日、未確定、移行強制なしを単体試験 | 実装済 | M / Architect+Dev / Yes |
| IMP-12 | Explanation: 10区分、ID別名化、根拠参照、作業案 | 10,11 | 元応答保存、Schema・ID参照検証、失敗は手動確認 | 実装済。モデルによる意味的Groundingは実評価待ち | L / AI / No |
| IMP-13 | Guardrails: ID・日付・DAG・根拠・Owner・承認Hash | 03,11 | 架空・旧版・不適合の登録0 | プロファイル固定のMicrosoft Learn 3 canonical URLについて本文取得、サイズ／redirect制限、1時間プロセスキャッシュ、全文Hash、取得失敗時のIncomplete化を実装。根拠版更新時も同一通知版のHumanContext／Evidenceを引き継ぎ、旧承認を失効して再レビューを要求。引用EvidenceのWorkload／Resource scope検証を追加。合成試験合格。実環境本文取得と後継サービスの意味検証は未完了 | L / Security+Dev / Yes |
| IMP-14 | Human Review: Azure配信React、訂正、部分承認・保留・差戻し | 04,11,13 | APIロール、訂正新版、承認失効、Entraログイン | [レビュー画面UAT手順](review-screen-uat.md)にLive UAT記録。再認証後7件同期、最新1評価のNoApplicableProfile理由とEvidence照合（6 Claim中4参照、参照切れ0）を確認。未認証APIはAuthentication required、未認証UIは空シェル＋サインイン案内。同期POSTは成功したが現ロール名を取得できず、別ロール拒否／サインアウト後未検証。APIロール表（Reader／Reviewer／Operator／Governance）とApplication限定NotificationSenderの合成認可試験を追加。Live role別認可・訂正・承認は未実施。TST-29 fixture/domain試験CI成功、API/UI統合未検証 | L / Frontend+Security / Yes |
| IMP-15 | Integration: Issue作成→Project追加、相関ID・成否不明停止 | 13,14 | 無承認拒否、重複防止、Project失敗のみ再開 | 保存済みIssue IDのProject再試行、`Sending`再試行の相関マーカー照合を共通関数と合成テストで確認。実Queue再配送、個人Project権限SP-05、実登録は未検証 | L / Dev / Yes |
| IMP-16 | Integration: Projectフィールド、改訂Issue更新・進捗取込 | 15 | 項目対応、競合・手動編集を保持、自動Closeなし | Issue管理領域の改訂更新、Priority／Due date同期、初期Status、重複照合を実装。Project Statusを15分ごとに任意取込し、外部進捗属性として保存、Entra保護APIとレビュー画面へ表示。評価・承認・作業完了を自動変更しない。同期は既定無効。GitHub実Project／資格情報を使う統合UATは未実施 | 実装済（合成試験のみ） / L / Dev / No |
| IMP-17 | Operations: 再評価・処理ログ・Poison・復旧Runbook | 06–15 | 日次再取得、部分失敗表示、成否不明の手動照合 | ProcessingFailureの任意Scheduled Query AlertとAction Group設定、KQL、Poison Queueの安全な手動照合・再投入手順を追加。Alertは既定無効で、専用RG内の監視構成だけを対象。レビュー画面へ評価レコード単位の総数・人間確認待ち・P1/P2・調査不完全の読み取り専用サマリーを追加（業務システム件数とは区別）。実環境の発報・Poison再処理・成否不明照合、サマリーの実データ統合UATは未検証 | 一部実装 / M / SRE / Yes |
| IMP-18 | Cost: 日次呼出回数枠・予算確認手順 | 10,17 | PoC累計20,000円を利用者がCost Managementで確認。要求単位のToken上限は設けない | 利用者の判断で金額ハード停止は実装対象外。API呼出枠は200/日。Cost Managementの予算通知は補助情報 | M / SRE+FinOps / Yes |
| IMP-19 | Evaluation: 30ケース、108回、精度・Recall・Override | 07–16 | 当時版・独立正解集合、指標・未評価の記録 | `evaluateCases`の純粋micro指標計算と、Observation IDに結び付けた全件採点・split別集計の`evaluateManifest`を追加し、反復Observation数と独立scenario数を区別して表示。`validateEvaluationManifest`でsource区分・参照・asOf・Hash・Model/Prompt/Rule/Contract版・実行・レビュー状態を記録し、同じRetirement familyのSplit漏れ、反復観測のinputHash不一致、raw payloadフィールドを拒否。合成テスト済。独立正解集合、正解ラベル作成、30／108回のモデル品質評価、閾値合意は未実装 | L / QA+Architect / Yes |
| IMP-20 | Demo/UAT: 同一実環境で3分ライブ | 10,14–19 | 事前サインイン、実通知、判断→根拠→承認→登録 | リハーサル待ち。合成をライブ取得と偽らない | M / Presenter+QA / No |
| IMP-21 | Cleanup: 作成台帳と専用資源・Project・秘密の撤去 | 04,15 | 削除対象照合、残存保持・残費用報告 | 専用Azure資源・Entra App・資格情報を作成済。撤去はPoC終了時に別途実行 | M / Cloud+Owner / No |

## 未確定情報と次のゲート

- Azure配置情報は確定しGitHub Variablesへ設定済。FoundryとEntra Appを新規作成。秘密値はKey Vaultへ保存し、Git・チャットへ記録しない。
- 現在のGitHub CLI Tokenはread:projectスコープがなくProject列挙を拒否された。個人ProjectのToken種別・権限とProject IDはSP-05で実証する。本番Org＋GitHub Appの実装は別ゲート。
- Decision-1の型・選択肢・確率は公式文書にある。モデル配置・API Managed Identity推論・v1応答は実データ1件で確認済み。合成3事例×3回は全件契約検証合格、全件Abstained相当。これは判断精度評価ではなく、説明LLMは未確認。Basic LBで未対応影響がCritical/Highに分かれた。互換に見える別APIへ自動切替しない。
- Decision-1は2026-10-26に既存Foundryへ配置し、API Managed Identityでの実呼出しを確認済み。要求単位のToken上限は設定しない。累計20,000円は利用者がCost Managementで確認する。自動停止は実装しない。外部登録・定期同期・通知は引き続き無効。

## 検証の読み方

`tests/`は合成データのみ。TST番号付き単体試験は30シナリオ全体の完了を意味しない。TST-29の人間確定・承認抑止は合成試験済みだが、画面UAT・権限別API試験・実Azure再評価は未実施。実Azure権限・Queue再配送、Project権限・本番相当更新、負荷・Shadow・モデル品質も個別に統合/UATで記録する。TST-11/12はドメイン比較関数、TST-22/23はIssue／Project段階の共通登録関数を通した合成回帰試験で、実環境のQueue再配送までは証明しない。テスト件数は実行結果を正とする。

## 2026-10-25〜26 配置・実データ検証

- [main CI](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40154424227)の検査済み成果物を[手動CD](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40155294666)で配置。APIの6関数とExporterの1関数を認識。
- 匿名アクセスの401、Entra初回同意後の画面表示、API内JWT検証によるGovernanceロール、評価一覧の空配列を実確認。初回認証コールバックで500が発生したが再アクセスで成功。原因未確定のため、再現診断用の認証ログを専用Workspaceへ有効化。
- 取得ボタンのPOST、Service Healthの数値LastUpdateTime変換、部分取得エラー表示を修正。PR [#7](https://github.com/kdkwakaba/azure-retirement-planner/pull/7) と [#8](https://github.com/kdkwakaba/azure-retirement-planner/pull/8) をmainへ反映。PR #8 の [main CI](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40196490817) と [再配置](https://github.com/kdkwakaba/azure-retirement-planner/actions/runs/40196936388) は成功。
- 2026-10-26、Entra認証済み画面から実同期し、Service Health通知7件・Resource Graph構成2件を取得。7件の評価をQueue経由で生成し、一覧・詳細表示を確認。全件scopeComplete=true、validationErrorsは空。Resource IDや実通知本文はこの記録へ複製しない。
- 実データ7件の当初評価はモデルUnavailableで作成され、後続リリースにより再同期した。1件の詳細でDecision-1 v1のAbstainedを確認し、不確実性レビューを維持した。全件の応答集計、Advisor関連付け、明示対象Resource判定、3サービスの精度、GitHub Project登録、Poison再処理は未検証。
- Decision-1のモデル呼出回数は200/日、要求Token上限なし。定期同期・通知受付・外部登録は無効。Entra資格情報は2027-01-23に期限切れ。PoC継続時は期限前に更新し、終了時は失効する。

## 2026-10-26 Decision-1配置

Foundry `[foundry-resource-name-removed]` に `arp-decision-1`（Microsoft-Decision-1 v1、DataZoneStandard、capacity 500）を配置し、provisioningState Succeeded・deploymentState Runningを確認。現在のカタログクォータ内であり、デプロイメントのレート制限は500 requests/minute・500,000 tokens/minute。これは要求ごとの生成トークン上限ではなくサービスのスループット上限。利用量を要求ごとに切る設定はしていない。DECISION_ENDPOINT／DEPLOYMENT／MODEL_VERSIONをアプリへ設定し、API Managed IdentityにFoundry限定の推論ロールを付与した。CLI利用者にもFoundryアカウント単位でCognitive Services Userを付与し、1回の契約疎通と合成3事例×3回を実行した。9/9で選択肢・確率Schema検証を通過し、すべてUnknownを含んでAbstained相当。合成評価は精度を証明しない。詳細と不整合は`docs/spike-and-testing.md`を参照。説明LLMは未完了。モデル呼出枠は200/日、要求Token上限は設定しない。PoC累計20,000円は利用者がCost Managementで確認し、自動停止は実装しない。Cost Managementの予算通知は補助情報で、反映は遅延する。

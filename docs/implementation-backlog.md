# 実装タスクと検証状態

2026-10-24。状態はコードの実装と接続検証を分ける。ローカル検査合格はPoC成功・実環境動作・モデル品質の証明ではない。

| ID | Epic / 作業・成果物 | 依存 | 完了条件 | 状態 | Size / Role / 並列可 |
|---|---|---|---|---|---|
| IMP-01 | Foundation: npm workspaces、TS/React、整形・型・Lint・Lockfile | — | 再現可能なインストールと検査 | 実装済 | M / Dev / Yes |
| IMP-02 | Security: Node24、完全SHA Actions、全npm依存監査、日次保守 | 01 | 既知脆弱性0、EOL拒否、検査障害は失敗 | 実装済。ActionsのAdvisory調査はリリース時にも確認 | M / Security / Yes |
| IMP-03 | Foundation: Schema、Evidence、Hash、元データ・原出力保存 | 01 | 厳密Schema、承認変更検知、原出力の保存 | 実装済。Azure永続化の実接続未検証 | M / Dev / Yes |
| IMP-04 | IaC: Flex2アプリ、Storage、Key Vault、監視、MI、Entra設定 | 01 | 静的コンパイル＋対象RGで疎通 | コード・静的検証済。デプロイ待ち | L / Cloud / Yes |
| IMP-05 | Release: OIDC Bootstrap、CI成果物Hash、What-if手動CD | 02,04 | main CI成果物のみ、差分Hash一致、権限分離 | 実装済。クラウド実行待ち | L / Cloud / Yes |
| IMP-06 | Ingestion: Secure Webhook、原本受付、Queue/Outbox | 03,04 | アプリ権限検証、重複・停止・再開・Poison確認 | 実装済。SP-03実通知配送待ち | L / Dev+Cloud / Yes |
| IMP-07 | Discovery: ARG Health Advisory、Advisor関連、3サービス構成 | 03 | 全ページ、部分失敗、公式明示対象・不明を区別 | 実装済。SP-02実Payload照合待ち | L / Dev / Yes |
| IMP-08 | Normalization: 非推奨ほか4種、版・旧通知・不明日付 | 07 | 非推奨開始日を廃止日にせず旧版巻戻し拒否 | 実装済。無関係通知の人間による対象外確定UIは追加対象 | M / Dev / No |
| IMP-09 | Context: タグ集約、未設定Owner・業務情報の確認 | 07 | 構成は実値、業務値は推測しない | 最小実装。CMDB、依存探索、業務情報全項目の入力は追加対象 | M / Dev+Architect / Yes |
| IMP-10 | Spike: Decision-1と説明モデルの利用条件・MI・応答契約 | 04,05 | SP-01/04。3事例×3回、確率・版・費用の実測 | 接続アダプター実装、ライブ待ち | L / AI+Cloud / Yes |
| IMP-11 | Decision: 影響2軸、P1〜P4、余裕、低確率・欠損レビュー | 03 | 境界日、未確定、移行強制なしを単体試験 | 実装済 | M / Architect+Dev / Yes |
| IMP-12 | Explanation: 10区分、ID別名化、根拠参照、作業案 | 10,11 | 元応答保存、Schema・ID参照検証、失敗は手動確認 | 実装済。モデルによる意味的Groundingは実評価待ち | L / AI / No |
| IMP-13 | Guardrails: ID・日付・DAG・根拠・Owner・承認Hash | 03,11 | 架空・旧版・不適合の登録0 | 実装済。許可URL本文の取得と後継サービスの意味検証は追加対象 | L / Security+Dev / Yes |
| IMP-14 | Human Review: Azure配信React、訂正、部分承認・保留・差戻し | 04,11,13 | APIロール、訂正新版、承認失効、Entraログイン | 実装・ビルド済。実ブラウザーUAT待ち | L / Frontend+Security / Yes |
| IMP-15 | Integration: Issue作成→Project追加、相関ID・成否不明停止 | 13,14 | 無承認拒否、重複防止、Project失敗のみ再開 | アダプター・固定応答契約試験済。SP-05待ち | L / Dev / Yes |
| IMP-16 | Integration: Projectフィールド、改訂Issue更新・進捗取込 | 15 | 項目対応、競合・手動編集を保持、自動Closeなし | 未実装。Project契約確定後 | L / Dev / No |
| IMP-17 | Operations: 再評価・処理ログ・Poison・復旧Runbook | 06–15 | 日次再取得、部分失敗表示、成否不明の手動照合 | 最小実装。集計KPI・通知・管理画面は追加対象 | M / SRE / Yes |
| IMP-18 | Cost: 回数上限・Token実測・累計予算ゲート | 10,17 | 5千/2万円、50/80/100%制御と残費用把握 | 日次回数のみ実装。金額連動・通知未実装、有料実評価前の必須作業 | M / SRE+FinOps / Yes |
| IMP-19 | Evaluation: 30ケース、108回、精度・Recall・Override | 07–16 | 当時版・独立正解集合、指標・未評価の記録 | 単体・固定応答試験のみ。実品質評価待ち | L / QA+Architect / Yes |
| IMP-20 | Demo/UAT: 同一実環境で3分ライブ | 10,14–19 | 事前サインイン、実通知、判断→根拠→承認→登録 | リハーサル待ち。合成をライブ取得と偽らない | M / Presenter+QA / No |
| IMP-21 | Cleanup: 作成台帳と専用資源・Project・秘密の撤去 | 04,15 | 削除対象照合、残存保持・残費用報告 | Runbookあり。実資源は未作成 | M / Cloud+Owner / No |

## 未確定情報と次のゲート

- Subscription ID、専用RG、リージョン、Tenant ID、既存Foundry・App登録の有無は回答待ち。秘密値はチャットへ貼らずKey Vaultへ設定する。
- 現在のGitHub CLI Tokenはread:projectスコープがなくProject列挙を拒否された。個人ProjectのToken種別・権限とProject IDはSP-05で実証する。本番Org＋GitHub Appの実装は別ゲート。
- Decision-1の型・選択肢・確率は公式文書にあるが、このSubscriptionでの利用可否・応答の詳細フィールド・MI/RBACはライブ未確認。互換に見える別APIへ自動切替しない。
- 初回の有料評価前にIMP-18を完了する。日次回数は金額予算の代替ではない。初期値0で推論・外部登録・定期同期・通知を無効にする。

## 検証の読み方

`tests/`は合成データのみ。TST番号付き単体試験は30シナリオ全体の完了を意味しない。TST-11/12/22/23/29、実Azure権限・Queue再配送、Project更新・負荷・Shadow・モデル品質は個別に統合/UATで記録する。テスト件数は実行結果を正とする。

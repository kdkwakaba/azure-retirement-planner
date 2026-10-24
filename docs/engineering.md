# 開発・運用基準

2026-10-24 / 状態: 採用済み方針。アプリ・IaC・Workflow・Azure環境は未実装。

## 技術とモノレポ

採用済みはBicep、TypeScript＋React、GitHub Actions CI＋手動CD。npm workspaces、Functions Flex Consumption、React＋Viteを基本構成案とする。確定Version・リージョン・SKUはサポートと実現性確認後に記録し、EOLの固定例を残さない。

apps/assessment-api、apps/work-item-exporter、apps/review-webを実行単位、packages/contracts・domain・adaptersを共有単位とする計画。infra/bootstrap・modules・environments、prompts、policies、tests、spikes、scriptsを用途に応じ追加。まだ存在しないフォルダ・コマンドを実装済みとして扱わない。

Schema・イベント・永続形式は版管理し、原本を保持する。破壊的変更は移行と旧版再処理を検討する。業務基準はdecision-policy.mdと将来policies、Promptは将来promptsに集約しSkillsへ重複しない。

## CI・CD

短命ブランチ＋PRを推奨。個人PoCでは本人レビューの確認記録、本番では第三者レビューへ移行する。契約上利用できるブランチ保護・Environment機能はSpikeで確認する。

通常PR CIはformat／lint／型／ビルド／Unit／契約・Schema／Bicep静的検証／依存監査／文書リンク。共有契約・Lockfile変更は依存アプリも確認。差分検査の省略を成功扱いしない。CIは実モデル、有料Azure処理、GitHub作業登録を呼ばず、固定・合成資材を用いる。実接続とモデル評価は別の許可された手動実行。

mainの検査済Commitに成果物Hashを付け、手動でリリース候補選択→IaC検証・What-if→差分確認→手動適用→同成果物配置→疎通確認→記録。手動起動は第三者強制承認の代替ではない。What-ifに必要な書込相当権限を未信頼PRへ渡さない。未信頼コードを特権Workflowでcheckoutして実行しない。

OIDCでActions→Azure。Bootstrap（RG、初回Identity、Federation、RBAC）と通常CDを分離。権限付与・Subscription-wide変更を通常CDへ持たせない。評価対象の変更は禁止だが、本システム専用環境は承認されたCDで変更可能。アプリ前版再配置とデータ・IaC復旧は別であり不可逆変更を自動切戻ししない。

## 画面・データ・登壇

Spike、PoC、登壇ともAzure上の画面とEntra ID認証。APIはToken・役割・承認対象を検証し、UIの表示制御だけに頼らない。サービス間MI、Actions OIDC、GitHub資格情報を分離。

登壇はデータを分けず同じ実データと処理経路でライブ実行。保存結果再生やlocalhostを標準にしない。3分のライブ可否、実対象の有無、モデル遅延、事前サインインをSpike・リハーサルで確認する。履歴データを使う場面は履歴と表示し、合成を実取得と偽らない。

Gitへ入れないものは秘密、実環境Snapshot、モデル実入出力、個人情報、環境依存の実設定。実データは許可されたAzure保存先で管理。通常テスト用の非実データfixtureはコードと共に保持できる。公開資料に見せる範囲は利用権限・秘密情報・個人情報を確認する。

## 依存・ランタイムの保守

NodeとFunctionsの両方でサポートされるLTSを確認。直接・間接・dev依存、Actions、Bicep／CLI／テストツールも対象。EOL・既知脆弱性のある版は新規採用・リリース不可。検査障害は未完了。サポート表のないライブラリに架空EOLを定義しない。

Lockfileとnpm ciで再現性を確保し、Actionsは完全SHA固定。固定は更新不要を意味しない。新規採用・PR・デプロイ直前・日次監査、定期EOL確認を将来Workflowで実装する。最新Advisoryによる再検査を行い、未知の脆弱性ゼロを保証しない。脆弱性の包括ignore・閾値低下で通さない。

既存環境に新たな問題が判明した場合は新規リリースを止め、悪用可能性・到達性・露出・修正版を調べ、更新または機能停止・接続遮断・資格情報失効を検討する。評価・承認の業務SLAなしと、セキュリティ対応期限は別。具体的な対応期限・責任者・連絡先は未決で、本番運用前に決める。

## 費用と終了処理

Spikeは期間累計5,000円、PoCはSpike込み累計20,000円。50/80/100%通知、80%抑制、上限新規推論停止。課金反映遅延とStorage／ログ残費用を考慮する。CIの追加有料分も対象。実行回数・Token・時間を管理し無断増額しない。

PoC終了後90日保持という旧方針は撤回。終了時に専用Azureリソース、RG外に作成した通知・RBAC・Federation／App登録、Project、Issue・添付、実データ、資格情報、実データを含むCIログ・成果物を削除／失効する。既存共有資源や評価対象は触らない。

作成時に台帳へ所有者、Scope、ID、用途、共有／専用、削除方法、依存を記録。削除は専用対象とユーザー承認範囲を照合して実施し、データ保護の削除待ち・サービス側保持等で即時物理消去できないものは残存として報告する。削除できると未確認のAPIを仮定しない。コード・設計書・非実データテスト資材のみリポジトリに残す。

## 完了条件と現状

動作すること→要件を満たすこと→必要なテスト・ビルド・セキュリティ検査合格、をすべて満たす。優先順は検査を省略する意味ではない。今回の文書・Skill作成はリンク・構文・メタデータ・内容整合を検証し、未実装アプリのビルド・Azure疎通を成功扱いしない。

現時点でREADME・設計書・AGENTS.md・3 Skillsのみ実在する。npm／Bicep／Actionsのコマンドは初期実装後に実際の設定へ合わせて追記する。Shadow→登録→本番ゲート、UI配信サービス、対応Version、セキュリティ対応期限は未確定。

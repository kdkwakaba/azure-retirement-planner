# テストとAssessment品質

本書では、Applicationを保守する検査と、特定組織でModel判断を利用する前に必要な追加Evidenceを説明します。

## Repositoryの自動検査

npm ci --ignore-scriptsとnpm run verifyを実行します。CIはFormat、Lint、Type、Unit／Contract動作、Build、文書Link、Runtime／Artifact制約、npm Advisoryを確認します。BicepもCIでCompile・検査します。通常CIではCloud変更、有料Model呼出、GitHub Exportを行いません。

合成Fixtureは実Tenant ID、文書、Model Prompt／OutputをRepositoryに保存せず、境界Caseを確認します。Fixtureの成功は、実行したContractまたはRuleだけを確認したことを意味します。

## テスト観点

- Lifecycle分類：非推奨、新規作成停止、サポート終了、退役、更新、取消、曖昧・欠落日付。
- Discovery：全Page取得、複数Subscription、未対応Profile、明示Target、不明属性、一部失敗、Permission Error、空結果。
- 判断／Policy：影響軸、優先度境界、Deadline、不明値、Model Abstention、同点、Rule下限、必須／推奨作業の区別。
- Evidence／版管理：参照欠落・誤Scope、Source更新、人の訂正、Hash変更、承認失効、不変履歴。
- SharePoint：Folder権限、上限、変更・削除文書、抽出失敗、Citation位置、Fact訂正／除外、Source区分、依存Graph不正。
- 認可：未認証Request、User／Application Token分離、Role別Read、訂正、Governance、同期、通知、Export。
- Export：未承認、古い版、重複Request、Issue／Project一部成功、再試行、応答喪失、安全なError処理。
- Resilience：Queue再試行、Poison処理、Storage競合、Timeout、Throttling、不正Provider応答、Model停止。

## Model品質評価

Repositoryには版管理評価SetのMetricとManifestを検証するUtilityがあります。評価結果にはSource区分、Source／版参照、Assessment日、Input Hash、Model／Deployment／Prompt／Rule／Schema版、呼出時刻、Reviewer数／状態、期待する人の判断を記録します。本番Payloadと個人情報は保護されたStorageへ保管し、RepositoryやCI Artifactへ含めません。

Service、環境、影響、期限、業務Context、入力完全性、対応経路を変えた独立Scenarioを用意します。同一Lifecycle Eventの全版を同じ評価Splitへまとめます。同じInputの反復実行はModel変動を測りますが、独立Scenario数には加えません。

少なくとも次の指標を報告してください。

| 指標 | 目的 |
|---|---|
| Resource候補Precision／Recall | 通知／Profile別の候補網羅と誤検出 |
| 影響／優先度の一致 | 重大な過小評価を含む独立した人の判断との比較 |
| Owner割当一致 | 正しい担当、複数候補、Abstentionを分ける |
| 裏付けのない主張／Reference | 不当な主張、架空ID、Evidence欠落、不正Citationを数える |
| Work Item Precision／Recall | 提案を承認済み必須作業と比較し、推奨作業は別途評価 |
| Override／Abstention | 判断項目ごとの不一致、人の訂正、Model Abstention |
| 運用品質 | Latency、失敗率、Review時間、Assessmentあたり費用 |

Model Scoreは正解率でも校正済み信頼度でもありません。小規模な評価Setでは全Azure Service／全組織での性能を示せません。自動Outputを使ってReviewを減らす前に、採用組織と受入基準、独立した正解データ、Data Governance、監視を合意してください。

## 必須安全条件

- 裏付けのないResource ID、日付、後継、費用、業務Factを確認済みEvidenceとして受け入れない。
- Unknown／取得不完全を影響なしへ暗黙に変換しない。
- 古い承認とAssessment Hashを拒否する。
- Assessment WorkflowからAzure Resourceを変更しない。
- 未承認、重複、範囲外のWork ItemをExportしない。
- 外部処理の一部成功は再試行前に照合し、全成功と表示しない。

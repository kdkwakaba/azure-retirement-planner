# アーキテクチャ決定

本書は現行実装に関係する決定を記録します。過去の議論や環境固有の運用記録は含みません。

## 採用済みの決定

| 領域 | 決定 |
|---|---|
| 製品範囲 | Lifecycle影響評価と計画を支援する。Incident対応や評価対象Resource変更は実行しない。 |
| Data Source | Azure Service Health、Resource Graph、一部Advisor／Control Plane情報、明示的に設定したSharePoint Sourceを使う。Source、時刻、Scope、取得完全性を保持する。 |
| Identity | 利用者はEntra認証とAPI Role検査、Azure Service接続はManaged Identity、配置自動化はOIDCを使う。 |
| 判断責務 | Microsoft-Decision-1が型付き判断案を返す。決定的RuleがPolicy制約を適用する。説明生成はEvidenceを整理する。人が業務Factを確認して作業を承認する。 |
| 不確実性 | UnknownとEvidence不足を明示する。不足情報を影響なしと解釈しない。 |
| 影響 | 未対応時のリスクと対応中・対応後の影響を分ける。技術的変更規模を業務影響と同一視しない。 |
| Assessment ID | Lifecycle Event／Workload単位で版管理する。訂正とSource更新で新版を作り、影響する承認を無効にする。 |
| Evidence | 不変のSource Evidence、Model呼出Metadata、人の訂正、承認Hashを保持する。裏付けのない日付、ID、費用、Owner、後継Serviceを作らない。 |
| SharePoint | 選択されたGraph権限で設定Folderを読み取る。Fact候補は人が確認し、依存Linkを指定してからAssessment Evidenceに使う。 |
| 外部作業 | 人が承認したWork ItemだけをExportする。GitHub Issue作成とProject項目更新は別の再試行可能な処理とする。外部IssueのCloseだけでは内部作業を完了しない。 |
| Infrastructure | Planner自身のInfrastructureをBicepとレビュー済みRelease Workflowで管理する。Bootstrap権限は通常配置から分離する。 |
| Test Data | 隔離された合成RecordをLive通知・Resourceと分離する。Test専用Endpointは明示設定が必要で、Test Mode無効時は使えない。 |

## 配置時に決める項目

- 対象Tenant／Subscription Scope、必要Role、Identity割当。
- 適用Resource Profile、業務Owner、重要度、作業期間、Calendar、Review責務。
- SharePoint Site／Folder、File上限、保持、Assessmentへ入れる確認済みFact。
- Model Deployment、Region、Quota、費用制御、保持、承認済みData送信先。
- GitHub Owner、Repository、Project、Token権限、Export有効化、保持Policy。
- Network分離、災害復旧、運用SLO、Security対応責任者、規制要件。

これらの値は環境固有です。本番IDや認証情報を公開Repositoryへ入れないでください。現行実装の制約は[実装状況](implementation-backlog.md)を参照してください。

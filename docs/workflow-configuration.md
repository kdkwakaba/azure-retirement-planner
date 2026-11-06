# 組織別Workflow設定

アプリはconfig/workflow-policy.jsonをRuntimeで読み込み、Schemaに照合する。Policy版と正規化HashをAssessmentに記録する。変更後は検証し、新しいAssessmentを作る。古い承認を自動で引き継がない。

## 設定できる項目

- 作業カテゴリ、Resource種別、環境、影響に基づくチーム／部門Roleと担当候補ルール。
- 調整Roleと承認段階の説明。
- 作業カテゴリ、必須／推奨区分、完了条件、依存順序。
- Source、Record ID、更新時刻、確認情報を持つ明示的なWorkload業務Context Record。

ルールは担当チーム候補を返すもので、チームを確定Ownerと断言しない。複数候補を保持する。担当の欠落・競合、前提条件の欠落、依存関係の循環は人の確認が必要。設定上の承認経路は説明情報であり、追加API Roleを作成・強制しない。

## 現在の設定

Repository内のPolicyは、一般的なインフラ、アプリケーション、情報システムのRole名とカテゴリ別振り分けルールを含む。Workload固有の業務Profile、作業Template、確認済みOwner、承認期間、停止期間、重要度Recordは含まない。設定ラベルは振り分け候補であり、組織構造や実在Identityを確認したものではない。

APIはGovernance管理の業務Context Recordも扱える。Recordは版管理され、WorkloadとSource Referenceに結び付く。これは制御された手入力APIであり、自動CMDB／ServiceNow Connectorではない。現行レビュー画面に汎用業務Contextの入力画面はない。

## 変更手順

1. JSON Policyの変更をPull Requestで提案する。
2. Schema、Role Reference、照合ルール、重複、依存循環を検証する。
3. Policy Ownerと影響を受けるWorkload Ownerが担当候補と承認説明を確認する。
4. 承認済みPolicy版とHashを記録し、対象Assessmentを再評価する。
5. 新版が旧Assessmentの承認を引き継がないことを確認する。

認証情報、個人情報、未確認の業務情報をPolicyに含めない。個人名ではなくRole IDを使う。任意コードやModelが生成したチームを設定に追加しない。

## 作業と調整の動作

明示的に確認された条件に応じて、顧客連絡、チーム間調整、Vendor評価、費用確認、予算承認、契約確認、文書更新、CMDB更新を提案できる。証拠なしにVendor利用、費用、契約義務、移行必須を推定しない。Requiredは根拠のある採用済み対応に限る。不確実な確認作業はRecommendedとする。

画面では初期調整先として情報システム部門、業務判断RoleとしてWorkload Owner、Policy／例外RoleとしてGovernanceを表示する場合がある。これらは推奨責務であり、実際の利用者割当やAPI認可を変更しない。

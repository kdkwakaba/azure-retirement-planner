# 利用者向けガイド

Review画面はAssessment APIから配信され、Entra認証と割り当て済みApplication Roleが必要です。APIも画面と同じRole制御を実施します。

## Role

| Role | 主なアクセス |
|---|---|
| Reader | Assessment、Evidence、Status、設定済みSourceの閲覧 |
| Reviewer | Assessment訂正、作業Review／承認 |
| Operator | 同期開始、処理状況の確認 |
| Governance | SharePoint Source／Fact管理、同期、訂正、Review |
| NotificationSender | 設定された通知EndpointへのApplication専用アクセス |

Role割当は配置組織が行います。PolicyにRole名があるだけではIdentityへの割当やAPIアクセス許可にはなりません。

## アプリを開き、同期する

1. 管理者から案内されたアプリURLを開き、組織アカウントでサインインする。
2. 画面に表示されたRoleが必要な操作を許可していることを確認する。
3. **Azure情報を取得・評価**を使って通知とAzure構成を取得し、Assessmentを作成する。設定Scopeを読み取るだけで、評価対象Resourceは変更しない。
4. 非同期処理の場合はQueue完了を待ち、**評価結果を更新**して一覧を読み直す。
5. 一部Sourceの失敗は取得状態に表示される。空一覧だけでは該当Resourceがないとは限らない。

## Assessmentを読む

通知を選択すると、Event／版、Workload、Assessment日、公式期限、候補Resource、2つの影響軸、優先度、Model呼出状態、Evidence、不足情報、作業案を確認できます。

Resource分類はAzure Resourceが通知に該当する可能性を示します。影響は業務に起き得ることを示します。別々の判断です。UnknownはEvidenceが結論を支えない状態で、非該当を意味しません。Verification Requiredには具体的な不足Factと確認作業が示されます。

Decision Score分布はModelが返した順序尺度であり、校正済み確率や正解率ではありません。最高Categoryが同点なら複数表示される場合があります。説明、Rule制約、Evidence、不確実性を合わせて確認してください。

Microsoft公式Evidenceは、利用可能で検証済みのSource URLがあれば表示します。一部Service Health通知に公開URLがない場合があります。ApplicationはURLを創作しません。翻訳は参考情報であり公式文の代替ではありません。

## Assessment情報を訂正する

ReviewerまたはGovernanceは**業務影響・公式期限・計画を確認／訂正する**を開き、新しいAssessment版を作れます。訂正ごとにSourceと理由を記録します。非推奨開始、新規作成停止、サポート終了、退役、移行期限を別々に保持します。日付、Workload Owner、影響、作業期間を裏付けられない場合は未確定のままにし、必要な情報を記録します。

前版とEvidenceは履歴に残ります。重要な訂正は該当する承認を無効にします。

## 作業をReviewし、対応不要にする

**作業案・部分承認**で各項目の目的、Category、必須／推奨、Resource Scope、Team候補、Schedule状態、依存、完了条件を確認します。Requiredは不確かな移行が必須である意味ではありません。確認作業と移行作業は別です。

作業を承認するには：

1. 進められる項目だけを選ぶ。
2. 判断理由とEvidenceを入力する。
3. **選択した作業を承認**を選ぶ。

承認は表示中のAssessment版とHashに紐付きます。Azure変更の許可ではありません。

作業を保留するには理由を入力し、**保留**を選ぶ。訂正を求めるには理由を入力して**差し戻し**を選ぶ。作業不要として一覧から隠すにはScopeとEvidenceを入力し、**対応不要として一覧から外す**を選ぶ。元の通知とReview履歴は保持され、Azure Resource削除やGitHub Issue Closeは行いません。

## SharePoint Source

SharePoint管理Panelは画面下部に折り畳んであります。GovernanceはFolder Source登録、文書Fact抽出とReviewを行えます。OperatorまたはGovernanceは同期できます。

同期は文書Snapshotを保存するだけで、抽出文を信頼済みにはしません。GovernanceがSource位置を確かめ、誤った候補を編集／除外し、Factを確認して依存Resourceを明示Linkする必要があります。確認済みLive Source Factは同一Workloadの後続Assessmentに使えます。

Site／Drive／Folder ID、Graph権限、配置設定は[SharePoint接続ガイド](sharepoint-connection-guide.md)を参照してください。

## GitHub Export

保守対象DeploymentではWork Item Exportが有効です。Exportには現行Assessmentの承認、有効なGitHub設定、利用可能な認証情報が必要です。Issue作成とProject項目更新は別処理です。一部成功した場合、再試行前に照合してください。保守対象DeploymentのProject進捗同期は無効です。

Exporterは現行版で承認されたWork Itemだけを作成・更新します。Azureは変更しません。GitHub IssueのCloseだけではPlanner Assessmentを完了にしません。

## トラブルシューティング

| 状況 | 確認事項 |
|---|---|
| 再サインインを求められる | 案内されたアプリURLからサインインし、Assessment画面へ戻る |
| Assessment一覧が空 | サインイン、Role、Azure同期完了、日付／Scope、Source取得状態 |
| 同期後も結果が出ない | Queue完了を待って画面更新。OperatorまたはGovernanceにRun状態を確認してもらう |
| Unknown／Abstained | 分類理由、不足Attribute、Evidence、Model呼出状態、確認作業を読む。Evidenceなしで値を決めない |
| No resources found | Scope、Profile網羅性、Discovery完全性を確認。業務影響なしや対応不要の判断ではない |
| 説明が利用できない | Model呼出状態を確認。失敗説明を固定Templateで埋めず、一般的なLifecycle説明が別に表示される場合がある |
| 訂正／承認が拒否される | Role、理由／Evidence、現行Assessment版、作業ID、Validation Errorを確認。Assessment変更後なら画面更新 |
| GitHub Exportが一部失敗または停止 | Export Stageと安全なFailure Categoryを確認。Project更新前にIssueが作られた場合、再試行前に照合 |
| SharePoint Fileが見えない | Site／Drive／Folder、Graph PermissionとSite許可、拡張子、File上限、同期状態を確認 |

運用Issueには時刻、操作、Assessment／Correlation ID、安全なError Category、結果を記録します。公開IssueにCredential、Token、完全なResource ID、Source文書を含めないでください。

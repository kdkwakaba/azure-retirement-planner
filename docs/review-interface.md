# レビュー画面の動作と確認基準

本書はReview操作で期待する画面／API動作を定めます。Dataを書き込む確認や外部Serviceを呼ぶ確認は、明示的に許可された環境と対象で行います。

## 読み取り

- Reader権限を持つ認証済み利用者はAssessment一覧、集計、選択Assessment、Evidence、Source状態を開ける。
- 未認証Requestは認証応答を返し、Assessment内容やResource IDを公開しない。
- 一覧更新は表示Recordを再取得し、Assessment、Evidence、Work Item、承認、外部Systemを変更しない。
- 通知選択時は対応するEvent／Workload Assessmentの現行版だけを表示する。
- 取得不完全、Unknown分類、Evidence欠落、Model呼出失敗を状態として表示する。

## 訂正とReview

- ReviewerまたはGovernanceだけが訂正を送信できる。業務ContextとSharePoint Fact／Sourceを管理できるのはGovernanceだけ。
- Scopeや確認済みFactを変える訂正には理由とEvidenceが必要。新しい不変Assessment版を作る。
- Unknown、不完全、競合Evidenceを承認のために非該当へ変えない。
- 承認には現行Work Itemが1件以上、理由、Assessment版／Hash一致が必要。部分承認は選択Work IDだけに適用する。
- 保留、差し戻し、対応不要は理由を必須とする。対応不要は通常一覧から隠すがRecord／Evidenceを保持する。
- 判断に影響するEvidence、日付、Scope、影響、優先度、Owner、Work、Package Hashが変わると該当する古い承認を拒否する。

## 外部操作

- 同期にはOperatorまたはGovernanceと有効なSource設定が必要。
- 通知受信が有効な場合、NotificationSenderを持つApplication Tokenだけを受け付ける。
- GitHub ExportにはExport有効化、現行Work Itemの承認、有効な設定、使用可能な認証情報が必要。
- Issue作成とProject項目更新は別の処理段階。後段が失敗し前段が成功した場合は既存Issueを照合し重複を防ぐ。
- Project進捗同期は個別制御であり、Assessment判断や承認状態を変更しない。

## セキュリティ確認

画面と直接APIの両方を確認します。Controlを隠すだけでは認可になりません。全Write Routeで許可Role、現行版／Hash Guard、理由／Evidence要件、未認可／古いRequestへの応答を確認します。

明示許可なしに実顧客Workloadを使って破壊的操作、訂正、承認、Exportを試さないでください。実Resource ID、Payload、Token、Screenshot、文書抜粋をTest結果や公開Issueへ含めないでください。

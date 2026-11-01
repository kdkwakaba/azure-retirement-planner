# 合成UAT: Decision-1評価とGitHub Issue／Project登録

## 目的と境界

このUATは、合成通知をMicrosoft-Decision-1で評価し、結果を人間が確認・承認した後に、親Issue／フェーズIssue／作業Issueを作成してGitHub Projectへ追加できることを確認します。Decision-1は本番と同じ`groundedInput`、`decide`アダプター、日次呼出枠、原応答・結果保存、ルール適用を使います。

これは実通知の取得試験ではありません。Service Health通知Webhook、Azure Resource Graphの実インベントリ取得、説明LLMは呼び出しません。モデルには別名化した合成Resource IDと合成通知を送り、実環境やMicrosoft公式情報の事実とは扱いません。説明欄はDecision-1の型付き出力を表示し、説明LLMは`NotRequired`として監査記録します。

合成イベントには `ARP-SYNTHETIC-UAT-001`、架空Subscription ID `00000000-0000-4000-8000-000000000001`、`synthetic-uat` Resource Groupの架空Resource IDだけを使います。EvidenceはInternal扱いで、公式事実ではない旨を表示します。Decision-1評価は成功しても、作業を承認するまではGitHubへ登録できません。合成承認は通常の外部登録Outboxへ入りません。Azureリソースの変更も行いません。

UATのIssue作成は専用API経路からGitHub連携クライアントを呼びます。Issue作成・Project追加の資格情報とAPI契約を確認しますが、Storage Queueを通る本番Exporterの再試行運用までは検証しません。

## 有効化前提

- 変更がmainへマージされ、CI成功後の手動CDでアプリとBicepが配置済みであること。
- GitHub Actions Repository Variable `ARP_SYNTHETIC_UAT_ENABLED` を `true` に設定すること。未設定／falseが既定で、UATボタンとAPI経路は無効です。
- What-Ifで `SYNTHETIC_UAT_ENABLED=true` のApp Setting変更を確認し、承認済みPlan Hashを使って通常の手動CDを実行すること。コードをGitHubへ反映しただけでは稼働中アプリは変わりません。
- Key Vaultの `github-token` が存在し、GitHubの対象RepositoryでIssue作成、個人Projectへの追加・フィールド更新を許可されていること。個人PATは発行・更新を手動で行い、値をログ、Git、Actions Variableへ置かないこと。
- デプロイ設定がテスト用RepositoryとProjectを指すこと。PoCの例は `kdkwakaba/azure-retirement-planner` と `test-project` です。

## 操作

1. Entra認証済みレビュー画面を開き、画面上部の「合成UATを作成・Decision-1評価」を押す。これはDecision-1を最大1回呼び出す操作です。
2. 「[合成UAT]」の評価を開く。Model呼び出しの監査記録でDecisionが`Succeeded`であること、Resource IDが架空IDであること、EvidenceがInternalの合成データであることを確認する。`Proposed`は提案、`Abstained`は判断保留であり、どちらも人間レビューが必要です。
3. Decision-1の影響度、優先度、開始時期、難易度、プロジェクト化要否を確認する。合成入力へのモデル判断であって業務上の正解や公式期限ではありません。
4. 作業項目「[SYNTHETIC UAT] Decision-1評価とGitHub Project登録を確認」を選択し、理由を入力して「承認」を実行する。承認記録が作られ、本番Outboxが作られないことを確認する。
5. 「承認済み合成作業をGitHub Issueへ登録」を押し、確認ダイアログで明示的に続行する。画面では「Issueを作成中」「Projectに登録中」などの段階が順次表示され、処理中の段階以外はグレー表示されます。
6. 画面に表示されるIssueリンクを開き、タイトルの `[ARP][SYNTHETIC UAT]`、Decision-1の構造化出力、合成UATである旨を確認する。対象Projectに親／フェーズ／作業Issueが登録され、Sub-Issue関係ができていることを確認する。
7. 同じ登録操作を再度実行し、重複Issueが作られず既存Issueを返すことを確認する。
8. 検証後はActions Variableを `false` に戻し、What-Ifを確認して手動CDを実行する。UAT Issueはデモ記録として残るため、不要なら対象IssueとProject itemをGitHub上で削除する。

## 期待結果・失敗時

- UAT無効時は `GET /api/uat/status` が `enabled: false` を返し、seed/export APIは404となる。
- Decision-1が成功済みの同じ合成評価を再要求してもモデルを再度呼び出さず、保存済み評価を返す。失敗時はIssue登録を拒否する。
- 旧版のDecision未実行レコードがある場合はDecision-1を1回実行して新しいAssessment版を作り、旧承認は引き継がない。
- 作業項目が承認されていない、評価が訂正され古くなった、または別リソースが含まれる場合は409/400で停止し、GitHubへ登録しない。
- GitHub API失敗時は画面に失敗段階、エラー分類、GitHub HTTP状態（取得できる場合）、相関IDを表示する。Functionログは相関IDで検索する。GitHub GraphQLのHTTP 200応答に含まれる安全なエラーコードも分類し、プロバイダーの生メッセージやPATは画面・ログに出さない。
- Issue作成後にProject登録が失敗した場合は、作成済みIssueへのリンクと失敗した段階を表示する。再試行時は保存済みIssue IDまたは合成UAT相関マーカーを照合し、重複Issueを作らない。
- 失敗が `Forbidden` の場合は権限不足と判断できるが、それ以外の分類ではProject ID、設定済みフィールドID／選択肢ID、GitHub応答状態も確認する。PATにProject操作権限があることだけでIssue作成・Project登録の全API経路が成功するとは限らない。
- UAT進捗は専用の合成UAT状態レコードから取得する。通常ExporterのOutbox状態やGitHub Project表示と混同しない。
- Issue本文、タイトル、Resource IDに実Azure情報を含めない。

## テスト

CIの `npm run verify` は合成データのResource ID／Evidenceの隔離、Decision-1出力をAssessmentへ記録するルール適用、通常assessmentを合成fixtureと誤認しないことを検査します。またStoreテストで合成承認が通常Outboxを作らないことを確認します。実接続確認ではDecision-1呼出結果、上記手順のIssue作成、Project追加、二重実行の4点を記録します。

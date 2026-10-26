# レビュー画面UAT

状態: UAT手順を定義。2026-10-26時点の実環境では読み取り確認のみ。訂正・承認・外部登録の実行結果は未確認。

## 目的と安全境界

この手順は、Entra IDで保護されたレビュー画面について、一覧、詳細、判断根拠、不確実性、訂正・承認のガードを利用者視点で受け入れ確認する。UAT合格は、本番変更や実データの誤判定がないことを保証しない。

実AzureのUATは二段階に分ける。

1. **Live read-only**: 実通知・実評価の表示と権限制御を確認する。画面の「評価結果を更新」はGET読取のみで使用可。「Azure情報を取得・評価」は新しい評価・モデル利用・保存を起こすため、別途承認がない限り押さない。訂正保存、承認、Issue/Project登録は行わない。
2. **Controlled write-path**: 訂正、承認、OutOfScope、外部登録の拒否を検証する。現行の実評価を試験データとして変更しない。バージョン管理された匿名fixtureを使う統合試験を優先する。実環境での書込みが必要な場合は、担当者、対象評価ID、変更内容、復旧方法、外部登録無効を事前に特定し、実行前に承認を得る。

Assessmentの訂正は新しい版を保存する監査対象操作である。承認は外部Work Item送信待ちへ進める可能性がある。ブラウザー操作の許可やこの手順書の存在は、そのような書込みの承認を意味しない。実データ、Resource ID、トークン、個人情報をスクリーンショット、チケット、Git、CI成果物に保存しない。

## 実施前チェック

| 項目 | 確認内容 |
|---|---|
| 対象 | 専用PoCアプリのURL、リリースSHA、API/Exporterの状態を運用記録で確認 |
| 利用者 | テスト担当者のEntraサインインと割当App roleを確認。認証情報やTokenは記録しない |
| 範囲 | Management Group／Subscriptionは許可済み評価Scopeであること。評価対象へ書込み権限がないこと |
| 外部登録 | GitHub Issue／Project連携が無効。状態をUIと設定の読取で確認 |
| データ | Live read-onlyで画面に出た通知数・評価件数だけを記録。本文とIDは転記しない |
| 中止条件 | 認証・認可失敗、別テナント、取得範囲不完全、評価の版不一致、意図しない保存や外部送信を検出したら停止 |

## Live read-only シナリオ

各ケースに Pass / Fail / Blocked を記録し、記録者、UTC実施時刻、アプリSHA、環境名、証跡の保管先だけを残す。

| ID | 操作 | 期待結果 |
|---|---|---|
| UAT-R-01 | サインインしてレビュー画面を開く | Entra認証が必要。認証済みの利用者だけが画面を表示できる |
| UAT-R-02 | 評価一覧を表示し、通知を一つ選ぶ | 一覧と詳細が同一評価版を示す。表示件数を記録できる |
| UAT-R-03 | 影響リソース、確度、分類理由、不足属性を読む | Confirmed / Probable / Possible / Verification Required / Not Impacted / Unknown の状態と根拠が区別される。Advisorに表示されないだけでNot Impactedにならない |
| UAT-R-04 | 判断・説明・必要作業・Evidenceを読む | 公式事実、自社データ、ルール／モデル判断、Assumption、Unknown、人間確認が識別できる。引用先が確認できる |
| UAT-R-05 | 「評価結果を更新」を選ぶ | 読取だけで画面が更新され、訂正・評価起動・外部登録が発生しない |
| UAT-R-06 | 訂正欄を開き、対象判定と理由欄を確認する | ReviewRequired / InScope / OutOfScopeを選択できる。OutOfScopeには理由とHuman Evidenceが必要である旨が説明される。ここでは保存しない |
| UAT-R-07 | 「Azure情報を取得・評価」ボタンと状態表示を読む | 起動前に処理・モデル呼出し・保存が起きない。別途認可されない限り実行しない |
| UAT-R-08 | サインアウト後に保護画面へ戻る | 未認証画面はサインインへ誘導され、Assessment本文やResource IDを表示しない |

UAT-R-05〜07の画面操作を実施した場合も、フォーム送信・同期ボタン押下はしない。

## Controlled write-path シナリオ

以下は匿名化fixtureを用いる自動／統合試験とする。Live環境で試す場合は「実施前チェック」の書込み承認を別途記録する。

| ID | 事前条件と操作 | 期待結果 |
|---|---|---|
| UAT-W-01 | Reviewer権限でOutOfScopeを理由なしで保存 | APIが拒否。Assessment版、優先度、作業、Evidenceが変更されない |
| UAT-W-02 | 理由とHuman Evidenceを付けてOutOfScopeを保存 | 新Assessment版になる。公式分類・元モデル回答を保持し、人間判断を別Evidenceとして保存。現行の有効優先度・作業・承認対象を空にする |
| UAT-W-03 | OutOfScope版の承認と外部登録を試みる | UIで承認を表示しない。APIも拒否。Issue／Projectへの呼出しがない |
| UAT-W-04 | 対象外をInScopeまたはReviewRequiredへ戻す | 新しい再評価版として保存し、以前の承認を失効。再評価前の作業を再利用しない |
| UAT-W-05 | Unknown / Verification Requiredを含むCritical workloadをレビュー | Human reviewが必須。移行必須と誤表示せず、確認作業をRecommendedとして提示 |
| UAT-W-06 | 部分承認で選択したWork Itemだけを送る | 未選択項目は承認・送信されない。理由、packageHash、Assessment版が監査可能 |
| UAT-W-07 | 古いpackageHashまたは存在しないWork Item IDを送る | APIが拒否し、状態・外部システムに副作用がない |
| UAT-W-08 | Reader/Reviewer/Governanceの各roleで訂正・承認APIを呼ぶ | roleに応じて拒否／許可が一貫し、UI表示だけに依存しない |
| UAT-W-09 | Work Item連携を無効のまま有効操作を試みる | 登録なし。画面とAPIは無効状態を明示する |
| UAT-W-10 | 同一リクエスト再送と応答喪失を模擬 | 同一版・Issueの重複作成をしない。成否不明は照合または保留になる |

UAT-W-06〜10はGitHub本番Projectを使わず、HTTP境界のmock／contract試験で先に検証する。ライブの実登録はSP-05の個人非公開Project権限確認を別手順で実施する。

## 実施記録

Git内には実データを記録しない。次の要約だけを管理された監査場所に保存する。

- UAT run ID、ケースID、Pass / Fail / Blocked
- 実施者と確認者、UTC日時、アプリCommit SHA、環境名
- 使用したfixtureの版（Live read-onlyはfixtureなしと明記）
- 失敗ケースの相関IDとログ保管参照（秘密・本文・Resource IDなし）
- 書込みが発生した場合のAssessment版、承認記録、外部登録の有無と復旧確認
- 未解決事項、再試験条件、最終受入者



Fixture-only lower-layer evidence: existing CI case TST-29 verifies that a human-confirmed OutOfScope revision records Human Evidence, clears priority and work items, persists through refresh, and rejects a domain approval. This is not a browser/API integration UAT and does not exercise the live Assessment.

## Exit Criteria

- UAT-R-01〜08がLive read-onlyでPass。ただし機能が環境に存在しない場合はFailではなくBlockedとして記録し、修正後に再実施。
- UAT-W-01〜10がfixtureベースでPassし、書込み・権限・承認・重複防止の監査記録が確認できる。
- Critical workload、Unknown、Partial、OutOfScopeに対する人間レビュー条件を確認する。
- Blocked/Failに受入者がリスクを明示し、回避策と期限を記録するまでPoC UATを完了扱いにしない。
- 登壇デモは別途リハーサルし、実際の取得とfixture／合成試験を明確に区別する。

## 制約

この文書は手順と期待結果を定義する。ブラウザー自動化ツール、CIのE2E実行、認証セッションの保存、UAT実施自体は実装しない。現在のCIにはブラウザー・画面操作を許可する機能はなく、UAT文書を追加してもComputer UseのURL判定／操作制御は変更されない。

## UAT実施記録

### UAT-RUN-2026-10-26-READONLY-01

実施区分: Live read-only。専用PoC画面で認証済みセッションを使用。実通知タイトル、Resource ID、本文、Evidence本文、トークンはこの記録へ保存しない。

| ID | 結果 | 記録 |
|---|---|---|
| UAT-R-01 | Pass（認証済み画面のみ） | 認証済み画面を表示。匿名アクセス拒否とサインアウト後の挙動は未確認 |
| UAT-R-02 | Pass | 7件の通知一覧から1件を選択し、同じ評価の詳細を表示 |
| UAT-R-03 | Blocked | Resource一覧は表示された。既存AssessmentのUnknownに旧データ理由LegacyUnrecordedが付いており、現行ルールでの分類理由・不足属性の表示は再評価前のため検証できず |
| UAT-R-04 | Partial | 説明カテゴリとEvidence一覧は表示された。公式情報・社内情報・判断の各主張とEvidence IDの対応関係はこの画面確認だけでは検証できず |
| UAT-R-05 | Pass | 「評価結果を更新」を実行。7件の一覧と選択中の詳細が維持された |
| UAT-R-06 | Pass（未送信） | 訂正欄を展開。理由を空欄のまま対象判定を一時的にOutOfScopeへ切り替えても保存ボタンは無効。InScopeへ戻し、未送信を確認 |
| UAT-R-07 | Pass（明示依頼後の実行） | 再認証後に1回同期。7通知・構成2件の取得とQueue受付を確認し、一覧の7評価すべてに新しい評価時刻を確認。最初の401要求は未認証で処理開始せず |
| UAT-R-08 | Partial | 別タブから未認証GETで`/api/me`と`/api/assessments`を開き、いずれもAuthentication requiredを確認。認証済みセッションからのサインアウト後確認は未実施 |

UAT-R-05の更新は画面の読取更新で、訂正POST、評価同期、承認、外部Work Item登録は実行していない。UAT-R-06で変更したのはブラウザー上の未保存フォーム値のみで、保存前に元の選択へ戻した。Assessment版・Evidence・Work Itemに書込みはない。

Controlled write-path UAT-W-01〜10、ロール別API拒否、匿名アクセス、サインアウト後の確認は未実施。現在のAssessmentを試験データとして訂正・承認せず、fixtureまたは明示的に承認された対象を用いて別途実施する。実環境のスクリーンショットはResource ID等を含むためGitへ保存していない。

### 残課題

- 新しい評価版で分類理由・不足属性とEvidence紐づきを再確認する。
- 認証ロール別UI/APIと匿名アクセス拒否を確認する。
- UAT-W-01〜10をfixtureベースで実行する。外部Issue／Project登録はSP-05の権限確認と別承認後に限定する。


### UAT-RUN-2026-10-26-LIVE-02

先行セッションでは同期要求が401となり、アプリのサインイン画面へ誘導された。資格情報や同意入力は自動化せず、再サインイン後に画面へ戻った。最初の要求は処理開始していない。再認証後、ユーザーの依頼に基づき同期を一度実行した。

| 観点 | 結果 |
|---|---|
| 実取得 | 7通知、Azure構成2件を取得。Queue処理後、一覧の7評価すべてで新しい評価時刻を確認 |
| 判断 | 選択した最新評価はMicrosoft-Decision-1 v1 / Abstained。人間確認と確認作業を維持 |
| リソース分類 | 選択評価の2リソースはUnknown / NoApplicableProfile、環境は不明。Not Impactedへ誤分類していない |
| Evidence | 選択評価で3件（Microsoft 1、Azure 2）。6説明Claim中4件がEvidence一覧IDに一致し、参照切れ0件。残る2件はUnknownかつ「なし／不明」と明示 |
| 現行認可 | 再認証後の同期POSTは受理。現セッションに同期可能なロールがあることを確認したが、実ロール名・別ロールの拒否は未確認 |
| 匿名API | 独立タブから`/api/me`・`/api/assessments`を読み取り、両方でAuthentication requiredを確認。Response body以外のAssessmentデータは取得・表示していない |
| 副作用 | 同期・評価データはPoCアプリ内へ保存。評価対象Azureリソース、訂正、承認、Issue／Projectには変更なし |

Decision-1呼出しの実数を個別メトリックから確認していないため、7件のモデル呼出し完了とは断定しない。呼出し日次枠の上限内で同期した。選択した1評価の応答は画面上で確認した。

この実施でUAT-R-03の最新分類理由、UAT-R-04のClaim→Evidence参照、UAT-R-07の同期経路を確認した。匿名アクセス・サインアウト後、Reader／Reviewer／Governance／Operator別のHTTP認可、UAT-W-01〜10のControlled write-pathは依然未実施。対象外訂正や承認は現行実データを変更するため実行していない。

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

## Exit Criteria

- UAT-R-01〜08がLive read-onlyでPass。ただし機能が環境に存在しない場合はFailではなくBlockedとして記録し、修正後に再実施。
- UAT-W-01〜10がfixtureベースでPassし、書込み・権限・承認・重複防止の監査記録が確認できる。
- Critical workload、Unknown、Partial、OutOfScopeに対する人間レビュー条件を確認する。
- Blocked/Failに受入者がリスクを明示し、回避策と期限を記録するまでPoC UATを完了扱いにしない。
- 登壇デモは別途リハーサルし、実際の取得とfixture／合成試験を明確に区別する。

## 制約

この文書は手順と期待結果を定義する。ブラウザー自動化ツール、CIのE2E実行、認証セッションの保存、UAT実施自体は実装しない。現在のCIにはブラウザー・画面操作を許可する機能はなく、UAT文書を追加してもComputer UseのURL判定／操作制御は変更されない。

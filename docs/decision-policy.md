# 判断・承認ポリシー

本ポリシーは、通知範囲、Azure Resource適用性、業務影響、優先度、人による承認をどう分けるかを定めます。組織が採用・設定するまでは、全社標準ではありません。

## 通知範囲

公式Lifecycle Categoryは、人が決めたScope判定とは別に保持します。単一Keywordだけで通知を除外しません。Reviewerが対象外にするには、理由とHuman Evidenceが必要です。対象外Assessmentは有効な優先度や作業案を持たず、承認・Exportできません。再検討は新しいAssessment版を作ります。

## 影響軸

アプリは独立した2つの影響判断を記録します。

| レベル | 未対応時のリスク | 対応時・対応後の影響 |
|---|---|---|
| Low | 業務への影響が小さい、限定的な運用不便 | 変更、費用、運用差が確認済み許容範囲に収まる |
| Medium | 一部機能、監視、費用、Serviceが低下する可能性。回避策がある場合がある | 確認済み計画で管理できる範囲の停止、差異、作業が発生する |
| High | 重要業務機能が停止・大幅劣化する、または費用／運用へ大きく影響する可能性 | 重要機能の中断や大規模な緩和作業が発生する可能性 |
| Critical | 事業継続、重大Data、規制、契約上の深刻なリスクが根拠付きである | 対応中または対応後に同程度の深刻な影響が根拠付きである |
| Unknown | 利用可能な情報ではレベルを裏付けられない | 利用可能な情報ではレベルを裏付けられない |

一方の重大な影響を平均化して弱めない。UnknownはLowではない。Critical Workload指定には人が確認したSourceが必要。変更規模と業務影響は別の判断。代替策が不明なだけではCriticalとしない。

Workload固有の依存情報がなければ、条件付きの一般的なLifecycle影響説明を表示する場合があります。業務処理名、停止時間、費用、移行必須を創作してはいけません。文書記載だけでは現在の実行時利用を証明しません。

## 優先度と時期

優先度は計画・判断の緊急度です。P1でも本番を即時変更する許可にはなりません。

| 優先度 | 意味 |
|---|---|
| P1 | 急いで判断または計画を開始し、実現可能性やリスク受容を確認する |
| P2 | 早期に計画を作り、調査、設計、人員確保を始める |
| P3 | 通常の変更計画に含め、進捗を追う |
| P4 | 影響が限定的で余裕があるため、監視または後続計画とする |

必須期限と承認済み作業期間が分かる場合、計画余裕は最も遅い実行可能開始日からAssessment日を引いて算定します。Critical Path、依存、停止期間、人員、予備期間も考慮します。日付や期間が欠ける場合、計画日を創作しません。現行配置では、重要な未解決CaseにP2、期限超過または直近期限の未解決CaseにP1の保守的な下限を使います。正確な条件はRule実装を参照してください。

対応期限に対する基準Matrix：

| 未対応時の影響 | 0日以下 | 1～30日 | 31～90日 | 91日以上 |
|---|---:|---:|---:|---:|
| Critical | P1 | P1 | P2 | P2 |
| High | P1 | P1 | P2 | P3 |
| Medium | P1 | P2 | P3 | P3 |
| Low | P1 | P2 | P3 | P4 |

これは計画基準であり、全組織共通要件ではありません。確認済み緩和策がないHigh／Criticalな対応影響にはP2下限を適用します。Ruleは優先度の下限を設定し、Modelは下限未満へ下げられません。人が下げる場合は承認理由を記録します。

ModelはProgram全体の開始時期としてImmediate、Within 30 days、Within 90 days、Within 180 days、Later、No action、Unknownを返す場合があります。個別Work Itemの算定開始日ではありません。No actionは理由を伴う候補であり、未記入や未レビューではありません。

## Lifecycleの日付

非推奨開始、新規作成停止、サポート終了、退役日、その他の対応期限を分けて保持します。非推奨開始日や移行期限を退役日に使い回しません。権威ある構造化Fieldまたは限定的に認識された公式退役文だけが退役日を裏付ける場合、そうでなければ未確定にします。競合・曖昧な日付は人が確認します。

未発表の退役日はnullのままです。それだけでは期限超過や移行必須を意味しません。後続の公式更新は新しいEvent／Assessment版を作り、影響を受ける承認を失効させます。似たTitleやNameだけでEventを統合しません。

## Resource分類

Azure Resourceの適用性は、業務影響とは分けて記録します。

| 分類 | 用途 |
|---|---|
| Confirmed | Service HealthまたはAdvisorがResourceを明示した。属性の追加確認が必要でも明示Evidenceを保持する |
| Probable | 有効な版管理済み通知適用Profileと条件に一致する |
| Possible | Azure設定が関係を示すが、より強い結論には不足する |
| Verification Required | 具体的な不明点を人の確認で解消できる。属性と確認作業を示す |
| Not Impacted | 必須属性とScopeが完全で、承認済みProfileまたは公式除外が非該当を裏付ける |
| Unknown | 適用性を決められず、具体的な確認方法も分からない |

現行Profile RegistryはBasic Load Balancer、Storage GPv1、Application Insights URL ping test、Classic Foundry Agent Serviceを対象とします。Profile網羅性は完全ではありません。Profileは候補Resource Typeを絞るもので、実行時利用を証明しません。明示されたService Health／Advisor ResourceはProfile外でも保持します。

Profile未対応は非該当ではなく、ProfileUnavailableのReviewになります。候補なしの完全検索、取得不完全、全件Not Impacted、Profile未対応は別状態です。No resources foundは、業務影響なしや対応不要と同じではありません。

## Review要件

不確実性が結論を変え得る場合は人のReviewが必要です。例：

- Unknown、Possible、Verification Required、関連する取得不完全。
- 実現可能性に影響する期限、重要度、Scope、移行期間、代替案の不足。
- 公式Evidenceと設定／業務Recordの重大な不一致。
- 優先度や対応方法を変え得る前提。
- Critical Workload、またはHigh RiskとModelの重大な不一致、低Score、首位Category同点。
- Work Item承認、Scope判定、外部登録。

Decision Scoreは校正済み信頼度ではありません。高いModel ScoreでもReviewを省略できません。Scopeと取得が完全で明確に非該当の場合、UIがAssessment Reviewを省略可能とする場合がありますが、作業承認、業務影響なしの宣言、Exportを許可するものではありません。

## 作業と承認

Work Itemは根拠のある必須作業と推奨調査を区別します。不確かな移行は移行必須ではありません。Impact Verificationは確認作業であり、本番変更を許可しません。

承認は現行Assessment版とPackage Hashに紐付きます。部分承認は選択Itemだけに適用します。訂正、再評価、Evidence、重要日付、Scope、影響、優先度、Owner、Schedule、受入条件が変わると、影響を受ける承認は失効します。旧AssessmentとSource Recordは不変で保持します。

Review結果は承認、部分承認、差し戻し、保留、対応不要です。対応不要は通常一覧からEvent／Workloadを隠しますが、通知、Evidence、Assessment、Review履歴は残します。GitHub作業をCloseしたりAzureを変更したりしません。

## Evidenceと再評価

公式Source、Source版／Hash、観測時刻、Scope完全性、判断・説明の呼出Record、人の訂正、承認者／時刻を保存します。Resource ID、日付、費用、後継、Ownerを捏造しません。Source更新や人の訂正は新しい版を作り、過去Evidenceを上書きせず無効な承認を引き継ぎません。

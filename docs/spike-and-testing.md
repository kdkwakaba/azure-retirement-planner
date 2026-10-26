# Spike・テスト・費用計画

状態: Decision-1の接続・デプロイと合成3事例×3回の型契約評価は完了。実環境の影響判定精度、説明LLM、他のSpike項目は未完了。

## 実現性Spike

| ID | 最小検証 | 成功条件 |
|---|---|---|
| SP-01 | Decision-1提供・認証・3事例呼出 | **完了（条件付き）**。Foundry account scopeのCLI推論権限でMicrosoft-Decision-1 v1に接続し、型付き回答と確率分布を取得。合成3事例×3回すべてSchema・確率検証に合格。判断品質の代表性は未評価 |
| SP-02 | Service Health、Advisor、ARG実読取 | 非Retirementの非推奨を含む実Payload・分類・関連範囲・欠損を確認 |
| SP-03 | Action Groupから認証済受付 | Health Advisoryの非推奨候補を排除しない配送条件、認証・原本保存を確認。実通知とテストを区別 |
| SP-04 | 判断＋Evidenceから説明・作業案 | 必須Schema、根拠、架空ID等の拒否 |
| SP-05 | 個人非公開Issue・Project | 作成・追加・更新・冪等性と最小権限を確認 |
| SP-06 | Azure画面・Entra認証・ライブ処理・利用量 | API認可、実データの3分デモ可否、費用材料を取得 |

Microsoft-Decision-1を第一目標とし、初回エラーや精度不足だけで切り替えない。認証・RBAC、利用可能リージョン／提供形態、429、入力量、質問・選択肢・基準を修正し同一評価セットで比較。一部不安定ならその項目を人間判断にする。

利用可能条件を調べても使用不能、必須型／確率が取得不能、改善後も重大誤判断が続き人間を含む運用が不成立、予算に収まらない場合のみ代替再検討。試した対策と阻害要因を記録する。

Jev／Decisions APIは自動Fallbackではない。提供元公式URL、契約、送信先、仕様を確認し、別途同一データで比較する。名称から事業者・API・互換性を断定しない。モデル間確率を同一尺度としない。

判定は「成立」「条件付き成立」「代替方式の再検討」「保留」。実例不足で合成を使う場合、実接続や実環境Recallが成立したとは扱わない。概算5〜8人日、外部待ち別。成果は契約・必要権限・保存入出力・実測費用・Go/No-Go。

## 環境

既存Subscriptionの専用RG、同一テナントの許可Scope。非公開Repositoryは作成済み、個人Projectは未作成。個人Projectで成立するToken種別・権限をSP-05で確認し、PATが必要なら期限・Key Vault・対象制限・実権限範囲を記録。本番はOrg＋GitHub Appsへ移行する。画面はSpikeからAzureへ配置し、Entra認証・API認可を検証。評価対象の変更権限は与えない。

## 3事例

| 事例 | 評価目的 | 公式参照 |
|---|---|---|
| Basic Load Balancer | SKU対象、依存、Prod/Dev、ネットワーク移行 | [移行案内](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-basic-upgrade-guidance) |
| Storage GPv1 | 自動移行、費用、不足情報、不可逆性 | [概要](https://learn.microsoft.com/en-us/azure/storage/common/general-purpose-version-1-account-migration-overview) |
| URL ping tests | 期限更新、監視と業務停止の区別、再承認 | [可用性テスト](https://learn.microsoft.com/en-us/azure/azure-monitor/app/availability) |

設計時に確認した資料ではBasic LBは2025-09-30廃止。ping testsは旧2026-09-30から2028-09-30への延期が記載。GPv1資料は月単位期限・自動移行・費用・停止不要・不可逆性を記載。実行前に最新版を確認し、過去判断には当時版を使用する。サンプルや検索結果の具体日を別の適用範囲へ転用しない。

## 3層の試験

A: 公式・保存・合成Snapshotで分類・判断・更新・異常を再現。B: 現Azureで認証・実Schema・取得・推論を確認。C: 保存／実結果を用いレビュー・承認・GitHubを確認。実通知がなければ配送疎通とRetirement再生を別判定にする。

全ケースにID、目的、実取得／公式／合成／再構成区分、参照版・取得日時、評価基準日時、Scope、構成、業務情報、期待・禁止結果、確認者、Model/Prompt/Rule版を保存。合成Advisor対象によるConfirmedは分類試験でありMicrosoftの実対象証明ではない。

## 2026-10-26 Decision-1合成推論評価

Microsoft-Decision-1 version 1、deployment `arp-decision-1`、既存の6質問契約で9回実行。実リソースではなく合成Resource ID・業務コンテキストを送信した。Storage GPv1の期限は評価のための合成日付であり、公式Retirement Dateとして扱わない。CLI利用者にはFoundryアカウント単位でCognitive Services Userを付与し、Subscription/Resource Group全体の推論権限は付与していない。評価出力はSDKのDecision契約相当の全選択肢・確率を返し、9/9で確率合計許容差および選択肢検証を通過。全9回が少なくとも1項目Unknownを含み、Abstained扱いとなった。平均応答時間は約766 ms（687–898 ms）。各ケース3回で判断ラベルは安定したが、Basic LBの未対応影響はCritical 1/3・High 2/3。型・確率の機能成立は確認したが、判断品質・閾値校正を示す標本ではない。

| Synthetic case | 3回の主な選択 | Unknown項目/回 | 入力Token/回 | 判定上の注意 |
|---|---|---:|---:|---|
| Basic Load Balancer（期限超過、Critical Production） | 未対応影響 Critical 1回・High 2回、対応中影響 Unknown、Priority P2、Start Immediate | 3/6 | 613 | 期限超過でもルールによる強制P1はこの直接モデル呼出しには適用していない。アプリ統合時のルール適用を別途検証 |
| Storage GPv1（期限5日という合成入力） | 未対応影響 Unknown、対応中影響 Unknown、Priority P1、Start Immediate | 4/6 | 620 | GPv1の日付は合成。P1/Immediateは作業開始判断であり、自動移行や移行必須の根拠ではない |
| URL ping tests（期限704日） | 未対応影響 Unknown、対応中影響 Unknown、Priority P2、Start Later | 4/6 | 610 | 監視機能廃止と業務停止を同一視しない。アプリ・監視構成の確認を人間に残す |

3ケースともProject RequiredはUnknown、難易度もUnknownとなり、全9回で人間レビュー相当となった。出力Tokenは各6。9回合計入力5,529、出力54 Token（最初の契約疎通1回522/6を含めると入力6,051、出力60）。Model API応答は `microsoft-decision-1` としたが、deployment versionは構成値1を記録し、呼出し応答自体にバージョン値がない点を区別する。費用は従量単価と実際の請求反映で確認する。

制約: 同一入力の反復は再現性確認であり、3独立事例の評価ではない。合成データなのでPrecision/Recall、AdvisorによるConfirmed、実Azureの影響、期限の事実性は証明しない。Basic LBではモデル単体のPriorityがP2だったが、アプリの決定的`priorityFor`は期限当日・超過（slack <= 0）をP1にする。今回の直接モデル呼出しは統合後のeffectivePriorityを評価していないため、次にDecision adapter／評価パイプライン経由で合成し、ルール適用後にP1となることを確認する。現契約にUnknownが含まれれば選択値にかかわらずAbstainedとなるため、人間レビューが適切。次は公式期限Snapshotを用いた非合成回帰、難易度／移行必須の曖昧ケースの評価も行う。

## 必須30ケース（非推奨の追加6件を含む）

| ID | 入力 | 期待結果 |
|---|---|---|
| TST-01 | 公式明示対象A | Confirmedと出典時刻 |
| TST-02 | 明示なし・公式条件一致 | Probable、対象外にしない |
| TST-03 | Basic廃止にStandard | 当該発表の除外条件を確認してNot Impacted |
| TST-04 | 根拠ある依存 | Possibleと依存根拠 |
| TST-05 | 利用実態属性なし | Unknown／Verification Required、移行断定なし |
| TST-06 | 一部Subscription403 | Partial、影響なしにしない |
| TST-07 | 旧タグと移行済実構成 | 実構成採用・矛盾記録 |
| TST-08 | Owner・重要度欠損 | 人間確認、推測確定なし |
| TST-09 | 同構成・異なる業務重要度 | 技術分類維持、業務影響を別評価 |
| TST-10 | ping期限延期 | 新版、再評価、重要変更で承認失効 |
| TST-11 | 新版後に旧通知 | 巻戻しなし |
| TST-12 | 公式期限矛盾 | 競合表示・レビュー |
| TST-13 | GPv1利用量不明 | 費用可能性・不足、架空額なし |
| TST-14 | GPv1へ戻す作業案 | 不可逆性と不整合として拒否 |
| TST-15 | 監視廃止のみ | アプリ停止必至としない |
| TST-16 | 超過・期間不足・禁止期間 | 実現不能表示、架空日なし |
| TST-17 | 未提供Resource ID | 拒否・外部登録なし |
| TST-18 | 根拠なし後継・作業 | 公式推奨扱いせず確認 |
| TST-19 | 同通知100回 | 同版・作業・Issue増殖なし |
| TST-20 | Decision-1停止・429 | Retry・待機・手動評価、成功偽装なし |
| TST-21 | 無承認・旧版承認 | 外部登録拒否 |
| TST-22 | Project追加のみ失敗 | Issue再作成なし |
| TST-23 | Issue作成応答喪失 | 照合・不明保留 |
| TST-24 | 文書内の検証無視命令 | 命令に従わず承認・検証維持 |
| TST-25 | RetirementサブタイプがないHealth Advisoryに公式の非推奨記載 | 本文・参照から対象選別。原分類保存、架空の公式enumなし |
| TST-26 | 非推奨開始日のみ・廃止期限未発表 | 廃止日null、必要確認は暫定P2＋レビュー。期限超過・移行必須としない |
| TST-27 | 非推奨・作成停止・サポート終了・廃止が別日付 | 別マイルストーンと適用範囲を保持。作業別期限で検証 |
| TST-28 | 新規作成停止、既存利用は継続可能 | 既存停止を断定せず、増設・再構築・DRの必要確認 |
| TST-29 | ライフサイクル変更と無関係なHealth Advisory | 理由付き対象外。移行作業・暫定P2を生成しない |
| TST-30 | 期限未発表の非推奨へ廃止期限が追加、Advisor対象なし | 同案件の新版・再評価・影響承認失効。ARG等へ接続し、根拠なく対象外にしない |

分類理由の追加回帰では、既知プロファイルの必須属性欠損（LB SKU、Storage kind、WebTest kind）をVerification Required＋不足属性名、既知プロファイル内の未知属性値をUnknown、イベントと対応プロファイルがない場合を別理由付きUnknownとする。旧保存Assessmentは既定理由`LegacyUnrecorded`で読み取る。Unknown／Possible／Verification Requiredでは不足情報をレビュー欄へ含め、説明モデル停止時にもEvidence付きRecommended Impact Verification作業を生成する。これらはローカル契約・ルール検証であり、実Advisor対象との関連精度を証明しない。

Advisor関連付けの合成契約テストでは、Service Healthのimpacted-resource IDからTracking IDを完全一致抽出し、Advisor metadataのTracking ID→recommendationTypeId→recommendationを結ぶ。recommendationStatusはNew／InProgress／Postponedに限定し、完了・dismissed・未知状態を明示対象として採用しない。ARG実環境のAdvisorデータで返却Schema・網羅性・状態遷移を確認するまでは、関連対象なしを影響なしと解釈しない。

単体、統合、API契約、Schema、Rule、Model、Grounding、Security、障害注入、冪等性、負荷、UAT、Shadowへ割り当てる。期限0/1/30/31/90/91日、P1〜P4、部分承認、仮定で結論が変わる条件も各ケースの変種として確認する。

## 品質評価

Spikeは3代表シナリオ×3回＝9回。機能は30ケース（既存24＋非推奨6、固定応答を利用可）。判断品質は3サービス×12シナリオ×3回＝108回、独立母数は36。繰返しは揺れ評価であり独立事例と数えない。

2専門家の独立判定・合議を推奨。重要度、環境、期限余裕、Owner、情報完全性、移行方式を変え、1条件だけ違う比較を含む。開発・調整・保留評価に分け、同じRetirementの更新版を分割間に漏らさない。当時Snapshotがなければ現在構成による再現と明記。

| 指標 | 測定 |
|---|---|
| 対象Precision / Recall | 正解集合との比較、分類別、確認経由捕捉も別集計 |
| 影響2軸・優先度 | 完全・重み付き一致、重大な過小評価 |
| Owner一致 | 棄権・候補なしを分離 |
| 架空Resource | 生成段階と検証通過後を分離、後者0 |
| 根拠なし主張 | 支持不足の事実主張／全事実主張 |
| 作業過不足 | 必須集合に対するPrecision/Recall、追加の妥当性 |
| Override | 項目別率・訂正理由 |
| 見逃し | 通知入口、探索、Service Health外を分離 |
| 運用性 | 揺れ、棄権、レビュー時間、1評価費用 |

少数で0件だった結果を全Azure保証としない。精度閾値は本番化前に別合意。必須安全性は架空ID・無承認・不適合作業の外部登録、越権の検証通過0件。重大誤りの説明残存は修正し、未評価項目を報告する。

## 予算と制御

**月額ではなく期間累計。Spike 5,000円、PoCはSpike込み20,000円。** 料金見積もりではなく採用した上限目安。Azure基盤、モデル、Storage、ログ、通信、追加GitHub有料費を含み、人件費と無関係な既存費は除外。

50/80/100%通知。80%で追加評価・再生成抑制、上限で新規推論停止。課金反映遅延があるためToken・回数・実行時間にも制限し、金額を厳密に保証しない。保存・監査は維持費が残る。Spike実測後に108回評価の実行可能性を再確認し、予算超過なら無断で増額せず計画を調整する。

PoC終了時に専用Azure・Project・Issue等の実データ・資格情報を削除する。終了後90日保持とデモ用環境維持は標準から撤回。削除完了までの残費用、税・通貨換算・課金計測は実行前に確認する。登壇は同じ環境・実データのライブ処理を使い、その推論・通信費も予算に含める。[開発・運用基準](engineering.md)を参照。

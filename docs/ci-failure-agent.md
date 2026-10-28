# CI失敗時のCodex調査・修正

## 動作

`.github/workflows/ci-failure-agent.yml`は、Workflow名が`CI`のGitHub Actions runが失敗して完了したときに起動します。PRイベントかつこのRepository内のブランチに限定し、`codex/ci-repair-`で始まる修正PRからの再帰起動を除外します。

1. 失敗Run、Commit、元PRをActions Job Summaryに記録する
2. PR作成者が許可されている場合だけCodexを実行する
3. 失敗ログを最大30 KBに制限してCodexへ渡す
4. Codexが原因を確認し、根拠があり再現可能な場合だけ最小修正を提案する
5. Codex用API Keyを持たない別Jobでパッチを適用し、`npm run verify`とBicep静的ビルドを再実行する
6. 検証に成功し、元PRが同じhead SHAでOpenのままの場合、元PRのブランチをbaseとする修正PRを作成する

修正PRは人間がレビュー・マージします。元PRへ直接Pushせず、自動マージ、Azureデプロイ、外部Issue登録はしません。検証不能、原因不明、外部障害の場合はパッチを作らないか、検証Jobで止まります。

## 有効化に必要な設定

- Repositoryの **Settings → Secrets and variables → Actions → Secrets** に`OPENAI_API_KEY`を登録する。キーはCodex実行Stepにだけ渡す。
- Repositoryの **Settings → Actions → General → Workflow permissions** で、GitHub ActionsがPRを作成できる設定を許可する。
- 任意のRepository variable `CI_FAILURE_AGENT_ALLOWED_AUTHORS`へ、Codex実行を許可するGitHubユーザー名をカンマ区切りで指定する。未設定時はRepository Ownerだけを許可する。
- `CI_FAILURE_AGENT`を`disabled`に設定すると自動起動を停止する。未設定なら有効。

API Keyが未登録、またはPR作成者が許可リスト外の場合、失敗検知とJob Summary記録は行いますが、モデル呼出しと修正PR作成は行いません。

許可ユーザーはGitHub ActionとWorkflowの両方で制限します。既定はRepository Ownerのみです。自動修正ではCI Workflow、修復Skill、テストファイルを変更対象外とします。

Codex GitHub ActionはコミットSHAで固定し、Codex CLIも安定版の明示バージョンに固定しています。更新時はAction、CLI、Responses API proxyの互換性と脆弱性情報を確認してください。

## セキュリティ境界

- `workflow_run`で起動し、Fork PRは対象外。
- Codex Jobは`actions:read`、`contents:read`、`pull-requests:read`のみ。GitHub書込権限は別のPublisher Jobに限る。
- Codex API Keyを含むJobではGitHub書込権限を持たず、npm lifecycle scriptsを無効にして依存を導入する。
- パッチは別Runnerで再適用・再検証する。CI WorkflowとこのSkillは自動パッチ対象から除外する。
- 元PRのhead SHAが変わった場合、またはPRが閉じられた場合は修正PRを作らない。
- Codex出力・PR本文・ログの内容を無条件に信頼しない。承認なしの本番変更と自動マージは禁止。

## 対象範囲と制限

このWorkflowが検知するのはGitHub Actionsの`CI` Workflowの失敗です。Codex Code Reviewの「Request changes」レビューや他の外部レビューツールの指摘を検知するものではありません。Codex Code ReviewはCodexのGitHub設定で別途有効化し、レビュー指摘の修正は人間の依頼・レビューで行います。

元PRに対して作成される修正PRにも通常のCIが実行されます。Actions API Keyの利用料はGitHub ActionsのCI利用料と別管理です。予算上限はこのWorkflowで強制しません。

# CI失敗時のCodex調査・修正

## 動作

.github/workflows/ci-failure-agent.ymlは、CIという名前のGitHub Actions Runが失敗して終了したときに起動する。Pull Request Eventかつ同一RepositoryのBranchに限定し、codex/ci-repair-で始まる修正PRからの再帰起動を除外する。

1. 失敗Run、Commit、元Pull RequestをActions Job Summaryに記録する。
2. Pull Request作成者が許可されている場合に限りCodexを実行する。
3. 失敗Logを最大30 KBに制限してCodexへ渡す。
4. Codexが原因を確認し、根拠があり再現可能な場合だけ最小修正を提案する。
5. Codex用API Keyを持たない別JobでPatchを適用し、npm run verifyとBicep静的Buildを再実行する。
6. 検証に成功し、元Pull Requestが同じhead SHAでOpenのままなら、元BranchをBaseに修正Pull Requestを作成する。

修正Pull Requestは人がReview・Mergeする。元Pull Requestへ直接Pushせず、自動Merge、Azure配置、外部Issue登録はしない。検証不能、原因不明、外部障害の場合はPatchを作らないか、検証Jobで停止する。

## 有効化に必要な設定

- RepositoryのSettings → Secrets and variables → Actions → SecretsにOPENAI_API_KEYを登録する。KeyはCodex実行Stepだけに渡す。
- RepositoryのSettings → Actions → General → Workflow permissionsで、GitHub ActionsによるPull Request作成を許可する。
- 任意のRepository Variable CI_FAILURE_AGENT_ALLOWED_AUTHORSに、Codex実行を許可するGitHubユーザー名をカンマ区切りで指定する。未設定時はRepository Ownerだけを許可する。
- CI_FAILURE_AGENTをdisabledにすると自動起動を停止する。未設定時は有効。

公開RepositoryでOPENAI_API_KEY Secretが未登録の場合、失敗検知とJob Summary記録だけを行う。Codex Actionを実行せず修正Pull Requestも作らない。Secretが登録済みでも作成者が許可リスト外なら、自動修正を省略する。SecretをSource Code、Log、Artifactへ出力しない。

許可UserはGitHub ActionとWorkflowの両方で制限する。既定ではRepository Ownerだけが対象。自動修正ではCI Workflow、修復Skill、Test Fileを変更対象外とする。

Codex GitHub ActionはCommit SHAで固定し、Codex CLIも安定版の明示Versionに固定する。更新時はAction、CLI、Responses API Proxyの互換性と脆弱性情報を確認する。

## セキュリティ境界

- workflow_runで起動し、Fork Pull Requestは対象外。
- Codex Jobはactions:read、contents:read、pull-requests:readだけを持つ。GitHub Write権限は別のPublisher Jobだけが持つ。
- Codex API Keyを含むJobにはGitHub Write権限を与えない。npm lifecycle scriptを無効にして依存を導入する。
- Patchは別Runnerで再適用・再検証する。CI WorkflowとこのSkillは自動Patch対象から除外する。
- 元Pull Requestのhead SHAが変わった場合、またはPull Requestが閉じられた場合、修正Pull Requestを作らない。
- Codex Output、Pull Request本文、Logを無条件に信頼しない。承認なしの本番変更と自動Mergeは禁止。

## 対象範囲と制約

このWorkflowが検知するのはGitHub ActionsのCI Workflow失敗。Codex Code ReviewのRequest changesや、外部Review Toolの指摘は検知しない。Codex Code ReviewはCodexのGitHub設定で別途有効化する。Review指摘の修正は人からの依頼とReviewを経て行う。

元Pull Requestに対して作成する修正Pull Requestにも通常のCIが実行される。Actions API Keyの利用料はGitHub ActionsのCI利用料と別管理。Workflowは予算上限を強制しない。

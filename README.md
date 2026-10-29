# Azure Retirement Planner

Azureの非推奨化・新規作成停止・サポート終了・リタイアメント情報と自社の構成・業務情報から、根拠付きの影響評価と対応計画を作成するシステム。

**TypeScript/Reactのモノレポ、Functions、Bicep、CI・手動CD、判断・検証・レビュー・GitHub連携を実装しています。2026-10-29時点でmainのAPI／ExporterをAzureへ配置し、過去にService Health実通知7件の取得とMicrosoft-Decision-1の実応答1件を確認しました。認証済み画面の最新UAT、Advisorとの正の相関、説明LLM、GitHub実Project登録などは未確認で、PoC全体の完了ではありません。現在の状態と未完了項目は[実装バックログ](docs/implementation-backlog.md)、配置・実データ確認の詳細は[Runbook](docs/runbook.md)を参照してください。**

## 設計書

| 文書 | 内容 |
|---|---|
| [システム設計書](docs/design.md) | 要件、論理設計、データ、セキュリティ、運用 |
| [現行構成・Decision-1解説](docs/architecture-and-decision-model.md) | 登壇向けの構成図、処理／データフロー、Decision-1の入力・判断・出力と検証状況 |
| [判断・承認基準](docs/decision-policy.md) | 影響度2軸、確度分類、P1〜P4、不確実性、人間レビュー、作業項目生成 |
| [ワークフロー設定基準](docs/workflow-configuration.md) | 企業別の担当割当、部署調整、承認、移行順序の設定方式 |
| [Spike・テスト計画](docs/spike-and-testing.md) | 実現性、3事例、30テスト（非推奨6件追加）、品質評価、予算 |
| [登壇・デモ計画](docs/presentation-demo.md) | 15分発表、実データによる3分ライブデモ |
| [合意・未決事項](docs/decisions.md) | 採用済み事項、未確定条件、次の判断ゲート |
| [開発・運用基準](docs/engineering.md) | モノレポ、CI/CD、認証、セキュリティ、終了時削除 |
| [実装バックログ](docs/implementation-backlog.md) | 依存関係、実装状態、実接続ゲートと残作業 |
| [利用者向け操作ガイド](docs/user-operations-guide.md) | サインイン、同期、評価・Evidence確認、訂正、承認、デモ準備 |
| [Runbook](docs/runbook.md) | 初期構築、Entra・MI、手動CD、復旧、撤去 |
| [AGENTS.md](AGENTS.md) | エージェントが守る共通ルール |

## 基本方針

- Service Health、Advisor、Resource Graphの標準機能を利用する。
- Microsoft-Decision-1の型付き判断、生成LLMの説明、ルール検証、人間承認を分離する。
- 評価対象の変更を実行しない。本システム専用環境は承認された手動CDで管理する。
- PoCは個人GitHubの非公開Repository／Project。本番はOrganization＋GitHub Apps。
- Spike予算は期間累計5,000円、PoCはSpike込み期間累計20,000円。料金見積もりではなく予算枠。

## 開発用Skills

- [arp-feature](.agents/skills/arp-feature/SKILL.md): 機能追加・修正と検証。
- [arp-security-maintenance](.agents/skills/arp-security-maintenance/SKILL.md): 脆弱性・EOL調査と更新。
- [arp-release](.agents/skills/arp-release/SKILL.md): 専用環境へのリリース計画と手動CD。

各Skillにagents/openai.yamlを持つ。Skillの利用は外部変更の包括許可ではない。

## コードの検証

Nodeとnpmの版は`.node-version`と`package.json`を使用する。

```sh
npm ci --ignore-scripts
npm run verify
```

`apps/assessment-api`はAPI・収集・判断・レビューとUI配信、`apps/work-item-exporter`は承認済み作業の登録、`apps/review-web`はReact画面。共有契約・業務ルール・接続を`packages/`へ分ける。通常CIはクラウドを変更しない。Azure配信はEntra認証を必須にし、[Runbook](docs/runbook.md)のBootstrap後にmainのCI成果物を手動CDする。

合意事項と実装状況は随時更新。Microsoftの機能・期限・価格は利用時に公式情報で再確認する。

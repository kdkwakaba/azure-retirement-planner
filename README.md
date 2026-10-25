# Azure Retirement Planner

Azureの非推奨化・新規作成停止・サポート終了・リタイアメント情報と自社の構成・業務情報から、根拠付きの影響評価と対応計画を作成するシステム。

**TypeScript/Reactのモノレポ、Functions、Bicep、CI・手動CD、判断・検証・レビュー・GitHub連携の初期実装があります。Azure配置・実接続・モデル評価は未実施であり、PoC全体の完了ではありません。**

## 設計書

| 文書 | 内容 |
|---|---|
| [システム設計書](docs/design.md) | 要件、アーキテクチャ、データ、セキュリティ、運用、バックログ |
| [判断・承認基準](docs/decision-policy.md) | 影響度2軸、P1〜P4、不確実性、人間レビュー |
| [Spike・テスト計画](docs/spike-and-testing.md) | 実現性、3事例、30テスト（非推奨6件追加）、品質評価、予算 |
| [登壇・デモ計画](docs/presentation-demo.md) | 15分発表、実データによる3分ライブデモ |
| [合意・未決事項](docs/decisions.md) | 採用済み事項、未確定条件、次の判断ゲート |
| [開発・運用基準](docs/engineering.md) | モノレポ、CI/CD、認証、セキュリティ、終了時削除 |
| [実装バックログ](docs/implementation-backlog.md) | 依存関係、実装状態、実接続ゲートと残作業 |
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

2026-10-24までの合意を反映。Microsoftの機能・期限・価格は実装前に公式情報で再確認する。

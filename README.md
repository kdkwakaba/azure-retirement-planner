# Azure Retirement Planner

Azureのリタイアメント情報と自社の構成・業務情報から、根拠付きの影響評価と対応計画を作成するシステム。

**現在は設計段階です。アプリケーション、Azure環境、GitHub連携、モデル評価は未実装・未実施です。** このリポジトリの作成は実装開始を意味しません。

## 設計書

| 文書 | 内容 |
|---|---|
| [システム設計書](docs/design.md) | 要件、アーキテクチャ、データ、セキュリティ、運用、バックログ |
| [判断・承認基準](docs/decision-policy.md) | 影響度2軸、P1〜P4、不確実性、人間レビュー |
| [Spike・テスト計画](docs/spike-and-testing.md) | 実現性、3事例、24テスト、品質評価、予算 |
| [登壇・デモ計画](docs/presentation-demo.md) | 15分発表、3分再生デモ、準備物 |
| [合意・未決事項](docs/decisions.md) | 採用済み事項、未確定条件、次の判断ゲート |

## 基本方針

- Service Health、Advisor、Resource Graphの標準機能を利用する。
- Microsoft-Decision-1の型付き判断、生成LLMの説明、ルール検証、人間承認を分離する。
- 本番変更を自動実行しない。不確実な対象を移行必須と断定しない。
- PoCは個人GitHubの非公開Repository／Project。本番はOrganization＋GitHub Apps。
- Spike予算は期間累計5,000円、PoCはSpike込み期間累計20,000円。料金見積もりではなく予算枠。

2026-10-22時点の会話による合意を文書化。Microsoftの機能・期限・価格は実装前に公式情報で再確認する。

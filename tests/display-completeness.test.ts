import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItem } from '@arp/contracts'
import { fixture } from './fixtures.ts'
import {
  approvalDisplay,
  claimKindDisplay,
  assessmentStatusDisplay,
  coordinationDisplay,
  criticalWorkloadDisplay,
  decisionStatusDisplay,
  evidenceDisplay,
  explanationSectionDisplay,
  impactDisplay,
  milestoneDateDisplay,
  milestoneKindDisplay,
  ownerDisplay,
  ownerTagDisplay,
  modelVersionDisplay,
  plannedDateDisplay,
  priorityDisplay,
  projectProgressDisplay,
  reviewReasonDisplay,
  routingDisplay,
  sequenceDisplay,
  workloadDisplay,
} from '../apps/review-web/src/display-completeness.ts'

const routing = {
  policyVersion: 'poc-department-routing-1',
  teamCandidates: [],
  coordinationCandidates: [],
  approvalStages: [],
  sequenceOrder: null,
  dependsOnCategories: [],
  policyRuleIds: [],
  unresolvedReasons: [],
} satisfies NonNullable<WorkItem['workflowRouting']>

test('incomplete assessment values display their reason and next decision', () => {
  assert.match(impactDisplay(null, '未対応時'), /影響度は未確定/)
  assert.match(priorityDisplay(null), /対象範囲と影響を確認後/)
  assert.match(plannedDateDisplay(null, '完了日'), /計画担当が設定/)
  assert.match(ownerDisplay(null, routing), /情報システム部門が初動窓口/)
  assert.match(routingDisplay(routing), /情報システム部門が初動で割当調整/)
  assert.match(coordinationDisplay(routing), /情報システム部門/)
  assert.match(approvalDisplay(routing), /Workload責任者.*ガバナンス責任者/)
  assert.match(sequenceDisplay(routing), /個別の順序指定なし.*前提作業なし/)
  assert.match(projectProgressDisplay(null), /登録状態と同期結果を確認/)
  assert.match(evidenceDisplay([]), /承認前に根拠を追加/)
  assert.match(ownerTagDisplay(null), /実担当をWorkload責任者と確認/)
  assert.match(modelVersionDisplay(null), /監査記録を確認/)
  assert.equal(explanationSectionDisplay('missingInformation'), '不足情報')
  assert.equal(claimKindDisplay('Unknown'), '根拠不足で不明')
  assert.equal(claimKindDisplay('General Impact'), '一般的な影響想定')
  assert.match(milestoneDateDisplay(null, null), /公式通知の原文を確認/)
  assert.equal(milestoneKindDisplay('Retirement'), '廃止日')
  assert.match(
    workloadDisplay('unassigned'),
    /情報システム部門が初動で振り分け/,
  )
})

test('known values remain visible without being replaced by fallback text', () => {
  assert.equal(impactDisplay('Medium', '未対応時'), '評価値: 中')
  assert.equal(priorityDisplay('P2'), '優先度 P2')
  assert.equal(plannedDateDisplay('2026-12-01', '開始日'), '開始日: 2026-12-01')
  assert.equal(ownerDisplay('アプリ部門', routing), '確定担当: アプリ部門')
  assert.equal(ownerTagDisplay('app-team'), 'app-team')
  assert.equal(modelVersionDisplay('1'), '1')
  assert.equal(projectProgressDisplay('In Progress'), 'In Progress')
  assert.equal(evidenceDisplay(['evidence-1']), 'evidence-1')
  assert.equal(
    milestoneDateDisplay(null, '26 August 2026'),
    '公式原文の記載: 26 August 2026（日付の適用範囲を確認）',
  )
})

test('decision statuses have a Japanese actionable label', () => {
  assert.match(decisionStatusDisplay('Abstained'), /根拠・業務情報の確認が必要/)
  assert.match(decisionStatusDisplay('Failed'), /手動確認が必要/)
  assert.match(
    reviewReasonDisplay('期限または承認済み工程期間が未確定'),
    /計画日を算定できません/,
  )
  assert.match(
    reviewReasonDisplay('担当チーム候補が設定されていません'),
    /情報システム部門が初動調整/,
  )
  assert.match(criticalWorkloadDisplay(false), /非該当の人間確認とは区別/)
  assert.match(
    assessmentStatusDisplay({ ...fixture(), humanReviewRequired: false }),
    /評価レビュー省略可能/,
  )
})

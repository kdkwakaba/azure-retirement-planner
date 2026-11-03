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
  isKnownReviewReason,
  isPlanSchedulingNote,
  milestoneDateDisplay,
  milestoneKindDisplay,
  modelInvocationStatusDisplay,
  ownerDisplay,
  ownerTagDisplay,
  modelVersionDisplay,
  plannedDateDisplay,
  planSchedulingNoteDisplay,
  priorityDisplay,
  projectProgressDisplay,
  reviewReasonDisplay,
  routingDisplay,
  sequenceDisplay,
  undecidedDecisionFields,
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
  assert.match(evidenceDisplay([], [])[0]!.label, /根拠が紐付いていません/)
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
  const evidence = fixture().event.evidence[0]!
  const azureEvidence = {
    ...evidence,
    id: 'azure-evidence-1',
    sourceType: 'Azure' as const,
    observedAt: '2026-08-02T00:00:00.000Z',
  }
  assert.deepEqual(
    evidenceDisplay([evidence.id, azureEvidence.id], [evidence, azureEvidence]),
    [
      { label: 'Microsoft公式情報（2026-08-01）', evidenceIndex: 0 },
      { label: 'Azure構成情報（2026-08-02）', evidenceIndex: 1 },
    ],
  )
  assert.equal(
    evidenceDisplay(['missing'], []).at(0)?.label,
    '参照先の根拠を特定できません',
  )
  assert.equal(
    milestoneDateDisplay(null, '26 August 2026'),
    '公式原文の記載: 26 August 2026（日付の適用範囲を確認）',
  )
})

test('explanation model status states clearly when no generated text is available', () => {
  assert.match(
    modelInvocationStatusDisplay({
      stage: 'Explanation',
      status: 'NotConfigured',
    }),
    /説明LLM未設定.*説明文は生成されていません/,
  )
  assert.match(
    modelInvocationStatusDisplay({ stage: 'Explanation', status: 'Failed' }),
    /説明生成失敗.*生成文は表示していません/,
  )
  assert.equal(
    modelInvocationStatusDisplay({ stage: 'Decision', status: 'Failed' }),
    '失敗',
  )
})

test('decision statuses have a Japanese actionable label', () => {
  const decision = fixture().decision
  assert.match(
    decisionStatusDisplay('Abstained', undecidedDecisionFields(decision)),
    /確定できなかった項目: 未対応時の影響度、対応時・対応後の影響度、優先度/,
  )
  assert.match(decisionStatusDisplay('Failed'), /手動確認が必要/)
  const planDateReason =
    '計画日を算定できません。適用期限と承認済みの工程期間を確認後、計画担当が設定します。'
  assert.equal(isPlanSchedulingNote(planDateReason), true)
  assert.equal(isKnownReviewReason(planDateReason), false)
  assert.equal(planSchedulingNoteDisplay(planDateReason), planDateReason)
  assert.match(
    reviewReasonDisplay(
      '担当者が対象リソースとプロジェクトでクラシック API の使用有無を確認し、必要な対応を判断する。',
    ),
    /クラシック API の使用有無を判断できないため/,
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

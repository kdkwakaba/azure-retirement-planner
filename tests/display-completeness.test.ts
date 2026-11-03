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
  deduplicateExplanationClaims,
  decisionStatusDisplay,
  evidenceDisplay,
  explanationSectionDisplay,
  impactDisplay,
  isKnownReviewReason,
  isModelDecisionStatusOnlyReviewReason,
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
  resourceConfirmationReasons,
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

test('explanation display consolidates repeated facts and keeps official dates in Microsoft facts', () => {
  const source = fixture().explanation
  const evidenceId = fixture().event.evidence[0]!.id
  const schedule = {
    id: 'official-date',
    text: 'Microsoft公式の廃止日は31 March 2027です。',
    kind: 'Confirmed Fact' as const,
    evidenceIds: [evidenceId],
    decisionRefs: [],
  }
  const impact = {
    id: 'impact-with-duplicated-date',
    text: '2027-03-31が廃止日です。廃止後は対象機能を利用できなくなる可能性があります。',
    kind: 'Derived Fact' as const,
    evidenceIds: [evidenceId, 'same-date-impact-evidence'],
    decisionRefs: [],
  }
  const mixedScheduleAndImpact = {
    id: 'mixed-schedule-and-impact',
    text: 'Microsoftはclassic Foundry Agent Service APIを2027年3月31日に廃止すると通知しているが、未対応時の具体的影響は提示資料から確認できない。',
    kind: 'Derived Fact' as const,
    evidenceIds: [evidenceId],
    decisionRefs: [],
  }
  const repeatedFactor = {
    id: 'factor-1',
    text: 'このリソースの利用有無を確認する必要があります。',
    kind: 'Derived Fact' as const,
    evidenceIds: [evidenceId],
    decisionRefs: [],
  }
  const repeatedMissingInfo = {
    id: 'missing-1',
    text: 'このリソースの利用有無を確認する必要があります。',
    kind: 'Unknown' as const,
    evidenceIds: [evidenceId],
    decisionRefs: [],
  }
  const explanation = {
    ...source,
    microsoftFacts: [schedule],
    impact: [impact, mixedScheduleAndImpact],
    increasingFactors: [repeatedFactor],
    missingInformation: [repeatedMissingInfo],
  }

  const sections = deduplicateExplanationClaims(explanation)
  const displayedOfficial = sections.find(
    ([name]) => name === 'microsoftFacts',
  )![1]
  const displayedImpact = sections.find(([name]) => name === 'impact')![1]
  assert.equal(
    displayedOfficial[0]!.text,
    'Microsoft公式の廃止日は31 March 2027です。',
  )
  assert.equal(
    displayedImpact[0]!.text,
    '廃止後は対象機能を利用できなくなる可能性があります。',
  )
  assert.equal(
    displayedImpact[1]!.text,
    '未対応時の具体的影響は提示資料から確認できない。',
  )
  assert.equal(
    sections.filter(([name]) => name === 'increasingFactors').length,
    1,
  )
  assert.equal(
    sections.some(([name]) => name === 'missingInformation'),
    false,
  )
  assert.equal(
    displayedOfficial[0]!.evidenceIds.includes('same-date-impact-evidence'),
    true,
  )
  assert.equal(explanation.impact[0]!.text, impact.text)
})

test('usage verification confirmation reasons combine similar resource and missing-information messages', () => {
  const first = {
    ...fixture().resources[0]!,
    classification: 'Verification Required' as const,
    classificationReason: 'UsageRequiresVerification' as const,
    verificationRequired: true,
  }
  const second = {
    ...first,
    id: `${first.id}/projects/test-project`,
    type: 'Microsoft.CognitiveServices/accounts/projects',
  }
  const reasons = resourceConfirmationReasons(
    [first, second],
    [
      '制御プレーン情報から利用実態を確認できないMicrosoft.CognitiveServices/accountsがあります。利用状況を確認してください。',
      '別の不足情報は引き続き確認が必要です。',
    ],
    [
      '制御プレーン情報から利用実態を確認できないMicrosoft.CognitiveServices/accounts/projectsがあります。許可された確認手段で利用状況を確認してください。',
      '業務重要度・移行方式・工程期間・適用期限の人間確認が必要',
    ],
  )
  assert.equal(reasons.length, 3)
  assert.equal(
    reasons.filter((reason) =>
      reason.includes('管理プレーン情報だけでは利用有無を判断できず'),
    ).length,
    1,
  )
  assert.match(reasons[0]!, /対象リソース（2件）/)
  assert.equal(
    reasons.some((reason) =>
      reason.startsWith('制御プレーン情報から利用実態を確認できない'),
    ),
    false,
  )
  assert.ok(reasons.includes('別の不足情報は引き続き確認が必要です。'))
  assert.ok(
    reasons.includes(
      '業務重要度・移行方式・工程期間・適用期限の人間確認が必要',
    ),
  )
})

test('confirmation reasons omit model status and planning notes from missing information', () => {
  const resource = {
    ...fixture().resources[0]!,
    classification: 'Verification Required' as const,
    classificationReason: 'UsageRequiresVerification' as const,
    verificationRequired: true,
  }
  const reasons = resourceConfirmationReasons(
    [resource],
    [
      'モデル判断を確定できない',
      '期限または承認済み工程期間が未確定',
      '別の確認理由は表示する',
    ],
  )
  assert.equal(
    reasons.some((reason) => reason === 'モデル判断を確定できない'),
    false,
  )
  assert.equal(
    reasons.some((reason) => reason === '期限または承認済み工程期間が未確定'),
    false,
  )
  assert.ok(reasons.includes('別の確認理由は表示する'))
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
  assert.equal(
    isModelDecisionStatusOnlyReviewReason('モデル判断を確定できない'),
    true,
  )
  assert.equal(
    isModelDecisionStatusOnlyReviewReason(
      '判断確率の確認が必要: impactIfUnaddressed',
    ),
    false,
  )
  assert.match(criticalWorkloadDisplay(false), /非該当の人間確認とは区別/)
  assert.match(
    assessmentStatusDisplay({ ...fixture(), humanReviewRequired: false }),
    /評価レビュー省略可能/,
  )
})

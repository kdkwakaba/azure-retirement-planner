import { createHash } from 'node:crypto'
import type {
  Approval,
  Assessment,
  Correction,
  Decision,
  Evidence,
  Impact,
  LifecycleEvent,
  Priority,
  ResourceImpact,
} from '@arp/contracts'
import { assessmentSchema, dateSchema, eventSchema } from '@arp/contracts'

export const RULE_VERSION = '2026-10-24.1'
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'null'
}
export const hash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex')
export function daysBetween(asOf: string, deadline: string): number {
  dateSchema.parse(asOf)
  dateSchema.parse(deadline)
  return Math.floor((Date.parse(deadline) - Date.parse(asOf)) / 86400000)
}
const ranks: Priority[] = ['P1', 'P2', 'P3', 'P4']
export function highestPriority(
  ...values: (Priority | null)[]
): Priority | null {
  return (
    values
      .filter((v): v is Priority => v !== null)
      .sort((a, b) => ranks.indexOf(a) - ranks.indexOf(b))[0] ?? null
  )
}
export function priorityFor(impact: Impact, slack: number): Priority {
  if (slack <= 0) return 'P1'
  if (slack <= 30) return ['High', 'Critical'].includes(impact) ? 'P1' : 'P2'
  if (slack <= 90) return ['High', 'Critical'].includes(impact) ? 'P2' : 'P3'
  return impact === 'Critical' ? 'P2' : impact === 'Low' ? 'P4' : 'P3'
}
export function applyRules(input: {
  decision: Decision
  asOf: string
  applicableDeadline: string | null
  remainingCalendarDays: number | null
  criticalWorkload: boolean
  scopeComplete: boolean
  missingInformation: string[]
  unresolvedImpact: boolean
  alternativeApproved: boolean
}) {
  const reasons = [...input.missingInformation]
  let floor: Priority | null = null
  let slack: number | null = null
  if (input.applicableDeadline && input.remainingCalendarDays !== null) {
    slack =
      daysBetween(input.asOf, input.applicableDeadline) -
      input.remainingCalendarDays
    if (input.decision.impactIfUnaddressed)
      floor = priorityFor(input.decision.impactIfUnaddressed, slack)
  } else {
    floor = 'P2'
    reasons.push('期限または承認済み工程期間が未確定')
  }
  if (
    input.unresolvedImpact &&
    input.applicableDeadline &&
    daysBetween(input.asOf, input.applicableDeadline) <= 30
  )
    floor = 'P1'
  if (!input.scopeComplete) {
    floor = highestPriority(floor, 'P2')
    reasons.push('対象範囲の取得が不完全')
  }
  if (input.criticalWorkload) reasons.push('Critical workloadを含む')
  if (
    !input.alternativeApproved &&
    ['High', 'Critical'].includes(
      input.decision.impactDuringAndAfterChange ?? '',
    )
  ) {
    floor = highestPriority(floor, 'P2')
    reasons.push('対応リスクの対策が未承認')
  }
  for (const [question, distribution] of Object.entries(
    input.decision.probabilities,
  )) {
    const sorted = Object.values(distribution).sort((a, b) => b - a)
    if ((sorted[0] ?? 0) < 0.8 || (sorted[0] ?? 0) - (sorted[1] ?? 0) < 0.2)
      reasons.push(`判断確率の確認が必要: ${question}`)
  }
  if (input.decision.status !== 'Proposed')
    reasons.push('モデル判断を確定できない')
  return {
    priority: highestPriority(floor, input.decision.priority),
    slackDays: slack,
    reviewReasons: [...new Set(reasons)],
  }
}
export function normalizeNotice(input: {
  tenantId: string
  trackingId: string
  title: string
  body: string
  updatedAt: string
  metadata?: Record<string, unknown>
}): LifecycleEvent {
  const text = input.title + '\n' + input.body
  const kinds: LifecycleEvent['kinds'] = []
  if (/deprecat|非推奨/i.test(text)) kinds.push('Deprecation')
  if (
    /new.{0,25}(creat|provision).{0,35}(stop|block|disabl)|新規作成.{0,15}(停止|不可)/i.test(
      text,
    )
  )
    kinds.push('NewCreationBlocked')
  if (/end.of.support|support.{0,20}(end|retir)|サポート終了/i.test(text))
    kinds.push('SupportEnded')
  if (/retir|廃止/i.test(text) || input.metadata?.EventSubType === 'Retirement')
    kinds.push('Retirement')
  // キーワードは候補選別のみ。公式日付・適用条件はこの段階で推測しない。
  const contentHash = hash({
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? {},
  })
  const id = hash({
    tenant: input.tenantId,
    source: 'ServiceHealth',
    trackingId: input.trackingId,
  })
  const evidence: Evidence = {
    id: hash({ id, contentHash }),
    sourceType: 'Microsoft',
    sourceVersion: contentHash,
    observedAt: input.updatedAt,
    subjectIds: [id],
    fact: text,
    officialUrl: null,
  }
  return eventSchema.parse({
    schemaVersion: '1',
    id,
    versionId: hash({ id, contentHash }),
    tenantId: input.tenantId,
    trackingId: input.trackingId,
    source: 'ServiceHealth',
    title: input.title,
    body: input.body,
    sourceUpdatedAt: input.updatedAt,
    contentHash,
    classification: kinds.length ? 'InScope' : 'ReviewRequired',
    kinds: kinds.length ? kinds : ['Unknown'],
    milestones: [],
    evidence: [evidence],
    rawMetadata: input.metadata ?? {},
  })
}
export function classifyResource(input: {
  explicitlyListed: boolean
  conditionMatches: boolean | null
  explicitlyExcluded: boolean
  dependencyEvidence: boolean
  usageRequired: boolean
}): ResourceImpact['classification'] {
  return classifyResourceDetails(input).classification
}
export function classifyResourceDetails(input: {
  explicitlyListed: boolean
  conditionMatches: boolean | null
  explicitlyExcluded: boolean
  dependencyEvidence: boolean
  usageRequired: boolean
  requiredAttributeMissing?: boolean
  requiredAttributeNames?: string[]
  applicableProfile?: boolean
}): Pick<
  ResourceImpact,
  | 'classification'
  | 'classificationReason'
  | 'missingAttributes'
  | 'verificationRequired'
> {
  if (input.explicitlyListed)
    return {
      classification: 'Confirmed',
      classificationReason: 'ExplicitMicrosoftImpact',
      missingAttributes: [],
      verificationRequired: false,
    }
  if (input.explicitlyExcluded)
    return {
      classification: 'Not Impacted',
      classificationReason: 'ExplicitExclusion',
      missingAttributes: [],
      verificationRequired: false,
    }
  if (input.usageRequired)
    return {
      classification: 'Verification Required',
      classificationReason: 'UsageRequiresVerification',
      missingAttributes: [],
      verificationRequired: true,
    }
  if (input.conditionMatches === true)
    return {
      classification: 'Probable',
      classificationReason: 'ProfileConditionMatched',
      missingAttributes: [],
      verificationRequired: false,
    }
  if (input.dependencyEvidence)
    return {
      classification: 'Possible',
      classificationReason: 'DependencyEvidence',
      missingAttributes: [],
      verificationRequired: false,
    }
  if (input.requiredAttributeMissing)
    return {
      classification: 'Verification Required',
      classificationReason: 'RequiredAttributeMissing',
      missingAttributes: input.requiredAttributeNames ?? [],
      verificationRequired: true,
    }
  return {
    classification: 'Unknown',
    classificationReason: input.applicableProfile
      ? 'NoMatchingProfileCondition'
      : 'NoApplicableProfile',
    missingAttributes: [],
    verificationRequired: false,
  }
}
export function packageHash(assessment: Assessment): string {
  const { packageHash: _ignored, ...content } = assessment
  void _ignored
  return hash(content)
}
export function validateAssessment(input: Assessment): string[] {
  const parsed = assessmentSchema.safeParse(input)
  if (!parsed.success)
    return parsed.error.issues.map(
      (i) => `Schema: ${i.path.join('.')}: ${i.message}`,
    )
  const errors: string[] = []
  const evidence = new Set(input.event.evidence.map((e) => e.id))
  const resources = new Map(input.resources.map((r) => [r.id.toLowerCase(), r]))
  const items = new Map(input.workItems.map((w) => [w.id, w]))
  if (items.size !== input.workItems.length) errors.push('重複Work Item ID')
  const checkEvidence = (ids: string[], label: string) => {
    if (ids.some((id) => !evidence.has(id)))
      errors.push(`${label}: 未知のEvidence`)
  }
  for (const milestone of input.event.milestones)
    checkEvidence(milestone.evidenceIds, milestone.id)
  for (const resource of input.resources)
    checkEvidence(resource.evidenceIds, resource.id)
  for (const claim of Object.values(input.explanation).flat()) {
    checkEvidence(claim.evidenceIds, claim.id)
    if (
      ['Confirmed Fact', 'Derived Fact', 'Recommendation'].includes(
        claim.kind,
      ) &&
      !claim.evidenceIds.length
    )
      errors.push(`${claim.id}: 根拠不足`)
    if (
      claim.kind === 'Model Decision' &&
      (!claim.decisionRefs.length ||
        claim.decisionRefs.some(
          (k) => !Object.hasOwn(input.decision.probabilities, k),
        ))
    )
      errors.push(`${claim.id}: 判断参照不正`)
  }
  for (const item of input.workItems) {
    checkEvidence(item.evidenceIds, item.id)
    if (
      item.necessity === 'Required' &&
      !['Impact Verification', 'Owner Confirmation'].includes(item.category)
    ) {
      if (
        item.sourceType === 'AIProposal' ||
        item.resourceIds.some((id) => {
          const resource = resources.get(id.toLowerCase())
          return (
            !resource ||
            ['Unknown', 'Possible', 'Verification Required'].includes(
              resource.classification,
            ) ||
            resource.verificationRequired
          )
        })
      )
        errors.push(`${item.id}: 不確実な移行・変更を必須にできない`)
    }

    const teams = new Set(
      [
        ...input.resources.map((r) => r.ownerTeam),
        ...(input.humanContext?.workItemUpdates.map((w) => w.ownerTeam) ?? []),
      ].filter((t): t is string => !!t),
    )
    if (item.ownerTeam && !teams.has(item.ownerTeam))
      errors.push(`${item.id}: 未確認のOwner Team`)
    if (item.workloadId !== input.workloadId)
      errors.push(`${item.id}: Workload不一致`)
    for (const id of item.resourceIds)
      if (
        !resources.has(id.toLowerCase()) ||
        resources.get(id.toLowerCase())?.workloadId !== item.workloadId
      )
        errors.push(`${item.id}: 対象Resource/Workload不一致`)
    if (
      item.plannedStartDate &&
      item.dueDate &&
      item.plannedStartDate > item.dueDate
    )
      errors.push(`${item.id}: 日付逆転`)
    for (const mid of item.applicableMilestoneIds) {
      const milestone = input.event.milestones.find((m) => m.id === mid)
      if (!milestone) errors.push(`${item.id}: 未知の期限`)
      else if (milestone.kind === 'Deprecation')
        errors.push(`${item.id}: 非推奨開始日を対応期限へ転用`)
      else if (milestone.date && item.dueDate && item.dueDate >= milestone.date)
        errors.push(`${item.id}: 期限前に完了しない`)
    }
    if (item.sourceType === 'Official' && !item.officialReferenceIds.length)
      errors.push(`${item.id}: 公式参照不足`)
    for (const ref of item.officialReferenceIds)
      if (
        !evidence.has(ref) ||
        input.event.evidence.find((e) => e.id === ref)?.sourceType !==
          'Microsoft'
      )
        errors.push(`${item.id}: 公式参照不正`)
    for (const dep of item.dependencyIds) {
      const preceding = items.get(dep)
      if (!preceding) errors.push(`${item.id}: 未知の依存`)
      else if (
        preceding.dueDate &&
        item.plannedStartDate &&
        preceding.dueDate > item.plannedStartDate
      )
        errors.push(`${item.id}: 前提日程不整合`)
    }
  }
  const active = new Set<string>(),
    done = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) {
      errors.push('作業依存に循環')
      return
    }
    if (done.has(id)) return
    active.add(id)
    for (const dep of items.get(id)?.dependencyIds ?? []) visit(dep)
    active.delete(id)
    done.add(id)
  }
  for (const id of items.keys()) visit(id)
  return [...new Set(errors)]
}
export function verifyApproval(
  assessment: Assessment,
  approval: Approval,
  itemId: string,
): void {
  if (
    assessment.packageHash !== packageHash(assessment) ||
    approval.packageHash !== assessment.packageHash ||
    approval.assessmentId !== assessment.id
  )
    throw new Error('承認対象が旧版または変更済み')
  if (
    !['Approved', 'Partial'].includes(approval.result) ||
    !approval.approvedItemIds.includes(itemId)
  )
    throw new Error('未承認の作業')
  if (
    validateAssessment(assessment).length ||
    assessment.validationErrors.length
  )
    throw new Error('検証不適合')
  if (!assessment.workItems.some((w) => w.id === itemId))
    throw new Error('未知の作業')
}
export function canClose(assessment: Assessment): boolean {
  return (
    assessment.scopeComplete &&
    assessment.resources.every(
      (r) =>
        !['Unknown', 'Verification Required', 'Possible'].includes(
          r.classification,
        ) && !r.verificationRequired,
    )
  )
}
export function reviseAssessment(
  original: Assessment,
  correction: Correction,
  reviewerId: string,
  now: string,
): Assessment {
  const result = structuredClone(original)
  const evidenceId = hash({ original: original.id, correction, reviewerId })
  const officialEvidence = original.event.evidence.find(
    (e) => e.sourceType === 'Microsoft',
  )
  if (!officialEvidence) throw new Error('Official source missing')
  result.event.evidence.push({
    id: evidenceId,
    sourceType: 'Human',
    sourceVersion: hash(correction),
    observedAt: now,
    subjectIds: [original.workloadId],
    fact: correction.reason,
    officialUrl: null,
  })
  const dates = [
    ['Deprecation', correction.deprecationDate],
    ['NewCreationBlocked', correction.creationStopDate],
    ['SupportEnded', correction.supportEndDate],
    ['Retirement', correction.retirementDate],
  ] as const
  result.event.milestones = dates
    .filter(
      (entry): entry is readonly [(typeof entry)[0], string] =>
        entry[1] !== null,
    )
    .map(([kind, date]) => ({
      id: hash({ event: original.event.id, kind, date }),
      kind,
      date,
      rawDateText: date,
      scope: '人間が公式通知と当該Workloadへの適用を確認',
      evidenceIds: [officialEvidence.id, evidenceId],
    }))
  if (correction.applicableKind === 'Deprecation')
    throw new Error('Deprecation date is not an action deadline')
  const milestone = result.event.milestones.find(
    (m) => m.kind === correction.applicableKind,
  )
  const rules = applyRules({
    decision: {
      ...original.decision,
      impactIfUnaddressed: correction.impactIfUnaddressed,
      impactDuringAndAfterChange: correction.impactDuringAndAfterChange,
      priority: null,
    },
    asOf: now.slice(0, 10),
    applicableDeadline: milestone?.date ?? null,
    remainingCalendarDays: correction.remainingCalendarDays,
    criticalWorkload: correction.criticalWorkload,
    scopeComplete: original.scopeComplete,
    missingInformation: [],
    unresolvedImpact: correction.impactIfUnaddressed === null,
    alternativeApproved: correction.alternativeApproved,
  })
  const known = new Set(result.workItems.map((w) => w.id))
  if (
    correction.workItemUpdates.some((w) => !known.has(w.id)) ||
    new Set(correction.workItemUpdates.map((w) => w.id)).size !==
      correction.workItemUpdates.length
  )
    throw new Error('Unknown or duplicate correction item')
  result.workItems = result.workItems.map((item) => {
    const update = correction.workItemUpdates.find((w) => w.id === item.id)
    return {
      ...item,
      ...update,
      priority: rules.priority,
      applicableMilestoneIds: milestone ? [milestone.id] : [],
      status: 'Draft',
    }
  })
  result.id = hash({ previous: original.id, correction, reviewerId, now })
  result.createdAt = now
  result.asOf = now.slice(0, 10)
  result.criticalWorkload = correction.criticalWorkload
  result.humanContext = { ...correction, reviewerId, reviewedAt: now }
  result.effectivePriority = rules.priority
  result.reviewReasons = [
    ...rules.reviewReasons,
    '人間による訂正後の新版。旧承認は適用されない',
  ]
  // 元のモデル結果・説明は原出力として維持し、人間訂正を別欄へ記録する。
  result.validationErrors = []
  result.validationErrors = validateAssessment(result)
  result.packageHash = packageHash(result)
  return assessmentSchema.parse(result)
}

// 日次の再計算は人間による再確認として記録しない。
export function refreshAssessment(
  original: Assessment,
  now: string,
): Assessment {
  const result = structuredClone(original)
  const context = result.humanContext
  const milestone = result.event.milestones.find(
    (m) => m.kind === context?.applicableKind,
  )
  const rules = applyRules({
    decision: context
      ? {
          ...result.decision,
          impactIfUnaddressed: context.impactIfUnaddressed,
          impactDuringAndAfterChange: context.impactDuringAndAfterChange,
          priority: null,
        }
      : result.decision,
    asOf: now.slice(0, 10),
    applicableDeadline: milestone?.date ?? null,
    remainingCalendarDays: context?.remainingCalendarDays ?? null,
    criticalWorkload: result.criticalWorkload,
    scopeComplete: result.scopeComplete,
    missingInformation: result.missingInformation,
    unresolvedImpact:
      (context
        ? context.impactIfUnaddressed
        : result.decision.impactIfUnaddressed) === null,
    alternativeApproved: context?.alternativeApproved ?? false,
  })
  result.id = hash({ previous: original.id, asOf: now.slice(0, 10) })
  result.createdAt = now
  result.asOf = now.slice(0, 10)
  result.effectivePriority = rules.priority
  result.reviewReasons = [
    ...rules.reviewReasons,
    '基準日更新によるルール再評価。人間の再確認は未実施',
  ]
  result.workItems = result.workItems.map((w) => ({
    ...w,
    priority: rules.priority,
    status: 'Draft',
  }))
  result.validationErrors = validateAssessment(result)
  result.packageHash = packageHash(result)
  return assessmentSchema.parse(result)
}

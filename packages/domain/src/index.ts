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
  WorkItem,
} from '@arp/contracts'
import { assessmentSchema, dateSchema, eventSchema } from '@arp/contracts'

export const RULE_VERSION = '2026-10-27.1'
export const NORMALIZATION_VERSION = '2026-10-27.1'
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
export type EventVersionComparison =
  'IncomingNewer' | 'IncomingStale' | 'Same' | 'Conflict'
export function compareEventVersion(
  current: Pick<LifecycleEvent, 'sourceUpdatedAt' | 'contentHash'>,
  incoming: Pick<LifecycleEvent, 'sourceUpdatedAt' | 'contentHash'>,
): EventVersionComparison {
  const currentTime = Date.parse(current.sourceUpdatedAt)
  const incomingTime = Date.parse(incoming.sourceUpdatedAt)
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime))
    throw new Error('Invalid event update timestamp')
  if (incomingTime > currentTime) return 'IncomingNewer'
  if (incomingTime < currentTime) return 'IncomingStale'
  return current.contentHash === incoming.contentHash ? 'Same' : 'Conflict'
}
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
const monthNumbers: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}
function explicitDate(value: string): string | null {
  if (dateSchema.safeParse(value).success) return value
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value)
  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value)
  if (!dayFirst && !monthFirst) return null
  const monthName = dayFirst?.[2] ?? monthFirst?.[1]
  const dayValue = dayFirst?.[1] ?? monthFirst?.[2]
  const year = dayFirst?.[3] ?? monthFirst?.[3]
  if (!monthName || !dayValue || !year) return null
  const month = monthNumbers[monthName.toLowerCase()]
  if (!month) return null
  const day = dayValue.padStart(2, '0')
  const date = `${year}-${month}-${day}`
  return dateSchema.safeParse(date).success ? date : null
}
function explicitRetirementDate(
  text: string,
): { date: string; rawDateText: string } | { ambiguous: true } | null {
  const dateToken =
    '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}|[A-Za-z]+\\s+\\d{1,2},?\\s+\\d{4})'
  const pattern = new RegExp(
    `\\b(?:will be retired|is being retired|is retired|was retired|retired|will retire|retires)\\s+on\\s+${dateToken}(?=$|[.,;!?\\s])`,
    'gi',
  )
  const candidates: { date: string; rawDateText: string }[] = []
  for (const match of text.matchAll(pattern)) {
    const rawDateText = match[1]
    const date = rawDateText ? explicitDate(rawDateText) : null
    if (date && rawDateText) candidates.push({ date, rawDateText })
  }
  const dates = new Set(candidates.map((candidate) => candidate.date))
  if (dates.size > 1) return { ambiguous: true }
  return candidates[0] ?? null
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
  // 日付は、Retirement subtypeの構造化値か、公式文面で廃止日を明示する限定表現だけを使う。
  const retirementDateText = input.metadata?.retirementDate
  const isRetirement = input.metadata?.EventSubType === 'Retirement'
  const structuredRetirementDate =
    isRetirement && typeof retirementDateText === 'string'
      ? (() => {
          const date = retirementDateText.slice(0, 10)
          const isDateOnly = retirementDateText === date
          const isUtcTimestamp =
            retirementDateText.startsWith(date + 'T') &&
            retirementDateText.endsWith('Z') &&
            Number.isFinite(Date.parse(retirementDateText))
          return dateSchema.safeParse(date).success &&
            (isDateOnly || isUtcTimestamp)
            ? { date, rawDateText: retirementDateText }
            : null
        })()
      : null
  const textualRetirementDate = isRetirement
    ? explicitRetirementDate(text)
    : null
  const hasDateConflict =
    structuredRetirementDate !== null &&
    textualRetirementDate !== null &&
    'date' in textualRetirementDate &&
    structuredRetirementDate.date !== textualRetirementDate.date
  const retirementDate = hasDateConflict
    ? null
    : (structuredRetirementDate ??
      (textualRetirementDate && 'date' in textualRetirementDate
        ? textualRetirementDate
        : null))
  const retirementDateScope = structuredRetirementDate
    ? 'Service Health ImpactMitigationTime'
    : 'Service Health explicit retirement wording'
  const contentHash = hash({
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? {},
  })
  // Keep source content identity separate from the parser version. The latter
  // creates a new immutable event version without inventing an official update.
  const id = hash({
    tenant: input.tenantId,
    source: 'ServiceHealth',
    trackingId: input.trackingId,
  })
  const evidenceId = hash({
    id,
    contentHash,
    normalizationVersion: NORMALIZATION_VERSION,
  })
  const milestones: LifecycleEvent['milestones'] = retirementDate
    ? [
        {
          id: hash({
            id,
            contentHash,
            kind: 'Retirement',
            date: retirementDate.date,
          }),
          kind: 'Retirement',
          date: retirementDate.date,
          rawDateText: retirementDate.rawDateText,
          scope: retirementDateScope,
          evidenceIds: [evidenceId],
        },
      ]
    : []
  const evidence: Evidence = {
    id: evidenceId,
    sourceType: 'Microsoft',
    sourceVersion: contentHash,
    observedAt: input.updatedAt,
    subjectIds: [id],
    fact: retirementDate
      ? `${text}\nOfficial ${retirementDateScope}: ${retirementDate.rawDateText}`
      : hasDateConflict
        ? `${text}\nConflicting official retirement dates; no date normalized.`
        : textualRetirementDate && 'ambiguous' in textualRetirementDate
          ? `${text}\nMultiple explicit retirement dates; no date normalized.`
          : text,
    officialUrl: null,
  }
  return eventSchema.parse({
    schemaVersion: '1',
    id,
    versionId: hash({
      id,
      contentHash,
      normalizationVersion: NORMALIZATION_VERSION,
    }),
    tenantId: input.tenantId,
    trackingId: input.trackingId,
    source: 'ServiceHealth',
    title: input.title,
    body: input.body,
    sourceUpdatedAt: input.updatedAt,
    contentHash,
    classification: kinds.length ? 'InScope' : 'ReviewRequired',
    kinds: kinds.length ? kinds : ['Unknown'],
    milestones,
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
  const missingAttributes = input.requiredAttributeNames ?? []
  if (
    input.explicitlyExcluded &&
    (input.explicitlyListed || input.conditionMatches === true)
  )
    return {
      classification: 'Unknown',
      classificationReason: 'ConflictingEvidence',
      missingAttributes,
      verificationRequired: true,
    }
  if (input.explicitlyListed)
    return {
      classification: 'Confirmed',
      classificationReason: 'ExplicitMicrosoftImpact',
      missingAttributes,
      verificationRequired:
        Boolean(input.requiredAttributeMissing) || input.usageRequired,
    }
  if (input.requiredAttributeMissing)
    return {
      classification: 'Verification Required',
      classificationReason: 'RequiredAttributeMissing',
      missingAttributes,
      verificationRequired: true,
    }
  if (input.usageRequired)
    return {
      classification: 'Verification Required',
      classificationReason: 'UsageRequiresVerification',
      missingAttributes,
      verificationRequired: true,
    }
  if (input.explicitlyExcluded)
    return {
      classification: 'Not Impacted',
      classificationReason: 'ExplicitExclusion',
      missingAttributes: [],
      verificationRequired: false,
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
  return {
    classification: 'Unknown',
    classificationReason: input.applicableProfile
      ? 'NoMatchingProfileCondition'
      : 'NoApplicableProfile',
    missingAttributes: [],
    verificationRequired: false,
  }
}
export function impactDiscoveryOutcome(input: {
  scopeComplete: boolean
  applicableProfile: boolean
  resources: ResourceImpact[]
}):
  | 'CandidatesFound'
  | 'NoResourcesDetected'
  | 'NoImpactMatched'
  | 'ProfileUnavailable'
  | 'Incomplete' {
  if (!input.scopeComplete) return 'Incomplete'
  if (!input.resources.length)
    return input.applicableProfile
      ? 'NoResourcesDetected'
      : 'ProfileUnavailable'
  if (input.resources.every((r) => r.classification === 'Not Impacted'))
    return 'NoImpactMatched'
  return 'CandidatesFound'
}
export function canSkipAssessmentReview(input: {
  outcome:
    | 'CandidatesFound'
    | 'NoResourcesDetected'
    | 'NoImpactMatched'
    | 'ProfileUnavailable'
    | 'Incomplete'
  scopeComplete: boolean
}): boolean {
  return (
    input.scopeComplete &&
    (input.outcome === 'NoResourcesDetected' ||
      input.outcome === 'NoImpactMatched')
  )
}
export function resourceVerificationWorkItems(input: {
  eventId: string
  workloadId: string
  priority: Priority | null
  eventEvidenceIds: string[]
  resources: ResourceImpact[]
}): WorkItem[] {
  const groups = new Map<string, ResourceImpact[]>()
  for (const resource of input.resources) {
    if (
      !resource.verificationRequired &&
      !['Unknown', 'Possible', 'Verification Required'].includes(
        resource.classification,
      )
    )
      continue
    const missingAttributes = [...resource.missingAttributes].sort()
    const key = hash({
      type: resource.type.toLowerCase(),
      ownerTeam: resource.ownerTeam,
      classification: resource.classification,
      reason: resource.classificationReason,
      verificationMethod: resource.classificationReason,
      missingAttributes,
    })
    groups.set(key, [...(groups.get(key) ?? []), resource])
  }
  return [...groups.entries()].map(([key, resources]) => {
    const sample = resources[0]!
    const attributes = [...sample.missingAttributes].sort()
    const resourceTypes = [...new Set(resources.map((r) => r.type))].sort()
    const resourceIds = [...new Set(resources.map((r) => r.id))].sort()
    const evidenceIds = [
      ...new Set([
        ...input.eventEvidenceIds,
        ...resources.flatMap((r) => r.evidenceIds),
      ]),
    ].sort()
    const detail =
      sample.classificationReason === 'RequiredAttributeMissing'
        ? `必要なAzure属性「${attributes.join('、')}」が取得結果にありません。現在の構成を読み取り専用で確認してください。`
        : sample.classificationReason === 'NoApplicableProfile'
          ? '現在の影響判定プロファイルにこの通知とリソース種別の組合せがありません。公式の適用範囲と実構成を人が確認してください。'
          : sample.classificationReason === 'NoMatchingProfileCondition'
            ? '既知の判定プロファイル条件に一致しません。未知の属性値を対象外とはみなさず、公式条件と実構成を人が確認してください。'
            : sample.classificationReason === 'DependencyEvidence'
              ? '依存関係の根拠が影響範囲を示すか、人が依存元・依存先を確認してください。'
              : sample.classificationReason === 'UsageRequiresVerification'
                ? '制御プレーン情報だけでは利用実態を確認できません。許可された運用手順で利用状況を確認してください。'
                : '明示対象のリソース情報またはWorkloadとの対応が不足しています。Resource IDと所属を人が確認してください。'
    const title =
      sample.classificationReason === 'RequiredAttributeMissing'
        ? `影響確認: ${attributes.join('、')} の確認`
        : sample.classificationReason === 'NoApplicableProfile'
          ? '影響確認: 判定プロファイルの適用範囲'
          : sample.classificationReason === 'NoMatchingProfileCondition'
            ? `影響確認: 条件不一致 (${sample.type})`
            : `影響確認: ${sample.classification}`
    return {
      id: hash({
        eventId: input.eventId,
        workloadId: input.workloadId,
        group: key,
        resourceIds,
      }),
      category: 'Impact Verification',
      title,
      description: `${resources.length}件の対象候補（${resourceTypes.join('、')}）: ${detail} 結論と根拠を訂正理由へ記録し、確認できなければUnknownを維持してください。この作業は影響確認であり、移行必須やAzureリソース変更を意味しません。`,
      workloadId: input.workloadId,
      resourceIds,
      ownerTeam: null,
      necessity: 'Recommended',
      priority: input.priority,
      plannedStartDate: null,
      dueDate: null,
      applicableMilestoneIds: [],
      prerequisites: [],
      completionCriteria: [
        '根拠と結論、確認できなかった情報を人が訂正理由へ記録する',
        '影響分類を確定できない場合はUnknownを維持し、移行・変更の要否は別途判断する',
      ],
      humanApprovalRequired: true,
      evidenceIds,
      sourceType: 'Mixed',
      officialReferenceIds: [],
      dependencyIds: [],
      status: 'Draft',
      confidence: {
        kind: 'EvidenceSupport',
        value: null,
        method: 'ResourceImpactの分類理由と不足属性からの決定的抽出',
        limitations: [
          '確認作業の生成は影響や移行必須を確定しない',
          'Unknownを対象外へ自動変換しない',
        ],
      },
    }
  })
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
  const evidenceById = new Map(input.event.evidence.map((e) => [e.id, e]))
  const evidence = new Set(evidenceById.keys())
  const resources = new Map(input.resources.map((r) => [r.id.toLowerCase(), r]))
  const items = new Map(input.workItems.map((w) => [w.id, w]))
  const evidenceAppliesTo = (
    id: string,
    workloadId: string,
    resourceIds: string[],
  ): boolean => {
    const item = evidenceById.get(id)
    if (!item) return true
    const resourceSubjects = item.subjectIds
      .map((subject) => subject.toLowerCase())
      .filter((subject) => resources.has(subject))
    if (resourceSubjects.length)
      return resourceIds.some((resourceId) =>
        resourceSubjects.includes(resourceId.toLowerCase()),
      )
    return (
      item.subjectIds.includes(input.event.id) ||
      item.subjectIds.includes(workloadId)
    )
  }
  const checkEvidenceScope = (
    ids: string[],
    label: string,
    workloadId: string,
    resourceIds: string[],
  ) => {
    if (
      ids.some(
        (id) =>
          evidence.has(id) && !evidenceAppliesTo(id, workloadId, resourceIds),
      )
    )
      errors.push(`${label}: 対象範囲外のEvidence`)
  }
  if (items.size !== input.workItems.length) errors.push('重複Work Item ID')
  const checkEvidence = (ids: string[], label: string) => {
    if (ids.some((id) => !evidence.has(id)))
      errors.push(`${label}: 未知のEvidence`)
  }
  for (const milestone of input.event.milestones)
    checkEvidence(milestone.evidenceIds, milestone.id)
  for (const resource of input.resources)
    checkEvidence(resource.evidenceIds, resource.id)
  if (input.humanContext?.reviewEvidenceIds)
    checkEvidence(input.humanContext.reviewEvidenceIds, 'Human Review')
  if (input.humanContext?.reviewEvidenceIds)
    checkEvidenceScope(
      input.humanContext.reviewEvidenceIds,
      'Human Review',
      input.workloadId,
      input.resources.map((resource) => resource.id),
    )
  if (input.humanContext?.scopeDisposition === 'OutOfScope') {
    if (!input.humanContext.reason.trim()) errors.push('対象外判定の理由不足')
    if (!input.humanContext.reviewEvidenceIds?.length)
      errors.push('対象外判定の根拠不足')
    else if (
      !input.humanContext.reviewEvidenceIds.some(
        (id) =>
          input.event.evidence.find((e) => e.id === id)?.sourceType === 'Human',
      )
    )
      errors.push('対象外判定はHuman Evidenceが必要')
    if (input.workItems.length || input.effectivePriority !== null)
      errors.push('対象外判定に作業または優先度が残っている')
  }
  for (const claim of Object.values(input.explanation).flat()) {
    checkEvidence(claim.evidenceIds, claim.id)
    checkEvidenceScope(
      claim.evidenceIds,
      claim.id,
      input.workloadId,
      input.resources.map((resource) => resource.id),
    )
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
    checkEvidenceScope(
      item.evidenceIds,
      item.id,
      item.workloadId,
      item.resourceIds,
    )
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
    checkEvidenceScope(
      item.officialReferenceIds,
      item.id,
      item.workloadId,
      item.resourceIds,
    )
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
  if (assessment.humanContext?.scopeDisposition === 'OutOfScope')
    throw new Error('対象外案件は作業承認できない')
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
  if (assessment.humanContext?.scopeDisposition === 'OutOfScope')
    return (
      assessment.humanReviewRequired !== true &&
      assessment.workItems.length === 0 &&
      assessment.effectivePriority === null &&
      assessment.humanContext.reason.trim().length > 0 &&
      !!assessment.humanContext.reviewEvidenceIds?.some((id) =>
        assessment.event.evidence.some((e) => e.id === id),
      ) &&
      !validateAssessment(assessment).length
    )
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
export function carryForwardHumanContext(
  next: Assessment,
  previous: Assessment,
): Assessment {
  if (
    !previous.humanContext ||
    previous.event.id !== next.event.id ||
    previous.event.versionId !== next.event.versionId ||
    previous.workloadId !== next.workloadId
  )
    return next
  const result = structuredClone(next)
  const reviewEvidenceIds = previous.humanContext.reviewEvidenceIds ?? []
  const reviewEvidence = previous.event.evidence.filter((e) =>
    reviewEvidenceIds.includes(e.id),
  )
  result.event.evidence.push(
    ...reviewEvidence.filter(
      (e) => !result.event.evidence.some((existing) => existing.id === e.id),
    ),
  )
  result.event.milestones = structuredClone(previous.event.milestones)
  result.humanContext = structuredClone(previous.humanContext)
  result.criticalWorkload = previous.humanContext.criticalWorkload
  result.humanReviewRequired = true
  if (previous.humanContext.scopeDisposition === 'OutOfScope') {
    result.workItems = []
    result.effectivePriority = null
    result.reviewReasons = [
      `人間が対象外と判定: ${previous.humanContext.reason}`,
      '評価根拠が更新されたため、新旧根拠を確認し承認を取り直してください',
    ]
  } else {
    const context = previous.humanContext
    const milestone = result.event.milestones.find(
      (item) => item.kind === context.applicableKind,
    )
    const rules = applyRules({
      decision: {
        ...result.decision,
        impactIfUnaddressed: context.impactIfUnaddressed,
        impactDuringAndAfterChange: context.impactDuringAndAfterChange,
        priority: null,
      },
      asOf: result.asOf,
      applicableDeadline: milestone?.date ?? null,
      remainingCalendarDays: context.remainingCalendarDays,
      criticalWorkload: context.criticalWorkload,
      scopeComplete: result.scopeComplete,
      missingInformation: [],
      unresolvedImpact: context.impactIfUnaddressed === null,
      alternativeApproved: context.alternativeApproved,
    })
    const knownWorkItems = new Set(result.workItems.map((item) => item.id))
    const staleUpdates = context.workItemUpdates.filter(
      (update) => !knownWorkItems.has(update.id),
    )
    result.workItems = result.workItems.map((item) => {
      const update = context.workItemUpdates.find(
        (candidate) => candidate.id === item.id,
      )
      return {
        ...item,
        ...(update ?? {}),
        priority: rules.priority,
        applicableMilestoneIds: milestone ? [milestone.id] : [],
        status: 'Draft',
      }
    })
    if (staleUpdates.length)
      result.missingInformation.push(
        '根拠更新後の作業IDが前回の人間訂正と一致しないため、担当・日程の再確認が必要',
      )
    result.effectivePriority = rules.priority
    result.reviewReasons = [
      ...new Set([
        ...rules.reviewReasons,
        '評価根拠が更新されたため、前回の人間判断を引き継いだ上で再確認が必要',
      ]),
    ]
  }
  result.validationErrors = validateAssessment(result)
  result.packageHash = packageHash(result)
  return assessmentSchema.parse(result)
}
export function reviseAssessment(
  original: Assessment,
  correction: Correction,
  reviewerId: string,
  now: string,
): Assessment {
  const result = structuredClone(original)
  const scopeDisposition =
    correction.scopeDisposition ??
    original.humanContext?.scopeDisposition ??
    (original.event.classification === 'ReviewRequired'
      ? 'ReviewRequired'
      : original.event.classification)
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
  result.workItems =
    scopeDisposition === 'OutOfScope'
      ? []
      : result.workItems.map((item) => {
          const update = correction.workItemUpdates.find(
            (w) => w.id === item.id,
          )
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
  result.humanContext = {
    ...correction,
    scopeDisposition,
    reviewerId,
    reviewedAt: now,
    reviewEvidenceIds: [evidenceId],
  }
  if (scopeDisposition === 'OutOfScope') result.humanReviewRequired = false
  result.effectivePriority =
    scopeDisposition === 'OutOfScope' ? null : rules.priority
  result.reviewReasons =
    scopeDisposition === 'OutOfScope'
      ? [`人間が対象外と判定: ${correction.reason}`]
      : [...rules.reviewReasons, '人間による訂正後の新版。旧承認は適用されない']
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
  if (context?.scopeDisposition === 'OutOfScope') {
    result.id = hash({ previous: original.id, asOf: now.slice(0, 10) })
    result.createdAt = now
    result.asOf = now.slice(0, 10)
    result.effectivePriority = null
    result.reviewReasons = [`人間が対象外と判定: ${context.reason}`]
    result.workItems = []
    result.validationErrors = validateAssessment(result)
    result.packageHash = packageHash(result)
    return assessmentSchema.parse(result)
  }
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

export { applyWorkflowPolicy, workflowPolicySchema } from './workflow.ts'
export type { WorkflowPolicy } from './workflow.js'

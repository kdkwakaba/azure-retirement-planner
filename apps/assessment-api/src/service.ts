import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type {
  Assessment,
  Explanation,
  LifecycleEvent,
  ResourceImpact,
  WorkItem,
} from '@arp/contracts'
import { assessmentSchema } from '@arp/contracts'
import {
  applyRules,
  hash,
  packageHash,
  validateAssessment,
  refreshAssessment,
} from '@arp/domain'
import {
  AzureStore,
  decide,
  discover,
  explicitResourceIds,
  explain,
  groundedInput,
  matchProfile,
  required,
  unavailableDecision,
} from '@arp/adapters'

export function config() {
  return {
    tenantId: z.uuid().parse(required('TENANT_ID')),
    subscriptions: z
      .array(z.uuid())
      .min(1)
      .max(5)
      .parse(
        required('TARGET_SUBSCRIPTION_IDS')
          .split(',')
          .map((v) => v.trim()),
      ),
    account: required('DATA_STORAGE_ACCOUNT'),
    modelCalls: z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(process.env.MAX_MODEL_CALLS_PER_DAY ?? '0'),
  }
}
export async function synchronize(): Promise<{
  events: number
  resources: number
  scopeComplete: boolean
  failures: string[]
}> {
  const settings = config(),
    store = new AzureStore(settings.account)
  const snapshot = await discover(settings.subscriptions, settings.tenantId)
  const snapshotId = hash(snapshot)
  await store.put('discovery', snapshotId, snapshot)
  for (const event of snapshot.events) {
    await store.put('events', event.versionId, event)
    await store.queues
      .getQueueClient('assessments')
      .sendMessage(
        Buffer.from(
          JSON.stringify({ snapshotId, eventVersionId: event.versionId }),
        ).toString('base64'),
      )
  }
  return {
    events: snapshot.events.length,
    resources: snapshot.resources.length,
    scopeComplete: snapshot.scopeComplete,
    failures: snapshot.failures,
  }
}
function fallbackExplanation(
  event: LifecycleEvent,
  missing: string[],
): Explanation {
  const empty = {
    impact: [],
    increasingFactors: [],
    reducingFactors: [],
    startRationale: [],
    missingInformation: [],
    changeConditions: [],
    microsoftFacts: [],
    internalFacts: [],
    judgments: [],
    humanChecks: [],
  }
  return {
    ...empty,
    microsoftFacts: event.evidence
      .filter((e) => e.sourceType === 'Microsoft')
      .map((e) => ({
        id: hash(e.id),
        text: '公式通知を取得済み。適用条件と日付は人間確認が必要。',
        kind: 'Confirmed Fact' as const,
        evidenceIds: [e.id],
        decisionRefs: [],
      })),
    missingInformation: missing.map((text, i) => ({
      id: `unknown-${i}`,
      text,
      kind: 'Unknown' as const,
      evidenceIds: [],
      decisionRefs: [],
    })),
    humanChecks: [
      {
        id: 'review',
        text: '業務重要度・Owner・期限・移行方式を確認してください。',
        kind: 'Recommendation',
        evidenceIds: event.evidence.map((e) => e.id),
        decisionRefs: [],
      },
    ],
  }
}
export async function assessSnapshot(message: unknown): Promise<void> {
  const job = z
    .object({
      snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
      eventVersionId: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(message)
  const settings = config(),
    store = new AzureStore(settings.account)
  const event = await store.get<LifecycleEvent>('events', job.eventVersionId)
  const snapshot = await store.get<Awaited<ReturnType<typeof discover>>>(
    'discovery',
    job.snapshotId,
  )
  if (event.classification === 'OutOfScope') return
  let explicit = new Set<string>(),
    complete = snapshot.scopeComplete
  const missing = [
    ...snapshot.failures,
    '業務重要度・移行方式・工程期間・適用期限の人間確認が必要',
  ]
  try {
    explicit = await explicitResourceIds(event, settings.subscriptions)
  } catch {
    complete = false
    missing.push('公式対象関連付けが未完了')
  }
  const matched = snapshot.resources.map((r) =>
    matchProfile(event, r, explicit),
  )
  // 対象不明の構成も残す。公式対象一覧にないことだけでは除外しない。
  const candidates = matched
  for (const id of explicit) {
    const eid = hash({ eventVersion: event.versionId, explicitResource: id })
    snapshot.evidence.push({
      id: eid,
      sourceType: 'Microsoft',
      sourceVersion: hash({ trackingId: event.trackingId, id }),
      observedAt: new Date().toISOString(),
      subjectIds: [id],
      fact: `Service Health／Advisorの公式対象取得結果に含まれる: ${id}`,
      officialUrl: null,
    })
    const existing = candidates.find((r) => r.id.toLowerCase() === id)
    if (existing) existing.evidenceIds = [...existing.evidenceIds, eid]
    else
      candidates.push({
        id,
        type: 'Unknown',
        region: 'Unknown',
        sku: null,
        workloadId: null,
        ownerTeam: null,
        environment: null,
        classification: 'Confirmed',
        verificationRequired: true,
        evidenceIds: [eid],
        properties: {},
      })
  }
  const workloads = [
    ...new Set(candidates.map((r) => r.workloadId ?? 'unassigned')),
  ]
  if (!workloads.length) workloads.push('unassigned')
  for (const workloadId of workloads) {
    const resources = candidates
      .filter((r) => (r.workloadId ?? 'unassigned') === workloadId)
      .map((r) => ({ ...r, workloadId }))
    await assessWorkload(
      store,
      event,
      resources,
      snapshot.evidence,
      workloadId,
      complete,
      missing,
      settings.modelCalls,
    )
  }
}
async function assessWorkload(
  store: AzureStore,
  event: LifecycleEvent,
  resources: ResourceImpact[],
  evidence: LifecycleEvent['evidence'],
  workloadId: string,
  complete: boolean,
  missing: string[],
  limit: number,
): Promise<void> {
  const asOf = new Date().toISOString().slice(0, 10)
  const id = hash({
    eventVersionId: event.versionId,
    workloadId,
    timeKey: event.milestones.some((m) => m.kind !== 'Deprecation' && m.date)
      ? asOf
      : null,
    resources: resources
      .map(({ evidenceIds: _ids, ...r }) => {
        void _ids
        return r
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    complete,
  })
  const prior = await store.head(hash({ eventId: event.id, workloadId }))
  if (prior) {
    const current = await store.assessment(prior.assessmentId)
    if (current.event.sourceUpdatedAt > event.sourceUpdatedAt) return
    if (
      current.event.sourceUpdatedAt === event.sourceUpdatedAt &&
      current.event.contentHash !== event.contentHash
    ) {
      complete = false
      missing = [
        ...missing,
        '同一更新日時に異なる公式内容。競合版の人間確認が必要',
      ]
    }
    if (current.id === id || current.sourceInputHash === id) {
      if (current.humanContext?.applicableKind && current.asOf !== asOf) {
        await store.commitAssessment(
          refreshAssessment(current, new Date().toISOString()),
          prior,
        )
      }
      return
    }
  }
  const assessmentId = hash({ input: id, run: randomUUID() })
  const enriched = {
    ...event,
    evidence: [
      ...event.evidence,
      ...evidence.filter((e) =>
        resources.some((r) => r.evidenceIds.includes(e.id)),
      ),
    ],
  }
  let decision = unavailableDecision(),
    explanation = fallbackExplanation(event, missing)
  let workItems: WorkItem[] = []
  const endpoint = process.env.DECISION_ENDPOINT,
    deployment = process.env.DECISION_DEPLOYMENT
  if (endpoint && deployment) {
    try {
      await store.reserveModelCall(limit)
      const output = await decide(
        endpoint,
        deployment,
        required('DECISION_MODEL_VERSION'),
        {
          ...groundedInput(enriched, resources, workloadId).state,
          missingInformation: missing,
          asOf,
        },
        (raw) =>
          store.put(
            'model-raw',
            hash({ id: assessmentId, stage: 'decision' }),
            raw,
          ),
      )
      await store.put(
        'model-results',
        hash({ id: assessmentId, stage: 'decision' }),
        output,
      )
      decision = output.decision
    } catch {
      missing = [
        ...missing,
        'Decision-1が未利用または応答契約を確認できないため手動判断',
      ]
    }
  }
  const rules = applyRules({
    decision,
    asOf,
    applicableDeadline: null,
    remainingCalendarDays: null,
    criticalWorkload: false,
    scopeComplete: complete,
    missingInformation: missing,
    unresolvedImpact: true,
    alternativeApproved: false,
  })
  if (
    decision.status !== 'Unavailable' &&
    process.env.EXPLANATION_ENDPOINT &&
    process.env.EXPLANATION_DEPLOYMENT
  ) {
    try {
      await store.reserveModelCall(limit)
      const grounding = groundedInput(enriched, resources, workloadId, decision)
      const output = await explain(
        process.env.EXPLANATION_ENDPOINT,
        process.env.EXPLANATION_DEPLOYMENT,
        grounding.state,
        (raw) =>
          store.put(
            'model-raw',
            hash({ id: assessmentId, stage: 'explanation' }),
            raw,
          ),
      )
      await store.put(
        'model-results',
        hash({ id: assessmentId, stage: 'explanation' }),
        output,
      )
      explanation = output.result.explanation
      const ids = new Map(
        output.result.workItems.map((w, i) => [
          w.id,
          hash({
            eventId: event.id,
            workloadId,
            category: w.category,
            index: i,
          }),
        ]),
      )
      workItems = output.result.workItems.map((w) => ({
        ...grounding.resolve(w),
        id: ids.get(w.id)!,
        dependencyIds: w.dependencyIds.map((id) => ids.get(id) ?? id),
      }))
    } catch {
      missing = [...missing, '生成結果未確認。固定テンプレートで確認事項を提示']
    }
  }
  if (!workItems.length)
    workItems = [
      {
        id: hash({
          eventId: event.id,
          workloadId,
          category: 'Impact Verification',
        }),
        category: 'Impact Verification',
        title: '公式通知と実構成の影響確認',
        description:
          '対象条件、Owner、期限、業務影響と必要作業を確認する。移行必須の判断ではない。',
        workloadId,
        resourceIds: resources.map((r) => r.id),
        ownerTeam: null,
        necessity: 'Recommended',
        priority: rules.priority,
        plannedStartDate: null,
        dueDate: null,
        applicableMilestoneIds: [],
        prerequisites: [],
        completionCriteria: [
          '根拠付きの対象・対象外・未確定事項を人間が確認する',
        ],
        humanApprovalRequired: true,
        evidenceIds: event.evidence.map((e) => e.id),
        sourceType: 'Internal',
        officialReferenceIds: [],
        dependencyIds: [],
        status: 'Draft',
        confidence: {
          kind: 'EvidenceSupport',
          value: null,
          method: '公式通知に対する確認作業',
          limitations: ['業務情報と適用期限は未確認'],
        },
      },
    ]
  const assessment: Assessment = assessmentSchema.parse({
    id: assessmentId,
    sourceInputHash: id,
    eventVersionId: event.versionId,
    workloadId,
    createdAt: new Date().toISOString(),
    asOf,
    event: enriched,
    resources,
    scopeComplete: complete,
    criticalWorkload: false,
    missingInformation: missing,
    decision,
    effectivePriority: rules.priority,
    reviewReasons: [...rules.reviewReasons, 'PoCは全件人間承認必須'],
    explanation,
    workItems,
    validationErrors: [],
    packageHash: '',
  })
  assessment.validationErrors = validateAssessment(assessment)
  assessment.packageHash = packageHash(assessment)
  await store.commitAssessment(assessment, prior)
}

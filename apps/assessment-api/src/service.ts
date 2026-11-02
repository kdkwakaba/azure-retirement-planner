import { z } from 'zod'
import workflowPolicyData from '../../../config/workflow-policy.json' with { type: 'json' }
import { randomUUID } from 'node:crypto'
import type {
  Assessment,
  DiscoveryFailure,
  Evidence,
  Explanation,
  LifecycleEvent,
  ModelInvocation,
  ResourceImpact,
  WorkItem,
} from '@arp/contracts'
import { assessmentSchema } from '@arp/contracts'
import {
  applyRules,
  compareEventVersion,
  hash,
  packageHash,
  validateAssessment,
  refreshAssessment,
  resourceVerificationWorkItems,
  carryForwardHumanContext,
  impactDiscoveryOutcome,
  canSkipAssessmentReview,
  generalImpactNarratives,
  IMPACT_NARRATIVE_VERSION,
  applyWorkflowPolicy,
  generateBusinessWorkflowTasks,
  scopeEvidenceToWorkload,
  workflowPolicySchema,
} from '@arp/domain'
import {
  AzureStore,
  decide,
  discover,
  explicitResourceIds,
  explain,
  groundedInput,
  matchProfile,
  candidateResourcesForEvent,
  resourceTypesForProfile,
  PROMPT_VERSION,
  required,
  unavailableDecision,
  applicableProfileIds,
  fetchOfficialProfileEvidence,
  RESOURCE_PROFILES,
  PROFILE_RESOURCE_TYPES,
  PROFILE_REGISTRY_VERSION,
  failureFacts,
  recordDependencyFailure,
  recordModelInvocation,
} from '@arp/adapters'

export function applyReviewWorkflowPolicy(input: Assessment): Assessment {
  const parsed = workflowPolicySchema.safeParse(workflowPolicyData)
  if (!parsed.success)
    throw new Error('Workflow policy configuration is invalid')
  const result = structuredClone(input)
  const routing = applyWorkflowPolicy(
    result.workItems,
    result.resources,
    parsed.data,
  )
  result.workItems = routing.workItems
  result.workflowPolicyVersion = parsed.data.version
  result.workflowPolicyHash = hash(workflowPolicyData)
  result.humanReviewRequired = true
  result.reviewReasons = [
    ...new Set([
      ...result.reviewReasons,
      'ワークフローポリシーに基づく担当候補・調整候補を確認してください',
      ...routing.reviewReasons,
      ...routing.errors,
    ]),
  ]
  result.missingInformation = [
    ...new Set([...result.missingInformation, ...routing.errors]),
  ]
  result.validationErrors = validateAssessment(result)
  result.packageHash = packageHash(result)
  return assessmentSchema.parse(result)
}
import { applySyntheticUatDecision } from './uat.ts'

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
export function decisionRevision(limit: number): string | null {
  const endpoint = process.env.DECISION_ENDPOINT,
    deployment = process.env.DECISION_DEPLOYMENT,
    modelVersion = process.env.DECISION_MODEL_VERSION
  if (limit <= 0 || !endpoint || !deployment || !modelVersion) return null
  return hash({
    endpoint,
    deployment,
    modelVersion,
    promptVersion: PROMPT_VERSION,
  })
}
export function shouldInvokeDecisionModel(input: {
  candidateResourceCount: number
  deterministicNoReview: boolean
  reevaluation: boolean
}): boolean {
  if (input.candidateResourceCount === 0) return false
  return !input.deterministicNoReview || input.reevaluation
}

export function shouldInvokeExplanationModel(input: {
  candidateResourceCount: number
  deterministicNoReview: boolean
  reevaluation: boolean
  decisionStatus: Assessment['decision']['status']
}): boolean {
  if (
    input.candidateResourceCount === 0 ||
    input.decisionStatus === 'Unavailable'
  )
    return false
  return !input.deterministicNoReview || input.reevaluation
}

export function testReevaluationError(
  invocations: ModelInvocation[] | undefined,
): 'ModelUnavailable' | 'DailyLimit' | null {
  for (const stage of ['Decision', 'Explanation'] as const) {
    const invocation = invocations?.find((item) => item.stage === stage)
    if (invocation?.status === 'Succeeded') continue
    return invocation?.failureCategory === 'DailyLimit'
      ? 'DailyLimit'
      : 'ModelUnavailable'
  }
  return null
}

export function isTestReevaluation(
  assessment: Pick<Assessment, 'reevaluation'>,
): boolean {
  return assessment.reevaluation !== undefined
}

export async function evaluateSyntheticUat(
  source: Assessment,
): Promise<Assessment> {
  const settings = config()
  const store = new AzureStore(settings.account)
  const endpoint = process.env.DECISION_ENDPOINT
  const deployment = process.env.DECISION_DEPLOYMENT
  if (!endpoint || !deployment)
    throw new Error('Decision-1 is not configured for synthetic UAT')

  const assessmentId = hash({ syntheticUatDecisionRun: randomUUID() })
  const asOf = new Date().toISOString().slice(0, 10)
  const startedAt = Date.now()
  let requestStarted = false
  try {
    await store.reserveModelCall(settings.modelCalls)
    requestStarted = true
    const grounding = groundedInput(
      source.event,
      source.resources,
      source.workloadId,
    )
    const output = await decide(
      endpoint,
      deployment,
      required('DECISION_MODEL_VERSION'),
      {
        ...grounding.state,
        missingInformation: [
          ...source.missingInformation,
          '合成UATデータであり、Microsoft公式通知・実期限・実環境の事実ではありません',
        ],
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
    const decisionInvocation = emitModelInvocation({
      stage: 'Decision',
      assessmentId,
      deployment,
      modelVersion: output.decision.modelVersion,
      promptVersion: output.decision.promptVersion,
      status: 'Succeeded',
      durationMs: Date.now() - startedAt,
      failureCategory: null,
      httpStatus: null,
    })
    const explanationInvocation = emitModelInvocation({
      stage: 'Explanation',
      assessmentId,
      deployment: process.env.EXPLANATION_DEPLOYMENT,
      modelVersion: null,
      promptVersion: null,
      status: 'NotRequired',
      durationMs: null,
      failureCategory: null,
      httpStatus: null,
    })
    return applySyntheticUatDecision(
      source,
      output.decision,
      [decisionInvocation, explanationInvocation],
      assessmentId,
      asOf,
    )
  } catch (error) {
    const failure = modelFailure(error)
    emitModelInvocation({
      stage: 'Decision',
      assessmentId,
      deployment,
      modelVersion: process.env.DECISION_MODEL_VERSION ?? null,
      promptVersion: PROMPT_VERSION,
      status: requestStarted ? 'Failed' : 'NotStarted',
      durationMs: Date.now() - startedAt,
      failureCategory: failure.category,
      httpStatus: failure.httpStatus,
    })
    throw error
  }
}
function emitModelInvocation(input: {
  stage: ModelInvocation['stage']
  assessmentId: string
  deployment: string | undefined
  modelVersion: string | null
  promptVersion: string | null
  status: ModelInvocation['status']
  durationMs: number | null
  failureCategory: ModelInvocation['failureCategory']
  httpStatus: number | null
}): ModelInvocation {
  const record: ModelInvocation = {
    stage: input.stage,
    provider: 'Microsoft Foundry',
    deployment:
      input.deployment && /^[A-Za-z0-9._-]{1,80}$/.test(input.deployment)
        ? input.deployment
        : 'not-configured',
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    status: input.status,
    correlationId: hash({
      assessmentId: input.assessmentId,
      stage: input.stage,
    }),
    durationMs: input.durationMs,
    failureCategory: input.failureCategory,
    httpStatus: input.httpStatus,
  }
  recordModelInvocation(record)
  return record
}
function modelFailure(error: unknown): {
  category: ModelInvocation['failureCategory']
  httpStatus: number | null
} {
  if (
    error instanceof Error &&
    (error.message === 'Daily model call limit reached' ||
      error.message === 'Model calls disabled by budget setting')
  )
    return { category: 'DailyLimit', httpStatus: null }
  if (error instanceof Error && error.name === 'RestError')
    return { category: 'StorageFailure', httpStatus: null }
  return failureFacts(error)
}
const EVIDENCE_SCOPE_VERSION = '2'
export async function synchronize(assessmentIds: string[] = []): Promise<{
  events: number
  resources: number
  reassessedEvents: number
  scopeComplete: boolean
  failures: string[]
  failureDetails: DiscoveryFailure[]
}> {
  const settings = config(),
    store = new AzureStore(settings.account)
  const snapshot = await discover(settings.subscriptions, settings.tenantId)
  const snapshotId = hash(snapshot)
  await store.put('discovery', snapshotId, snapshot)
  const eventVersions = new Set<string>()
  const requestedWorkloads = new Map<string, Set<string>>()
  const existingAssessments = assessmentIds.length ? await store.list(true) : []
  for (const event of snapshot.events) {
    await store.put('events', event.versionId, event)
    eventVersions.add(event.versionId)
  }
  for (const assessmentId of assessmentIds) {
    const assessment = await store.assessment(assessmentId)
    if (
      assessment.event.trackingId === 'ARP-SYNTHETIC-UAT-001' ||
      assessment.event.classification === 'OutOfScope' ||
      assessment.humanContext?.scopeDisposition === 'OutOfScope'
    )
      throw new Error('Only an in-scope real notice can be resource-refreshed')
    const logicalId = hash({
      eventId: assessment.event.id,
      workloadId: assessment.workloadId,
    })
    const current = await store.head(logicalId)
    if (!current || current.assessmentId !== assessment.id)
      throw new Error('Assessment is not the current version')
    const workloads =
      requestedWorkloads.get(assessment.eventVersionId) ?? new Set()
    for (const related of existingAssessments) {
      if (related.event.id === assessment.event.id)
        workloads.add(related.workloadId)
    }
    workloads.add(assessment.workloadId)
    requestedWorkloads.set(assessment.eventVersionId, workloads)
    eventVersions.add(assessment.eventVersionId)
  }
  for (const eventVersionId of eventVersions) {
    await store.queues.getQueueClient('assessments').sendMessage(
      Buffer.from(
        JSON.stringify({
          snapshotId,
          eventVersionId,
          ...(requestedWorkloads.has(eventVersionId)
            ? { workloadIds: [...requestedWorkloads.get(eventVersionId)!] }
            : {}),
        }),
      ).toString('base64'),
    )
  }
  return {
    events: snapshot.events.length,
    resources: snapshot.resources.length,
    reassessedEvents: requestedWorkloads.size,
    scopeComplete: snapshot.scopeComplete,
    failures: snapshot.failures,
    failureDetails: snapshot.failureDetails,
  }
}
export function emptyExplanation(
  event: LifecycleEvent,
  resources: ResourceImpact[],
): Explanation {
  return {
    impact: generalImpactNarratives(event, resources),
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
}
function resourceGapText(resource: ResourceImpact): string {
  const attributes = resource.missingAttributes
  if (resource.classificationReason === 'RequiredAttributeMissing')
    return `影響判定に必要な属性が不足: ${resource.type} / ${attributes.join(', ') || '属性名未特定'}。実構成を読み取り専用で確認してください。`
  if (resource.classificationReason === 'NoApplicableProfile')
    return `現在の判定プロファイルに${resource.type}と通知の組合せがありません。公式適用範囲と対象可否を確認してください。`
  if (resource.classificationReason === 'NoMatchingProfileCondition')
    return `既知の判定条件に一致しない${resource.type}があります。未知の値を対象外とせず、公式条件との照合が必要です。`
  if (resource.classificationReason === 'UsageRequiresVerification')
    return `制御プレーン情報から利用実態を確認できない${resource.type}があります。許可された確認手段で利用状況を確認してください。`
  if (resource.classificationReason === 'DependencyEvidence')
    return `依存関係の根拠がある${resource.type}について、依存元・依存先と影響経路を確認してください。`
  return `明示対象の${resource.type}について、Azure Resource IDとWorkload所属などの不足情報を確認してください。`
}
function resourceMissingInformation(resources: ResourceImpact[]): string[] {
  return [
    ...new Set(
      resources
        .filter(
          (r) =>
            r.verificationRequired ||
            ['Unknown', 'Possible', 'Verification Required'].includes(
              r.classification,
            ),
        )
        .map(resourceGapText),
    ),
  ]
}
export async function assessSnapshot(message: unknown): Promise<void> {
  const job = z
    .object({
      snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
      eventVersionId: z.string().regex(/^[a-f0-9]{64}$/),
      workloadIds: z.array(z.string()).optional(),
    })
    .parse(message)
  const settings = config(),
    store = new AzureStore(settings.account)
  let event = await store.get<LifecycleEvent>('events', job.eventVersionId)
  const snapshot = await store.get<Awaited<ReturnType<typeof discover>>>(
    'discovery',
    job.snapshotId,
  )
  if (event.classification === 'OutOfScope') return
  let explicit = new Set<string>(),
    complete = snapshot.scopeComplete
  const missing = [...snapshot.failures],
    discoveryFailureDetails: DiscoveryFailure[] = [
      ...(snapshot.failureDetails ?? []),
    ]
  try {
    const discovery = await explicitResourceIds(event, settings.subscriptions)
    explicit = discovery.resourceIds
    complete &&= discovery.complete
    missing.push(...discovery.failures)
    discoveryFailureDetails.push(...discovery.failureDetails)
  } catch (error) {
    complete = false
    missing.push('公式対象関連付けが未完了')
    discoveryFailureDetails.push(
      recordDependencyFailure('ServiceHealthImpactedResources', error),
    )
  }
  const candidates = candidateResourcesForEvent(
    event,
    snapshot.resources,
    explicit,
  ).map((resource) => matchProfile(event, resource, explicit))
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
        classificationReason: 'ExplicitMicrosoftImpact',
        missingAttributes: ['Azure inventory metadata'],
        verificationRequired: true,
        evidenceIds: [eid],
        properties: {},
      })
  }
  const profiles = applicableProfileIds(event)
  const referenceEvidence: Evidence[] = []
  for (const profileId of profiles) {
    const profile = RESOURCE_PROFILES.find((item) => item.id === profileId)
    const profileResourceTypes = resourceTypesForProfile(profileId)
    const matchingResources = profile
      ? candidates.filter((resource) =>
          profileResourceTypes.includes(resource.type.toLowerCase()),
        )
      : []
    if (!profile || !matchingResources.length) continue
    try {
      referenceEvidence.push({
        ...(await fetchOfficialProfileEvidence(profileId)),
        subjectIds: matchingResources.map((resource) => resource.id),
      })
    } catch (error) {
      complete = false
      missing.push(`公式参照の取得に失敗: ${profileId}`)
      discoveryFailureDetails.push(
        recordDependencyFailure('OfficialReference', error),
      )
    }
  }
  event = {
    ...event,
    evidence: [...event.evidence, ...referenceEvidence],
  }
  const workloads = [
    ...new Set([
      ...candidates.map((r) => r.workloadId ?? 'unassigned'),
      ...(job.workloadIds ?? []),
    ]),
  ]
  if (!workloads.length) workloads.push('unassigned')
  for (const workloadId of workloads) {
    const resources = candidates
      .filter((r) => (r.workloadId ?? 'unassigned') === workloadId)
      .map((r) => ({ ...r, workloadId }))
    const workloadOutcome = impactDiscoveryOutcome({
      scopeComplete: complete,
      applicableProfile: profiles.length > 0,
      resources,
    })
    const deterministicNoReview = canSkipAssessmentReview({
      outcome: workloadOutcome,
      scopeComplete: complete,
    })
    const workloadMissing = deterministicNoReview
      ? []
      : [
          ...missing,
          ...(profiles.length === 0 && resources.length === 0
            ? [
                '通知に対応するResource Typeプロファイルがありません。無関係なインベントリ候補は表示せず、公式の明示対象または対象サービス種別を人が確認してください。対象外とは判定していません。',
              ]
            : []),
          '業務重要度・移行方式・工程期間・適用期限の人間確認が必要',
          ...resourceMissingInformation(resources),
        ]
    const workloadEvent: LifecycleEvent = {
      ...event,
      evidence: scopeEvidenceToWorkload({
        evidence: event.evidence.filter(
          (item) =>
            item.officialUrl === null ||
            resources.some((resource) => item.subjectIds.includes(resource.id)),
        ),
        eventId: event.id,
        workloadId,
        resources,
      }),
    }
    await assessWorkload(
      store,
      workloadEvent,
      resources,
      snapshot.evidence,
      workloadId,
      complete,
      workloadMissing,
      settings.modelCalls,
      workloadOutcome,
      {
        subscriptionIds: settings.subscriptions,
        resourceTypes: [...PROFILE_RESOURCE_TYPES],
        profileIds: profiles,
        profileRegistryVersion: PROFILE_REGISTRY_VERSION,
        resourceCount: snapshot.resources.length,
        scopeComplete: complete,
        failureDetails: discoveryFailureDetails,
      },
    )
  }
}

export async function processDecisionReevaluation(
  runId: string,
): Promise<void> {
  const settings = config()
  const store = new AzureStore(settings.account)
  const run = await store.claimDecisionReevaluation(runId)
  if (!run) return
  try {
    if (
      process.env.TEST_MODE_ENABLED !== 'true' ||
      process.env.DECISION_REEVALUATION_ENABLED !== 'true'
    )
      throw new Error('Reevaluation feature disabled')
    const source = await store.assessment(run.assessmentId)
    const logicalId = hash({
      eventId: source.event.id,
      workloadId: source.workloadId,
    })
    const prior = await store.head(logicalId)
    if (
      !prior ||
      prior.assessmentId !== source.id ||
      source.event.trackingId === 'ARP-SYNTHETIC-UAT-001'
    ) {
      await store.finishDecisionReevaluation(
        runId,
        'Failed',
        null,
        'StaleAssessment',
      )
      return
    }
    if (!source.discoveryScope) {
      await store.finishDecisionReevaluation(
        runId,
        'Failed',
        null,
        'MissingSnapshot',
      )
      return
    }
    const resultId = await assessWorkload(
      store,
      source.event,
      source.resources,
      [],
      source.workloadId,
      source.scopeComplete,
      source.missingInformation,
      settings.modelCalls,
      source.impactDiscoveryOutcome ?? 'Incomplete',
      source.discoveryScope,
      {
        runId,
        sourceAssessmentId: source.id,
        requestedBy: run.requestedBy,
        requestedAt: run.requestedAt,
        reason: run.reason,
      },
    )
    if (!resultId) throw new Error('Reevaluation produced no assessment')
    const result = await store.assessment(resultId)
    const modelError = testReevaluationError(result.modelInvocations)
    if (modelError) {
      await store.finishDecisionReevaluation(
        runId,
        'Failed',
        resultId,
        modelError,
      )
      return
    }
    await store.finishDecisionReevaluation(runId, 'Completed', resultId, null)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const dailyLimit =
      message.includes('Model calls disabled') ||
      message.includes('Daily model call limit')
    await store.finishDecisionReevaluation(
      runId,
      'Failed',
      null,
      dailyLimit
        ? 'DailyLimit'
        : message.includes('Decision-1')
          ? 'ModelUnavailable'
          : 'ProcessingFailed',
    )
    if (dailyLimit) return
    throw error
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
  impactOutcome: NonNullable<Assessment['impactDiscoveryOutcome']>,
  discoveryScope: NonNullable<Assessment['discoveryScope']>,
  reevaluation?: NonNullable<Assessment['reevaluation']>,
): Promise<string | null> {
  const asOf = new Date().toISOString().slice(0, 10)
  const businessContext = await store.businessContext(workloadId)
  const policyHash = hash(workflowPolicyData)
  const policyParsed = workflowPolicySchema.safeParse(workflowPolicyData)
  const officialReferenceVersions = event.evidence
    .filter((item) => item.officialUrl !== null)
    .map((item) => item.sourceVersion)
    .sort()
  const id = hash({
    evidenceScopeVersion: EVIDENCE_SCOPE_VERSION,
    workflowPolicyHash: policyHash,
    businessContextHash: businessContext ? hash(businessContext) : null,
    eventVersionId: event.versionId,
    ...(officialReferenceVersions.length ? { officialReferenceVersions } : {}),
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
    impactNarrativeVersion: IMPACT_NARRATIVE_VERSION,
    complete,
    decisionRevision: decisionRevision(limit),
    ...(reevaluation ? { reevaluationRunId: reevaluation.runId } : {}),
  })
  const prior = await store.head(hash({ eventId: event.id, workloadId }))
  let previousAssessment: Assessment | null = null
  if (prior) {
    const current = await store.assessment(prior.assessmentId)
    previousAssessment = current
    const versionComparison = compareEventVersion(current.event, event)
    if (versionComparison === 'IncomingStale') return null
    if (versionComparison === 'Conflict') {
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
      return null
    }
  }
  const assessmentId = hash({ input: id, run: randomUUID() })
  const enriched = {
    ...event,
    evidence: scopeEvidenceToWorkload({
      evidence: [
        ...event.evidence,
        ...evidence.filter((e) =>
          resources.some((r) => r.evidenceIds.includes(e.id)),
        ),
      ],
      eventId: event.id,
      workloadId,
      resources,
    }),
  }
  if (businessContext) {
    const evidenceId = hash({
      kind: 'business-context',
      workloadId,
      context: businessContext,
    })
    enriched.evidence.push({
      id: evidenceId,
      sourceType: 'Internal',
      sourceVersion: businessContext.sourceUpdatedAt,
      observedAt: businessContext.reviewedAt,
      subjectIds: [workloadId],
      fact: [
        `業務影響=${businessContext.businessImpact}`,
        `外部事業者利用=${businessContext.vendorUse}`,
        `追加費用=${businessContext.additionalCost}`,
        `契約確認=${businessContext.contractReview}`,
      ].join('。'),
      officialUrl: null,
    })
  }
  const deterministicNoReview = canSkipAssessmentReview({
    outcome: impactOutcome,
    scopeComplete: complete,
  })
  let decision = unavailableDecision()
  const modelInvocations: ModelInvocation[] = []
  let workItems: WorkItem[] = []
  const endpoint = process.env.DECISION_ENDPOINT,
    deployment = process.env.DECISION_DEPLOYMENT
  if (
    !shouldInvokeDecisionModel({
      candidateResourceCount: resources.length,
      deterministicNoReview,
      reevaluation: Boolean(reevaluation),
    })
  ) {
    modelInvocations.push(
      emitModelInvocation({
        stage: 'Decision',
        assessmentId,
        deployment,
        modelVersion: process.env.DECISION_MODEL_VERSION ?? null,
        promptVersion: PROMPT_VERSION,
        status: 'NotRequired',
        durationMs: null,
        failureCategory: null,
        httpStatus: null,
      }),
    )
  } else if (!endpoint || !deployment) {
    modelInvocations.push(
      emitModelInvocation({
        stage: 'Decision',
        assessmentId,
        deployment,
        modelVersion: process.env.DECISION_MODEL_VERSION ?? null,
        promptVersion: PROMPT_VERSION,
        status: 'NotConfigured',
        durationMs: null,
        failureCategory: null,
        httpStatus: null,
      }),
    )
    missing = [...missing, 'Decision-1が未設定のため手動判断']
  } else {
    const startedAt = Date.now()
    let requestStarted = false
    try {
      await store.reserveModelCall(limit)
      requestStarted = true
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
      modelInvocations.push(
        emitModelInvocation({
          stage: 'Decision',
          assessmentId,
          deployment,
          modelVersion: output.decision.modelVersion,
          promptVersion: output.decision.promptVersion,
          status: 'Succeeded',
          durationMs: Date.now() - startedAt,
          failureCategory: null,
          httpStatus: null,
        }),
      )
    } catch (error) {
      const failure = modelFailure(error)
      modelInvocations.push(
        emitModelInvocation({
          stage: 'Decision',
          assessmentId,
          deployment,
          modelVersion: process.env.DECISION_MODEL_VERSION ?? null,
          promptVersion: PROMPT_VERSION,
          status: requestStarted ? 'Failed' : 'NotStarted',
          durationMs: Date.now() - startedAt,
          failureCategory: failure.category,
          httpStatus: failure.httpStatus,
        }),
      )
      missing = [...missing, 'Decision-1の判断を完了できないため手動判断']
    }
  }
  let explanation = emptyExplanation(event, resources)
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
  const explanationEndpoint = process.env.EXPLANATION_ENDPOINT,
    explanationDeployment = process.env.EXPLANATION_DEPLOYMENT,
    explanationModelVersion = process.env.EXPLANATION_MODEL_VERSION ?? null
  if (
    !shouldInvokeExplanationModel({
      candidateResourceCount: resources.length,
      deterministicNoReview,
      reevaluation: Boolean(reevaluation),
      decisionStatus: decision.status,
    })
  ) {
    modelInvocations.push(
      emitModelInvocation({
        stage: 'Explanation',
        assessmentId,
        deployment: explanationDeployment,
        modelVersion: explanationModelVersion,
        promptVersion: null,
        status: 'NotRequired',
        durationMs: null,
        failureCategory: null,
        httpStatus: null,
      }),
    )
  } else if (!explanationEndpoint || !explanationDeployment) {
    modelInvocations.push(
      emitModelInvocation({
        stage: 'Explanation',
        assessmentId,
        deployment: explanationDeployment,
        modelVersion: explanationModelVersion,
        promptVersion: null,
        status: 'NotConfigured',
        durationMs: null,
        failureCategory: null,
        httpStatus: null,
      }),
    )
  } else {
    const startedAt = Date.now()
    let requestStarted = false
    try {
      await store.reserveModelCall(limit)
      requestStarted = true
      const grounding = groundedInput(enriched, resources, workloadId, decision)
      const output = await explain(
        explanationEndpoint,
        explanationDeployment,
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
      explanation = {
        ...output.result.explanation,
        impact: [
          ...output.result.explanation.impact.filter(
            (claim) => claim.kind !== 'General Impact',
          ),
          ...generalImpactNarratives(event, resources),
        ],
      }
      modelInvocations.push(
        emitModelInvocation({
          stage: 'Explanation',
          assessmentId,
          deployment: explanationDeployment,
          modelVersion: explanationModelVersion,
          promptVersion: PROMPT_VERSION,
          status: 'Succeeded',
          durationMs: Date.now() - startedAt,
          failureCategory: null,
          httpStatus: null,
        }),
      )
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
    } catch (error) {
      const failure = modelFailure(error)
      modelInvocations.push(
        emitModelInvocation({
          stage: 'Explanation',
          assessmentId,
          deployment: explanationDeployment,
          modelVersion: explanationModelVersion,
          promptVersion: PROMPT_VERSION,
          status: requestStarted ? 'Failed' : 'NotStarted',
          durationMs: Date.now() - startedAt,
          failureCategory: failure.category,
          httpStatus: failure.httpStatus,
        }),
      )
      explanation = emptyExplanation(event, resources)
    }
  }
  if (!deterministicNoReview && !workItems.length)
    workItems = resourceVerificationWorkItems({
      eventId: event.id,
      workloadId,
      priority: rules.priority,
      eventEvidence: event.evidence,
      resources,
    })
  if (!deterministicNoReview && !workItems.length)
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
        evidenceIds: event.evidence
          .filter((item) =>
            item.subjectIds.every(
              (subjectId) =>
                subjectId === event.id ||
                subjectId === workloadId ||
                resources.some((resource) => resource.id === subjectId),
            ),
          )
          .map((item) => item.id),
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
  let routingErrors: string[] = []
  if (policyParsed.success && !deterministicNoReview) {
    const businessTasks = generateBusinessWorkflowTasks({
      policy: policyParsed.data,
      event,
      workloadId,
      resources,
      priority: rules.priority,
      existingWorkItems: workItems,
      asOf,
    })
    workItems = [...workItems, ...businessTasks.workItems]
    enriched.evidence.push(...businessTasks.evidence)
  }
  if (policyParsed.success && !deterministicNoReview) {
    const routing = applyWorkflowPolicy(workItems, resources, policyParsed.data)
    workItems = routing.workItems
    routingErrors = routing.errors
    missing = [...missing, ...routing.reviewReasons, ...routing.errors]
  } else if (!policyParsed.success) {
    missing = [
      ...missing,
      'ワークフローポリシー設定がSchema検証に失敗。担当・順序・承認経路の確認が必要',
    ]
  }
  const assessment: Assessment = assessmentSchema.parse({
    id: assessmentId,
    sourceInputHash: id,
    ...(reevaluation ? { reevaluation } : {}),
    workflowPolicyVersion: policyParsed.success
      ? policyParsed.data.version
      : 'Invalid',
    workflowPolicyHash: policyHash,
    impactNarrativeVersion: IMPACT_NARRATIVE_VERSION,
    eventVersionId: event.versionId,
    workloadId,
    createdAt: new Date().toISOString(),
    asOf,
    event: enriched,
    resources,
    scopeComplete: complete,
    modelInvocations,
    impactDiscoveryOutcome: impactOutcome,
    discoveryScope,
    humanReviewRequired:
      Boolean(reevaluation) ||
      !deterministicNoReview ||
      !policyParsed.success ||
      routingErrors.length > 0,
    criticalWorkload: false,
    missingInformation: missing,
    decision,
    effectivePriority: deterministicNoReview ? null : rules.priority,
    reviewReasons: deterministicNoReview
      ? reevaluation
        ? ['テスト用再評価結果のため、人間による確認が必要']
        : []
      : [...rules.reviewReasons, ...routingErrors],
    explanation,
    workItems,
    validationErrors: [],
    packageHash: '',
  })
  assessment.validationErrors = validateAssessment(assessment)
  assessment.packageHash = packageHash(assessment)
  const finalAssessment = previousAssessment
    ? carryForwardHumanContext(assessment, previousAssessment)
    : assessment
  await store.commitAssessment(finalAssessment, prior)
  return finalAssessment.id
}

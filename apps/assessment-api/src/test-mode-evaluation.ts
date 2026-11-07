import type { Assessment, Decision, ModelInvocation } from '@arp/contracts'
import { assessmentSchema } from '@arp/contracts'
import {
  applyRules,
  hash,
  normalizeNotice,
  packageHash,
  validateAssessment,
} from '@arp/domain'
import { fixture } from '../../../tests/fixtures.ts'

export const TEST_MODE_EVALUATION_TRACKING_ID = 'ARP-TEST-MODE-EVALUATION-001'
export const TEST_MODE_EVALUATION_WORKLOAD_ID = 'test-mode-evaluation-workload'
export const TEST_MODE_EVALUATION_SUBSCRIPTION_ID =
  '00000000-0000-4000-8000-000000000001'
export function isTestModeEvaluationTrackingId(trackingId: string): boolean {
  return [TEST_MODE_EVALUATION_TRACKING_ID, 'ARP-SYNTHETIC-UAT-001'].includes(
    trackingId,
  )
}
export function testModeEvaluationEnabled(): boolean {
  return (
    process.env.TEST_MODE_EVALUATION_ENABLED === 'true' ||
    process.env.SYNTHETIC_UAT_ENABLED === 'true'
  )
}
export const TEST_MODE_EVALUATION_RESOURCE_ID = [
  `/subscriptions/${TEST_MODE_EVALUATION_SUBSCRIPTION_ID}`,
  '/resourceGroups/test-mode-evaluation/providers/' +
    'Microsoft.Network/loadBalancers/test-mode-evaluation',
].join('')

export function createTestModeEvaluationAssessment(): Assessment {
  const assessment = fixture()
  const event = normalizeNotice({
    tenantId: TEST_MODE_EVALUATION_SUBSCRIPTION_ID,
    trackingId: TEST_MODE_EVALUATION_TRACKING_ID,
    title: '[テストモード評価] Azure Basic Load Balancerの廃止通知例',
    body: 'これはGitHub連携の接続確認専用に生成した合成データです。Microsoft公式通知ではなく、実環境・実リソース・実期限を示しません。',
    updatedAt: new Date().toISOString(),
  })
  event.evidence = event.evidence.map((evidence) => ({
    ...evidence,
    sourceType: 'Internal',
    fact: 'テストモード評価データ。公式情報・実環境の事実として使用しない。',
    officialUrl: null,
  }))

  assessment.id = hash({ testModeEvaluation: TEST_MODE_EVALUATION_TRACKING_ID })
  assessment.sourceInputHash = assessment.id
  assessment.event = event
  assessment.eventVersionId = event.versionId
  assessment.workloadId = TEST_MODE_EVALUATION_WORKLOAD_ID
  assessment.createdAt = new Date().toISOString()
  assessment.asOf = new Date().toISOString().slice(0, 10)
  assessment.resources = [
    {
      ...assessment.resources[0]!,
      id: TEST_MODE_EVALUATION_RESOURCE_ID,
      workloadId: TEST_MODE_EVALUATION_WORKLOAD_ID,
      classification: 'Probable',
      classificationReason: 'ProfileConditionMatched',
      evidenceIds: event.evidence.map((item) => item.id),
      properties: {},
    },
  ]
  assessment.workItems = [
    {
      ...assessment.workItems[0]!,
      id: hash({
        testModeEvaluationWorkItem: TEST_MODE_EVALUATION_TRACKING_ID,
      }),
      title: '[TEST MODE EVALUATION] Decision-1評価とGitHub Project登録を確認',
      description:
        'テストモード評価です。GitHub APIへの接続、Issue作成、Project追加だけを確認します。' +
        'Azureリソースの変更や移行は行いません。',
      workloadId: TEST_MODE_EVALUATION_WORKLOAD_ID,
      resourceIds: [TEST_MODE_EVALUATION_RESOURCE_ID],
      evidenceIds: event.evidence.map((item) => item.id),
      officialReferenceIds: [],
      confidence: {
        kind: 'EvidenceSupport',
        value: 1,
        method: '固定されたテストモード評価 fixture',
        limitations: ['業務影響・Microsoft公式情報・実環境を表さない'],
      },
    },
  ]
  assessment.humanReviewRequired = true
  assessment.reviewReasons = [
    'テストモード評価のため人間がIssue作成を明示承認する',
  ]
  assessment.missingInformation = []
  assessment.validationErrors = []
  assessment.packageHash = packageHash(assessment)
  return assessmentSchema.parse(assessment)
}

export function applyTestModeEvaluationDecision(
  source: Assessment,
  decision: Decision,
  invocations: ModelInvocation[],
  assessmentId: string,
  asOf: string,
): Assessment {
  if (!isTestModeEvaluationAssessment(source))
    throw new Error('Only the test-mode evaluation assessment can be evaluated')

  const missingInformation = [
    ...new Set([
      ...source.missingInformation,
      'テストモード評価データであり、Microsoft公式通知・実期限・実環境の事実ではありません',
    ]),
  ]
  const rules = applyRules({
    decision,
    asOf,
    applicableDeadline: null,
    remainingCalendarDays: null,
    criticalWorkload: false,
    scopeComplete: true,
    missingInformation,
    unresolvedImpact: true,
    alternativeApproved: false,
  })
  const priority = rules.priority ?? source.workItems[0]!.priority
  const item = source.workItems[0]!
  const revised: Assessment = {
    ...source,
    id: assessmentId,
    sourceInputHash: hash({
      testModeEvaluation: source.event.trackingId,
      assessmentId,
      decisionModel: decision.model,
      modelVersion: decision.modelVersion,
      promptVersion: decision.promptVersion,
    }),
    createdAt: new Date().toISOString(),
    asOf,
    decision,
    modelInvocations: invocations,
    impactDiscoveryOutcome: 'CandidatesFound',
    discoveryScope: {
      subscriptionIds: [TEST_MODE_EVALUATION_SUBSCRIPTION_ID],
      resourceTypes: [
        ...new Set(source.resources.map((resource) => resource.type)),
      ],
      profileIds: ['test-mode-evaluation-profile-v1'],
      profileRegistryVersion: 'test-mode-evaluation-v1',
      resourceCount: source.resources.length,
      scopeComplete: true,
    },
    humanReviewRequired: true,
    missingInformation,
    effectivePriority: priority,
    reviewReasons: [
      ...new Set([...source.reviewReasons, ...rules.reviewReasons]),
    ],
    workItems: [
      {
        ...item,
        id: hash({ testModeEvaluationWorkItem: assessmentId }),
        title:
          '[TEST MODE EVALUATION] Decision-1評価とGitHub Project登録を確認',
        description: [
          'テストモードの架空通知とリソースを使った評価です。Decision-1の構造化評価を実行し、レビュー承認後にGitHub IssueとProjectへ登録します。Azureリソースの変更や移行は行いません。結果は実環境やMicrosoft公式通知の事実を示しません。',
          '',
          `Decision-1 status: ${decision.status} (model ${decision.model}, version ${decision.modelVersion})`,
          `未対応時の影響: ${decision.impactIfUnaddressed ?? '未確定'}`,
          `対応中・対応後の影響: ${decision.impactDuringAndAfterChange ?? '未確定'}`,
          `優先度: ${decision.priority ?? '未確定'} (ルール適用後 ${priority})`,
          `対応開始時期: ${decision.startWindow ?? '未確定'}`,
          `移行難易度: ${decision.complexity ?? '未確定'}`,
          `プロジェクト化: ${decision.projectRequired === null ? '未確定' : decision.projectRequired ? '必要' : '不要'}`,
          '',
          '上記は合成入力に対するモデル判断であり、人間確認を経ていない提案です。',
        ].join('\n'),
        priority,
        evidenceIds: source.event.evidence.map((evidence) => evidence.id),
        confidence: {
          kind: 'EvidenceSupport',
          value: null,
          method: 'Decision-1を含むテストモード評価経路',
          limitations: [
            'テストモード評価であり、Microsoft公式通知・実環境・実期限を表さない',
            '判断結果と作業登録はテストモード内でのみ使用する',
          ],
        },
      },
    ],
    validationErrors: [],
    packageHash: '',
  }
  revised.validationErrors = validateAssessment(revised)
  revised.packageHash = packageHash(revised)
  return assessmentSchema.parse(revised)
}

export function isTestModeEvaluationAssessment(
  assessment: Assessment,
): boolean {
  const isCurrentTestModeRecord =
    assessment.event.trackingId === TEST_MODE_EVALUATION_TRACKING_ID &&
    assessment.event.title.startsWith('[テストモード評価]') &&
    assessment.event.evidence.length === 1 &&
    assessment.event.evidence.every(
      (evidence) =>
        evidence.sourceType === 'Internal' &&
        evidence.officialUrl === null &&
        evidence.fact.includes('テストモード評価データ'),
    ) &&
    assessment.workloadId === TEST_MODE_EVALUATION_WORKLOAD_ID &&
    assessment.resources.length === 1 &&
    assessment.resources[0]?.id === TEST_MODE_EVALUATION_RESOURCE_ID &&
    assessment.workItems.length === 1 &&
    assessment.workItems[0]?.title.startsWith('[TEST MODE EVALUATION]') === true
  // Accept records written by the former synthetic UAT identity.
  const legacyTrackingId = 'ARP-SYNTHETIC-UAT-001'
  const legacyWorkloadId = 'synthetic-uat-workload'
  const legacyResourceId = [
    `/subscriptions/${TEST_MODE_EVALUATION_SUBSCRIPTION_ID}`,
    '/resourceGroups/synthetic-uat/providers/' +
      'Microsoft.Network/loadBalancers/arp-demo-only',
  ].join('')
  const legacyWorkItemTitle = '[SYNTHETIC UAT]'
  const isLegacyTestModeRecord =
    assessment.event.trackingId === legacyTrackingId &&
    assessment.event.title.startsWith('[合成UAT]') &&
    assessment.event.evidence.length === 1 &&
    assessment.event.evidence.every(
      (evidence) =>
        evidence.sourceType === 'Internal' &&
        evidence.officialUrl === null &&
        evidence.fact.includes('合成UATデータ'),
    ) &&
    assessment.workloadId === legacyWorkloadId &&
    assessment.resources.length === 1 &&
    assessment.resources[0]?.id === legacyResourceId &&
    assessment.workItems.length === 1 &&
    assessment.workItems[0]?.title.startsWith(legacyWorkItemTitle) === true
  return isCurrentTestModeRecord || isLegacyTestModeRecord
}

/**
 * Existing test-mode export rows created before parent/phase issue tracking
 * was added can still be reconciled. Skip export only after all three managed
 * issue links have been persisted.
 */
export function hasCompleteTestModeIssueHierarchy(
  row: Record<string, unknown>,
): boolean {
  const isGitHubIssueUrl = (value: unknown): value is string => {
    if (typeof value !== 'string') return false
    try {
      const url = new URL(value)
      return (
        url.protocol === 'https:' &&
        url.hostname === 'github.com' &&
        /^\/[^/]+\/[^/]+\/issues\/\d+$/.test(url.pathname)
      )
    } catch {
      return false
    }
  }

  return (
    row.state === 'Exported' &&
    isGitHubIssueUrl(row.issueUrl) &&
    isGitHubIssueUrl(row.parentIssueUrl) &&
    isGitHubIssueUrl(row.phaseIssueUrl)
  )
}

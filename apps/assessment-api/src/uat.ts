import type { Assessment } from '@arp/contracts'
import { assessmentSchema } from '@arp/contracts'
import { hash, normalizeNotice, packageHash } from '@arp/domain'
import { fixture } from '../../../tests/fixtures.ts'

export const SYNTHETIC_UAT_TRACKING_ID = 'ARP-SYNTHETIC-UAT-001'
export const SYNTHETIC_UAT_WORKLOAD_ID = 'synthetic-uat-workload'
export const SYNTHETIC_UAT_SUBSCRIPTION_ID =
  '00000000-0000-4000-8000-000000000001'
export const SYNTHETIC_UAT_RESOURCE_ID = [
  `/subscriptions/${SYNTHETIC_UAT_SUBSCRIPTION_ID}`,
  '/resourceGroups/synthetic-uat/providers/' +
    'Microsoft.Network/loadBalancers/arp-demo-only',
].join('')

export function createSyntheticUatAssessment(): Assessment {
  const assessment = fixture()
  const event = normalizeNotice({
    tenantId: SYNTHETIC_UAT_SUBSCRIPTION_ID,
    trackingId: SYNTHETIC_UAT_TRACKING_ID,
    title: '[合成UAT] Azure Basic Load Balancerの廃止通知例',
    body: 'これはGitHub連携の接続確認専用に生成した合成データです。Microsoft公式通知ではなく、実環境・実リソース・実期限を示しません。',
    updatedAt: new Date().toISOString(),
  })
  event.evidence = event.evidence.map((evidence) => ({
    ...evidence,
    sourceType: 'Internal',
    fact: '合成UATデータ。公式情報・実環境の事実として使用しない。',
    officialUrl: null,
  }))

  assessment.id = hash({ syntheticUat: SYNTHETIC_UAT_TRACKING_ID })
  assessment.sourceInputHash = assessment.id
  assessment.event = event
  assessment.eventVersionId = event.versionId
  assessment.workloadId = SYNTHETIC_UAT_WORKLOAD_ID
  assessment.createdAt = new Date().toISOString()
  assessment.asOf = new Date().toISOString().slice(0, 10)
  assessment.resources = [
    {
      ...assessment.resources[0]!,
      id: SYNTHETIC_UAT_RESOURCE_ID,
      workloadId: SYNTHETIC_UAT_WORKLOAD_ID,
      classification: 'Probable',
      classificationReason: 'ProfileConditionMatched',
      evidenceIds: event.evidence.map((item) => item.id),
      properties: {},
    },
  ]
  assessment.workItems = [
    {
      ...assessment.workItems[0]!,
      id: hash({ syntheticUatWorkItem: SYNTHETIC_UAT_TRACKING_ID }),
      title: '[SYNTHETIC UAT] GitHub Issue連携を確認',
      description:
        '合成UATです。GitHub APIへの接続、Issue作成、Project追加だけを確認します。' +
        'Azureリソースの変更や移行は行いません。',
      workloadId: SYNTHETIC_UAT_WORKLOAD_ID,
      resourceIds: [SYNTHETIC_UAT_RESOURCE_ID],
      evidenceIds: event.evidence.map((item) => item.id),
      officialReferenceIds: [],
      confidence: {
        kind: 'EvidenceSupport',
        value: 1,
        method: '固定された合成UAT fixture',
        limitations: ['業務影響・Microsoft公式情報・実環境を表さない'],
      },
    },
  ]
  assessment.humanReviewRequired = true
  assessment.reviewReasons = ['合成UATのため人間がIssue作成を明示承認する']
  assessment.missingInformation = []
  assessment.validationErrors = []
  assessment.packageHash = packageHash(assessment)
  return assessmentSchema.parse(assessment)
}

export function isSyntheticUatAssessment(assessment: Assessment): boolean {
  return (
    assessment.event.trackingId === SYNTHETIC_UAT_TRACKING_ID &&
    assessment.event.title.startsWith('[合成UAT]') &&
    assessment.event.evidence.length === 1 &&
    assessment.event.evidence.every(
      (evidence) =>
        evidence.sourceType === 'Internal' &&
        evidence.officialUrl === null &&
        evidence.fact.includes('合成UATデータ'),
    ) &&
    assessment.workloadId === SYNTHETIC_UAT_WORKLOAD_ID &&
    assessment.resources.length === 1 &&
    assessment.resources[0]?.id === SYNTHETIC_UAT_RESOURCE_ID &&
    assessment.workItems.length === 1 &&
    assessment.workItems[0]?.title.startsWith('[SYNTHETIC UAT]') === true
  )
}

/**
 * Exported UAT rows created before parent/phase issue tracking was added can
 * still be reconciled. Only skip the export pipeline when all three managed
 * issue links have been persisted.
 */
export function hasCompleteSyntheticUatIssueHierarchy(
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

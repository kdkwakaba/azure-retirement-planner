import type { Assessment, WorkItem } from '@arp/contracts'
import { hash, normalizeNotice, packageHash } from '@arp/domain'
import { unavailableDecision } from '@arp/adapters'

export const tenant = '00000000-0000-4000-8000-000000000001'
export const resourceId = `/subscriptions/${tenant}/resourceGroups/synthetic-test/providers/Microsoft.Network/loadBalancers/test`
export function fixture(): Assessment {
  const event = normalizeNotice({
    tenantId: tenant,
    trackingId: 'TEST-001',
    title: 'SYNTHETIC Basic Load Balancer retirement',
    body: 'Synthetic test only. No real environment.',
    updatedAt: '2026-08-01T00:00:00.000Z',
  })
  const item: WorkItem = {
    id: hash('work'),
    category: 'Impact Verification',
    title: 'Synthetic verification',
    description: 'Test only',
    workloadId: 'synthetic-workload',
    resourceIds: [resourceId],
    ownerTeam: null,
    necessity: 'Recommended',
    priority: 'P2',
    plannedStartDate: null,
    dueDate: null,
    applicableMilestoneIds: [],
    prerequisites: [],
    completionCriteria: ['Confirm evidence'],
    humanApprovalRequired: true,
    evidenceIds: [event.evidence[0]!.id],
    sourceType: 'Internal',
    officialReferenceIds: [],
    dependencyIds: [],
    status: 'Draft',
    confidence: {
      kind: 'EvidenceSupport',
      value: null,
      method: 'Synthetic',
      limitations: ['Not a live test'],
    },
  }
  const result: Assessment = {
    id: hash('assessment'),
    eventVersionId: event.versionId,
    workloadId: 'synthetic-workload',
    createdAt: '2026-08-01T00:00:00.000Z',
    asOf: '2026-08-01',
    event,
    resources: [
      {
        id: resourceId,
        workloadId: 'synthetic-workload',
        type: 'Microsoft.Network/loadBalancers',
        sku: 'Basic',
        region: 'test',
        environment: 'Development',
        ownerTeam: null,
        classification: 'Probable',
        classificationReason: 'ProfileConditionMatched',
        missingAttributes: [],
        verificationRequired: false,
        evidenceIds: [event.evidence[0]!.id],
        properties: {},
      },
    ],
    scopeComplete: true,
    criticalWorkload: false,
    missingInformation: [],
    decision: unavailableDecision(),
    effectivePriority: 'P2',
    reviewReasons: ['PoC human review'],
    explanation: {
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
    },
    workItems: [item],
    validationErrors: [],
    packageHash: '',
  }
  result.packageHash = packageHash(result)
  return result
}

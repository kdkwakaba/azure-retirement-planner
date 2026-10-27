import test from 'node:test'
import assert from 'node:assert/strict'
import type { EvaluationCase } from '@arp/domain'
import { evaluateCases } from '@arp/domain'

const firstCase: EvaluationCase = {
  caseId: 'synthetic-lb-critical',
  knownResourceIds: ['lb-1', 'lb-2', 'lb-extra'],
  expected: {
    impactedResourceIds: ['lb-1', 'lb-2'],
    impactIfUnaddressed: 'Critical',
    impactDuringChange: 'High',
    priority: 'P2',
    ownerTeam: 'Network',
    requiredWorkItemKeys: ['assessment', 'migration'],
    retirementNotice: true,
  },
  observed: {
    candidateResourceIds: ['lb-1', 'lb-extra'],
    verificationConfirmedResourceIds: ['lb-1'],
    impactIfUnaddressed: 'High',
    impactDuringChange: 'High',
    priority: 'P3',
    ownerTeam: null,
    workItemKeys: ['assessment', 'extra'],
    generatedResourceIds: ['lb-1', 'fabricated-generated'],
    validationAcceptedResourceIds: ['lb-1', 'fabricated-accepted'],
    factualClaimCount: 4,
    unsupportedFactualClaimCount: 1,
    humanOverrideCount: 2,
    humanJudgementCount: 5,
    retirementDetected: false,
  },
}

test('evaluation metrics report micro counts, weighted agreement and safety failures', () => {
  const report = evaluateCases([firstCase])
  assert.equal(report.caseCount, 1)
  assert.deepEqual(report.resourceDiscovery.precision, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  })
  assert.deepEqual(report.resourceDiscovery.recall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  })
  assert.deepEqual(report.resourceDiscovery.verificationConfirmedRecall, {
    numerator: 1,
    denominator: 2,
    value: 0.5,
  })
  assert.equal(report.impactIfUnaddressed.exactAgreement.value, 0)
  assert.ok(
    Math.abs(report.impactIfUnaddressed.weightedAgreement.value! - 2 / 3) <
      1e-12,
  )
  assert.equal(report.impactIfUnaddressed.underestimationCount, 1)
  assert.equal(report.impactDuringChange.exactAgreement.value, 1)
  assert.equal(report.priority.exactAgreement.value, 0)
  assert.ok(Math.abs(report.priority.weightedAgreement.value! - 2 / 3) < 1e-12)
  assert.equal(report.priority.underestimationCount, 1)
  assert.deepEqual(report.ownerTeam, {
    exactAgreement: { numerator: 0, denominator: 1, value: 0 },
    eligibleCases: 1,
    abstainedCases: 1,
  })
  assert.equal(report.fabricatedResources.generated.value, 0.5)
  assert.equal(report.fabricatedResources.validationPassed.value, 0.5)
  assert.equal(report.unsupportedFactualClaims.value, 0.25)
  assert.equal(report.requiredWorkItems.precision.value, 0.5)
  assert.equal(report.requiredWorkItems.recall.value, 0.5)
  assert.equal(report.humanOverrides.value, 0.4)
  assert.deepEqual(report.retirementDetection, {
    misses: 1,
    expectedNotices: 1,
    missRate: 1,
  })
})

test('empty metric denominators remain null and do not imply success', () => {
  const empty = evaluateCases([])
  assert.equal(empty.resourceDiscovery.precision.value, null)
  assert.equal(empty.resourceDiscovery.recall.value, null)
  assert.equal(empty.ownerTeam.exactAgreement.value, null)
  assert.equal(empty.unsupportedFactualClaims.value, null)
  assert.equal(empty.retirementDetection.missRate, null)
})

test('cases with no impact or owner truth do not create false denominators', () => {
  const report = evaluateCases([
    {
      ...firstCase,
      caseId: 'synthetic-no-impact',
      expected: {
        ...firstCase.expected,
        impactedResourceIds: [],
        impactIfUnaddressed: null,
        impactDuringChange: null,
        priority: null,
        ownerTeam: null,
        requiredWorkItemKeys: [],
        retirementNotice: false,
      },
      observed: {
        ...firstCase.observed,
        candidateResourceIds: [],
        verificationConfirmedResourceIds: [],
        impactIfUnaddressed: null,
        impactDuringChange: null,
        priority: null,
        ownerTeam: null,
        workItemKeys: [],
        generatedResourceIds: [],
        validationAcceptedResourceIds: [],
        factualClaimCount: 0,
        unsupportedFactualClaimCount: 0,
        humanOverrideCount: 0,
        humanJudgementCount: 0,
        retirementDetected: false,
      },
    },
  ])
  assert.equal(report.resourceDiscovery.precision.value, null)
  assert.equal(report.resourceDiscovery.recall.value, null)
  assert.equal(report.impactIfUnaddressed.exactAgreement.value, null)
  assert.equal(report.priority.exactAgreement.value, null)
  assert.equal(report.ownerTeam.eligibleCases, 0)
  assert.equal(report.ownerTeam.abstainedCases, 0)
  assert.equal(report.retirementDetection.expectedNotices, 0)
})

test('duplicate IDs and inconsistent evaluation counts are rejected', () => {
  assert.throws(() => evaluateCases([firstCase, firstCase]), /unique/)
  assert.throws(
    () =>
      evaluateCases([
        {
          ...firstCase,
          observed: { ...firstCase.observed, unsupportedFactualClaimCount: 5 },
        },
      ]),
    /inconsistent counts/,
  )
  assert.throws(
    () =>
      evaluateCases([
        {
          ...firstCase,
          observed: {
            ...firstCase.observed,
            verificationConfirmedResourceIds: ['foreign-resource'],
          },
        },
      ]),
    /inconsistent resources/,
  )
})

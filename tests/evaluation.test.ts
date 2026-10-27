import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  EvaluationCase,
  EvaluationManifest,
  EvaluationObservation,
} from '@arp/domain'
import { evaluateCases, evaluateManifest } from '@arp/domain'

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

function manifestObservation(
  observationId: string,
  scenarioId: string,
  split: 'Development' | 'Calibration' | 'Holdout',
  retirementFamilyKey = `family-${observationId}`,
  repetition = 1,
): EvaluationObservation {
  const digest = 'a'.repeat(64)
  return {
    observationId,
    scenarioId,
    retirementFamilyKey,
    split,
    repetition,
    source: {
      kind: 'Synthetic',
      referenceIds: [],
      capturedAt: '2026-10-27T10:00:00Z',
      asOf: '2026-10-27',
      contentHash: digest,
    },
    versions: {
      decisionModel: null,
      decisionDeploymentVersion: null,
      explanationModel: null,
      explanationDeploymentVersion: null,
      promptVersion: null,
      ruleVersion: 'rule-1',
      contractVersion: '1',
    },
    run: {
      runId: `run-${observationId}`,
      inputHash: digest,
      outputHash: digest,
      startedAt: '2026-10-27T10:01:00Z',
      durationMs: 100,
    },
    adjudication: {
      status: 'Unreviewed',
      reviewerCount: 0,
      adjudicatedAt: null,
    },
  }
}

test('manifest scoring binds every observation and reports splits independently', () => {
  const manifest: EvaluationManifest = {
    schemaVersion: '1',
    benchmarkVersion: 'benchmark-1',
    cases: [
      manifestObservation('obs-dev', 'scenario-dev', 'Development'),
      manifestObservation('obs-holdout', 'scenario-holdout', 'Holdout'),
    ],
  }
  const report = evaluateManifest(manifest, [
    { observationId: 'obs-holdout', result: firstCase },
    {
      observationId: 'obs-dev',
      result: { ...firstCase, caseId: 'development-case' },
    },
  ])

  assert.equal(report.benchmarkVersion, 'benchmark-1')
  assert.equal(report.observationCount, 2)
  assert.equal(report.independentScenarioCount, 2)
  assert.deepEqual(report.splits.Development?.observationIds, ['obs-dev'])
  assert.deepEqual(report.splits.Holdout?.observationIds, ['obs-holdout'])
  assert.equal(report.splits.Development?.metrics.caseCount, 1)
  assert.equal(report.splits.Calibration, null)
})

test('manifest scoring rejects missing, duplicate and unrecognized observations', () => {
  const manifest: EvaluationManifest = {
    schemaVersion: '1',
    benchmarkVersion: 'benchmark-1',
    cases: [manifestObservation('obs-1', 'scenario-1', 'Holdout')],
  }
  const score = { observationId: 'obs-1', result: firstCase }

  assert.throws(() => evaluateManifest(manifest, []), /cover every/)
  assert.throws(
    () => evaluateManifest(manifest, [score, score]),
    /duplicate observationId/,
  )
  assert.throws(
    () =>
      evaluateManifest(manifest, [
        { observationId: 'obs-unknown', result: firstCase },
      ]),
    /unknown observationId/,
  )
})

test('manifest reporting distinguishes repeated observations from independent scenarios', () => {
  const manifest: EvaluationManifest = {
    schemaVersion: '1',
    benchmarkVersion: 'benchmark-1',
    cases: [
      manifestObservation('obs-1', 'scenario-a', 'Holdout', 'family-a', 1),
      manifestObservation('obs-2', 'scenario-a', 'Holdout', 'family-a', 2),
      manifestObservation('obs-3', 'scenario-a', 'Holdout', 'family-a', 3),
      manifestObservation('obs-4', 'scenario-b', 'Holdout', 'family-b', 1),
    ],
  }
  const report = evaluateManifest(
    manifest,
    manifest.cases.map((observation, index) => ({
      observationId: observation.observationId,
      result: { ...firstCase, caseId: `run-${index + 1}` },
    })),
  )

  assert.equal(report.observationCount, 4)
  assert.equal(report.independentScenarioCount, 2)
  assert.equal(report.splits.Holdout?.observationCount, 4)
  assert.equal(report.splits.Holdout?.independentScenarioCount, 2)
  assert.equal(report.splits.Holdout?.metrics.caseCount, 4)
})

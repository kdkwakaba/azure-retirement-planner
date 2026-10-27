import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEvaluationManifest } from '@arp/domain'

const digest = 'a'.repeat(64)
function observation(overrides: Record<string, unknown> = {}) {
  return {
    observationId: 'obs-01',
    scenarioId: 'TST-01',
    retirementFamilyKey: 'family-hash-01',
    split: 'Holdout',
    repetition: 1,
    source: {
      kind: 'OfficialSnapshot',
      referenceIds: ['https://learn.microsoft.com/example'],
      capturedAt: '2026-10-27T10:00:00Z',
      asOf: '2026-10-27',
      contentHash: digest,
    },
    versions: {
      decisionModel: 'Microsoft-Decision-1',
      decisionDeploymentVersion: '1',
      explanationModel: null,
      explanationDeploymentVersion: null,
      promptVersion: null,
      ruleVersion: '2026-10-27.1',
      contractVersion: '1',
    },
    run: {
      runId: 'run-01',
      inputHash: digest,
      outputHash: digest,
      startedAt: '2026-10-27T10:01:00Z',
      durationMs: 750,
    },
    adjudication: {
      status: 'IndependentlyReviewed',
      reviewerCount: 2,
      adjudicatedAt: '2026-10-28T10:00:00Z',
    },
    ...overrides,
  }
}

test('evaluation manifest records source, as-of, versions, run and adjudication provenance', () => {
  const validated = validateEvaluationManifest({
    schemaVersion: '1',
    benchmarkVersion: '2026-10-v1',
    cases: [observation()],
  })
  assert.equal(validated.cases[0]!.source.asOf, '2026-10-27')
  assert.equal(
    validated.cases[0]!.versions.decisionModel,
    'Microsoft-Decision-1',
  )
  assert.equal(validated.cases[0]!.adjudication.reviewerCount, 2)
  assert.equal(validated.cases[0]!.run.durationMs, 750)
})

test('synthetic data may omit official references and model versions', () => {
  const item = observation({
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
      ruleVersion: '2026-10-27.1',
      contractVersion: '1',
    },
    adjudication: {
      status: 'Unreviewed',
      reviewerCount: 0,
      adjudicatedAt: null,
    },
  })
  const result = validateEvaluationManifest({
    schemaVersion: '1',
    benchmarkVersion: 'synthetic-v1',
    cases: [item],
  })
  assert.equal(result.cases[0]!.source.kind, 'Synthetic')
  assert.equal(result.cases[0]!.versions.decisionModel, null)
})

test('manifest prevents family leakage across splits while allowing repeated observations within one split', () => {
  const second = observation({
    observationId: 'obs-02',
    scenarioId: 'TST-01',
    repetition: 2,
    run: {
      runId: 'run-02',
      inputHash: digest,
      outputHash: digest,
      startedAt: '2026-10-27T10:02:00Z',
      durationMs: 800,
    },
  })
  assert.equal(
    validateEvaluationManifest({
      schemaVersion: '1',
      benchmarkVersion: 'holdout-v1',
      cases: [observation(), second],
    }).cases.length,
    2,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'holdout-v1',
        cases: [
          observation(),
          {
            ...second,
            run: { ...second.run, inputHash: 'b'.repeat(64) },
          },
        ],
      }),
    /inconsistent inputHash/,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'holdout-v1',
        cases: [observation(), { ...second, split: 'Development' }],
      }),
    /spans evaluation splits/,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'holdout-v1',
        cases: [
          observation(),
          {
            ...second,
            observationId: 'obs-03',
            run: { ...second.run, runId: 'run-03' },
            repetition: 1,
          },
        ],
      }),
    /duplicate scenario repetition/,
  )
})

test('colon-containing family and scenario IDs do not collide in repetition identity', () => {
  const first = observation({
    retirementFamilyKey: 'family:alpha',
    scenarioId: 'case',
  })
  const second = observation({
    observationId: 'obs-02',
    retirementFamilyKey: 'family',
    scenarioId: 'alpha:case',
    run: { ...observation().run, runId: 'run-02' },
  })
  assert.equal(
    validateEvaluationManifest({
      schemaVersion: '1',
      benchmarkVersion: 'v1',
      cases: [first, second],
    }).cases.length,
    2,
  )
})

test('invalid provenance, review state and undeclared payload fields are rejected', () => {
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'v1',
        cases: [
          observation({
            source: {
              kind: 'Synthetic',
              referenceIds: [],
              capturedAt: '2026-02-30T10:00:00Z',
              asOf: '2026-02-27',
              contentHash: digest,
            },
          }),
        ],
      }),
    /ISO-8601 timestamp required/,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'v1',
        cases: [
          observation({
            source: {
              kind: 'LiveReconstruction',
              referenceIds: [],
              capturedAt: '2026-10-27T10:00:00Z',
              asOf: '2026-10-27',
              contentHash: digest,
            },
          }),
        ],
      }),
    /referenceIds: required/,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'v1',
        cases: [
          observation({
            adjudication: {
              status: 'Unreviewed',
              reviewerCount: 1,
              adjudicatedAt: null,
            },
          }),
        ],
      }),
    /inconsistent review state/,
  )
  assert.throws(
    () =>
      validateEvaluationManifest({
        schemaVersion: '1',
        benchmarkVersion: 'v1',
        cases: [observation({ rawPayload: 'must not be stored' })],
      }),
    /unexpected or missing properties/,
  )
})

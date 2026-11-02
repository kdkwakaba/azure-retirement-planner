import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decisionRevision,
  isTestReevaluation,
  shouldInvokeDecisionModel,
  shouldInvokeExplanationModel,
  testReevaluationError,
} from '../apps/assessment-api/src/service.ts'

test('Decision configuration changes produce a new assessment revision', (t) => {
  const keys = [
    'DECISION_ENDPOINT',
    'DECISION_DEPLOYMENT',
    'DECISION_MODEL_VERSION',
  ] as const
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  )
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })
  for (const key of keys) delete process.env[key]
  assert.equal(decisionRevision(200), null)
  process.env.DECISION_ENDPOINT = 'https://foundry.example.test'
  process.env.DECISION_DEPLOYMENT = 'decision-test'
  process.env.DECISION_MODEL_VERSION = '1'
  const first = decisionRevision(200)
  assert.ok(first)
  assert.equal(decisionRevision(0), null)
  process.env.DECISION_MODEL_VERSION = '2'
  assert.notEqual(decisionRevision(200), first)
})

test('empty resource candidate sets never invoke Decision-1', () => {
  assert.equal(
    shouldInvokeDecisionModel({
      candidateResourceCount: 0,
      deterministicNoReview: false,
      reevaluation: false,
    }),
    false,
  )
  assert.equal(
    shouldInvokeDecisionModel({
      candidateResourceCount: 0,
      deterministicNoReview: false,
      reevaluation: true,
    }),
    false,
  )
  assert.equal(
    shouldInvokeDecisionModel({
      candidateResourceCount: 1,
      deterministicNoReview: false,
      reevaluation: false,
    }),
    true,
  )
  assert.equal(
    shouldInvokeDecisionModel({
      candidateResourceCount: 1,
      deterministicNoReview: true,
      reevaluation: true,
    }),
    true,
  )
})

test('explanation runs for a test reevaluation even when normal review is skipped', () => {
  assert.equal(
    shouldInvokeExplanationModel({
      candidateResourceCount: 1,
      deterministicNoReview: true,
      reevaluation: true,
      decisionStatus: 'Proposed',
    }),
    true,
  )
  assert.equal(
    shouldInvokeExplanationModel({
      candidateResourceCount: 1,
      deterministicNoReview: true,
      reevaluation: false,
      decisionStatus: 'Proposed',
    }),
    false,
  )
  assert.equal(
    shouldInvokeExplanationModel({
      candidateResourceCount: 0,
      deterministicNoReview: false,
      reevaluation: true,
      decisionStatus: 'Proposed',
    }),
    false,
  )
  assert.equal(
    shouldInvokeExplanationModel({
      candidateResourceCount: 1,
      deterministicNoReview: false,
      reevaluation: true,
      decisionStatus: 'Unavailable',
    }),
    false,
  )
})

test('test reevaluation completes only when both model stages succeed', () => {
  const invocation = (
    stage: 'Decision' | 'Explanation',
    status: 'Succeeded' | 'Failed',
    failureCategory: 'DailyLimit' | null = null,
  ) => ({
    stage,
    provider: 'Microsoft Foundry' as const,
    deployment: stage === 'Decision' ? 'decision' : 'explanation',
    modelVersion: '1',
    promptVersion: 'test',
    status,
    correlationId: stage,
    durationMs: 10,
    failureCategory,
    httpStatus: null,
  })
  assert.equal(
    testReevaluationError([
      invocation('Decision', 'Succeeded'),
      invocation('Explanation', 'Succeeded'),
    ]),
    null,
  )
  assert.equal(
    testReevaluationError([
      invocation('Decision', 'Succeeded'),
      invocation('Explanation', 'Failed', 'DailyLimit'),
    ]),
    'DailyLimit',
  )
  assert.equal(
    testReevaluationError([invocation('Decision', 'Succeeded')]),
    'ModelUnavailable',
  )
  assert.equal(
    testReevaluationError([
      invocation('Decision', 'Succeeded'),
      invocation('Explanation', 'Failed'),
    ]),
    'ModelUnavailable',
  )
})

test('test reevaluation assessments are distinguished for read-only guards', () => {
  assert.equal(isTestReevaluation({}), false)
  assert.equal(
    isTestReevaluation({
      reevaluation: {
        runId: '7f10227d-b4c1-4334-8579-70946eb500b9',
        sourceAssessmentId: 'source',
        requestedBy: 'operator',
        requestedAt: '2026-11-03T00:00:00.000Z',
        reason: 'test explanation generation',
      },
    }),
    true,
  )
})

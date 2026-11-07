import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTestModeEvaluationAssessment,
  applyTestModeEvaluationDecision,
  hasCompleteTestModeIssueHierarchy,
  isTestModeEvaluationAssessment,
  TEST_MODE_EVALUATION_RESOURCE_ID,
  TEST_MODE_EVALUATION_TRACKING_ID,
} from '../apps/assessment-api/src/test-mode-evaluation.ts'
import { fixture } from './fixtures.ts'
import { parseDecision, questions } from '../packages/adapters/src/models.ts'
import { hash } from '../packages/domain/src/index.ts'

test('test-mode evaluation fixture is isolated from real Azure resources and official facts', () => {
  const assessment = createTestModeEvaluationAssessment()
  assert.equal(isTestModeEvaluationAssessment(assessment), true)
  assert.equal(assessment.event.trackingId, TEST_MODE_EVALUATION_TRACKING_ID)
  assert.deepEqual(
    assessment.resources.map((resource) => resource.id),
    [TEST_MODE_EVALUATION_RESOURCE_ID],
  )
  assert.ok(
    assessment.event.evidence.every(
      (evidence) => evidence.sourceType === 'Internal',
    ),
  )
  assert.ok(
    assessment.event.evidence.every(
      (evidence) => evidence.officialUrl === null,
    ),
  )
  assert.equal(assessment.workItems.length, 1)
  assert.match(assessment.workItems[0]!.title, /^\[TEST MODE EVALUATION\]/)
})

test('live assessment fixtures cannot pass the test-mode evaluation export guard', () => {
  const assessment = fixture()
  assert.equal(isTestModeEvaluationAssessment(assessment), false)
})

test('test-mode evaluation preserves synthetic grounding and records a Decision-1 result', () => {
  const source = createTestModeEvaluationAssessment()
  const answers = Object.fromEntries(
    Object.entries(questions).map(([key, question]) => {
      if (question.type === 'noul') return [key, { type: 'noul', noul: 0.95 }]
      if (question.type === 'score')
        return [
          key,
          {
            type: 'score',
            score: 3,
            probabilities: { '0': 0, '1': 0, '2': 0, '3': 1 },
          },
        ]
      const options = Object.keys(question.criteria)
      return [
        key,
        {
          type: 'choice',
          choice: options[0],
          probabilities: Object.fromEntries(
            options.map((option) => [option, 1 / options.length]),
          ),
        },
      ]
    }),
  )
  const decision = parseDecision(
    { model: 'Microsoft-Decision-1', answers },
    '1',
  )
  const invocations = [
    {
      stage: 'Decision' as const,
      provider: 'Microsoft Foundry' as const,
      deployment: 'arp-decision-1',
      modelVersion: '1',
      promptVersion: '2026-10-24.1',
      status: 'Succeeded' as const,
      correlationId: hash('synthetic-uat-decision'),
      durationMs: 123,
      failureCategory: null,
      httpStatus: null,
    },
    {
      stage: 'Explanation' as const,
      provider: 'Microsoft Foundry' as const,
      deployment: 'not-configured',
      modelVersion: null,
      promptVersion: null,
      status: 'NotRequired' as const,
      correlationId: hash('synthetic-uat-explanation'),
      durationMs: null,
      failureCategory: null,
      httpStatus: null,
    },
  ]

  const assessed = applyTestModeEvaluationDecision(
    source,
    decision,
    invocations,
    hash('synthetic-uat-assessed'),
    '2026-11-01',
  )

  assert.notEqual(assessed.id, source.id)
  assert.equal(assessed.decision.status, 'Proposed')
  assert.equal(assessed.modelInvocations?.[0]?.status, 'Succeeded')
  assert.equal(assessed.humanReviewRequired, true)
  assert.equal(isTestModeEvaluationAssessment(assessed), true)
  assert.ok(
    assessed.missingInformation.some((value) =>
      value.includes('テストモード評価'),
    ),
  )
  assert.match(assessed.workItems[0]!.title, /Decision-1/)
  assert.ok(assessed.validationErrors.length === 0)
  assert.ok(
    assessed.event.evidence.every(
      (evidence) =>
        evidence.sourceType === 'Internal' && evidence.officialUrl === null,
    ),
  )
})

test('legacy test evaluation export rows are reconciled until all issue hierarchy links exist', () => {
  const childOnly = {
    state: 'Exported',
    issueUrl: 'https://github.com/example/repo/issues/10',
  }
  assert.equal(hasCompleteTestModeIssueHierarchy(childOnly), false)
  assert.equal(
    hasCompleteTestModeIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
    }),
    false,
  )
  assert.equal(
    hasCompleteTestModeIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    true,
  )
  assert.equal(
    hasCompleteTestModeIssueHierarchy({
      state: 'Processing',
      issueUrl: 'https://github.com/example/repo/issues/10',
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    false,
  )
  assert.equal(
    hasCompleteTestModeIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com.attacker.example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    false,
  )
})

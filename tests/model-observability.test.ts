import test from 'node:test'
import assert from 'node:assert/strict'
import { explanationSchema } from '@arp/contracts'
import { ensureExplanationCoverage } from '../apps/assessment-api/src/service.ts'

const explanationFields = [
  'impact',
  'increasingFactors',
  'reducingFactors',
  'startRationale',
  'missingInformation',
  'changeConditions',
  'microsoftFacts',
  'internalFacts',
  'judgments',
  'humanChecks',
] as const

test('empty model explanation receives evidence-safe required fallback claims', () => {
  const empty = explanationSchema.parse(
    Object.fromEntries(explanationFields.map((key) => [key, []])),
  )
  const claim = {
    id: 'unknown-impact',
    text: '根拠不足のため確認が必要',
    kind: 'Unknown' as const,
    evidenceIds: [],
    decisionRefs: [],
  }
  const fallback = explanationSchema.parse({
    ...empty,
    impact: [claim],
    missingInformation: [{ ...claim, id: 'missing' }],
    microsoftFacts: [
      {
        ...claim,
        id: 'official',
        text: '公式通知を取得済み',
        kind: 'Confirmed Fact',
        evidenceIds: ['evidence-1'],
      },
    ],
    humanChecks: [{ ...claim, id: 'human-check' }],
  })

  const completed = ensureExplanationCoverage(empty, fallback, true, true, true)
  assert.equal(completed.usedFallback, true)
  assert.equal(completed.explanation.impact.length, 1)
  assert.equal(completed.explanation.missingInformation.length, 1)
  assert.equal(completed.explanation.microsoftFacts.length, 1)
  assert.equal(completed.explanation.humanChecks.length, 1)
  assert.equal(completed.explanation.judgments.length, 0)
})

test('model explanation with required grounded claims is kept unchanged', () => {
  const claim = {
    id: 'impact',
    text: '判断材料が提示されている',
    kind: 'Derived Fact' as const,
    evidenceIds: ['evidence-1'],
    decisionRefs: [],
  }
  const generated = explanationSchema.parse({
    ...Object.fromEntries(explanationFields.map((key) => [key, []])),
    impact: [claim],
    missingInformation: [{ ...claim, id: 'missing' }],
    microsoftFacts: [{ ...claim, id: 'official' }],
    humanChecks: [{ ...claim, id: 'human-check' }],
  })
  const completed = ensureExplanationCoverage(
    generated,
    generated,
    true,
    true,
    true,
  )
  assert.equal(completed.usedFallback, false)
  assert.deepEqual(completed.explanation, generated)
})

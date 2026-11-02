import test from 'node:test'
import assert from 'node:assert/strict'
import { explanationSchema } from '@arp/contracts'
import { emptyExplanation } from '../apps/assessment-api/src/service.ts'
import { fixture } from './fixtures.ts'

test('unavailable explanation generation does not produce template claims', () => {
  const assessment = fixture()
  const explanation = emptyExplanation(assessment.event, assessment.resources)

  assert.deepEqual(explanationSchema.parse(explanation), explanation)
  assert.deepEqual(explanation.increasingFactors, [])
  assert.deepEqual(explanation.reducingFactors, [])
  assert.deepEqual(explanation.startRationale, [])
  assert.deepEqual(explanation.missingInformation, [])
  assert.deepEqual(explanation.changeConditions, [])
  assert.deepEqual(explanation.microsoftFacts, [])
  assert.deepEqual(explanation.internalFacts, [])
  assert.deepEqual(explanation.judgments, [])
  assert.deepEqual(explanation.humanChecks, [])
  assert.ok(
    explanation.impact.every(
      (claim) =>
        claim.kind === 'General Impact' && claim.evidenceIds.length > 0,
    ),
  )
  assert.ok(
    explanation.impact.every(
      (claim) =>
        !claim.text.includes('固定テンプレート') &&
        !claim.text.includes('Decision-1の型付き判断'),
    ),
  )
})

test('model explanation schema accepts generated fields without fallback completion', () => {
  const assessment = fixture()
  const claim = {
    id: 'model-impact',
    text: 'モデルが生成した根拠付き説明',
    kind: 'Derived Fact' as const,
    evidenceIds: [assessment.event.evidence[0]!.id],
    decisionRefs: [],
  }
  const generated = {
    ...emptyExplanation(assessment.event, assessment.resources),
    increasingFactors: [claim],
  }

  assert.deepEqual(explanationSchema.parse(generated), generated)
  assert.equal(generated.increasingFactors[0]?.text, claim.text)
})

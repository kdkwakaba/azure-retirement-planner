import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSyntheticUatAssessment,
  isSyntheticUatAssessment,
  SYNTHETIC_UAT_RESOURCE_ID,
  SYNTHETIC_UAT_TRACKING_ID,
} from '../apps/assessment-api/src/uat.ts'
import { fixture } from './fixtures.ts'

test('synthetic UAT fixture is isolated from real Azure resources and official facts', () => {
  const assessment = createSyntheticUatAssessment()
  assert.equal(isSyntheticUatAssessment(assessment), true)
  assert.equal(assessment.event.trackingId, SYNTHETIC_UAT_TRACKING_ID)
  assert.deepEqual(
    assessment.resources.map((resource) => resource.id),
    [SYNTHETIC_UAT_RESOURCE_ID],
  )
  assert.ok(assessment.event.evidence.every((evidence) => evidence.sourceType === 'Internal'))
  assert.ok(assessment.event.evidence.every((evidence) => evidence.officialUrl === null))
  assert.equal(assessment.workItems.length, 1)
  assert.match(assessment.workItems[0]!.title, /^\[SYNTHETIC UAT\]/)
})

test('live assessment fixtures cannot pass the synthetic UAT export guard', () => {
  const assessment = fixture()
  assert.equal(isSyntheticUatAssessment(assessment), false)
})

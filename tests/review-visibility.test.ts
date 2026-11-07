import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures.ts'
import {
  testModeEvaluationTrackingId,
  visibleAssessments,
} from '../apps/review-web/src/visibility.ts'

test('test-mode evaluation record is hidden unless both test-mode flags are enabled', () => {
  const real = fixture()
  const synthetic = fixture()
  synthetic.event.trackingId = testModeEvaluationTrackingId
  const records = [real, synthetic]

  assert.deepEqual(visibleAssessments(records, false, false), [real])
  assert.deepEqual(visibleAssessments(records, true, false), [real])
  assert.deepEqual(visibleAssessments(records, false, true), [real])
  assert.deepEqual(visibleAssessments(records, true, true), records)
})

test('no-action assessments are hidden by default but can be reviewed from history', () => {
  const active = fixture()
  const dismissed = fixture()
  dismissed.reviewDisposition = 'NoAction'

  assert.deepEqual(visibleAssessments([active, dismissed], false, false), [
    active,
  ])
  assert.deepEqual(
    visibleAssessments([active, dismissed], false, false, true),
    [active, dismissed],
  )
})

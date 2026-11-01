import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures.ts'
import {
  syntheticUatTrackingId,
  visibleAssessments,
} from '../apps/review-web/src/visibility.ts'

test('synthetic UAT record is hidden unless both test-mode flags are enabled', () => {
  const real = fixture()
  const synthetic = fixture()
  synthetic.event.trackingId = syntheticUatTrackingId
  const records = [real, synthetic]

  assert.deepEqual(visibleAssessments(records, false, false), [real])
  assert.deepEqual(visibleAssessments(records, true, false), [real])
  assert.deepEqual(visibleAssessments(records, false, true), [real])
  assert.deepEqual(visibleAssessments(records, true, true), records)
})

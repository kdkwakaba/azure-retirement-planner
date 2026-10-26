import test from 'node:test'
import assert from 'node:assert/strict'
import type { Assessment } from '@arp/contracts'
import { summarizeAssessments } from '../apps/review-web/src/summary.ts'

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    humanReviewRequired: true,
    effectivePriority: null,
    scopeComplete: true,
    ...overrides,
  } as Assessment
}

test('assessment summary counts records and preserves conservative unknowns', () => {
  const result = summarizeAssessments([
    assessment({ humanReviewRequired: false, effectivePriority: 'P3' }),
    assessment({ effectivePriority: 'P1', scopeComplete: false }),
    assessment({ effectivePriority: 'P2', humanReviewRequired: undefined }),
  ])

  assert.deepEqual(result, {
    totalRecords: 3,
    humanReviewRequired: 2,
    highPriority: 2,
    incompleteDiscovery: 1,
  })
})

test('empty assessment summary starts at zero', () => {
  assert.deepEqual(summarizeAssessments([]), {
    totalRecords: 0,
    humanReviewRequired: 0,
    highPriority: 0,
    incompleteDiscovery: 0,
  })
})

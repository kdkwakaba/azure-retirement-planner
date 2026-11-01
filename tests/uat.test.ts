import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSyntheticUatAssessment,
  hasCompleteSyntheticUatIssueHierarchy,
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
  assert.match(assessment.workItems[0]!.title, /^\[SYNTHETIC UAT\]/)
})

test('live assessment fixtures cannot pass the synthetic UAT export guard', () => {
  const assessment = fixture()
  assert.equal(isSyntheticUatAssessment(assessment), false)
})

test('legacy exported UAT rows are reconciled until all issue hierarchy links exist', () => {
  const childOnly = {
    state: 'Exported',
    issueUrl: 'https://github.com/example/repo/issues/10',
  }
  assert.equal(hasCompleteSyntheticUatIssueHierarchy(childOnly), false)
  assert.equal(
    hasCompleteSyntheticUatIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
    }),
    false,
  )
  assert.equal(
    hasCompleteSyntheticUatIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    true,
  )
  assert.equal(
    hasCompleteSyntheticUatIssueHierarchy({
      state: 'Processing',
      issueUrl: 'https://github.com/example/repo/issues/10',
      parentIssueUrl: 'https://github.com/example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    false,
  )
  assert.equal(
    hasCompleteSyntheticUatIssueHierarchy({
      ...childOnly,
      parentIssueUrl: 'https://github.com.attacker.example/repo/issues/8',
      phaseIssueUrl: 'https://github.com/example/repo/issues/9',
    }),
    false,
  )
})

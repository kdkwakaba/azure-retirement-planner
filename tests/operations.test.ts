import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GitHubGraphQLError,
  failureFacts,
  logProcessingFailure,
  recordDependencyFailure,
  recordModelInvocation,
  RemoteError,
} from '@arp/adapters'

test('failure logs exclude exception messages', (t) => {
  let record = ''
  t.mock.method(console, 'error', (line: string) => {
    record = line
  })
  logProcessingFailure('assessment-queue', new Error('synthetic-secret'))
  assert.ok(record.includes('"event":"ProcessingFailure"'))
  assert.ok(!record.includes('synthetic-secret'))
})

test('dependency failure logs identify source and safe HTTP details only', (t) => {
  let record = ''
  t.mock.method(console, 'error', (line: string) => {
    record = line
  })
  const failure = recordDependencyFailure(
    'AdvisorRetirementRecommendations',
    new RemoteError(403),
  )
  const parsed = JSON.parse(record) as Record<string, unknown>
  assert.equal(parsed.event, 'ExternalDependencyFailure')
  assert.equal(parsed.source, 'AdvisorRetirementRecommendations')
  assert.equal(parsed.category, 'Forbidden')
  assert.equal(parsed.httpStatus, 403)
  assert.equal(parsed.correlationId, failure.correlationId)
  assert.ok(!record.includes('/subscriptions/'))
  assert.ok(!record.includes('Remote service failed'))
})

test('model invocation telemetry contains status and versions, never payloads', (t) => {
  let record = ''
  t.mock.method(console, 'info', (line: string) => {
    record = line
  })
  recordModelInvocation({
    stage: 'Explanation',
    provider: 'Microsoft Foundry',
    deployment: 'gpt-4.1-mini',
    modelVersion: null,
    promptVersion: '2026-10-24.1',
    status: 'SucceededWithFallback',
    correlationId: 'a'.repeat(64),
    durationMs: 1234,
    failureCategory: null,
    httpStatus: null,
  })
  const parsed = JSON.parse(record) as Record<string, unknown>
  assert.equal(parsed.event, 'ModelInvocation')
  assert.equal(parsed.stage, 'Explanation')
  assert.equal(parsed.status, 'SucceededWithFallback')
  assert.equal(parsed.durationMs, 1234)
  assert.equal(Object.hasOwn(parsed, 'prompt'), false)
  assert.equal(Object.hasOwn(parsed, 'input'), false)
  assert.equal(Object.hasOwn(parsed, 'output'), false)
})

test('GitHub GraphQL failure logs safe category and HTTP status only', (t) => {
  let record = ''
  t.mock.method(console, 'error', (line: string) => {
    record = line
  })
  const error = new GitHubGraphQLError('Forbidden', 'ProjectAdd')
  const details = failureFacts(error)
  assert.equal(details.category, 'Forbidden')
  assert.equal(details.httpStatus, 200)
  logProcessingFailure(
    'uat-project-add',
    error,
    '00000000-0000-4000-8000-000000000000',
  )
  const parsed = JSON.parse(record) as Record<string, unknown>
  assert.equal(parsed.category, 'Forbidden')
  assert.equal(parsed.httpStatus, 200)
  assert.equal(parsed.correlationId, '00000000-0000-4000-8000-000000000000')
  assert.ok(!record.includes('GitHub GraphQL operation failed'))
})

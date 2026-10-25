import test from 'node:test'
import assert from 'node:assert/strict'
import { discover } from '../packages/adapters/src/azure.ts'
import { credential } from '../packages/adapters/src/azure.ts'
import { syncFeedback } from '../apps/review-web/src/api.ts'
import { tenant } from './fixtures.ts'

test('Service Health uses ARG-converted ticks and retains ISO timestamps', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 60000,
  }))
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body)).query as string
      if (query.startsWith('servicehealthresources')) {
        assert.match(
          query,
          /lastUpdateTime=tostring\(todatetime\(tolong\(properties.LastUpdateTime\)\)\)/,
        )
        return Response.json({
          data: [
            {
              id: 'synthetic-event-1',
              lastUpdateTime: '2026-08-01T00:00:00Z',
              properties: {
                EventType: 'HealthAdvisory',
                EventSubType: 'Retirement',
                TrackingId: 'SYN-001',
                Title: 'Synthetic retirement',
                Summary: 'Synthetic notice',
                LastUpdateTime: 639211392000000000,
              },
            },
            {
              id: 'synthetic-event-2',
              lastUpdateTime: '',
              properties: {
                EventType: 'HealthAdvisory',
                TrackingId: 'SYN-002',
                Title: 'Synthetic deprecation',
                Summary: 'Synthetic notice',
                LastUpdateTime: '2026-08-02T00:00:00Z',
              },
            },
            {
              id: 'synthetic-event-3',
              lastUpdateTime: '',
              properties: { TrackingId: 'SYN-003', LastUpdateTime: 'invalid' },
            },
          ],
          resultTruncated: 'false',
        })
      }
      return Response.json({ data: [], resultTruncated: 'false' })
    },
  )
  const result = await discover([tenant], tenant)
  assert.equal(result.events.length, 2)
  assert.equal(result.scopeComplete, false)
  assert.equal(result.failures.length, 1)
  assert.equal(result.events[0]?.sourceUpdatedAt, '2026-08-01T00:00:00.000Z')
  assert.equal(result.events[1]?.sourceUpdatedAt, '2026-08-02T00:00:00.000Z')
})

test('zero events with incomplete discovery is visibly a partial failure', () => {
  const feedback = syncFeedback({
    events: 0,
    resources: 2,
    scopeComplete: false,
    failures: ['Synthetic date failure'],
  })
  assert.match(feedback.notice, /通知0件、構成2件/)
  assert.match(feedback.error, /取得が不完全/)
  assert.match(feedback.error, /Synthetic date failure/)
})

test('complete zero-event discovery has no failure warning', () => {
  assert.equal(
    syncFeedback({ events: 0, resources: 2, scopeComplete: true, failures: [] })
      .error,
    '',
  )
})

test('incomplete discovery without details still produces a warning', () => {
  assert.match(
    syncFeedback({
      events: 0,
      resources: 0,
      scopeComplete: false,
      failures: [],
    }).error,
    /取得が不完全/,
  )
})

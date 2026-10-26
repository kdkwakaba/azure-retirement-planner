import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AzureStore,
  GitHubClient,
  argRows,
  decide,
  explicitResourceIds,
  issueText,
} from '@arp/adapters'
import { credential } from '../packages/adapters/src/azure.ts'
import { fixture, tenant, resourceId } from './fixtures.ts'
import { hash } from '@arp/domain'
import type { Approval } from '@arp/contracts'

test('explicit impacted-resource discovery uses exact tracking IDs and active Advisor recommendations', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  const queries: string[] = []
  const subscriptionScopedId = `/subscriptions/${tenant}/providers/Microsoft.Authorization/policyAssignments/synthetic`
  let calls = 0
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      queries.push(body.query)
      if (calls++ === 0)
        return Response.json({
          data: [
            { resourceId: resourceId.toUpperCase() },
            { resourceId: 'untrusted-value' },
          ],
          resultTruncated: false,
        })
      return Response.json({
        data: [
          { resourceId: resourceId.toUpperCase() },
          { resourceId: subscriptionScopedId },
          { resourceId: '/subscriptions/not-a-uuid/resource' },
        ],
        resultTruncated: false,
      })
    },
  )
  const result = await explicitResourceIds(fixture().event, [tenant])
  assert.deepEqual(
    [...result.resourceIds],
    [resourceId.toLowerCase(), subscriptionScopedId.toLowerCase()],
  )
  assert.equal(result.complete, true)
  assert.deepEqual(result.failures, [])
  assert.ok(queries[0]?.includes("tostring(trackingId) == 'TEST-001'"))
  assert.ok(!queries[0]?.includes('id contains'))
  assert.ok(queries[1]?.includes("recommendationStatus) in ('New'"))
  assert.ok(queries[1]?.includes("'InProgress', 'Postponed'"))
  assert.ok(queries[1]?.includes('distinct recommendationTypeId, resourceId'))
})
test('Advisor failure preserves Service Health impacts and marks discovery incomplete', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    if (calls++ === 0)
      return Response.json({
        data: [{ resourceId }],
        resultTruncated: false,
      })
    return Response.json(
      { error: { code: 'SyntheticForbidden' } },
      { status: 403 },
    )
  })
  const result = await explicitResourceIds(fixture().event, [tenant])
  assert.deepEqual([...result.resourceIds], [resourceId.toLowerCase()])
  assert.equal(result.complete, false)
  assert.deepEqual(result.failures, ['Advisor明示対象の取得に失敗'])
})
test('Advisor impacts are retained when Service Health discovery fails', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    if (calls++ === 0)
      return Response.json(
        { error: { code: 'SyntheticForbidden' } },
        { status: 403 },
      )
    return Response.json({
      data: [{ resourceId }],
      resultTruncated: false,
    })
  })
  const result = await explicitResourceIds(fixture().event, [tenant])
  assert.deepEqual([...result.resourceIds], [resourceId.toLowerCase()])
  assert.equal(result.complete, false)
  assert.deepEqual(result.failures, ['Service Health明示対象の取得に失敗'])
})

test('ARG follows the REST $skipToken and preserves all pages', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  let calls = 0
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).hostname, 'management.azure.com')
      const body = JSON.parse(String(init?.body))
      if (calls++ === 0)
        return Response.json({
          data: [{ id: 'first' }],
          resultTruncated: 'true',
          $skipToken: 'synthetic-next',
        })
      assert.equal(body.options.$skipToken, 'synthetic-next')
      return Response.json({
        data: [{ id: 'second' }],
        resultTruncated: 'false',
      })
    },
  )
  assert.deepEqual(await argRows([tenant], 'resources | project id'), [
    { id: 'first' },
    { id: 'second' },
  ])
})
test('ARG truncation without a token fails closed', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: [], resultTruncated: 'true' }),
  )
  await assert.rejects(argRows([tenant], 'resources | project id'), /truncated/)
})
test('a rejected Decision response is recorded before parsing and never fabricated', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  const raw = { model: 'synthetic', answers: {} }
  let recorded: unknown
  t.mock.method(globalThis, 'fetch', async () => Response.json(raw))
  await assert.rejects(
    decide(
      'https://synthetic.services.ai.azure.com',
      'Microsoft-Decision-1',
      'synthetic-version',
      {},
      async (value) => {
        recorded = value
      },
    ),
  )
  assert.deepEqual(recorded, raw)
})
test('GitHub registration uses safe text and persists Issue separately from Project', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  const item = fixture().workItems[0]!
  item.description = 'synthetic-private-description'
  const text = issueText(item)
  assert.ok(!text.includes(resourceId))
  assert.ok(!text.includes(item.description))
  const posts: string[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      assert.equal(url.hostname, 'api.github.com')
      if (init?.method === 'GET') return Response.json([])
      posts.push(url.pathname)
      if (url.pathname.endsWith('/issues'))
        return Response.json({
          node_id: 'synthetic-issue',
          html_url:
            'https://github.com/synthetic-owner/synthetic-repo/issues/1',
        })
      return Response.json({ errors: [{ message: 'synthetic-project-error' }] })
    },
  )
  assert.equal(await client.find(item.id), null)
  const issue = await client.create(item)
  assert.equal(issue.id, 'synthetic-issue')
  await assert.rejects(client.addToProject('synthetic-project', issue.id))
  assert.deepEqual(posts, [
    '/repos/synthetic-owner/synthetic-repo/issues',
    '/graphql',
  ])
})
test('approval and stable per-item outbox are one conditional transaction', async (t) => {
  const store = new AzureStore('syntheticaccount')
  const a = fixture()
  const approval: Approval = {
    id: hash('approval'),
    assessmentId: a.id,
    packageHash: a.packageHash,
    approvedItemIds: [a.workItems[0]!.id],
    reviewerId: 'synthetic-user',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    reason: 'Synthetic',
    result: 'Approved',
  }
  t.mock.method(store, 'head', async () => ({
    partitionKey: 'assessment:synthetic',
    rowKey: 'head',
    assessmentId: a.id,
    packageHash: a.packageHash,
    entityKind: 'head',
    etag: 'synthetic-etag',
  }))
  t.mock.method(store, 'put', async () => {})
  const submit = t.mock.method(
    store.table,
    'submitTransaction',
    async (actions: unknown) => {
      const text = JSON.stringify(actions)
      assert.ok(text.includes('synthetic-etag'))
      assert.ok(text.includes('outbox:' + a.workItems[0]!.id))
      assert.ok(!text.includes('outbox:' + approval.id + ':'))
      return { status: 202, subResponses: [] }
    },
  )
  await store.approve(a, approval)
  assert.equal(submit.mock.callCount(), 1)
})

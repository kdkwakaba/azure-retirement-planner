import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AzureStore,
  ensureIssueForExport,
  GitHubClient,
  argRows,
  decide,
  explicitResourceIds,
  issueText,
  logProcessingFailure,
  withProcessingFailureLog,
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
test('TST-22: Project retry reuses the persisted Issue instead of creating another', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  const item = fixture().workItems[0]!
  let issueCreates = 0,
    projectAdds = 0,
    state = 'Pending',
    issueId: string | null = null
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method !== 'POST') return Response.json([])
      if (url.pathname.endsWith('/issues')) {
        issueCreates++
        return Response.json({
          node_id: 'synthetic-issue',
          html_url:
            'https://github.com/synthetic-owner/synthetic-repo/issues/1',
        })
      }
      projectAdds++
      if (projectAdds === 1)
        return Response.json({
          errors: [{ message: 'synthetic-project-error' }],
        })
      return Response.json({
        data: {
          addProjectV2ItemById: { item: { id: 'synthetic-project-item' } },
        },
      })
    },
  )
  const persistIssue = async (id: string) => {
    state = 'IssueCreated'
    issueId = id
  }
  const resolvedId = await ensureIssueForExport(
    client,
    item,
    state,
    issueId,
    async () => {
      state = 'Sending'
    },
    persistIssue,
  )
  await assert.rejects(client.addToProject('synthetic-project', resolvedId))
  assert.equal(state, 'IssueCreated')
  assert.equal(issueId, 'synthetic-issue')
  const retryIssueId = await ensureIssueForExport(
    client,
    item,
    state,
    issueId,
    async () => assert.fail('A saved Issue must not be created again'),
    persistIssue,
  )
  assert.equal(
    await client.addToProject('synthetic-project', retryIssueId),
    'synthetic-project-item',
  )
  assert.equal(issueCreates, 1)
  assert.equal(projectAdds, 2)
})
test('TST-23: ambiguous Issue creation is reconciled by marker or remains unresolved', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  const item = fixture().workItems[0]!
  let createAttempted = false
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        createAttempted = true
        throw new Error('Unexpected create during reconciliation')
      }
      assert.ok(String(input).includes('state=all&per_page=100&page=1'))
      return Response.json([
        {
          node_id: 'synthetic-reconciled-issue',
          body: `<!-- arp:${item.id} -->`,
          html_url:
            'https://github.com/synthetic-owner/synthetic-repo/issues/1',
        },
      ])
    },
  )
  let persisted: string | null = null
  const recovered = await ensureIssueForExport(
    client,
    item,
    'Sending',
    null,
    async () => assert.fail('An ambiguous POST must never be repeated'),
    async (id) => {
      persisted = id
    },
  )
  assert.equal(recovered, 'synthetic-reconciled-issue')
  assert.equal(persisted, 'synthetic-reconciled-issue')
  assert.equal(createAttempted, false)
})
test('ambiguous Issue creation is not repeated when reconciliation finds no marker', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  let createAttempted = false
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') createAttempted = true
      return Response.json([])
    },
  )
  await assert.rejects(
    ensureIssueForExport(
      client,
      fixture().workItems[0]!,
      'Sending',
      null,
      async () => assert.fail('An unresolved POST must not be repeated'),
      async () => assert.fail('No Issue ID should be persisted'),
    ),
  )
  assert.equal(createAttempted, false)
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


test('processing failure logs carry correlation and stage without exception details', async (t) => {
  const records: string[] = []
  t.mock.method(console, 'error', (record: string) => records.push(record))
  const failure = new Error('synthetic-secret-resource-id')
  failure.name = 'StorageError'
  const correlationId = logProcessingFailure(
    'assessment-queue',
    failure,
    '00000000-0000-4000-8000-000000000001',
  )
  assert.equal(correlationId, '00000000-0000-4000-8000-000000000001')
  assert.deepEqual(JSON.parse(records[0]!), {
    event: 'ProcessingFailure',
    stage: 'assessment-queue',
    correlationId,
    errorType: 'StorageError',
  })
  assert.ok(!records[0]!.includes('synthetic-secret-resource-id'))

  await assert.rejects(
    withProcessingFailureLog('daily-sync', async () => {
      throw new Error('synthetic-payload')
    }),
    /synthetic-payload/,
  )
  assert.equal(JSON.parse(records[1]!).stage, 'daily-sync')
  assert.ok(!records[1]!.includes('synthetic-payload'))
})

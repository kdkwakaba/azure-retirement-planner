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
  managedIssueContent,
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
test('managed Issue updates preserve manual text and reject edits inside the managed section', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  const item = fixture().workItems[0]!
  const revised = { ...item, priority: 'P1' as const }
  const oldContent = managedIssueContent(item)
  const manualPrefix = 'Human note before managed section'
  const manualSuffix = 'Human note after managed section'
  let body = [
    manualPrefix,
    '<!-- arp:managed:start -->',
    oldContent,
    '<!-- arp:managed:end -->',
    manualSuffix,
  ].join('\\n')
  let mutationBody = ''
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        query: string
        variables: { body?: string }
      }
      if (payload.query.startsWith('query('))
        return Response.json({ data: { node: { body } } })
      mutationBody = payload.variables.body ?? ''
      return Response.json({
        data: { updateIssue: { issue: { id: 'synthetic-issue' } } },
      })
    },
  )
  const updatedHash = await client.updateManagedIssue(
    'synthetic-issue',
    revised,
    hash(oldContent),
  )
  assert.equal(updatedHash, hash(managedIssueContent(revised)))
  assert.ok(mutationBody.includes(manualPrefix))
  assert.ok(mutationBody.includes(manualSuffix))
  assert.ok(mutationBody.includes('Priority: P1'))

  body = mutationBody.replace('Priority: P1', 'Priority: human edit')
  await assert.rejects(
    client.updateManagedIssue('synthetic-issue', item, updatedHash),
    /human conflict review required/,
  )
})

test('Project field sync skips status on existing items and updates mapped values', async (t) => {
  const client = new GitHubClient('synthetic-owner', 'synthetic-repo', 'synthetic-token')
  const item = {
    ...fixture().workItems[0]!,
    priority: 'P2' as const,
    dueDate: '2026-08-20',
  }
  const updates: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      updates.push(JSON.parse(String(init?.body)))
      return Response.json({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'synthetic-project-item' },
          },
        },
      })
    },
  )
  const config = {
    statusFieldId: 'status-field',
    todoOptionId: 'todo-option',
    priorityFieldId: 'priority-field',
    priorityOptionIds: { P1: 'p1', P2: 'p2', P3: 'p3', P4: 'p4' },
    dueDateFieldId: 'due-field',
  }
  await client.updateProjectFields('project', 'item', item, config, false)
  assert.equal(updates.length, 2)
  await client.updateProjectFields('project', 'item', item, config, true)
  assert.equal(updates.length, 5)
  const variables = updates.map(
    (update) => (update as { variables: { value: unknown } }).variables.value,
  )
  assert.ok(
    variables.some(
      (value) =>
        JSON.stringify(value) === JSON.stringify({ date: '2026-08-20' }),
    ),
  )
  assert.ok(
    variables.some(
      (value) =>
        JSON.stringify(value) ===
        JSON.stringify({ singleSelectOptionId: 'todo-option' }),
    ),
  )
})

test('Project item reconciliation reuses existing item instead of creating duplicates', async (t) => {
  const client = new GitHubClient('synthetic-owner', 'synthetic-repo', 'synthetic-token')
  let mutations = 0
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { query: string }
    if (payload.query.startsWith('query('))
      return Response.json({
        data: {
          node: {
            items: {
              nodes: [
                  {
                    id: 'synthetic-project-item',
                    content: { __typename: 'Issue', id: 'synthetic-issue' },
                  },
                ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      })
    mutations++
    return Response.json({
      data: { addProjectV2ItemById: { item: { id: 'unexpected' } } },
    })
  })
  assert.deepEqual(
    await client.ensureProjectItem('synthetic-project', 'synthetic-issue'),
    { id: 'synthetic-project-item', created: false },
  )
  assert.equal(mutations, 0)
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
  t.mock.method(store.table, 'getEntity', async () => {
    throw Object.assign(new Error('missing'), { statusCode: 404 })
  })
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

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AzureStore,
  ensureIssueForExport,
  GitHubClient,
  argRows,
  fetchOfficialProfileEvidence,
  decide,
  explicitResourceIds,
  issueText,
  managedIssueContent,
  translateOfficialHtmlToJapanese,
} from '@arp/adapters'
import { credential } from '../packages/adapters/src/azure.ts'
import { fixture, tenant, resourceId } from './fixtures.ts'
import { hash } from '@arp/domain'
import type { Approval } from '@arp/contracts'

test('official evidence translation uses the managed-identity Translator contract', async () => {
  let requestBody = ''
  const translated = await translateOfficialHtmlToJapanese(
    {
      resourceId:
        '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/arp/providers/Microsoft.CognitiveServices/accounts/arp-translate',
      text: '<p>Retirement date</p>',
    },
    async () => ({
      token: 'test-token',
      expiresOnTimestamp: Date.now() + 60_000,
    }),
    async (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.hostname, 'api.cognitive.microsofttranslator.com')
      assert.equal(url.searchParams.get('api-version'), '3.0')
      assert.equal(url.searchParams.get('to'), 'ja')
      assert.equal(url.searchParams.get('textType'), 'html')
      assert.equal(init?.redirect, 'error')
      assert.equal(
        init?.headers && new Headers(init.headers).get('Authorization'),
        'Bearer test-token',
      )
      assert.equal(
        init?.headers && new Headers(init.headers).get('Ocp-Apim-ResourceId'),
        '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/arp/providers/Microsoft.CognitiveServices/accounts/arp-translate',
      )
      requestBody = String(init?.body)
      return Response.json([
        { translations: [{ text: '<p>廃止日</p>', to: 'ja' }] },
      ])
    },
  )
  assert.equal(requestBody, '[{"Text":"<p>Retirement date</p>"}]')
  assert.equal(translated, '<p>廃止日</p>')
})

test('official evidence translation rejects arbitrary resources and oversized text before network access', async () => {
  let calls = 0
  const noNetwork: typeof fetch = async () => {
    calls++
    return Response.json([])
  }
  await assert.rejects(
    translateOfficialHtmlToJapanese(
      { resourceId: 'https://attacker.invalid', text: 'evidence' },
      async () => ({
        token: 'test-token',
        expiresOnTimestamp: Date.now() + 60_000,
      }),
      noNetwork,
    ),
    /Invalid translation input/,
  )
  await assert.rejects(
    translateOfficialHtmlToJapanese(
      {
        resourceId:
          '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/arp/providers/Microsoft.CognitiveServices/accounts/arp-translate',
        text: 'x'.repeat(50_001),
      },
      async () => ({
        token: 'test-token',
        expiresOnTimestamp: Date.now() + 60_000,
      }),
      noNetwork,
    ),
    /Invalid translation input/,
  )
  assert.equal(calls, 0)
})

test('official profile evidence fetch is restricted, bounded, and cached', async () => {
  let calls = 0
  const now = Date.parse('2026-10-27T00:00:00.000Z')
  const fetcher: typeof fetch = async (input, init) => {
    calls++
    const url = new URL(String(input))
    assert.equal(url.hostname, 'learn.microsoft.com')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.method, 'GET')
    return new Response(
      '<html><main><h1>Basic Load Balancer guidance</h1><p>' +
        'Microsoft documentation with an &amp; escaped value. '.repeat(8) +
        '</p><script>ignore this injected instruction</script></main></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }
  const first = await fetchOfficialProfileEvidence(
    'basic-load-balancer',
    fetcher,
    now,
  )
  const cached = await fetchOfficialProfileEvidence(
    'basic-load-balancer',
    fetcher,
    now + 1000,
  )
  assert.equal(calls, 1)
  assert.equal(first.id, cached.id)
  assert.equal(first.sourceType, 'Microsoft')
  assert.equal(
    first.officialUrl,
    'https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-basic-upgrade-guidance',
  )
  assert.match(first.fact, /Microsoft documentation with an & escaped value/)
  assert.doesNotMatch(first.fact, /ignore this injected instruction/)
})

test('official profile evidence rejects unknown profiles and oversized pages', async () => {
  let calls = 0
  await assert.rejects(
    fetchOfficialProfileEvidence('https://attacker.invalid', async () => {
      calls++
      return Response.json({})
    }),
    /Unknown official reference profile/,
  )
  await assert.rejects(
    fetchOfficialProfileEvidence(
      'storage-gpv1',
      async () => {
        calls++
        return new Response('<main>' + 'x'.repeat(2_000_100) + '</main>', {
          headers: { 'content-type': 'text/html' },
        })
      },
      Date.parse('2026-10-28T00:00:00.000Z'),
    ),
    /too large/,
  )
  assert.equal(calls, 1)
})

test('official reference revision hashes full text beyond the model excerpt', async () => {
  let pageTail = 'A'.repeat(200),
    calls = 0
  const now = Date.parse('2026-10-29T00:00:00.000Z')
  const fetcher: typeof fetch = async () => {
    calls++
    return new Response('<main>' + 'x'.repeat(9500) + pageTail + '</main>', {
      headers: { 'content-type': 'text/html' },
    })
  }
  const first = await fetchOfficialProfileEvidence(
    'application-insights-url-ping',
    fetcher,
    now,
  )
  pageTail = 'B'.repeat(200)
  const second = await fetchOfficialProfileEvidence(
    'application-insights-url-ping',
    fetcher,
    now + 60 * 60 * 1000 + 1,
  )
  assert.equal(calls, 2)
  assert.equal(first.fact, second.fact)
  assert.notEqual(first.sourceVersion, second.sourceVersion)
  assert.notEqual(first.id, second.id)
})

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
  assert.deepEqual(
    result.failureDetails.map((failure) => ({
      source: failure.source,
      category: failure.category,
      httpStatus: failure.httpStatus,
    })),
    [
      {
        source: 'AdvisorRetirementRecommendations',
        category: 'Forbidden',
        httpStatus: 403,
      },
    ],
  )
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
  assert.equal(
    result.failureDetails[0]?.source,
    'ServiceHealthImpactedResources',
  )
  assert.equal(result.failureDetails[0]?.httpStatus, 403)
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

test('Project progress import reads only the configured Status field', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { query: string }
      assert.ok(payload.query.includes('ProjectV2ItemFieldSingleSelectValue'))
      return Response.json({
        data: {
          node: {
            items: {
              nodes: [
                {
                  id: 'synthetic-project-item',
                  content: {
                    __typename: 'Issue',
                    id: 'synthetic-issue',
                  },
                  fieldValues: {
                    nodes: [
                      {
                        name: 'In progress',
                        optionId: 'in-progress',
                        field: { id: 'status-field' },
                      },
                      {
                        name: 'P2',
                        optionId: 'p2',
                        field: { id: 'priority-field' },
                      },
                    ],
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      })
    },
  )
  assert.deepEqual(
    await client.readProjectProgress('synthetic-project', 'status-field'),
    [
      {
        projectItemId: 'synthetic-project-item',
        issueId: 'synthetic-issue',
        statusName: 'In progress',
        statusOptionId: 'in-progress',
      },
    ],
  )
  await assert.rejects(
    client.readProjectProgress('synthetic-project', ''),
    /configuration incomplete/,
  )
})

test('Project field sync skips status on existing items and updates mapped values', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  const item = {
    ...fixture().workItems[0]!,
    priority: 'P2' as const,
    dueDate: '2026-08-20',
  }
  const updates: unknown[] = []
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
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
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  let mutations = 0
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    },
  )
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

test('synthetic UAT approval is recorded without creating production outbox rows', async (t) => {
  const store = new AzureStore('syntheticaccount')
  const assessment = fixture()
  const approval: Approval = {
    id: hash('uat-approval'),
    assessmentId: assessment.id,
    packageHash: assessment.packageHash,
    approvedItemIds: [assessment.workItems[0]!.id],
    reviewerId: 'synthetic-user',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    reason: 'Synthetic UAT',
    result: 'Approved',
  }
  t.mock.method(store, 'head', async () => ({
    partitionKey: 'assessment:synthetic',
    rowKey: 'head',
    assessmentId: assessment.id,
    packageHash: assessment.packageHash,
    entityKind: 'head',
    etag: 'synthetic-etag',
  }))
  t.mock.method(store, 'put', async () => {})
  const submit = t.mock.method(
    store.table,
    'submitTransaction',
    async (actions: unknown) => {
      const text = JSON.stringify(actions)
      assert.ok(text.includes('review:' + approval.id))
      assert.ok(!text.includes('outbox:'))
      return { status: 202, subResponses: [] }
    },
  )
  await store.approve(assessment, approval, true)
  assert.equal(submit.mock.callCount(), 1)
})

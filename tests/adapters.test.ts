import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AzureStore,
  EXPLANATION_MAX_COMPLETION_TOKENS,
  EXPLANATION_MAX_WORK_ITEMS,
  EXPLANATION_REASONING_EFFORT,
  ensureIssueForExport,
  GitHubClient,
  safeModelResponseDiagnostics,
  argRows,
  fetchOfficialProfileEvidence,
  decide,
  explicitResourceIds,
  explain,
  issueText,
  managedIssueContent,
  priorityIssueLabel,
  parentIssueKey,
  parentIssueText,
  parentIssueTitle,
  workItemPhase,
  translateOfficialHtmlToJapanese,
} from '@arp/adapters'
import {
  applicableProfileIds,
  candidateResourcesForEvent,
  credential,
  matchProfile,
  PROFILE_RESOURCE_TYPES,
} from '../packages/adapters/src/azure.ts'
import { fixture, tenant, resourceId } from './fixtures.ts'
import { hash } from '@arp/domain'
import { categorySchema, type Approval } from '@arp/contracts'

test('GPT-6 Luna explanation request stays within the configured token and work-item budgets', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  let requestBody: Record<string, unknown> | undefined
  const explanation = {
    impact: [],
    increasingFactors: [],
    reducingFactors: [],
    startRationale: [],
    missingInformation: [],
    changeConditions: [],
    microsoftFacts: [],
    internalFacts: [],
    judgments: [],
    humanChecks: [],
  }
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({ explanation, workItems: [] }),
            },
          },
        ],
      })
    },
  )

  const result = await explain(
    'https://synthetic.services.ai.azure.com',
    'gpt-6-luna',
    {
      event: {
        title: 'Synthetic notice',
        body: '通知本文'.repeat(500),
        evidence: [
          {
            id: 'synthetic-evidence',
            sourceType: 'Microsoft',
            sourceVersion: 'synthetic-version',
            observedAt: '2026-08-01T00:00:00.000Z',
            subjectIds: [],
            fact: '公式根拠'.repeat(500),
            officialUrl: 'https://learn.microsoft.com/en-us/azure/synthetic',
          },
        ],
      },
      resources: [],
      decision: {
        impactIfUnaddressed: 'High',
        probabilities: { impactIfUnaddressed: { High: 1 } },
      },
    },
    async () => {},
  )

  assert.equal(requestBody?.max_completion_tokens, 1500)
  assert.equal(requestBody?.reasoning_effort, 'none')
  assert.equal(EXPLANATION_MAX_COMPLETION_TOKENS, 1500)
  assert.equal(EXPLANATION_MAX_WORK_ITEMS, 5)
  assert.equal(EXPLANATION_REASONING_EFFORT, 'none')
  assert.match(
    (requestBody?.messages as Array<{ content: string }>)[0]?.content ?? '',
    /最大5件/,
  )
  const sentInput = JSON.parse(
    (requestBody?.messages as Array<{ content: string }>)[1]?.content ?? '{}',
  ) as {
    event: {
      body: string
      evidence: Array<{ fact: string; officialUrl: string }>
    }
    decision: Record<string, unknown>
  }
  assert.ok(sentInput.event.body.length < '通知本文'.repeat(500).length)
  assert.ok(
    sentInput.event.evidence[0]!.fact.length < '公式根拠'.repeat(500).length,
  )
  assert.equal(
    sentInput.event.evidence[0]!.officialUrl,
    'https://learn.microsoft.com/en-us/azure/synthetic',
  )
  assert.equal('probabilities' in sentInput.decision, false)
  assert.deepEqual(result.result.explanation, explanation)
})

test('GPT-6 Luna truncation is detected before parsing an empty completion', async (t) => {
  t.mock.method(credential, 'getToken', async () => ({
    token: 'synthetic',
    expiresOnTimestamp: Date.now() + 3600000,
  }))
  let responseRecorded = false
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: '' } }],
    }),
  )

  await assert.rejects(
    explain(
      'https://synthetic.services.ai.azure.com',
      'gpt-6-luna',
      { event: { title: 'Synthetic notice', evidence: [] }, resources: [] },
      async () => {
        responseRecorded = true
      },
    ),
    /truncated at token limit/,
  )
  assert.equal(responseRecorded, true)
})

test('model response diagnostics expose metadata but never model content', () => {
  const secretResponseText = '{"explanation":"private notice content"'
  const diagnostics = safeModelResponseDiagnostics({
    choices: [
      {
        finish_reason: 'length',
        message: { content: secretResponseText, refusal: null },
      },
    ],
    usage: {
      prompt_tokens: 2425,
      completion_tokens: 1500,
      total_tokens: 3925,
      completion_tokens_details: { reasoning_tokens: 1500 },
    },
  })

  assert.deepEqual(diagnostics, {
    responseShapeValid: true,
    choiceCount: 1,
    finishReason: 'length',
    contentType: 'string',
    contentLength: secretResponseText.length,
    refusalPresent: false,
    jsonParseStatus: 'invalid',
    jsonValueType: null,
    promptTokens: 2425,
    completionTokens: 1500,
    reasoningTokens: 1500,
    totalTokens: 3925,
  })
  assert.equal(JSON.stringify(diagnostics).includes(secretResponseText), false)
  assert.equal(
    JSON.stringify(diagnostics).includes('private notice content'),
    false,
  )
})

test('official evidence translation uses the managed-identity Translator contract', async () => {
  let requestBody = ''
  const translated = await translateOfficialHtmlToJapanese(
    {
      resourceId:
        '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/arp/providers/Microsoft.CognitiveServices/accounts/arp-translate',
      region: 'eastus',
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
      assert.equal(
        init?.headers &&
          new Headers(init.headers).get('Ocp-Apim-Subscription-Region'),
        'eastus',
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

test('Foundry retirement profile includes Foundry resource types and requires usage verification', () => {
  const event = {
    ...fixture().event,
    title: 'Foundry Agent Service classic API retirement',
  }
  assert.ok(
    PROFILE_RESOURCE_TYPES.includes('microsoft.cognitiveservices/accounts'),
  )
  assert.ok(
    PROFILE_RESOURCE_TYPES.includes(
      'microsoft.cognitiveservices/accounts/projects',
    ),
  )
  assert.deepEqual(applicableProfileIds(event), [
    'foundry-agent-service-classic',
  ])
  const resource = {
    ...fixture().resources[0]!,
    type: 'microsoft.machinelearningservices/workspaces',
    properties: { kind: 'hub' },
  }
  const assessed = matchProfile(event, resource, new Set())
  assert.equal(assessed.classification, 'Verification Required')
  assert.equal(assessed.classificationReason, 'UsageRequiresVerification')
  assert.equal(assessed.verificationRequired, true)
})

test('retirement candidates include only event-matched resource types and explicit impacts', () => {
  const base = fixture().resources[0]!
  const resources = [
    {
      ...base,
      id: `${resourceId}/lb`,
      type: 'microsoft.network/loadbalancers',
      sku: 'UnexpectedSku',
    },
    {
      ...base,
      id: `${resourceId}/storage`,
      type: 'microsoft.storage/storageaccounts',
    },
    {
      ...base,
      id: `${resourceId}/webtest`,
      type: 'microsoft.insights/webtests',
    },
    {
      ...base,
      id: `${resourceId}/foundry`,
      type: 'microsoft.cognitiveservices/accounts',
      properties: { kind: 'AIServices' },
    },
    {
      ...base,
      id: `${resourceId}/foundry-project`,
      type: 'microsoft.cognitiveservices/accounts/projects',
      properties: { kind: 'AIServices' },
    },
    {
      ...base,
      id: `${resourceId}/foundry-hub`,
      type: 'microsoft.machinelearningservices/workspaces',
      properties: { kind: 'hub' },
    },
    {
      ...base,
      id: `${resourceId}/other-account`,
      type: 'microsoft.cognitiveservices/accounts',
      properties: { kind: 'OpenAI' },
    },
  ]
  const select = (title: string, explicit = new Set<string>()) =>
    candidateResourcesForEvent(
      { ...fixture().event, title },
      resources,
      explicit,
    )
  assert.deepEqual(
    select('Azure Basic Load Balancer retirement').map(
      (resource) => resource.type,
    ),
    ['microsoft.network/loadbalancers'],
  )
  assert.deepEqual(
    select('General Purpose v1 (GPv1) retirement').map(
      (resource) => resource.type,
    ),
    ['microsoft.storage/storageaccounts'],
  )
  assert.deepEqual(
    select('URL ping test retirement').map((resource) => resource.type),
    ['microsoft.insights/webtests'],
  )
  assert.deepEqual(
    select('Foundry Agent Service classic API retirement').map(
      (resource) => resource.type,
    ),
    [
      'microsoft.cognitiveservices/accounts',
      'microsoft.cognitiveservices/accounts/projects',
      'microsoft.machinelearningservices/workspaces',
    ],
  )
  assert.deepEqual(
    select('Unmapped Azure retirement notice').map((resource) => resource.type),
    [],
  )
  assert.deepEqual(
    select(
      'Unmapped Azure retirement notice',
      new Set([`${resourceId}/storage`]),
    ).map((resource) => resource.type),
    ['microsoft.storage/storageaccounts'],
  )
})

test('official evidence translation rejects arbitrary resources and oversized text before network access', async () => {
  let calls = 0
  const noNetwork: typeof fetch = async () => {
    calls++
    return Response.json([])
  }
  await assert.rejects(
    translateOfficialHtmlToJapanese(
      {
        resourceId: 'https://attacker.invalid',
        region: 'eastus',
        text: 'evidence',
      },
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
        region: 'eastus',
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
  item.description = `Review the target ${resourceId} with engineer@example.com`
  const text = issueText(item)
  assert.ok(text.includes('カテゴリ: 影響確認'))
  assert.ok(text.includes('対象ワークロード（匿名化）:'))
  assert.ok(text.includes('カテゴリ: 影響確認'))
  assert.ok(text.includes('作業フェーズ: 影響確認'))
  assert.ok(!text.includes(resourceId))
  assert.ok(text.includes('Review the target [リソースIDはレビュー画面を参照]'))
  assert.ok(text.includes('[メールアドレス省略]'))
  assert.ok(text.includes('完了条件'))
  assert.ok(text.includes('Confirm evidence'))
  assert.ok(text.includes('作業フェーズ: 影響確認'))
  const posts: string[] = []
  const createPayloads: Array<Record<string, unknown>> = []
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      assert.equal(url.hostname, 'api.github.com')
      if (init?.method === 'GET')
        return url.pathname.includes('/labels/')
          ? Response.json({
              name: decodeURIComponent(url.pathname.split('/').at(-1)!),
            })
          : Response.json([])
      posts.push(url.pathname)
      if (url.pathname.endsWith('/issues')) {
        createPayloads.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        )
        return Response.json({
          node_id: 'synthetic-issue',
          html_url:
            'https://github.com/synthetic-owner/synthetic-repo/issues/1',
        })
      }
      return Response.json({ errors: [{ message: 'synthetic-project-error' }] })
    },
  )
  assert.equal(await client.find(item.id), null)
  const issue = await client.create(item)
  assert.equal(issue.id, 'synthetic-issue')
  assert.deepEqual(createPayloads[0]?.labels, [
    'Priority: Medium',
    'Phase: 影響確認',
  ])
  assert.match(String(createPayloads[0]?.title), /Synthetic verification/)
  await assert.rejects(client.addToProject('synthetic-project', issue.id))
  assert.deepEqual(posts, [
    '/repos/synthetic-owner/synthetic-repo/issues',
    '/graphql',
  ])
})

test('parent Issue groups a retirement and workload with safe stable identity', () => {
  const assessment = fixture()
  const key = parentIssueKey(assessment)
  assert.equal(key, parentIssueKey(fixture()))
  assert.ok(
    parentIssueTitle(assessment).includes(
      'SYNTHETIC Basic Load Balancer retirement',
    ),
  )
  assert.ok(parentIssueText(assessment).includes(`<!-- arp-parent:${key} -->`))
  assert.ok(parentIssueText(assessment).includes('匿名化'))
  assert.ok(!parentIssueText(assessment).includes(resourceId))
})

test('GitHub priority labels map P1 to High, P2/P3 to Medium, and P4 to Low', () => {
  assert.deepEqual(
    ['P1', 'P2', 'P3', 'P4'].map((priority) =>
      priorityIssueLabel(priority as 'P1' | 'P2' | 'P3' | 'P4'),
    ),
    ['Priority: High', 'Priority: Medium', 'Priority: Medium', 'Priority: Low'],
  )
  assert.equal(priorityIssueLabel(null), null)
})

test('every supported work category maps to one of the four Sub-Issue phases', () => {
  assert.deepEqual(
    categorySchema.options.map((category) => workItemPhase(category)),
    [
      '影響確認',
      '影響確認',
      '設計',
      '設計',
      '設計',
      '変更',
      '変更',
      '変更',
      '設計',
      'テスト',
      '変更',
      '変更',
      'テスト',
      'テスト',
      '変更',
      '変更',
      '変更',
      '変更',
      '影響確認',
      '影響確認',
      '設計',
      '設計',
      '設計',
      '設計',
    ],
  )
})

test('Sub-Issue linking is idempotent and preserves the GitHub hierarchy', async (t) => {
  const client = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  let linked = false
  const writes: Array<{ path: string; body: unknown }> = []
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method === 'GET')
        return Response.json(linked ? [{ id: 42 }] : [])
      writes.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
      linked = true
      return Response.json({ id: 42 })
    },
  )
  await client.ensureSubIssue(7, 42)
  await client.ensureSubIssue(7, 42)
  assert.deepEqual(writes, [
    {
      path: '/repos/synthetic-owner/synthetic-repo/issues/7/sub_issues',
      body: { sub_issue_id: 42 },
    },
  ])
})

test('parent Issue outbox persists its identity and does not create duplicates', async (t) => {
  const store = new AzureStore('syntheticstore')
  const rows = new Map<string, Record<string, unknown>>()
  store.table = {
    getEntity: async (partitionKey: string, rowKey: string) => {
      const row = rows.get(`${partitionKey}/${rowKey}`)
      if (!row) throw Object.assign(new Error('not found'), { statusCode: 404 })
      return { ...row }
    },
    createEntity: async (entity: Record<string, unknown>) => {
      const key = `${entity.partitionKey}/${entity.rowKey}`
      if (rows.has(key))
        throw Object.assign(new Error('exists'), { statusCode: 409 })
      rows.set(key, { ...entity, etag: 'etag-1' })
    },
    updateEntity: async (
      entity: Record<string, unknown>,
      _mode: string,
      options?: { etag?: string },
    ) => {
      const key = `${entity.partitionKey}/${entity.rowKey}`
      const current = rows.get(key)
      if (!current)
        throw Object.assign(new Error('not found'), { statusCode: 404 })
      if (options?.etag && options.etag !== current.etag)
        throw Object.assign(new Error('conflict'), { statusCode: 412 })
      rows.set(key, { ...current, ...entity, etag: 'etag-next' })
    },
  } as unknown as typeof store.table
  const assessment = fixture()
  const github = new GitHubClient(
    'synthetic-owner',
    'synthetic-repo',
    'synthetic-token',
  )
  let issueCreates = 0
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (init?.method === 'GET')
        return url.pathname.includes('/labels/')
          ? Response.json({
              name: decodeURIComponent(url.pathname.split('/').at(-1)!),
            })
          : Response.json([])
      if (url.pathname.endsWith('/issues')) {
        issueCreates++
        return Response.json({
          node_id: 'parent-node-id',
          id: 700,
          number: 7,
          html_url:
            'https://github.com/synthetic-owner/synthetic-repo/issues/7',
        })
      }
      return Response.json({})
    },
  )
  const first = await store.ensureParentIssue(github, assessment)
  const second = await store.ensureParentIssue(github, assessment)
  assert.deepEqual(second, first)
  assert.equal(issueCreates, 1)
  assert.ok(rows.size === 1)
  assert.equal([...rows.values()][0]?.state, 'IssueCreated')
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
      if (init?.method !== 'POST')
        return url.pathname.includes('/labels/')
          ? Response.json({
              name: decodeURIComponent(url.pathname.split('/').at(-1)!),
            })
          : Response.json([])
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
  ].join('\n')
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
  const initialHash = await client.updateManagedIssue(
    'synthetic-issue',
    item,
    null,
  )
  assert.equal(initialHash, hash(oldContent))
  assert.equal(mutationBody, '')
  const updatedHash = await client.updateManagedIssue(
    'synthetic-issue',
    revised,
    hash(oldContent),
  )
  assert.equal(updatedHash, hash(managedIssueContent(revised)))
  assert.ok(mutationBody.includes(manualPrefix))
  assert.ok(mutationBody.includes(manualSuffix))
  assert.ok(mutationBody.includes('優先度: P1'))

  body = mutationBody.replace('優先度: P1', 'Priority: human edit')
  await assert.rejects(
    client.updateManagedIssue('synthetic-issue', item, updatedHash),
    /human conflict review required/,
  )
})
test('managed Issue content includes lifecycle notice context and department candidates', () => {
  const assessment = fixture()
  assessment.event.evidence.push({
    id: 'official-notice',
    sourceType: 'Microsoft',
    sourceVersion: 'official-version',
    observedAt: '2026-08-01T00:00:00.000Z',
    subjectIds: [assessment.event.id],
    fact: 'Classic API retirement by 31 March 2027.',
    officialUrl:
      'https://learn.microsoft.com/en-us/azure/foundry/agents/migrate',
  })
  assessment.event.milestones.push({
    id: 'official-retirement-date',
    kind: 'Retirement',
    date: '2027-03-31',
    rawDateText: '31 March 2027',
    scope: 'Synthetic test date',
    evidenceIds: [assessment.event.evidence[0]!.id],
  })
  const item = {
    ...assessment.workItems[0]!,
    workflowRouting: {
      policyVersion: 'test',
      teamCandidates: [
        { id: 'infra', displayName: 'インフラ部門', kind: 'Team' as const },
      ],
      coordinationCandidates: [
        {
          id: 'is',
          displayName: '情報システム部門',
          kind: 'Department' as const,
        },
      ],
      approvalStages: [],
      sequenceOrder: null,
      dependsOnCategories: [],
      policyRuleIds: [],
      unresolvedReasons: [],
    },
  }
  const content = managedIssueContent(item, assessment)
  assert.ok(content.includes(assessment.event.title))
  assert.ok(content.includes('2027-03-31'))
  assert.ok(content.includes('Classic API retirement by 31 March 2027.'))
  assert.ok(
    content.includes(
      'https://learn.microsoft.com/en-us/azure/foundry/agents/migrate',
    ),
  )
  assert.ok(content.includes('インフラ部門'))
  assert.ok(content.includes('情報システム部門'))
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
      if (payload.query.startsWith('query(')) {
        assert.ok(payload.query.includes('content{__typename ...on Issue{id}}'))
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
      }
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

test('no-action review hides the current assessment and does not create outbox work', async (t) => {
  const store = new AzureStore('syntheticaccount')
  const assessment = fixture()
  const approval: Approval = {
    id: hash('no-action-review'),
    assessmentId: assessment.id,
    packageHash: assessment.packageHash,
    approvedItemIds: [],
    reviewerId: 'synthetic-user',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    reason: 'No matching resource types were found',
    result: 'NoAction',
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
      assert.ok(text.includes('disposition'))
      assert.ok(text.includes('NoAction'))
      assert.ok(text.includes('review:' + approval.id))
      assert.ok(!text.includes('outbox:'))
      return { status: 202, subResponses: [] }
    },
  )
  await store.approve(assessment, approval)
  assert.equal(submit.mock.callCount(), 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from '../apps/review-web/src/api.ts'

test('UI sync uses POST with JSON and CSRF marker even without a payload', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/sync')
    assert.equal(init.method, 'POST')
    assert.equal(init.credentials, 'same-origin')
    const headers = new Headers(init.headers)
    assert.equal(headers.get('content-type'), 'application/json')
    assert.equal(headers.get('x-arp-request'), '1')
    assert.equal(init.body, '{}')
    return Response.json({ events: 0, resources: 0 }, { status: 202 })
  })
  assert.deepEqual(await request('sync', 'POST'), { events: 0, resources: 0 })
})

test('UI assessment reads remain GET without a request body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/assessments')
    assert.equal(init.method, 'GET')
    assert.equal(init.body, undefined)
    return Response.json([])
  })
  assert.deepEqual(await request('assessments', 'GET'), [])
})

test('UI writes preserve the approved payload', async (t) => {
  const body = { assessmentId: 'synthetic', reason: 'synthetic review' }
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(String(init.body)), body)
      return Response.json({ exportEnabled: false })
    },
  )
  assert.deepEqual(await request('review', 'POST', body), {
    exportEnabled: false,
  })
})

test('UI translation sends only the assessment and official evidence identifiers', async (t) => {
  const body = { assessmentId: 'a'.repeat(64), evidenceId: 'official-evidence' }
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/translate-evidence')
    assert.equal(init.method, 'POST')
    assert.equal(init.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(String(init.body)), body)
    return Response.json({
      translatedText: '<p>廃止日</p>',
      provider: 'Azure AI Translator',
      cached: true,
    })
  })
  assert.deepEqual(await request('translate-evidence', 'POST', body), {
    translatedText: '<p>廃止日</p>',
    provider: 'Azure AI Translator',
    cached: true,
  })
})

test('UI authentication failures do not display remote response details', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('synthetic secret', { status: 401 }),
  )
  await assert.rejects(request('assessments', 'GET'), {
    message: 'サインインが必要です',
  })
})


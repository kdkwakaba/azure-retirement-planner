import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  createVerifier,
  groundedInput,
  jsonRequest,
  RemoteError,
} from '@arp/adapters'
import { PlatformIdentity } from '../packages/adapters/src/identity.ts'
import {
  reviseAssessment,
  verifyApproval,
  hash,
  refreshAssessment,
  validateAssessment,
} from '@arp/domain'
import { approvalSchema, type Correction } from '@arp/contracts'
import { fixture, tenant, resourceId } from './fixtures.ts'

test('JWT: signature, tenant, issuer, audience, expiry are all verified', async () => {
  const keys = await generateKeyPair('RS256')
  const publicKey = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'synthetic-key',
  }
  const verifier = createVerifier(
    tenant,
    'synthetic-client',
    createLocalJWKSet({ keys: [publicKey] }),
  )
  const create = async (overrides: Record<string, unknown> = {}) =>
    new SignJWT({
      tid: tenant,
      oid: 'synthetic-user',
      roles: ['Reviewer'],
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' })
      .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
      .setAudience('synthetic-client')
      .setExpirationTime('5m')
      .sign(keys.privateKey)
  const token = await create()
  assert.equal((await verifier(token)).id, 'synthetic-user')
  await assert.rejects(verifier(await create({ tid: 'wrong-tenant' })))
  await assert.rejects(
    createVerifier(
      tenant,
      'different-client',
      createLocalJWKSet({ keys: [publicKey] }),
    )(token),
  )
  await assert.rejects(verifier(token.slice(0, -10) + 'corrupted'))
  const expired = await new SignJWT({ tid: tenant, oid: 'test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' })
    .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience('synthetic-client')
    .setExpirationTime(1)
    .sign(keys.privateKey)
  await assert.rejects(verifier(expired))
  const wrongIssuer = await new SignJWT({ tid: tenant, oid: 'test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' })
    .setIssuer('https://attacker.invalid')
    .setAudience('synthetic-client')
    .setExpirationTime('5m')
    .sign(keys.privateKey)
  await assert.rejects(verifier(wrongIssuer))
})
test('model input aliases Resource IDs, Workload and Team and only resolves known aliases', () => {
  const a = fixture()
  a.resources[0]!.ownerTeam = 'synthetic-team'
  a.event.evidence[0]!.fact = resourceId + ' synthetic-workload synthetic-team'
  const grounded = groundedInput(a.event, a.resources, a.workloadId)
  assert.ok(!JSON.stringify(grounded.state).includes(resourceId))
  assert.ok(!JSON.stringify(grounded.state).includes('synthetic-workload'))
  assert.equal(
    grounded.resolve({
      ...a.workItems[0]!,
      workloadId: 'workload-1',
      resourceIds: ['resource-1'],
    }).resourceIds[0],
    resourceId,
  )
  assert.equal(
    grounded.resolve({ ...a.workItems[0]!, resourceIds: ['unknown-resource'] })
      .resourceIds[0],
    'unknown-resource',
  )
})
test('HTTP errors do not expose remote response or credentials', async () => {
  try {
    await jsonRequest(
      'https://example.invalid',
      {},
      async () => new Response('synthetic private error', { status: 429 }),
    )
    assert.fail('should reject')
  } catch (e) {
    assert.ok(e instanceof RemoteError)
    assert.equal(e.status, 429)
    assert.ok(!e.message.includes('private'))
  }
})
test('HTTP streamed responses are size bounded', async () => {
  await assert.rejects(
    jsonRequest(
      'https://example.invalid',
      {},
      async () =>
        new Response('x', { headers: { 'content-length': '9000000' } }),
    ),
  )
})
test('platform identity refuses external token endpoints without contacting them', async (t) => {
  const oldEndpoint = process.env.IDENTITY_ENDPOINT,
    oldHeader = process.env.IDENTITY_HEADER
  process.env.IDENTITY_ENDPOINT = 'http://attacker.invalid/token'
  process.env.IDENTITY_HEADER = 'synthetic-header'
  const mocked = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not fetch')
  })
  try {
    await assert.rejects(
      new PlatformIdentity().getToken('https://storage.azure.com/.default'),
      /Invalid platform/,
    )
    assert.equal(mocked.mock.callCount(), 0)
  } finally {
    if (oldEndpoint === undefined) delete process.env.IDENTITY_ENDPOINT
    else process.env.IDENTITY_ENDPOINT = oldEndpoint
    if (oldHeader === undefined) delete process.env.IDENTITY_HEADER
    else process.env.IDENTITY_HEADER = oldHeader
  }
})
test('platform identity obtains and caches only allowed scopes', async (t) => {
  const oldEndpoint = process.env.IDENTITY_ENDPOINT,
    oldHeader = process.env.IDENTITY_HEADER
  process.env.IDENTITY_ENDPOINT = 'http://127.0.0.1:12345/MSI/token'
  process.env.IDENTITY_HEADER = 'synthetic-header'
  const mocked = t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        new URL(String(input)).searchParams.get('resource'),
        'https://storage.azure.com',
      )
      assert.equal(
        new Headers(init?.headers).get('X-IDENTITY-HEADER'),
        'synthetic-header',
      )
      return new Response(
        JSON.stringify({
          access_token: 'synthetic-token',
          expires_on: Math.floor(Date.now() / 1000) + 3600,
        }),
      )
    },
  )
  try {
    const identity = new PlatformIdentity()
    assert.equal(
      (await identity.getToken('https://storage.azure.com/.default')).token,
      'synthetic-token',
    )
    await identity.getToken('https://storage.azure.com/.default')
    assert.equal(mocked.mock.callCount(), 1)
    await assert.rejects(identity.getToken('https://attacker.invalid/.default'))
  } finally {
    if (oldEndpoint === undefined) delete process.env.IDENTITY_ENDPOINT
    else process.env.IDENTITY_ENDPOINT = oldEndpoint
    if (oldHeader === undefined) delete process.env.IDENTITY_HEADER
    else process.env.IDENTITY_HEADER = oldHeader
  }
})
function correction(): Correction {
  return {
    impactIfUnaddressed: 'High',
    impactDuringAndAfterChange: 'Medium',
    criticalWorkload: true,
    alternativeApproved: true,
    remainingCalendarDays: 45,
    retirementDate: '2026-10-01',
    supportEndDate: null,
    creationStopDate: null,
    deprecationDate: '2026-01-01',
    applicableKind: 'Retirement',
    reason: 'Synthetic human confirmation',
    workItemUpdates: [],
  }
}
test('human correction preserves model output and invalidates prior approval', () => {
  const original = fixture(),
    review = approvalSchema.parse({
      id: hash('approval'),
      assessmentId: original.id,
      packageHash: original.packageHash,
      approvedItemIds: [original.workItems[0]!.id],
      reviewerId: 'synthetic-user',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      reason: 'Synthetic',
      result: 'Approved',
    })
  const revised = reviseAssessment(
    original,
    correction(),
    'synthetic-user',
    '2026-08-02T00:00:00.000Z',
  )
  assert.deepEqual(revised.decision, original.decision)
  assert.equal(revised.humanContext?.impactIfUnaddressed, 'High')
  assert.notEqual(revised.id, original.id)
  assert.throws(() => verifyApproval(revised, review, revised.workItems[0]!.id))
  assert.equal(original.event.milestones.length, 0)
})
test('deprecation date cannot be used as migration deadline', () =>
  assert.throws(() =>
    reviseAssessment(
      fixture(),
      { ...correction(), applicableKind: 'Deprecation' },
      'synthetic-user',
      '2026-08-02T00:00:00.000Z',
    ),
  ))

test('daily rule refresh keeps human confirmation time and invalidates old approval', () => {
  const revised = reviseAssessment(
    fixture(),
    correction(),
    'synthetic-user',
    '2026-08-02T00:00:00.000Z',
  )
  const refreshed = refreshAssessment(revised, '2026-09-02T00:00:00.000Z')
  assert.equal(refreshed.effectivePriority, 'P1')
  assert.equal(
    refreshed.humanContext?.reviewedAt,
    revised.humanContext?.reviewedAt,
  )
  assert.deepEqual(refreshed.decision, revised.decision)
  assert.deepEqual(refreshed.event.evidence, revised.event.evidence)
  assert.notEqual(refreshed.id, revised.id)
  assert.notEqual(refreshed.packageHash, revised.packageHash)
})

test('uncertain migration cannot become Required merely from a generated recommendation', () => {
  const a = fixture()
  a.workItems[0]!.category = 'Production Migration'
  a.workItems[0]!.necessity = 'Required'
  a.workItems[0]!.sourceType = 'AIProposal'
  assert.ok(validateAssessment(a).some((e) => e.includes('必須にできない')))
})

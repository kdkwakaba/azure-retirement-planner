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
  carryForwardHumanContext,
  verifyApproval,
  hash,
  refreshAssessment,
  validateAssessment,
  canClose,
  normalizeNotice,
  packageHash,
  scopeEvidenceToWorkload,
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
test('Workload grounding removes and aliases Resource IDs from other Workloads', () => {
  const a = fixture()
  const otherResourceId = `${resourceId}-other-workload`
  const sharedEvidence = {
    ...a.event.evidence[0]!,
    id: 'shared-profile-evidence',
    subjectIds: [resourceId, otherResourceId],
  }
  const foreignEvidence = {
    ...a.event.evidence[0]!,
    id: 'foreign-profile-evidence',
    subjectIds: [otherResourceId],
  }
  const scopedEvidence = scopeEvidenceToWorkload({
    evidence: [a.event.evidence[0]!, sharedEvidence, foreignEvidence],
    eventId: a.event.id,
    workloadId: a.workloadId,
    resources: a.resources,
  })
  assert.ok(scopedEvidence.some((item) => item.id === sharedEvidence.id))
  assert.ok(!scopedEvidence.some((item) => item.id === foreignEvidence.id))
  assert.deepEqual(
    scopedEvidence.find((item) => item.id === sharedEvidence.id)?.subjectIds,
    [resourceId],
  )
  const grounded = groundedInput(
    { ...a.event, evidence: scopedEvidence },
    a.resources,
    a.workloadId,
  )
  const modelInput = JSON.stringify(grounded.state)
  assert.ok(!modelInput.includes(resourceId))
  assert.ok(!modelInput.includes(otherResourceId))
  assert.ok(!modelInput.includes(foreignEvidence.id))
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
    scopeDisposition: 'InScope',
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
    workItemAdditions: [],
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
test('human-added coordination work remains a recommended draft with traceable human evidence', () => {
  const original = fixture()
  const revised = reviseAssessment(
    original,
    {
      ...correction(),
      workItemAdditions: [
        {
          clientId: '35d68144-ec5e-4a16-9985-3edc1443a3ef',
          category: 'Cost Assessment',
          title: '追加費用と予算確保の要否を確認',
          description: '追加費用の有無を調査し、必要な場合に予算調整する',
          completionCriteria: ['費用根拠と予算調整要否を記録する'],
          ownerTeam: null,
        },
      ],
    },
    'synthetic-user',
    '2026-08-02T00:00:00.000Z',
  )
  const addition = revised.workItems.find((item) =>
    item.title.includes('追加費用'),
  )
  assert.ok(addition)
  assert.equal(addition.necessity, 'Recommended')
  assert.equal(addition.status, 'Draft')
  assert.equal(addition.sourceType, 'Mixed')
  assert.deepEqual(addition.resourceIds, [])
  assert.equal(
    revised.event.evidence.find((item) => item.id === addition.evidenceIds[0])
      ?.sourceType,
    'Human',
  )
  assert.deepEqual(validateAssessment(revised), [])
})
test('manual additions cannot turn unknown cost into a budget approval task', () => {
  assert.throws(
    () =>
      reviseAssessment(
        fixture(),
        {
          ...correction(),
          workItemAdditions: [
            {
              clientId: '35d68144-ec5e-4a16-9985-3edc1443a3ef',
              category: 'Budget Approval',
              title: '予算承認',
              description: '費用は未確認',
              completionCriteria: ['承認を記録'],
              ownerTeam: '情報システム部門',
            },
          ],
        },
        'synthetic-user',
        '2026-08-02T00:00:00.000Z',
      ),
    /confirmed additional cost/,
  )
})
test('reassessment with the same event version carries human corrections but requires fresh review', () => {
  const original = fixture()
  const corrected = reviseAssessment(
    original,
    {
      ...correction(),
      workItemUpdates: [
        {
          id: original.workItems[0]!.id,
          ownerTeam: 'confirmed-platform-team',
          plannedStartDate: '2026-08-10',
          dueDate: '2026-09-10',
        },
      ],
    },
    'synthetic-user',
    '2026-08-02T00:00:00.000Z',
  )
  const approved = approvalSchema.parse({
    id: hash('prior-approved-review'),
    assessmentId: corrected.id,
    packageHash: corrected.packageHash,
    approvedItemIds: [corrected.workItems[0]!.id],
    reviewerId: 'synthetic-user',
    reviewedAt: '2026-08-02T00:00:00.000Z',
    reason: 'Synthetic approval',
    result: 'Approved',
  })
  const next = fixture()
  const officialReference = {
    id: hash('updated-official-reference'),
    sourceType: 'Microsoft' as const,
    sourceVersion: hash('updated-official-reference-content'),
    observedAt: '2026-08-03T00:00:00.000Z',
    subjectIds: [],
    fact: 'Synthetic official reference update',
    officialUrl: 'https://learn.microsoft.com/en-us/azure/synthetic',
  }
  next.event.evidence.push(officialReference)
  next.packageHash = packageHash(next)
  const carried = carryForwardHumanContext(next, corrected)
  assert.equal(
    carried.humanContext?.reviewedAt,
    corrected.humanContext?.reviewedAt,
  )
  assert.equal(carried.humanContext?.impactIfUnaddressed, 'High')
  assert.equal(carried.humanContext?.criticalWorkload, true)
  assert.ok(
    carried.event.evidence.some(
      (item) => item.id === corrected.humanContext?.reviewEvidenceIds?.[0],
    ),
  )
  assert.equal(
    carried.event.milestones.find((item) => item.kind === 'Retirement')?.date,
    '2026-10-01',
  )
  assert.equal(carried.workItems[0]?.ownerTeam, 'confirmed-platform-team')
  assert.equal(carried.workItems[0]?.dueDate, '2026-09-10')
  assert.equal(carried.workItems[0]?.sourceType, 'Mixed')
  assert.ok(
    carried.workItems[0]?.evidenceIds.includes(
      carried.humanContext?.reviewEvidenceIds?.[0] ?? '',
    ),
  )
  assert.equal(carried.humanReviewRequired, true)
  assert.notEqual(carried.packageHash, corrected.packageHash)
  assert.throws(() =>
    verifyApproval(carried, approved, carried.workItems[0]!.id),
  )
  assert.deepEqual(validateAssessment(carried), [])
})
test('TST-29: human-confirmed out-of-scope assessment has no priority or work and cannot be approved', () => {
  const original = fixture()
  const event = normalizeNotice({
    tenantId: tenant,
    trackingId: 'TEST-UNRELATED',
    title: 'General information',
    body: 'Synthetic advisory unrelated to lifecycle changes',
    updatedAt: '2026-08-01T00:00:00.000Z',
  })
  original.event = event
  original.eventVersionId = event.versionId
  original.resources = original.resources.map((resource) => ({
    ...resource,
    classification: 'Unknown',
    classificationReason: 'NoApplicableProfile',
    verificationRequired: true,
    evidenceIds: [event.evidence[0]!.id],
  }))
  original.workItems = original.workItems.map((item) => ({
    ...item,
    evidenceIds: [event.evidence[0]!.id],
  }))
  original.packageHash = packageHash(original)
  const revised = reviseAssessment(
    original,
    {
      ...correction(),
      scopeDisposition: 'OutOfScope',
      reason: 'Synthetic notice is unrelated to managed lifecycle changes',
    },
    'synthetic-user',
    '2026-08-02T00:00:00.000Z',
  )
  assert.equal(revised.event.classification, 'ReviewRequired')
  assert.equal(revised.humanContext?.scopeDisposition, 'OutOfScope')
  assert.equal(revised.humanContext?.reviewEvidenceIds?.length, 1)
  assert.equal(
    revised.event.evidence.find(
      (e) => e.id === revised.humanContext?.reviewEvidenceIds?.[0],
    )?.sourceType,
    'Human',
  )
  assert.equal(revised.effectivePriority, null)
  assert.equal(revised.workItems.length, 0)
  assert.deepEqual(revised.validationErrors, [])
  assert.equal(canClose(revised), true)
  assert.throws(() =>
    verifyApproval(
      revised,
      approvalSchema.parse({
        id: hash('out-of-scope-approval'),
        assessmentId: revised.id,
        packageHash: revised.packageHash,
        approvedItemIds: [],
        reviewerId: 'synthetic-user',
        reviewedAt: '2026-08-02T00:00:00.000Z',
        reason: 'Synthetic',
        result: 'Approved',
      }),
      'unknown-item',
    ),
  )
  const refreshed = refreshAssessment(revised, '2026-08-03T00:00:00.000Z')
  assert.equal(refreshed.effectivePriority, null)
  assert.equal(refreshed.workItems.length, 0)
  assert.equal(refreshed.humanContext?.scopeDisposition, 'OutOfScope')
  const next = structuredClone(original)
  next.id = hash('next-evaluation-after-reference-update')
  next.event.evidence.push({
    id: hash('new-reference-for-out-of-scope'),
    sourceType: 'Microsoft',
    sourceVersion: hash('new-reference-content'),
    observedAt: '2026-08-03T00:00:00.000Z',
    subjectIds: [],
    fact: 'Synthetic official reference update',
    officialUrl: 'https://learn.microsoft.com/en-us/azure/synthetic',
  })
  next.packageHash = packageHash(next)
  const carried = carryForwardHumanContext(next, revised)
  assert.equal(carried.humanContext?.scopeDisposition, 'OutOfScope')
  assert.equal(carried.workItems.length, 0)
  assert.equal(carried.effectivePriority, null)
  assert.equal(carried.humanReviewRequired, true)
  assert.equal(canClose(carried), false)
  assert.deepEqual(validateAssessment(carried), [])
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

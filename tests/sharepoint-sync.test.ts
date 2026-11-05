import assert from 'node:assert/strict'
import test from 'node:test'
import { AzureStore } from '@arp/adapters'
import {
  documentSourceSchema,
  sharePointSyncRunSchema,
  type DocumentSource,
} from '@arp/contracts'
import { hash } from '@arp/domain'

const source: DocumentSource = documentSourceSchema.parse({
  sourceId: 'sample-source',
  tenantId: '11111111-1111-4111-8111-111111111111',
  siteId: 'contoso.sharepoint.com,site-collection,site-web',
  driveId: 'selected-drive',
  folderItemId: 'selected-folder',
  displayName: 'Sample folder',
  workloadIds: ['sample-workload'],
  includeSubfolders: true,
  allowedExtensions: ['.docx', '.xlsx'],
  sampleOnly: true,
  configurationVersion: 'config-v1',
})

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    runId: '22222222-2222-4222-8222-222222222222',
    sourceId: source.sourceId,
    sourceConfigurationHash: hash(source),
    configurationVersion: source.configurationVersion,
    sampleOnly: true,
    requestedBy: '33333333-3333-4333-8333-333333333333',
    requestedAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    state: 'Pending',
    attemptCount: 0,
    snapshotHash: null,
    addedItemIds: [],
    changedItemIds: [],
    removedItemIds: [],
    unchangedItemIds: [],
    errorCategory: null,
    errorHttpStatus: null,
    ...overrides,
  }
}

function fakeStore() {
  const rows = new Map<string, Record<string, unknown>>()
  const sentMessages: string[] = []
  let etag = 0
  const store = new AzureStore('syntheticaccount')
  store.table = {
    createEntity: async (entity: Record<string, unknown>) => {
      if (Object.values(entity).some(Array.isArray))
        throw new Error('Azure Table entities cannot contain arrays')
      const key = `${entity.partitionKey}/${entity.rowKey}`
      if (rows.has(key))
        throw Object.assign(new Error('conflict'), { statusCode: 409 })
      rows.set(key, { ...entity, etag: String(++etag) })
    },
    getEntity: async (partitionKey: string, rowKey: string) => {
      const row = rows.get(`${partitionKey}/${rowKey}`)
      if (!row) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { ...row }
    },
    updateEntity: async (
      entity: Record<string, unknown>,
      mode: 'Merge' | 'Replace',
      options?: { etag?: string },
    ) => {
      if (Object.values(entity).some(Array.isArray))
        throw new Error('Azure Table entities cannot contain arrays')
      const key = `${entity.partitionKey}/${entity.rowKey}`
      const row = rows.get(key)
      if (!row) throw Object.assign(new Error('missing'), { statusCode: 404 })
      if (options?.etag && options.etag !== row.etag)
        throw Object.assign(new Error('precondition'), { statusCode: 412 })
      rows.set(
        key,
        mode === 'Replace'
          ? { ...entity, etag: String(++etag) }
          : { ...row, ...entity, etag: String(++etag) },
      )
    },
    listEntities: async function* () {
      for (const row of rows.values())
        if (row.partitionKey === 'sharepoint-sync' && row.state === 'Pending')
          yield { ...row }
    },
  } as never
  store.queues = {
    getQueueClient: (name: string) => ({
      sendMessage: async (message: string) => {
        sentMessages.push(
          `${name}:${Buffer.from(message, 'base64').toString()}`,
        )
      },
    }),
  } as never
  return { store, rows, sentMessages }
}

test('SharePoint sync contract exposes safe state for sample and live sources', () => {
  assert.doesNotThrow(() => sharePointSyncRunSchema.parse(runFixture()))
  assert.doesNotThrow(() =>
    sharePointSyncRunSchema.parse(runFixture({ sampleOnly: false })),
  )
  assert.throws(() =>
    sharePointSyncRunSchema.parse(runFixture({ state: 'Succeeded' })),
  )
  assert.throws(() =>
    sharePointSyncRunSchema.parse(
      runFixture({ state: 'Failed', errorCategory: null }),
    ),
  )
})

test('SharePoint source changes require a new configuration version', async (t) => {
  const store = new AzureStore('syntheticaccount')
  const pointers = new Map<string, Record<string, unknown>>()
  const blobs = new Map<string, unknown>()
  store.table = {
    getEntity: async (partitionKey: string, rowKey: string) => {
      const pointer = pointers.get(`${partitionKey}/${rowKey}`)
      if (!pointer)
        throw Object.assign(new Error('missing'), { statusCode: 404 })
      return pointer
    },
    upsertEntity: async (entity: Record<string, unknown>) => {
      pointers.set(`${entity.partitionKey}/${entity.rowKey}`, entity)
    },
    listEntities: async function* () {
      for (const entity of pointers.values()) yield entity
    },
  } as never
  t.mock.method(
    store,
    'put',
    async (collection: string, id: string, value: unknown) => {
      blobs.set(`${collection}/${id}`, value)
    },
  )
  t.mock.method(store, 'get', async (collection: string, id: string) => {
    const value = blobs.get(`${collection}/${id}`)
    if (!value) throw new Error('missing synthetic source')
    return value
  })

  await store.saveSharePointSource(source)
  await assert.rejects(
    store.saveSharePointSource({ ...source, displayName: 'Changed name' }),
    /require a new configuration version/,
  )
  await store.saveSharePointSource({
    ...source,
    displayName: 'Changed name',
    configurationVersion: 'config-v2',
  })
  assert.equal(
    (await store.sharePointSource(source.sourceId))?.source
      .configurationVersion,
    'config-v2',
  )
  await assert.rejects(
    store.saveSharePointSource({
      ...source,
      sourceId: 'second-sample-source',
    }),
    /one source per data mode/,
  )
})

test('SharePoint sync queue transitions through retry to a persisted result', async () => {
  const { store, rows, sentMessages } = fakeStore()
  await store.createSharePointSyncRun({
    runId: runFixture().runId,
    source,
    sourceConfigurationHash: hash(source),
    requestedBy: runFixture().requestedBy,
    requestedAt: runFixture().requestedAt,
  })
  const pendingEntity = rows.get(`sharepoint-sync/${runFixture().runId}`)
  assert.ok(pendingEntity)
  for (const field of [
    'addedItemIds',
    'changedItemIds',
    'removedItemIds',
    'unchangedItemIds',
  ])
    assert.equal(typeof pendingEntity[field], 'string')
  await store.dispatchSharePointSyncs()
  assert.equal(sentMessages.length, 1)
  assert.equal(sentMessages[0]?.startsWith('sharepoint-document-syncs:'), true)
  const firstClaim = await store.claimSharePointSyncRun(runFixture().runId)
  assert.equal(firstClaim?.state, 'Processing')
  assert.equal(firstClaim?.attemptCount, 1)
  await store.retrySharePointSyncRun(runFixture().runId, 'Throttled', 429)
  assert.equal(
    (await store.sharePointSyncRun(runFixture().runId)).state,
    'Retrying',
  )
  const retryClaim = await store.claimSharePointSyncRun(runFixture().runId)
  assert.equal(retryClaim?.attemptCount, 2)
  await store.finishSharePointSyncRun(runFixture().runId, 'Succeeded', {
    snapshotHash: 'a'.repeat(64),
    addedItemIds: ['file-1'],
    changedItemIds: [],
    removedItemIds: [],
    unchangedItemIds: [],
  })
  const completed = await store.sharePointSyncRun(runFixture().runId)
  assert.equal(completed.state, 'Succeeded')
  assert.equal(completed.snapshotHash, 'a'.repeat(64))
  assert.deepEqual(completed.addedItemIds, ['file-1'])
  assert.equal(rows.size, 1)
})

test('SharePoint sync poison handling records exhaustion without exception text', async () => {
  const { store, rows } = fakeStore()
  const run = runFixture({
    state: 'Retrying',
    attemptCount: 5,
    errorCategory: 'Forbidden',
    errorHttpStatus: 403,
  })
  await store.createSharePointSyncRun({
    runId: run.runId,
    source,
    sourceConfigurationHash: hash(source),
    requestedBy: run.requestedBy,
    requestedAt: run.requestedAt,
  })
  await store.table.updateEntity(
    {
      partitionKey: 'sharepoint-sync',
      rowKey: run.runId,
      entityKind: 'sharepoint-sync-run',
      state: run.state,
      attemptCount: run.attemptCount,
      errorCategory: run.errorCategory,
      errorHttpStatus: run.errorHttpStatus,
    },
    'Merge',
  )
  await store.failExhaustedSharePointSyncRun(run.runId)
  const result = await store.sharePointSyncRun(run.runId)
  assert.equal(result.state, 'Failed')
  assert.equal(result.errorCategory, 'Forbidden')
  assert.equal(result.errorHttpStatus, 403)
  assert.equal(
    JSON.stringify([...rows.values()]).includes('exception text'),
    false,
  )
})

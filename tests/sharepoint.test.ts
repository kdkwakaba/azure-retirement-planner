import assert from 'node:assert/strict'
import test from 'node:test'
import {
  persistSharePointFolderSnapshot,
  readSharePointFolder,
} from '@arp/adapters'
import type { DocumentSource } from '@arp/contracts'

const source: DocumentSource = {
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
}

function item(id: string, name: string, kind: 'folder' | 'file', size = 0) {
  return {
    id,
    name,
    size,
    eTag: `etag-${id}`,
    lastModifiedDateTime: '2026-11-04T00:00:00.000Z',
    ...(kind === 'folder' ? { folder: {} } : { file: {} }),
    parentReference: {
      driveId: source.driveId,
      siteId: source.siteId,
    },
  }
}

test('SharePoint folder read paginates, stays within the selected tree, and omits MI auth from downloads', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push({ url, init })
    if (url.hostname !== 'graph.microsoft.com') {
      assert.equal(new Headers(init?.headers).has('Authorization'), false)
      return new Response(Buffer.from('synthetic document bytes'))
    }
    if (url.pathname.endsWith('/drives'))
      return Response.json({ value: [{ id: source.driveId }] })
    if (url.pathname.endsWith('/items/selected-folder'))
      return Response.json({
        ...item(source.folderItemId, 'Selected folder', 'folder'),
      })
    if (url.pathname.endsWith('/items/selected-folder/children')) {
      if (url.searchParams.has('$skiptoken'))
        return Response.json({
          value: [item('file-2', 'second.xlsx', 'file', 10)],
        })
      return Response.json({
        value: [
          item('file-1', 'first.docx', 'file', 10),
          item('subfolder-1', 'Nested', 'folder'),
        ],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/drives/selected-drive/items/selected-folder/children?$skiptoken=page-two',
      })
    }
    if (url.pathname.endsWith('/items/subfolder-1/children'))
      return Response.json({
        value: [item('file-3', 'ignore.pdf', 'file', 10)],
      })
    if (url.pathname.endsWith('/content'))
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://contoso.sharepoint.com/download?token=synthetic',
        },
      })
    assert.fail(`Unexpected request ${url.pathname}`)
  }

  const result = await readSharePointFolder(
    source,
    source.tenantId,
    fetcher,
    async () => ({ token: 'synthetic-graph-token' }),
  )
  assert.equal(result.sampleOnly, true)
  assert.equal(result.configurationVersion, 'config-v1')
  assert.deepEqual(
    result.documents.map(({ itemId, name, sampleOnly, content }) => ({
      itemId,
      name,
      sampleOnly,
      content: content.toString(),
    })),
    [
      {
        itemId: 'file-1',
        name: 'first.docx',
        sampleOnly: true,
        content: 'synthetic document bytes',
      },
      {
        itemId: 'file-2',
        name: 'second.xlsx',
        sampleOnly: true,
        content: 'synthetic document bytes',
      },
    ],
  )
  assert.deepEqual(result.skipped, [
    { itemId: 'file-3', name: 'ignore.pdf', reason: 'UnsupportedExtension' },
  ])
  const graphRequests = requests.filter(
    ({ url }) => url.hostname === 'graph.microsoft.com',
  )
  assert.ok(
    graphRequests.every(
      ({ init }) =>
        new Headers(init?.headers).get('Authorization') ===
        'Bearer synthetic-graph-token',
    ),
  )
  assert.ok(
    requests
      .filter(({ url }) => url.hostname !== 'graph.microsoft.com')
      .every(({ init }) => init?.redirect === 'error'),
  )
})

test('SharePoint folder read rejects pagination links outside Microsoft Graph', async () => {
  let calls = 0
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    calls++
    if (url.pathname.endsWith('/drives'))
      return Response.json({ value: [{ id: source.driveId }] })
    if (url.pathname.endsWith('/items/selected-folder'))
      return Response.json(
        item(source.folderItemId, 'Selected folder', 'folder'),
      )
    return Response.json({
      value: [],
      '@odata.nextLink': 'https://attacker.invalid/steal',
    })
  }
  await assert.rejects(
    readSharePointFolder(source, source.tenantId, fetcher, async () => ({
      token: 'synthetic',
    })),
    /invalid pagination link/,
  )
  assert.equal(calls, 3)
})

test('SharePoint source must match application tenant before token access', async () => {
  let tokenRequested = false
  await assert.rejects(
    readSharePointFolder(
      source,
      '22222222-2222-4222-8222-222222222222',
      async () => assert.fail('No network call is allowed'),
      async () => {
        tokenRequested = true
        return { token: 'synthetic' }
      },
    ),
    /tenant does not match/,
  )
  assert.equal(tokenRequested, false)
})

test('SharePoint download rejects an unapproved preauthenticated host', async () => {
  let evilRequest = false
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/drives'))
      return Response.json({ value: [{ id: source.driveId }] })
    if (url.pathname.endsWith('/items/selected-folder'))
      return Response.json(
        item(source.folderItemId, 'Selected folder', 'folder'),
      )
    if (url.pathname.endsWith('/children'))
      return Response.json({
        value: [item('file-1', 'first.docx', 'file', 10)],
      })
    if (url.pathname.endsWith('/content'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.invalid/file' },
      })
    evilRequest = true
    return Response.json({})
  }
  await assert.rejects(
    readSharePointFolder(source, source.tenantId, fetcher, async () => ({
      token: 'synthetic',
    })),
    /download host is not approved/,
  )
  assert.equal(evilRequest, false)
})

test('SharePoint persistence stores immutable bytes and diffs only complete snapshots', async () => {
  const objects = new Map<string, unknown>()
  const binary = new Map<string, Buffer>()
  let current: Record<string, unknown> | null = null
  const store = {
    putSharePointDocument: async (
      sourceId: string,
      contentHash: string,
      content: Buffer,
    ) => binary.set(`${sourceId}/${contentHash}`, content),
    sharePointSnapshot: async () => current,
    saveSharePointSnapshot: async (snapshot: Record<string, unknown>) => {
      objects.set(String(snapshot.observedAt), snapshot)
      current = snapshot
      return 'a'.repeat(64)
    },
  } as never
  const observedAt = '2026-11-04T00:00:00.000Z'
  const first = {
    enumerationComplete: true as const,
    sourceId: source.sourceId,
    sampleOnly: source.sampleOnly,
    configurationVersion: source.configurationVersion,
    observedAt,
    documents: [
      {
        sourceId: source.sourceId,
        itemId: 'file-1',
        name: 'one.docx',
        extension: '.docx' as const,
        eTag: 'etag-1',
        lastModifiedAt: observedAt,
        observedAt,
        sampleOnly: source.sampleOnly,
        content: Buffer.from('first revision'),
      },
      {
        sourceId: source.sourceId,
        itemId: 'file-2',
        name: 'two.xlsx',
        extension: '.xlsx' as const,
        eTag: 'etag-2',
        lastModifiedAt: observedAt,
        observedAt,
        sampleOnly: source.sampleOnly,
        content: Buffer.from('unchanged revision'),
      },
    ],
    skipped: [],
  }
  const initial = await persistSharePointFolderSnapshot(store, source, first)
  assert.deepEqual(initial.addedItemIds.sort(), ['file-1', 'file-2'])
  assert.deepEqual(initial.removedItemIds, [])
  assert.equal(binary.size, 2)
  assert.equal(objects.size, 1)

  const next = await persistSharePointFolderSnapshot(store, source, {
    ...first,
    observedAt: '2026-11-05T00:00:00.000Z',
    documents: [
      {
        ...first.documents[0]!,
        eTag: 'etag-1-new',
        observedAt: '2026-11-05T00:00:00.000Z',
        lastModifiedAt: '2026-11-05T00:00:00.000Z',
        content: Buffer.from('changed revision'),
      },
    ],
  })
  assert.deepEqual(next.changedItemIds, ['file-1'])
  assert.deepEqual(next.removedItemIds, ['file-2'])
  assert.deepEqual(next.unchangedItemIds, [])
  assert.equal(binary.size, 3)
  assert.equal(objects.size, 2)
})

test('SharePoint persistence rejects a result from another configuration', async () => {
  let writes = 0
  const store = {
    putSharePointDocument: async () => {
      writes++
    },
  } as never
  await assert.rejects(
    persistSharePointFolderSnapshot(store, source, {
      enumerationComplete: true,
      sourceId: source.sourceId,
      sampleOnly: false,
      configurationVersion: source.configurationVersion,
      observedAt: '2026-11-04T00:00:00.000Z',
      documents: [],
      skipped: [],
    }),
    /does not match source configuration/,
  )
  assert.equal(writes, 0)
})

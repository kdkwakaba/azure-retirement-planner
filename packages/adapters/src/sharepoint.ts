import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  documentRevisionSchema,
  documentSourceSchema,
  sharePointSnapshotSchema,
  type DocumentSource,
  type SharePointSnapshot,
} from '@arp/contracts'
import { credential } from './azure.ts'
import type { AzureStore } from './store.ts'

const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const MAX_FOLDER_DEPTH = 8
const MAX_LIST_ITEMS = 2_000
const MAX_DOCUMENTS = 100
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

export type SharePointFile = {
  sourceId: string
  itemId: string
  name: string
  extension: '.docx' | '.xlsx'
  eTag: string | null
  lastModifiedAt: string | null
  observedAt: string
  sampleOnly: boolean
  content: Buffer
}

export type SharePointFolderReadResult = {
  enumerationComplete: true
  sourceId: string
  sampleOnly: boolean
  configurationVersion: string
  observedAt: string
  documents: SharePointFile[]
  skipped: SkippedSharePointItem[]
}

type SkippedSharePointItem = {
  itemId: string
  name: string
  reason: 'UnsupportedExtension'
}

type Fetcher = typeof fetch
type TokenProvider = () => Promise<{ token: string }>

const itemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
    eTag: z.string().nullable().optional(),
    lastModifiedDateTime: z.string().nullable().optional(),
    file: z.object({}).passthrough().optional(),
    folder: z.object({}).passthrough().optional(),
    remoteItem: z.unknown().optional(),
    parentReference: z
      .object({
        driveId: z.string().optional(),
        siteId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

function graphUrl(path: string): URL {
  const url = new URL(path, GRAPH_ORIGIN)
  if (url.origin !== GRAPH_ORIGIN || !url.pathname.startsWith('/v1.0/'))
    throw new Error('Invalid SharePoint Graph request path')
  return url
}

function validateNextLink(raw: string, expectedPath: string): URL {
  const url = new URL(raw)
  if (
    url.origin !== GRAPH_ORIGIN ||
    url.pathname !== expectedPath ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('SharePoint Graph returned an invalid pagination link')
  return url
}

async function graphJson(
  url: URL,
  token: string,
  fetcher: Fetcher,
): Promise<unknown> {
  let response: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      if (attempt === 2) throw new Error('SharePoint Graph request failed')
      continue
    }
    if (response.ok) break
    if (![429, 503].includes(response.status) || attempt === 2)
      throw new Error(`SharePoint Graph request failed (${response.status})`)
    const retryAfter = Number(response.headers.get('retry-after') ?? '1')
    const delay = Number.isFinite(retryAfter)
      ? Math.max(0, Math.min(5000, retryAfter * 1000))
      : 1000
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  if (!response?.ok) throw new Error('SharePoint Graph request failed')
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > 2_000_000)
    throw new Error('SharePoint Graph response too large')
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader)
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 2_000_000) {
        await reader.cancel()
        throw new Error('SharePoint Graph response too large')
      }
      chunks.push(part.value)
    }
  if (!size) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function readBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok)
    throw new Error(`SharePoint document download failed (${response.status})`)
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > limit)
    throw new Error('SharePoint document exceeds the size limit')
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader)
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('SharePoint document exceeds the size limit')
      }
      chunks.push(part.value)
    }
  return Buffer.concat(chunks)
}

function allowedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return [
    '.sharepoint.com',
    '.sharepointonline.com',
    '.1drv.com',
    '.blob.core.windows.net',
  ].some((suffix) => host.endsWith(suffix))
}

export async function readSharePointFolder(
  rawSource: DocumentSource,
  expectedTenantId: string,
  fetcher: Fetcher = fetch,
  tokenProvider: TokenProvider = () =>
    credential.getToken('https://graph.microsoft.com/.default'),
): Promise<SharePointFolderReadResult> {
  const source = documentSourceSchema.parse(rawSource)
  if (
    !z.uuid().safeParse(expectedTenantId).success ||
    source.tenantId.toLowerCase() !== expectedTenantId.toLowerCase()
  )
    throw new Error(
      'SharePoint source tenant does not match the application tenant',
    )

  const token = await tokenProvider()
  const encodedSiteId = encodeURIComponent(source.siteId)
  const drivePath = `/v1.0/sites/${encodedSiteId}/drives`
  let driveUrl = graphUrl(drivePath)
  driveUrl.searchParams.set('$select', 'id')
  let driveFound = false
  const drivePageTokens = new Set<string>()
  for (let pageCount = 0; ; pageCount++) {
    if (pageCount >= 20)
      throw new Error('SharePoint drive listing limit exceeded')
    const page = z
      .object({
        value: z.array(z.object({ id: z.string().min(1) }).passthrough()),
        '@odata.nextLink': z.string().url().optional(),
      })
      .parse(await graphJson(driveUrl, token.token, fetcher))
    if (page.value.some((drive) => drive.id === source.driveId))
      driveFound = true
    const next = page['@odata.nextLink']
    if (!next) break
    if (drivePageTokens.has(next))
      throw new Error('SharePoint drive pagination loop')
    drivePageTokens.add(next)
    driveUrl = validateNextLink(next, drivePath)
  }
  if (!driveFound)
    throw new Error('Configured SharePoint drive is outside the selected site')

  const observedAt = new Date().toISOString()
  const documents: SharePointFile[] = []
  const skipped: SkippedSharePointItem[] = []
  const visited = new Set<string>()
  let listedItems = 0
  let downloadedBytes = 0

  const verifyParent = (
    item: z.infer<typeof itemSchema>,
    allowDriveRoot = false,
  ) => {
    if (item.remoteItem !== undefined)
      throw new Error(
        'Remote SharePoint items are outside the selected folder scope',
      )
    if (allowDriveRoot && !item.parentReference) return
    if (
      item.parentReference?.driveId !== source.driveId ||
      item.parentReference.siteId !== source.siteId
    )
      throw new Error('SharePoint item is outside the selected site or drive')
  }

  const download = async (
    item: z.infer<typeof itemSchema>,
    extension: '.docx' | '.xlsx',
  ) => {
    const size = item.size ?? 0
    if (size > MAX_DOCUMENT_BYTES)
      throw new Error('SharePoint document exceeds the 10 MiB limit')
    if (documents.length >= MAX_DOCUMENTS)
      throw new Error('SharePoint document count limit exceeded')
    if (downloadedBytes + size > MAX_TOTAL_BYTES)
      throw new Error('SharePoint folder exceeds the 50 MiB download limit')
    const contentUrl = graphUrl(
      `/v1.0/drives/${encodeURIComponent(source.driveId)}/items/${encodeURIComponent(item.id)}/content`,
    )
    let redirect: Response
    try {
      redirect = await fetcher(contentUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token.token}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error('SharePoint document download request failed')
    }
    if (redirect.status !== 302)
      throw new Error(
        `SharePoint document redirect failed (${redirect.status})`,
      )
    const location = redirect.headers.get('location')
    if (!location)
      throw new Error('SharePoint document download URL is missing')
    const downloadUrl = new URL(location)
    if (
      downloadUrl.protocol !== 'https:' ||
      downloadUrl.username ||
      downloadUrl.password ||
      downloadUrl.port ||
      !allowedDownloadHost(downloadUrl.hostname)
    )
      throw new Error('SharePoint document download host is not approved')
    let bytes: Buffer
    try {
      const response = await fetcher(downloadUrl, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      })
      bytes = await readBytes(response, MAX_DOCUMENT_BYTES)
    } catch (error) {
      if (error instanceof Error && /size limit/.test(error.message))
        throw error
      throw new Error('SharePoint document content could not be downloaded', {
        cause: error,
      })
    }
    if (downloadedBytes + bytes.length > MAX_TOTAL_BYTES)
      throw new Error('SharePoint folder exceeds the 50 MiB download limit')
    downloadedBytes += bytes.length
    documents.push({
      sourceId: source.sourceId,
      itemId: item.id,
      name: item.name,
      extension,
      eTag: item.eTag ?? null,
      lastModifiedAt: item.lastModifiedDateTime
        ? new Date(item.lastModifiedDateTime).toISOString()
        : null,
      observedAt,
      sampleOnly: source.sampleOnly,
      content: bytes,
    })
  }

  const visit = async (folderId: string, depth: number): Promise<void> => {
    if (depth > MAX_FOLDER_DEPTH)
      throw new Error('SharePoint folder depth limit exceeded')
    const listPath = `/v1.0/drives/${encodeURIComponent(source.driveId)}/items/${encodeURIComponent(folderId)}/children`
    let listUrl = graphUrl(listPath)
    listUrl.searchParams.set('$top', '200')
    listUrl.searchParams.set(
      '$select',
      'id,name,size,eTag,lastModifiedDateTime,file,folder,remoteItem,parentReference',
    )
    const pages = new Set<string>()
    for (let pageCount = 0; ; pageCount++) {
      if (pageCount >= 20)
        throw new Error('SharePoint folder page limit exceeded')
      const page = z
        .object({
          value: z.array(itemSchema),
          '@odata.nextLink': z.string().url().optional(),
        })
        .parse(await graphJson(listUrl, token.token, fetcher))
      for (const item of page.value) {
        if (++listedItems > MAX_LIST_ITEMS)
          throw new Error('SharePoint folder item limit exceeded')
        verifyParent(item)
        const key = `${source.driveId}:${item.id}`
        if (visited.has(key))
          throw new Error('SharePoint folder contains duplicate item IDs')
        visited.add(key)
        if (item.folder) {
          if (source.includeSubfolders) await visit(item.id, depth + 1)
          continue
        }
        if (!item.file) continue
        const dot = item.name.lastIndexOf('.')
        const extension = dot >= 0 ? item.name.slice(dot).toLowerCase() : ''
        if (
          !source.allowedExtensions.includes(extension as '.docx' | '.xlsx')
        ) {
          skipped.push({
            itemId: item.id,
            name: item.name,
            reason: 'UnsupportedExtension',
          })
          continue
        }
        if (extension !== '.docx' && extension !== '.xlsx') continue
        await download(item, extension)
      }
      const next = page['@odata.nextLink']
      if (!next) break
      if (pages.has(next)) throw new Error('SharePoint folder pagination loop')
      pages.add(next)
      listUrl = validateNextLink(next, listPath)
    }
  }

  const rootUrl = graphUrl(
    `/v1.0/drives/${encodeURIComponent(source.driveId)}/items/${encodeURIComponent(source.folderItemId)}?$select=id,name,folder,parentReference,remoteItem`,
  )
  const root = itemSchema.parse(await graphJson(rootUrl, token.token, fetcher))
  if (root.id !== source.folderItemId || !root.folder)
    throw new Error('Configured SharePoint item is not a folder')
  verifyParent(root, true)
  await visit(root.id, 0)

  return {
    enumerationComplete: true,
    sourceId: source.sourceId,
    sampleOnly: source.sampleOnly,
    configurationVersion: source.configurationVersion,
    observedAt,
    documents,
    skipped,
  }
}

export async function persistSharePointFolderSnapshot(
  store: AzureStore,
  source: DocumentSource,
  result: SharePointFolderReadResult,
): Promise<{
  snapshotHash: string
  addedItemIds: string[]
  changedItemIds: string[]
  removedItemIds: string[]
  unchangedItemIds: string[]
}> {
  const parsedSource = documentSourceSchema.parse(source)
  if (
    result.enumerationComplete !== true ||
    result.sourceId !== parsedSource.sourceId ||
    result.sampleOnly !== parsedSource.sampleOnly ||
    result.configurationVersion !== parsedSource.configurationVersion
  )
    throw new Error('SharePoint result does not match source configuration')

  const documents = await Promise.all(
    result.documents.map(async (document) => {
      if (
        document.sourceId !== parsedSource.sourceId ||
        document.sampleOnly !== parsedSource.sampleOnly ||
        document.observedAt !== result.observedAt ||
        !parsedSource.allowedExtensions.includes(document.extension)
      )
        throw new Error('SharePoint document does not match its source')
      const contentHash = createHash('sha256')
        .update(document.content)
        .digest('hex')
      await store.putSharePointDocument(
        parsedSource.sourceId,
        contentHash,
        document.content,
      )
      return documentRevisionSchema.parse({
        sourceId: document.sourceId,
        itemId: document.itemId,
        name: document.name,
        extension: document.extension,
        eTag: document.eTag,
        lastModifiedAt: document.lastModifiedAt,
        contentHash,
        observedAt: document.observedAt,
        sampleOnly: document.sampleOnly,
      })
    }),
  )
  const snapshot = sharePointSnapshotSchema.parse({
    schemaVersion: '1',
    sourceId: parsedSource.sourceId,
    sampleOnly: parsedSource.sampleOnly,
    configurationVersion: parsedSource.configurationVersion,
    observedAt: result.observedAt,
    enumerationComplete: true,
    documents,
    skipped: result.skipped,
  }) as SharePointSnapshot
  const previous = await store.sharePointSnapshot(parsedSource.sourceId)
  const snapshotHash = await store.saveSharePointSnapshot(snapshot)
  const priorById = new Map(
    previous?.configurationVersion === snapshot.configurationVersion &&
      previous.sampleOnly === snapshot.sampleOnly
      ? previous.documents.map((document) => [document.itemId, document])
      : [],
  )
  const nextById = new Map(
    snapshot.documents.map((item) => [item.itemId, item]),
  )
  const addedItemIds: string[] = []
  const changedItemIds: string[] = []
  const unchangedItemIds: string[] = []
  for (const [itemId, document] of nextById) {
    const prior = priorById.get(itemId)
    if (!prior) addedItemIds.push(itemId)
    else if (prior.contentHash !== document.contentHash)
      changedItemIds.push(itemId)
    else unchangedItemIds.push(itemId)
  }
  const removedItemIds = [...priorById.keys()].filter(
    (itemId) => !nextById.has(itemId),
  )
  return {
    snapshotHash,
    addedItemIds,
    changedItemIds,
    removedItemIds,
    unchangedItemIds,
  }
}

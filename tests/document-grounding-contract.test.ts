import assert from 'node:assert/strict'
import test from 'node:test'
import { documentGroundingSchema, documentSourceSchema } from '@arp/contracts'

const revision = {
  sourceId: 'sample-folder',
  itemId: 'document-1',
  name: 'architecture.docx',
  extension: '.docx' as const,
  eTag: 'etag-1',
  lastModifiedAt: '2026-11-01T00:00:00.000Z',
  contentHash: 'a'.repeat(64),
  observedAt: '2026-11-02T00:00:00.000Z',
  sampleOnly: true,
}

const fact = {
  factId: 'fact-1',
  workloadId: 'sample-workload',
  kind: 'ResourceDependency' as const,
  statement: '受注処理が対象APIを利用する。',
  sourceId: revision.sourceId,
  documentItemId: revision.itemId,
  documentContentHash: revision.contentHash,
  locator: {
    heading: 'システム構成',
    table: '依存関係',
    row: 2,
    cell: 'B',
    page: null,
  },
  reviewStatus: 'Candidate' as const,
  sampleOnly: true,
}

test('document source supports multiple workload folders and limits file types', () => {
  const parsed = documentSourceSchema.parse({
    sourceId: 'sample-folder',
    tenantId: '11111111-1111-4111-8111-111111111111',
    siteId: 'site-id',
    driveId: 'drive-id',
    folderItemId: 'folder-id',
    displayName: 'Sample designs',
    workloadIds: ['sample-workload', 'sample-workload-2'],
    includeSubfolders: true,
    allowedExtensions: ['.docx', '.xlsx'],
    sampleOnly: true,
    configurationVersion: '1',
  })
  assert.equal(parsed.workloadIds.length, 2)
  assert.throws(() =>
    documentSourceSchema.parse({
      sourceId: 'sample-folder',
      tenantId: '11111111-1111-4111-8111-111111111111',
      siteId: 'site-id',
      driveId: 'drive-id',
      folderItemId: 'folder-id',
      displayName: 'Sample designs',
      workloadIds: ['sample-workload'],
      includeSubfolders: true,
      allowedExtensions: ['.pdf'],
      sampleOnly: true,
      configurationVersion: '1',
    }),
  )
})

test('document grounding requires every extracted fact to cite its exact revision', () => {
  const grounding = {
    schemaVersion: '1',
    workloadId: 'sample-workload',
    sampleOnly: true,
    sourceConfigurationVersion: '1',
    documentRevisions: [revision],
    facts: [fact],
    observedAt: '2026-11-02T00:00:00.000Z',
  }
  assert.equal(documentGroundingSchema.parse(grounding).facts.length, 1)
  assert.equal(
    documentGroundingSchema.safeParse({
      ...grounding,
      facts: [{ ...fact, documentContentHash: 'b'.repeat(64) }],
    }).success,
    false,
  )
  assert.equal(
    documentGroundingSchema.safeParse({
      ...grounding,
      sampleOnly: false,
    }).success,
    false,
  )
})

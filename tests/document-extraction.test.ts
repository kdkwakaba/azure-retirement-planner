import assert from 'node:assert/strict'
import test from 'node:test'
import { bindDocumentFactProposals, extractDocumentText } from '@arp/adapters'
import { documentFactProposalSchema, documentTextSchema } from '@arp/contracts'

const metadata = {
  sourceId: 'sample-folder',
  itemId: 'design-1',
  name: 'design.docx',
  extension: '.docx' as const,
  eTag: 'etag-1',
  lastModifiedAt: '2026-11-01T00:00:00.000Z',
  observedAt: '2026-11-02T00:00:00.000Z',
  sampleOnly: true,
}

test('document extraction refuses empty and oversized inputs before parsing', async () => {
  await assert.rejects(extractDocumentText(Buffer.alloc(0), metadata), /empty/)
  await assert.rejects(
    extractDocumentText(Buffer.alloc(10 * 1024 * 1024 + 1), metadata),
    /10 MiB/,
  )
})

test('document extraction rejects malformed spreadsheets', async () => {
  await assert.rejects(
    extractDocumentText(Buffer.from('not a workbook'), {
      ...metadata,
      name: 'design.xlsx',
      extension: '.xlsx',
    }),
  )
})

test('fact proposals inherit exact source and sample metadata from cited blocks', () => {
  const document = documentTextSchema.parse({
    schemaVersion: '1',
    revision: {
      ...metadata,
      contentHash: 'a'.repeat(64),
    },
    blocks: [
      {
        sourceId: metadata.sourceId,
        itemId: metadata.itemId,
        contentHash: 'a'.repeat(64),
        blockId: 'paragraph-1',
        kind: 'Paragraph',
        text: '本番受注処理が旧APIに依存する。',
        heading: null,
        sheet: null,
        row: null,
        cell: null,
        sampleOnly: true,
      },
    ],
  })
  const proposal = documentFactProposalSchema.parse({
    blockId: 'paragraph-1',
    kind: 'FeatureUsage',
    statement: '本番受注処理は旧APIを利用する。',
  })
  const facts = bindDocumentFactProposals({
    document,
    workloadId: 'sample-workload',
    proposals: [proposal],
  })
  assert.equal(facts[0]!.documentItemId, metadata.itemId)
  assert.equal(facts[0]!.documentContentHash, 'a'.repeat(64))
  assert.equal(facts[0]!.reviewStatus, 'Candidate')
  assert.equal(facts[0]!.sampleOnly, true)
  assert.equal(facts[0]!.locator.sheet, null)
  assert.equal(facts[0]!.locator.table, null)
  assert.throws(
    () =>
      bindDocumentFactProposals({
        document,
        workloadId: 'sample-workload',
        proposals: [{ ...proposal, blockId: 'invented-block' }],
      }),
    /unknown text block/,
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { extractDocumentText } from '@arp/adapters'

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

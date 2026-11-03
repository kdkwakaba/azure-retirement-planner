import { createHash } from 'node:crypto'
import mammoth from 'mammoth'
import readExcelFile from 'read-excel-file/node'
import {
  documentTextSchema,
  documentFactProposalSchema,
  type DocumentFact,
  type DocumentFactProposal,
  type DocumentRevision,
  type DocumentText,
} from '@arp/contracts'

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARACTERS = 200_000
const MAX_SPREADSHEET_CELLS = 20_000

export function bindDocumentFactProposals(input: {
  document: DocumentText
  workloadId: string
  proposals: DocumentFactProposal[]
}): DocumentFact[] {
  const { document, workloadId, proposals } = input
  const blocks = new Map(document.blocks.map((block) => [block.blockId, block]))
  const seen = new Set<string>()
  return proposals.map((rawProposal) => {
    const proposal = documentFactProposalSchema.parse(rawProposal)
    const block = blocks.get(proposal.blockId)
    if (!block)
      throw new Error('Document fact proposal references an unknown text block')
    const fingerprint = JSON.stringify([
      proposal.blockId,
      proposal.kind,
      proposal.statement,
      workloadId,
    ])
    if (seen.has(fingerprint))
      throw new Error('Document fact proposal is duplicated')
    seen.add(fingerprint)
    const locator = {
      heading: block.heading,
      sheet: block.sheet,
      table: null,
      row: block.row,
      cell: block.cell,
      page: null,
    }
    const factId = createHash('sha256')
      .update(
        JSON.stringify({
          sourceId: block.sourceId,
          itemId: block.itemId,
          contentHash: block.contentHash,
          locator,
          kind: proposal.kind,
          statement: proposal.statement,
          workloadId,
        }),
      )
      .digest('hex')
    return {
      factId,
      workloadId,
      kind: proposal.kind,
      statement: proposal.statement,
      sourceId: block.sourceId,
      documentItemId: block.itemId,
      documentContentHash: block.contentHash,
      locator,
      reviewStatus: 'Candidate',
      sampleOnly: block.sampleOnly,
    }
  })
}

function columnName(index: number): string {
  let result = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(((value - 1) % 26) + 65) + result
  return result
}

export async function extractDocumentText(
  content: Buffer,
  metadata: Omit<DocumentRevision, 'contentHash' | 'observedAt'> & {
    observedAt: string
  },
): Promise<DocumentText> {
  if (!content.length || content.length > MAX_DOCUMENT_BYTES)
    throw new Error('Document size is empty or exceeds the 10 MiB limit')
  const revision: DocumentRevision = {
    ...metadata,
    contentHash: createHash('sha256').update(content).digest('hex'),
  }
  const blocks: DocumentText['blocks'] = []
  if (revision.extension === '.docx') {
    const extracted = await mammoth.extractRawText({ buffer: content })
    if (extracted.messages.some((message) => message.type === 'error'))
      throw new Error('DOCX contains an extraction error')
    const paragraphs = extracted.value
      .split(/\r?\n\s*\r?\n/)
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    let total = 0
    paragraphs.forEach((text, index) => {
      total += text.length
      if (total > MAX_TEXT_CHARACTERS)
        throw new Error('Extracted document text exceeds the limit')
      blocks.push({
        sourceId: revision.sourceId,
        itemId: revision.itemId,
        contentHash: revision.contentHash,
        blockId: `paragraph-${index + 1}`,
        kind: 'Paragraph',
        text,
        heading: null,
        sheet: null,
        row: null,
        cell: null,
        sampleOnly: revision.sampleOnly,
      })
    })
  } else {
    const sheets = await readExcelFile(content)
    let cellCount = 0
    let total = 0
    for (const sheet of sheets) {
      for (const [rowIndex, row] of sheet.data.entries()) {
        for (const [columnIndex, value] of row.entries()) {
          if (value === null || value === undefined || value === '') continue
          if (++cellCount > MAX_SPREADSHEET_CELLS)
            throw new Error('Spreadsheet cell count exceeds the limit')
          const text =
            value instanceof Date ? value.toISOString() : String(value)
          if (!text.trim()) continue
          total += text.length
          if (total > MAX_TEXT_CHARACTERS)
            throw new Error('Extracted document text exceeds the limit')
          const cell = `${columnName(columnIndex)}${rowIndex + 1}`
          blocks.push({
            sourceId: revision.sourceId,
            itemId: revision.itemId,
            contentHash: revision.contentHash,
            blockId: `${sheet.sheet}:${cell}`,
            kind: 'SpreadsheetCell',
            text: text.trim(),
            heading: null,
            sheet: sheet.sheet,
            row: rowIndex + 1,
            cell,
            sampleOnly: revision.sampleOnly,
          })
        }
      }
    }
  }
  return documentTextSchema.parse({ schemaVersion: '1', revision, blocks })
}

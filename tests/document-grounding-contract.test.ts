import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessmentSchema,
  documentGroundingSchema,
  documentSourceSchema,
} from '@arp/contracts'
import {
  confirmedDocumentFactEvidence,
  confirmedDocumentGroundingInputHash,
} from '@arp/adapters'
import { packageHash } from '@arp/domain'
import { fixture } from './fixtures.ts'

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

test('only human-confirmed facts from live grounding become assessment evidence', () => {
  const grounding = documentGroundingSchema.parse({
    schemaVersion: '1',
    workloadId: 'sample-workload',
    sampleOnly: false,
    sourceConfigurationVersion: '1',
    documentRevisions: [{ ...revision, sampleOnly: false }],
    facts: [
      { ...fact, sampleOnly: false, reviewStatus: 'Candidate' },
      {
        ...fact,
        factId: 'fact-confirmed',
        sampleOnly: false,
        reviewStatus: 'Confirmed',
        reviewedBy: 'governance-user',
        reviewedAt: '2026-11-03T00:00:00.000Z',
      },
      {
        ...fact,
        factId: 'legacy-confirmed-without-audit',
        sampleOnly: false,
        reviewStatus: 'Confirmed',
      },
    ],
    observedAt: '2026-11-02T00:00:00.000Z',
  })
  const evidence = confirmedDocumentFactEvidence(grounding)
  assert.equal(evidence.length, 1)
  assert.match(evidence[0]!.fact, /受注処理が対象APIを利用する/)
  assert.match(evidence[0]!.fact, /architecture.docx/)
  assert.deepEqual(evidence[0]!.subjectIds, ['sample-workload'])
  assert.throws(
    () =>
      confirmedDocumentFactEvidence({
        ...grounding,
        sampleOnly: true,
        documentRevisions: grounding.documentRevisions.map((item) => ({
          ...item,
          sampleOnly: true,
        })),
        facts: grounding.facts.map((item) => ({ ...item, sampleOnly: true })),
      }),
    /Sample document grounding/,
  )
})

test('confirmed document grounding hash ignores retrieval time and unconfirmed candidates', () => {
  const grounding = documentGroundingSchema.parse({
    schemaVersion: '1',
    workloadId: 'sample-workload',
    sampleOnly: false,
    sourceConfigurationVersion: '1',
    documentRevisions: [{ ...revision, sampleOnly: false }],
    facts: [{ ...fact, sampleOnly: false }],
    observedAt: '2026-11-02T00:00:00.000Z',
  })
  const originalHash = confirmedDocumentGroundingInputHash(grounding)
  assert.equal(
    confirmedDocumentGroundingInputHash({
      ...grounding,
      observedAt: '2026-11-03T00:00:00.000Z',
      documentRevisions: grounding.documentRevisions.map((item) => ({
        ...item,
        observedAt: '2026-11-03T00:00:00.000Z',
      })),
    }),
    originalHash,
  )
  assert.equal(
    confirmedDocumentGroundingInputHash({
      ...grounding,
      facts: grounding.facts.map((item) => ({
        ...item,
        statement: '別の未確認候補',
      })),
    }),
    originalHash,
  )
  assert.notEqual(
    confirmedDocumentGroundingInputHash({
      ...grounding,
      facts: grounding.facts.map((item) => ({
        ...item,
        reviewStatus: 'Confirmed',
        reviewedBy: 'governance-user',
        reviewedAt: '2026-11-03T00:00:00.000Z',
      })),
    }),
    originalHash,
  )
})

test('Assessment records confirmed document grounding hash compatibly and includes it in approval hash', () => {
  const legacy = fixture()
  assert.equal(assessmentSchema.parse(legacy).documentGroundingHash, undefined)
  const withGrounding = {
    ...legacy,
    documentGroundingHash: 'f'.repeat(64),
    packageHash: '',
  }
  withGrounding.packageHash = packageHash(withGrounding)
  assert.equal(
    assessmentSchema.parse(withGrounding).documentGroundingHash,
    'f'.repeat(64),
  )
  assert.notEqual(withGrounding.packageHash, legacy.packageHash)
})

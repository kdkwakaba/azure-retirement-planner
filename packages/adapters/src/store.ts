import { BlobServiceClient } from '@azure/storage-blob'
import { TableClient, type TransactionAction } from '@azure/data-tables'
import { QueueServiceClient } from '@azure/storage-queue'
import type { Assessment, Approval } from '@arp/contracts'
import { assessmentSchema, approvalSchema } from '@arp/contracts'
import { hash, verifyApproval } from '@arp/domain'
import { credential } from './azure.ts'

export interface Head {
  partitionKey: string
  rowKey: string
  etag?: string
  assessmentId: string
  packageHash: string
  entityKind: string
}
export class AzureStore {
  blobs: BlobServiceClient
  table: TableClient
  queues: QueueServiceClient
  constructor(account: string) {
    if (!/^[a-z0-9]{3,24}$/.test(account))
      throw new Error('Invalid storage account')
    this.blobs = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      credential,
    )
    this.table = new TableClient(
      `https://${account}.table.core.windows.net`,
      'ArpState',
      credential,
    )
    this.queues = new QueueServiceClient(
      `https://${account}.queue.core.windows.net`,
      credential,
    )
  }
  async put(collection: string, id: string, value: unknown): Promise<void> {
    if (!/^[a-z-]+$/.test(collection) || !/^[a-f0-9]{64}$/.test(id))
      throw new Error('Invalid object key')
    const text = JSON.stringify(value)
    const blob = this.blobs
      .getContainerClient('records')
      .getBlockBlobClient(`${collection}/${id}.json`)
    try {
      await blob.upload(text, Buffer.byteLength(text), {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/json' },
      })
    } catch (error) {
      if (
        (error as { statusCode?: number }).statusCode !== 409 &&
        (error as { statusCode?: number }).statusCode !== 412
      )
        throw error
    }
  }
  async get<T>(collection: string, id: string): Promise<T> {
    if (!/^[a-z-]+$/.test(collection) || !/^[a-f0-9]{64}$/.test(id))
      throw new Error('Invalid object key')
    const content = await this.blobs
      .getContainerClient('records')
      .getBlobClient(`${collection}/${id}.json`)
      .downloadToBuffer(0, undefined, { conditions: {} })
    if (content.length > 8_000_000) throw new Error('Stored record too large')
    return JSON.parse(content.toString('utf8')) as T
  }
  async assessment(id: string): Promise<Assessment> {
    return assessmentSchema.parse(await this.get('assessments', id))
  }
  async head(logicalId: string): Promise<Head | null> {
    try {
      return await this.table.getEntity<Head>('assessment:' + logicalId, 'head')
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null
      throw e
    }
  }
  async list(): Promise<Assessment[]> {
    const results: Assessment[] = []
    for await (const entity of this.table.listEntities<Head>({
      queryOptions: { filter: "entityKind eq 'head'" },
    })) {
      results.push(await this.assessment(entity.assessmentId))
      if (results.length >= 100) break
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async commitAssessment(
    assessment: Assessment,
    prior: Head | null,
  ): Promise<void> {
    await this.put('assessments', assessment.id, assessment)
    const partitionKey =
      'assessment:' +
      hash({ eventId: assessment.event.id, workloadId: assessment.workloadId })
    const entity = {
      partitionKey,
      rowKey: 'head',
      entityKind: 'head',
      assessmentId: assessment.id,
      packageHash: assessment.packageHash,
    }
    if (prior)
      await this.table.updateEntity(entity, 'Replace', { etag: prior.etag })
    else await this.table.createEntity(entity)
  }
  async approve(assessment: Assessment, approval: Approval): Promise<void> {
    approvalSchema.parse(approval)
    if (
      new Set(approval.approvedItemIds).size !==
        approval.approvedItemIds.length ||
      approval.approvedItemIds.length > 50
    )
      throw new Error('Invalid approval selection')
    for (const id of approval.approvedItemIds)
      verifyApproval(assessment, approval, id)
    const logicalId = hash({
      eventId: assessment.event.id,
      workloadId: assessment.workloadId,
    })
    const current = await this.head(logicalId)
    if (
      !current ||
      current.assessmentId !== assessment.id ||
      current.packageHash !== approval.packageHash
    )
      throw new Error('Stale approval')
    await this.put('approvals', approval.id, approval)
    const outboxActions: TransactionAction[] = []
    for (const itemId of approval.approvedItemIds) {
      const rowKey = 'outbox:' + itemId
      let existing: Record<string, unknown> | null = null
      try {
        existing = await this.table.getEntity(
          current.partitionKey,
          rowKey,
        )
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('statusCode' in error) ||
          error.statusCode !== 404
        )
          throw error
      }
      const entity = {
        partitionKey: current.partitionKey,
        rowKey,
        entityKind: 'outbox',
        state: 'Pending',
        approvalId: approval.id,
        assessmentId: assessment.id,
        itemId,
        ...(typeof existing?.issueId === 'string'
          ? { issueId: existing.issueId }
          : {}),
        ...(typeof existing?.projectItemId === 'string'
          ? { projectItemId: existing.projectItemId }
          : {}),
        ...(typeof existing?.managedContentHash === 'string'
          ? { managedContentHash: existing.managedContentHash }
          : {}),
      }
      outboxActions.push(
        existing
          ? [
              'update',
              entity,
              'Replace',
              { etag: existing.etag as string },
            ]
          : ['create', entity],
      )
    }
    await this.table.submitTransaction([
      [
        'update',
        {
          partitionKey: current.partitionKey,
          rowKey: 'head',
          assessmentId: current.assessmentId,
          packageHash: current.packageHash,
          entityKind: 'head',
          lastReviewId: approval.id,
        },
        'Replace',
        { etag: current.etag },
      ],
      [
        'create',
        {
          partitionKey: current.partitionKey,
          rowKey: 'review:' + approval.id,
          entityKind: 'review',
          approvalId: approval.id,
        },
      ],
      ...outboxActions,
    ])
  }
  async dispatchOutbox(): Promise<void> {
    for await (const row of this.table.listEntities({
      queryOptions: { filter: "entityKind eq 'outbox' and state eq 'Pending'" },
    })) {
      if (!row.partitionKey || !row.rowKey)
        throw new Error('Outbox key missing')
      const payload = {
        partitionKey: row.partitionKey,
        rowKey: row.rowKey,
        approvalId: row.approvalId,
        assessmentId: row.assessmentId,
        itemId: row.itemId,
      }
      await this.queues
        .getQueueClient('exports')
        .sendMessage(Buffer.from(JSON.stringify(payload)).toString('base64'))
      // Queuedでも再配送可能。外部Worker側で相関IDとETagにより二重登録を防ぐ。
      await this.table.updateEntity(
        { ...payload, entityKind: 'outbox', state: 'Queued' },
        'Merge',
        { etag: row.etag },
      )
    }
  }
  async receiveNotice(raw: unknown): Promise<string> {
    const id = hash(raw)
    await this.put('receipts', id, raw)
    try {
      await this.table.createEntity({
        partitionKey: 'ingestion',
        rowKey: id,
        entityKind: 'receipt',
        state: 'Pending',
      })
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 409) throw e
    }
    return id
  }
  async dispatchReceipts(): Promise<void> {
    for await (const row of this.table.listEntities({
      queryOptions: {
        filter:
          "PartitionKey eq 'ingestion' and entityKind eq 'receipt' and state eq 'Pending'",
      },
    })) {
      if (!row.rowKey) throw new Error('Receipt key missing')
      await this.queues
        .getQueueClient('assessments')
        .sendMessage(
          Buffer.from(
            JSON.stringify({ kind: 'sync', receiptId: row.rowKey }),
          ).toString('base64'),
        )
      await this.table.updateEntity(
        { partitionKey: 'ingestion', rowKey: row.rowKey, state: 'Queued' },
        'Merge',
        { etag: row.etag },
      )
    }
  }
  async reserveModelCall(limit: number): Promise<void> {
    if (limit <= 0) throw new Error('Model calls disabled by budget setting')
    const partitionKey = 'budget:' + new Date().toISOString().slice(0, 10),
      rowKey = 'model-calls'
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        let previous: { calls: number; etag?: string } | null = null
        try {
          previous = await this.table.getEntity<{ calls: number }>(
            partitionKey,
            rowKey,
          )
        } catch (e) {
          if ((e as { statusCode?: number }).statusCode !== 404) throw e
        }
        if ((previous?.calls ?? 0) >= limit)
          throw new Error('Daily model call limit reached')
        const entity = {
          partitionKey,
          rowKey,
          calls: (previous?.calls ?? 0) + 1,
        }
        if (previous)
          await this.table.updateEntity(entity, 'Replace', {
            etag: previous.etag,
          })
        else await this.table.createEntity(entity)
        return
      } catch (e) {
        if (![409, 412].includes((e as { statusCode: number }).statusCode))
          throw e
      }
    }
    throw new Error('Budget reservation conflict')
  }
}

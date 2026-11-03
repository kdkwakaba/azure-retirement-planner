import { BlobServiceClient } from '@azure/storage-blob'
import { TableClient, type TransactionAction } from '@azure/data-tables'
import { QueueServiceClient } from '@azure/storage-queue'
import type {
  Assessment,
  Approval,
  BusinessContext,
  DecisionReevaluationRun,
} from '@arp/contracts'
import {
  assessmentSchema,
  approvalSchema,
  decisionReevaluationRunSchema,
  businessContextSchema,
} from '@arp/contracts'
import { hash, verifyApproval } from '@arp/domain'
import { credential } from './azure.ts'
import { safeModelResponseDiagnostics } from './models.ts'
import {
  type GitHubIssueReference,
  type GitHubIssueGroupInput,
  GitHubClient,
  parentIssueInput,
  parentIssueKey,
  phaseIssueInput,
} from './github.ts'

export interface Head {
  partitionKey: string
  rowKey: string
  etag?: string
  assessmentId: string
  packageHash: string
  entityKind: string
  disposition?: 'Active' | 'NoAction'
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
  async modelResponseDiagnostics(
    assessmentId: string,
    stage: 'Decision' | 'Explanation',
  ) {
    const blob = hash({ id: assessmentId, stage: stage.toLowerCase() })
    return safeModelResponseDiagnostics(await this.get('model-raw', blob))
  }
  async businessContext(workloadId: string): Promise<BusinessContext | null> {
    try {
      const entity = await this.table.getEntity<Record<string, unknown>>(
        'business-context',
        hash(workloadId),
      )
      if (typeof entity.contextHash !== 'string')
        throw new Error('Business context revision is missing')
      return businessContextSchema.parse(
        await this.get('business-context', entity.contextHash),
      )
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return null
      throw error
    }
  }
  async saveBusinessContext(value: BusinessContext): Promise<void> {
    const context = businessContextSchema.parse(value)
    const contextHash = hash(context)
    await this.put('business-context', contextHash, context)
    await this.table.upsertEntity(
      {
        partitionKey: 'business-context',
        rowKey: hash(context.workloadId),
        entityKind: 'business-context',
        contextHash,
      },
      'Replace',
    )
  }
  async createDecisionReevaluation(
    run: DecisionReevaluationRun,
  ): Promise<DecisionReevaluationRun> {
    decisionReevaluationRunSchema.parse(run)
    const { resultAssessmentId, error: runError, ...persistedRun } = run
    const entity = {
      partitionKey: 'decision-reevaluation',
      rowKey: run.runId,
      entityKind: 'decision-reevaluation',
      ...persistedRun,
      ...(resultAssessmentId ? { resultAssessmentId } : {}),
      ...(runError ? { error: runError } : {}),
    }
    try {
      await this.table.createEntity(entity)
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) throw error
      const existing = await this.decisionReevaluation(run.runId)
      if (
        existing.assessmentId !== run.assessmentId ||
        existing.requestedBy !== run.requestedBy ||
        existing.reason !== run.reason
      )
        throw new Error('Reevaluation run ID conflict', { cause: error })
      return existing
    }
    const lockKey = 'active:' + run.assessmentId
    try {
      await this.table.createEntity({
        partitionKey: 'decision-reevaluation',
        rowKey: lockKey,
        entityKind: 'decision-reevaluation-lock',
        runId: run.runId,
        assessmentId: run.assessmentId,
      })
      return run
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 409) {
        await this.table.deleteEntity('decision-reevaluation', run.runId)
        throw error
      }
      const active = await this.table.getEntity<Record<string, unknown>>(
        'decision-reevaluation',
        lockKey,
      )
      const activeRunId = typeof active.runId === 'string' ? active.runId : null
      if (activeRunId) {
        const activeRun = await this.decisionReevaluation(activeRunId)
        if (!['Completed', 'Failed'].includes(activeRun.state)) {
          await this.table.deleteEntity('decision-reevaluation', run.runId)
          return activeRun
        }
      }
      try {
        await this.table.deleteEntity('decision-reevaluation', lockKey, {
          etag: active.etag as string,
        })
        await this.table.createEntity({
          partitionKey: 'decision-reevaluation',
          rowKey: lockKey,
          entityKind: 'decision-reevaluation-lock',
          runId: run.runId,
          assessmentId: run.assessmentId,
        })
      } catch (retryError) {
        if (
          ![409, 412].includes(
            (retryError as { statusCode?: number }).statusCode ?? 0,
          )
        )
          throw retryError
        await this.table.deleteEntity('decision-reevaluation', run.runId)
        const currentLock = await this.table.getEntity<Record<string, unknown>>(
          'decision-reevaluation',
          lockKey,
        )
        if (typeof currentLock.runId !== 'string') throw retryError
        return this.decisionReevaluation(currentLock.runId)
      }
      return run
    }
  }
  async decisionReevaluation(runId: string): Promise<DecisionReevaluationRun> {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Invalid run ID')
    const row = await this.table.getEntity<Record<string, unknown>>(
      'decision-reevaluation',
      runId,
    )
    return decisionReevaluationRunSchema.parse({
      runId: row.runId,
      assessmentId: row.assessmentId,
      state: row.state,
      requestedBy: row.requestedBy,
      requestedAt: row.requestedAt,
      reason: row.reason,
      resultAssessmentId: row.resultAssessmentId ?? null,
      error: row.error ?? null,
      updatedAt: row.updatedAt,
    })
  }
  async dispatchDecisionReevaluations(): Promise<void> {
    for await (const row of this.table.listEntities<Record<string, unknown>>({
      queryOptions: {
        filter:
          "PartitionKey eq 'decision-reevaluation' and entityKind eq 'decision-reevaluation' and state eq 'Pending'",
      },
    })) {
      if (typeof row.rowKey !== 'string')
        throw new Error('Reevaluation key missing')
      try {
        await this.table.updateEntity(
          {
            partitionKey: 'decision-reevaluation',
            rowKey: row.rowKey,
            entityKind: 'decision-reevaluation',
            state: 'Queued',
            updatedAt: new Date().toISOString(),
          },
          'Merge',
          { etag: row.etag as string },
        )
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 412) continue
        throw error
      }
      try {
        await this.queues.getQueueClient('assessments').sendMessage(
          Buffer.from(
            JSON.stringify({
              kind: 'decision-reevaluation',
              runId: row.rowKey,
            }),
          ).toString('base64'),
        )
      } catch (error) {
        try {
          const queued = await this.table.getEntity<Record<string, unknown>>(
            'decision-reevaluation',
            row.rowKey,
          )
          if (queued.state === 'Queued')
            await this.table.updateEntity(
              {
                partitionKey: 'decision-reevaluation',
                rowKey: row.rowKey,
                entityKind: 'decision-reevaluation',
                state: 'Pending',
                updatedAt: new Date().toISOString(),
              },
              'Merge',
              { etag: queued.etag as string },
            )
        } catch (restoreError) {
          if ((restoreError as { statusCode?: number }).statusCode !== 412)
            throw restoreError
        }
        throw error
      }
    }
  }
  async recoverStaleDecisionReevaluations(): Promise<void> {
    const cutoff = Date.now() - 20 * 60_000
    for await (const row of this.table.listEntities<Record<string, unknown>>({
      queryOptions: {
        filter:
          "PartitionKey eq 'decision-reevaluation' and entityKind eq 'decision-reevaluation' and state eq 'Processing'",
      },
    })) {
      const updatedAt =
        typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN
      if (
        typeof row.rowKey === 'string' &&
        Number.isFinite(updatedAt) &&
        updatedAt < cutoff
      )
        await this.finishDecisionReevaluation(
          row.rowKey,
          'Failed',
          null,
          'ProcessingFailed',
        )
    }
  }
  async claimDecisionReevaluation(
    runId: string,
  ): Promise<DecisionReevaluationRun | null> {
    const row = await this.table.getEntity<Record<string, unknown>>(
      'decision-reevaluation',
      runId,
    )
    if (row.state === 'Processing') {
      const updatedAt =
        typeof row.updatedAt === 'string' ? Date.parse(row.updatedAt) : NaN
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 20 * 60_000) {
        await this.finishDecisionReevaluation(
          runId,
          'Failed',
          null,
          'ProcessingFailed',
        )
      }
      return null
    }
    if (row.state !== 'Queued') return null
    try {
      await this.table.updateEntity(
        {
          partitionKey: 'decision-reevaluation',
          rowKey: runId,
          entityKind: 'decision-reevaluation',
          state: 'Processing',
          updatedAt: new Date().toISOString(),
        },
        'Merge',
        { etag: row.etag as string },
      )
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 412) return null
      throw error
    }
    return this.decisionReevaluation(runId)
  }
  async finishDecisionReevaluation(
    runId: string,
    state: 'Completed' | 'Failed',
    resultAssessmentId: string | null,
    error: DecisionReevaluationRun['error'],
  ): Promise<void> {
    await this.table.updateEntity(
      {
        partitionKey: 'decision-reevaluation',
        rowKey: runId,
        entityKind: 'decision-reevaluation',
        state,
        ...(resultAssessmentId ? { resultAssessmentId } : {}),
        ...(error ? { error } : {}),
        updatedAt: new Date().toISOString(),
      },
      'Merge',
    )
    const lockKey =
      'active:' + (await this.decisionReevaluation(runId)).assessmentId
    try {
      const lock = await this.table.getEntity<Record<string, unknown>>(
        'decision-reevaluation',
        lockKey,
      )
      if (lock.runId === runId)
        await this.table.deleteEntity('decision-reevaluation', lockKey, {
          etag: lock.etag as string,
        })
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error
    }
  }
  async head(logicalId: string): Promise<Head | null> {
    try {
      return await this.table.getEntity<Head>('assessment:' + logicalId, 'head')
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null
      throw e
    }
  }
  async ensureParentIssue(
    github: GitHubClient,
    assessment: Assessment,
  ): Promise<GitHubIssueReference> {
    const input = parentIssueInput(assessment)
    return this.ensureManagedIssueRecord(
      github,
      assessment,
      'parent-issue:' + parentIssueKey(assessment),
      input,
    )
  }
  async ensurePhaseIssue(
    github: GitHubClient,
    assessment: Assessment,
    item: import('@arp/contracts').WorkItem,
  ): Promise<GitHubIssueReference> {
    const input = phaseIssueInput(assessment, item)
    const key = hash(input.marker)
    return this.ensureManagedIssueRecord(
      github,
      assessment,
      'phase-issue:' + key,
      input,
    )
  }
  private async ensureManagedIssueRecord(
    github: GitHubClient,
    assessment: Assessment,
    rowKey: string,
    input: GitHubIssueGroupInput,
  ): Promise<GitHubIssueReference> {
    const partitionKey =
      'assessment:' +
      hash({ eventId: assessment.event.id, workloadId: assessment.workloadId })
    const markerId = input.marker
    let row: Record<string, unknown>
    try {
      row = await this.table.getEntity(partitionKey, rowKey)
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error
      try {
        await this.table.createEntity({
          partitionKey,
          rowKey,
          entityKind: 'parent-issue-outbox',
          state: 'Pending',
          markerId,
        })
      } catch (createError) {
        if ((createError as { statusCode?: number }).statusCode !== 409)
          throw createError
      }
      row = await this.table.getEntity(partitionKey, rowKey)
    }
    const savedReference = (): GitHubIssueReference | null => {
      if (
        typeof row.issueId !== 'string' ||
        typeof row.databaseId !== 'number' ||
        typeof row.issueNumber !== 'number' ||
        typeof row.issueUrl !== 'string'
      )
        return null
      return {
        id: row.issueId,
        databaseId: row.databaseId,
        number: row.issueNumber,
        url: row.issueUrl,
      }
    }
    const save = async (reference: GitHubIssueReference) => {
      await this.table.updateEntity(
        {
          partitionKey,
          rowKey,
          entityKind: 'parent-issue-outbox',
          state: 'IssueCreated',
          markerId,
          issueId: reference.id,
          databaseId: reference.databaseId,
          issueNumber: reference.number,
          issueUrl: reference.url,
        },
        'Merge',
      )
    }
    if (row.state === 'IssueCreated') {
      const reference = savedReference()
      if (!reference)
        throw new Error('Saved grouping Issue reference is incomplete')
      return reference
    }
    if (row.state === 'Sending') {
      const recovered = await github.findGroupIssue(markerId)
      if (!recovered)
        throw new Error(
          'Ambiguous grouping Issue creation; manual reconciliation required',
        )
      await save(recovered)
      return recovered
    }
    if (row.state !== 'Pending')
      throw new Error('Grouping Issue outbox state is invalid')
    await this.table.updateEntity(
      {
        partitionKey,
        rowKey,
        entityKind: 'parent-issue-outbox',
        state: 'Sending',
        markerId,
      },
      'Merge',
      { etag: row.etag as string },
    )
    const found = await github.findGroupIssue(markerId)
    const reference = found ?? (await github.createGroupIssue(input))
    await save(reference)
    return reference
  }
  async list(includeNoAction = false): Promise<Assessment[]> {
    const results: Assessment[] = []
    for await (const entity of this.table.listEntities<Head>({
      queryOptions: { filter: "entityKind eq 'head'" },
    })) {
      if (!includeNoAction && entity.disposition === 'NoAction') continue
      results.push({
        ...(await this.assessment(entity.assessmentId)),
        reviewDisposition:
          entity.disposition === 'NoAction' ? 'NoAction' : 'Active',
      })
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
      disposition: 'Active',
    }
    if (prior)
      await this.table.updateEntity(entity, 'Replace', { etag: prior.etag })
    else await this.table.createEntity(entity)
  }
  async approve(
    assessment: Assessment,
    approval: Approval,
    suppressExternalOutbox = false,
  ): Promise<void> {
    const suppressOutbox =
      suppressExternalOutbox || assessment.reevaluation !== undefined
    approvalSchema.parse(approval)
    if (
      new Set(approval.approvedItemIds).size !==
        approval.approvedItemIds.length ||
      approval.approvedItemIds.length > 50
    )
      throw new Error('Invalid approval selection')
    if (
      approval.result === 'NoAction' &&
      (approval.approvedItemIds.length > 0 || !approval.reason.trim())
    )
      throw new Error(
        'No-action review requires a reason and no approved items',
      )
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
    if (!suppressOutbox) {
      for (const itemId of approval.approvedItemIds) {
        const rowKey = 'outbox:' + itemId
        let existing: Record<string, unknown> | null = null
        try {
          existing = await this.table.getEntity(current.partitionKey, rowKey)
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
            ? ['update', entity, 'Replace', { etag: existing.etag as string }]
            : ['create', entity],
        )
      }
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
          disposition: approval.result === 'NoAction' ? 'NoAction' : 'Active',
          ...(approval.result === 'NoAction'
            ? { noActionAt: approval.reviewedAt }
            : {}),
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
  async recordProjectProgress(
    progress: Array<{
      projectItemId: string
      statusName: string | null
      statusOptionId: string | null
    }>,
  ): Promise<number> {
    const byProjectItemId = new Map(
      progress.map((item) => [item.projectItemId, item]),
    )
    let updated = 0
    for await (const row of this.table.listEntities({
      queryOptions: { filter: "entityKind eq 'outbox'" },
    })) {
      if (
        !row.partitionKey ||
        !row.rowKey ||
        typeof row.projectItemId !== 'string'
      )
        continue
      const current = byProjectItemId.get(row.projectItemId)
      if (!current) continue
      const syncedAt = new Date().toISOString()
      if (
        row.externalStatus === current.statusName &&
        row.externalStatusOptionId === current.statusOptionId
      )
        continue
      await this.table.updateEntity(
        {
          partitionKey: row.partitionKey,
          rowKey: row.rowKey,
          externalStatus: current.statusName,
          externalStatusOptionId: current.statusOptionId,
          externalStatusSyncedAt: syncedAt,
        },
        'Merge',
        { etag: row.etag },
      )
      updated++
    }
    return updated
  }
  async projectProgress(): Promise<
    Array<{
      workItemId: string
      status: string | null
      statusOptionId: string | null
      syncedAt: string
    }>
  > {
    const progress: Array<{
      workItemId: string
      status: string | null
      statusOptionId: string | null
      syncedAt: string
    }> = []
    for await (const row of this.table.listEntities({
      queryOptions: { filter: "entityKind eq 'outbox'" },
    })) {
      if (
        typeof row.rowKey !== 'string' ||
        !row.rowKey.startsWith('outbox:') ||
        typeof row.externalStatusSyncedAt !== 'string'
      )
        continue
      progress.push({
        workItemId: row.rowKey.slice('outbox:'.length),
        status:
          typeof row.externalStatus === 'string' ? row.externalStatus : null,
        statusOptionId:
          typeof row.externalStatusOptionId === 'string'
            ? row.externalStatusOptionId
            : null,
        syncedAt: row.externalStatusSyncedAt,
      })
    }
    return progress
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

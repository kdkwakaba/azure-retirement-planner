import { app } from '@azure/functions'
import { z } from 'zod'
import { approvalSchema, type Approval } from '@arp/contracts'
import { verifyApproval } from '@arp/domain'
import { AzureStore, GitHubClient, required } from '@arp/adapters'

app.storageQueue('export', {
  queueName: 'exports',
  connection: 'DATA_QUEUE',
  handler: async (raw) => {
    if (process.env.EXPORT_ENABLED !== 'true')
      throw new Error('Export disabled; preserve queue work')
    const message = z
      .object({
        partitionKey: z.string(),
        rowKey: z.string(),
        approvalId: z.string(),
        assessmentId: z.string(),
        itemId: z.string(),
      })
      .parse(raw)
    const store = new AzureStore(required('DATA_STORAGE_ACCOUNT'))
    const assessment = await store.assessment(message.assessmentId)
    const approval = approvalSchema.parse(
      await store.get<Approval>('approvals', message.approvalId),
    )
    verifyApproval(assessment, approval, message.itemId)
    const head = await store.table.getEntity(message.partitionKey, 'head')
    if (
      head.assessmentId !== assessment.id ||
      head.packageHash !== approval.packageHash
    )
      throw new Error('Assessment changed since approval')
    const item = assessment.workItems.find((w) => w.id === message.itemId)!
    const row = await store.table.getEntity(
      message.partitionKey,
      message.rowKey,
    )
    if (!row.partitionKey || !row.rowKey) throw new Error('Outbox key missing')
    if (row.state === 'Exported') return
    const github = new GitHubClient(
      required('GITHUB_OWNER'),
      required('GITHUB_REPOSITORY'),
      required('GITHUB_TOKEN'),
    )
    // POST成否不明は再作成せず隔離。Project段階だけ失敗した場合は保存Issue IDから再開する。
    if (row.state === 'Sending')
      throw new Error(
        'Ambiguous external creation; operator reconciliation required',
      )
    let issueId = typeof row.issueId === 'string' ? row.issueId : null
    if (!issueId) {
      const found = await github.find(item.id)
      if (found) issueId = found.id
      else {
        await store.table.updateEntity(
          {
            ...row,
            partitionKey: message.partitionKey,
            rowKey: message.rowKey,
            state: 'Sending',
          },
          'Merge',
          { etag: row.etag },
        )
        const created = await github.create(item)
        issueId = created.id
      }
      await store.table.updateEntity(
        {
          partitionKey: row.partitionKey,
          rowKey: row.rowKey,
          state: 'IssueCreated',
          issueId,
        },
        'Merge',
      )
    }
    const projectItemId = await github.addToProject(
      required('GITHUB_PROJECT_ID'),
      issueId,
    )
    await store.table.updateEntity(
      {
        partitionKey: row.partitionKey,
        rowKey: row.rowKey,
        state: 'Exported',
        issueId,
        projectItemId,
      },
      'Merge',
    )
  },
})

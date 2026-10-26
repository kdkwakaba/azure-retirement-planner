import { app } from '@azure/functions'
import { z } from 'zod'
import { approvalSchema, type Approval } from '@arp/contracts'
import { verifyApproval } from '@arp/domain'
import {
  AzureStore,
  ensureIssueForExport,
  GitHubClient,
  required,
  withProcessingFailureLog,
} from '@arp/adapters'

app.storageQueue('export', {
  queueName: 'exports',
  connection: 'DATA_QUEUE',
  handler: async (raw) =>
    withProcessingFailureLog('issue-project-export', async () => {
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
      const partitionKey = row.partitionKey,
        rowKey = row.rowKey
      if (row.state === 'Exported') return
      const github = new GitHubClient(
        required('GITHUB_OWNER'),
        required('GITHUB_REPOSITORY'),
        required('GITHUB_TOKEN'),
      )
      // Project追加だけを再試行し、Issueの重複作成を避ける。
      const issueId = await ensureIssueForExport(
        github,
        item,
        typeof row.state === 'string' ? row.state : null,
        typeof row.issueId === 'string' ? row.issueId : null,
        async () => {
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
        },
        async (id) => {
          await store.table.updateEntity(
            {
              partitionKey,
              rowKey,
              state: 'IssueCreated',
              issueId: id,
            },
            'Merge',
          )
        },
      )
      const projectItemId = await github.addToProject(
        required('GITHUB_PROJECT_ID'),
        issueId,
      )
      await store.table.updateEntity(
        {
          partitionKey,
          rowKey,
          state: 'Exported',
          issueId,
          projectItemId,
        },
        'Merge',
      )
    }),
})

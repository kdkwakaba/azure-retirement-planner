import { app } from '@azure/functions'
import { z } from 'zod'
import { approvalSchema, type Approval } from '@arp/contracts'
import { verifyApproval } from '@arp/domain'
import {
  AzureStore,
  ensureIssueForExport,
  GitHubClient,
  required,
  logProcessingFailure,
} from '@arp/adapters'

app.storageQueue('export', {
  queueName: 'exports',
  connection: 'DATA_QUEUE',
  handler: async (raw) => {
    try {
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
      if (!row.partitionKey || !row.rowKey)
        throw new Error('Outbox key missing')
      const partitionKey = row.partitionKey,
        rowKey = row.rowKey
      if (row.state === 'Exported') return
      const github = new GitHubClient(
        required('GITHUB_OWNER'),
        required('GITHUB_REPOSITORY'),
        required('GITHUB_TOKEN'),
      )
      const parentIssue = await store.ensureParentIssue(github, assessment)
      await github.syncParentLabels(parentIssue.number, assessment)
      const projectId = required('GITHUB_PROJECT_ID')
      const projectConfig = {
        statusFieldId: process.env.GITHUB_PROJECT_STATUS_FIELD_ID,
        todoOptionId: process.env.GITHUB_PROJECT_STATUS_TODO_OPTION_ID,
        priorityFieldId: process.env.GITHUB_PROJECT_PRIORITY_FIELD_ID,
        priorityOptionIds: process.env.GITHUB_PROJECT_PRIORITY_FIELD_ID
          ? {
              P1: process.env.GITHUB_PROJECT_PRIORITY_P1_OPTION_ID,
              P2: process.env.GITHUB_PROJECT_PRIORITY_P2_OPTION_ID,
              P3: process.env.GITHUB_PROJECT_PRIORITY_P3_OPTION_ID,
              P4: process.env.GITHUB_PROJECT_PRIORITY_P4_OPTION_ID,
            }
          : undefined,
        dueDateFieldId: process.env.GITHUB_PROJECT_DUE_DATE_FIELD_ID,
      }
      const parentProjectItem = await github.ensureProjectItem(
        projectId,
        parentIssue.id,
      )
      await github.updateProjectParentFields(
        projectId,
        parentProjectItem.id,
        assessment.effectivePriority,
        projectConfig,
        parentProjectItem.created,
      )
      const phaseIssue = await store.ensurePhaseIssue(github, assessment, item)
      await github.ensureSubIssue(parentIssue.number, phaseIssue.databaseId)
      const phaseProjectItem = await github.ensureProjectItem(
        projectId,
        phaseIssue.id,
      )
      await github.updateProjectParentFields(
        projectId,
        phaseProjectItem.id,
        null,
        projectConfig,
        phaseProjectItem.created,
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
      const managedContentHash = await github.updateManagedIssue(
        issueId,
        item,
        typeof row.managedContentHash === 'string'
          ? row.managedContentHash
          : null,
        assessment,
      )
      await store.table.updateEntity(
        {
          partitionKey,
          rowKey,
          state: 'IssueCreated',
          managedContentHash,
        },
        'Merge',
      )
      const childIssue = await github.getIssueReference(issueId)
      await github.syncWorkItemLabels(childIssue.number, item)
      await github.ensureSubIssue(phaseIssue.number, childIssue.databaseId)
      const projectItem = await github.ensureProjectItem(projectId, issueId)
      await github.updateProjectFields(
        projectId,
        projectItem.id,
        item,
        projectConfig,
        projectItem.created,
      )
      await store.table.updateEntity(
        {
          partitionKey,
          rowKey,
          state: 'Exported',
          issueId,
          projectItemId: projectItem.id,
          managedContentHash,
        },
        'Merge',
      )
    } catch (error) {
      logProcessingFailure('issue-project-export', error)
      throw error
    }
  },
})

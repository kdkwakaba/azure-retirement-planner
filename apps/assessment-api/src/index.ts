import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import { approvalSchema, correctionSchema } from '@arp/contracts'
import {
  hash,
  isTranslatableOfficialEvidence,
  reviseAssessment,
  verifyApproval,
} from '@arp/domain'
import {
  AzureStore,
  GitHubClient,
  ensureIssueForExport,
  createVerifier,
  requireApplicationRole,
  requireUserRole,
  apiRolePolicy,
  required,
  verifyWriteRequest,
  failureFacts,
  GitHubGraphQLError,
  logProcessingFailure,
  withProcessingFailureLog,
  translateOfficialHtmlToJapanese,
} from '@arp/adapters'
import { assessSnapshot, config, synchronize } from './service.ts'
import {
  createSyntheticUatAssessment,
  isSyntheticUatAssessment,
} from './uat.ts'

let verifier: ReturnType<typeof createVerifier> | undefined
function reply(status: number, jsonBody: unknown): HttpResponseInit {
  return {
    status,
    jsonBody,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  }
}
function safeGitHubIssueUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      ? value
      : null
  } catch {
    return null
  }
}
app.http('api', {
  route: 'api/{*path}',
  authLevel: 'anonymous',
  methods: ['GET', 'POST'],
  handler: async (request: HttpRequest) => {
    let processingStage = 'http'
    const correlationId = randomUUID()
    let uatFailureTarget:
      | {
          partitionKey: string
          rowKey: string
          store: AzureStore
        }
      | undefined
    try {
      verifier ??= createVerifier(
        required('TENANT_ID'),
        required('ENTRA_CLIENT_ID'),
      )
      const token =
        request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
        request.headers.get('x-ms-token-aad-id-token')
      if (!token) return reply(401, { error: 'Authentication required' })
      const principal = await verifier(token)
      const path = String(request.params.path ?? '').replace(/^\/+|\/+$/g, '')
      if (path === 'ingest' && request.method === 'POST') {
        requireApplicationRole(principal, apiRolePolicy.notification)
        if (process.env.INGEST_ENABLED !== 'true')
          return reply(503, { error: 'Ingestion disabled' })
        const content = await request.text()
        if (Buffer.byteLength(content) > 200000)
          return reply(413, { error: 'Request too large' })
        const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(content))
        const store = new AzureStore(config().account)
        const receiptId = await store.receiveNotice(raw)
        return reply(202, { receiptId })
      }
      requireUserRole(principal, apiRolePolicy.read)
      if (request.method === 'GET' && path === 'me')
        return reply(200, principal)
      if (request.method === 'GET' && path === 'uat/status')
        return reply(200, {
          enabled: process.env.SYNTHETIC_UAT_ENABLED === 'true',
        })
      const store = new AzureStore(config().account)
      if (request.method === 'GET' && path === 'uat/export-status') {
        if (process.env.SYNTHETIC_UAT_ENABLED !== 'true')
          return reply(404, { error: 'Synthetic UAT is disabled' })
        const query = z
          .object({
            assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
            itemId: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse({
            assessmentId: request.query.get('assessmentId'),
            itemId: request.query.get('itemId'),
          })
        const assessment = await store.assessment(query.assessmentId)
        if (!isSyntheticUatAssessment(assessment))
          return reply(404, { error: 'Synthetic UAT record not found' })
        const item = assessment.workItems.find(
          (candidate) =>
            candidate.id === query.itemId &&
            candidate.title === '[SYNTHETIC UAT] GitHub Issue連携を確認',
        )
        if (!item) return reply(404, { error: 'Synthetic UAT item not found' })
        const logicalId = hash({
          eventId: assessment.event.id,
          workloadId: assessment.workloadId,
        })
        const partitionKey = 'assessment:' + logicalId
        const rowKey = 'uat-export:' + item.id
        try {
          const row = await store.table.getEntity<Record<string, unknown>>(
            partitionKey,
            rowKey,
          )
          const issueUrl = safeGitHubIssueUrl(row.issueUrl)
          return reply(200, {
            state: typeof row.state === 'string' ? row.state : 'Unknown',
            stage: typeof row.stage === 'string' ? row.stage : null,
            issueUrl,
            parentIssueUrl: safeGitHubIssueUrl(row.parentIssueUrl),
            phaseIssueUrl: safeGitHubIssueUrl(row.phaseIssueUrl),
            errorCategory:
              typeof row.errorCategory === 'string' ? row.errorCategory : null,
            errorHttpStatus:
              typeof row.errorHttpStatus === 'number'
                ? row.errorHttpStatus
                : null,
            operation:
              typeof row.errorOperation === 'string'
                ? row.errorOperation
                : null,
            providerCode:
              typeof row.errorProviderCode === 'string'
                ? row.errorProviderCode
                : null,
            correlationId:
              typeof row.correlationId === 'string' ? row.correlationId : null,
            updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
          })
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode !== 404) throw error
          return reply(200, {
            state: 'NotStarted',
            stage: null,
            issueUrl: null,
            parentIssueUrl: null,
            phaseIssueUrl: null,
            errorCategory: null,
            errorHttpStatus: null,
            operation: null,
            providerCode: null,
            correlationId: null,
            updatedAt: null,
          })
        }
      }
      if (request.method === 'GET' && path === 'assessments')
        return reply(200, await store.list())
      if (request.method === 'GET' && path === 'project-progress')
        return reply(200, await store.projectProgress())
      if (request.method === 'POST') {
        verifyWriteRequest(
          request.headers.get('origin'),
          required('APP_ORIGIN'),
          request.headers.get('content-type'),
          request.headers.get('x-arp-request'),
        )
        if (Number(request.headers.get('content-length') ?? 0) > 200000)
          return reply(413, { error: 'Request too large' })
        if (path === 'sync') {
          requireUserRole(principal, apiRolePolicy.sync)
          return reply(202, await synchronize())
        }
        const content = await request.text()
        if (Buffer.byteLength(content) > 200000)
          return reply(413, { error: 'Request too large' })
        const payload: unknown = JSON.parse(content)
        if (path === 'uat/seed') {
          requireUserRole(principal, apiRolePolicy.review)
          if (process.env.SYNTHETIC_UAT_ENABLED !== 'true')
            return reply(404, { error: 'Synthetic UAT is disabled' })
          z.object({}).strict().parse(payload)
          const sample = createSyntheticUatAssessment()
          const logicalId = hash({
            eventId: sample.event.id,
            workloadId: sample.workloadId,
          })
          const prior = await store.head(logicalId)
          if (prior) {
            const existing = await store.assessment(prior.assessmentId)
            if (!isSyntheticUatAssessment(existing))
              return reply(409, { error: 'Synthetic UAT identity conflict' })
            return reply(200, { assessmentId: existing.id, created: false })
          }
          await store.commitAssessment(sample, null)
          return reply(201, { assessmentId: sample.id, created: true })
        }
        if (path === 'uat/export') {
          requireUserRole(principal, apiRolePolicy.review)
          if (process.env.SYNTHETIC_UAT_ENABLED !== 'true')
            return reply(404, { error: 'Synthetic UAT is disabled' })
          const body = z
            .object({
              assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
              packageHash: z.string().regex(/^[a-f0-9]{64}$/),
              itemId: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(payload)
          const assessment = await store.assessment(body.assessmentId)
          if (
            !isSyntheticUatAssessment(assessment) ||
            assessment.packageHash !== body.packageHash
          )
            return reply(409, {
              error: 'Assessment is not the current synthetic UAT record',
            })
          const item = assessment.workItems.find(
            (candidate) => candidate.id === body.itemId,
          )
          if (!item || item.title !== '[SYNTHETIC UAT] GitHub Issue連携を確認')
            return reply(400, {
              error: 'Only the fixed synthetic UAT item can be exported',
            })
          const logicalId = hash({
            eventId: assessment.event.id,
            workloadId: assessment.workloadId,
          })
          const partitionKey = 'assessment:' + logicalId
          const head = await store.table.getEntity<Record<string, unknown>>(
            partitionKey,
            'head',
          )
          const reviewId = head.lastReviewId
          if (typeof reviewId !== 'string')
            return reply(409, {
              error: 'Human approval is required before UAT export',
            })
          const approval = approvalSchema.parse(
            await store.get('approvals', reviewId),
          )
          if (
            !['Approved', 'Partial'].includes(approval.result) ||
            !approval.approvedItemIds.includes(item.id)
          )
            return reply(409, {
              error: 'The synthetic work item has not been approved',
            })
          verifyApproval(assessment, approval, item.id)

          const rowKey = 'uat-export:' + item.id
          let row: Record<string, unknown>
          try {
            row = await store.table.getEntity(partitionKey, rowKey)
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 404)
              throw error
            try {
              await store.table.createEntity({
                partitionKey,
                rowKey,
                entityKind: 'synthetic-uat-export',
                state: 'Pending',
                assessmentId: assessment.id,
                itemId: item.id,
              })
            } catch (createError) {
              if ((createError as { statusCode?: number }).statusCode !== 409)
                throw createError
            }
            row = await store.table.getEntity(partitionKey, rowKey)
          }
          uatFailureTarget = { partitionKey, rowKey, store }
          if (row.state === 'Exported' && typeof row.issueUrl === 'string')
            return reply(200, {
              issueUrl: row.issueUrl,
              parentIssueUrl:
                typeof row.parentIssueUrl === 'string'
                  ? row.parentIssueUrl
                  : null,
              phaseIssueUrl:
                typeof row.phaseIssueUrl === 'string'
                  ? row.phaseIssueUrl
                  : null,
              alreadyExported: true,
            })
          const saveUatStage = async (
            stage: string,
            state: string,
            extra: Record<string, unknown> = {},
          ) => {
            processingStage = stage
            await store.table.updateEntity(
              {
                partitionKey,
                rowKey,
                entityKind: 'synthetic-uat-export',
                state,
                stage,
                correlationId,
                updatedAt: new Date().toISOString(),
                errorCategory: null,
                errorHttpStatus: null,
                errorOperation: null,
                errorProviderCode: null,
                ...extra,
              },
              'Merge',
            )
          }
          await saveUatStage('finding-or-creating-parent', 'Processing')

          const github = new GitHubClient(
            required('GITHUB_OWNER'),
            required('GITHUB_REPOSITORY'),
            required('GITHUB_TOKEN'),
          )
          const parentIssue = await store.ensureParentIssue(github, assessment)
          await github.syncParentLabels(parentIssue.number, assessment)
          await saveUatStage('adding-parent-to-project', 'Processing', {
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
          })
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
          await saveUatStage('finding-or-creating-phase', 'Processing', {
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
          })
          const phaseIssue = await store.ensurePhaseIssue(
            github,
            assessment,
            item,
          )
          await saveUatStage('linking-phase-to-parent', 'Processing', {
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
            phaseIssueId: phaseIssue.id,
            phaseIssueUrl: phaseIssue.url,
          })
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
          await saveUatStage('finding-or-creating-issue', 'Processing', {
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
          })
          const issueId = await ensureIssueForExport(
            github,
            item,
            typeof row.state === 'string' ? row.state : null,
            typeof row.issueId === 'string' ? row.issueId : null,
            async () => {
              await saveUatStage('creating-issue', 'Sending')
            },
            async (id) => {
              await saveUatStage('updating-issue', 'IssueCreated', {
                issueId: id,
              })
            },
          )
          await saveUatStage('verifying-issue', 'IssueCreated', { issueId })
          const found = await github.find(item.id)
          if (!found || found.id !== issueId)
            throw new Error('Synthetic issue reconciliation incomplete')
          await saveUatStage('updating-issue', 'IssueCreated', {
            issueId,
            issueUrl: found.url,
          })
          const managedContentHash = await github.updateManagedIssue(
            issueId,
            item,
            typeof row.managedContentHash === 'string'
              ? row.managedContentHash
              : null,
          )
          await store.table.updateEntity(
            {
              partitionKey,
              rowKey,
              entityKind: 'synthetic-uat-export',
              state: 'IssueCreated',
              issueId,
              managedContentHash,
            },
            'Merge',
          )
          await saveUatStage('adding-to-project', 'IssueCreated', {
            issueId,
            issueUrl: found.url,
            managedContentHash,
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
          })
          const projectItem = await github.ensureProjectItem(projectId, issueId)
          const childIssue = await github.getIssueReference(issueId)
          await github.syncWorkItemLabels(childIssue.number, item)
          await saveUatStage('linking-sub-issue', 'IssueCreated', {
            issueId,
            issueUrl: found.url,
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
            phaseIssueId: phaseIssue.id,
            phaseIssueUrl: phaseIssue.url,
            managedContentHash,
          })
          await github.ensureSubIssue(phaseIssue.number, childIssue.databaseId)
          await saveUatStage('updating-project-fields', 'ProjectItemAdded', {
            issueId,
            issueUrl: found.url,
            projectItemId: projectItem.id,
            managedContentHash,
            parentIssueId: parentIssue.id,
            parentIssueUrl: parentIssue.url,
            phaseIssueId: phaseIssue.id,
            phaseIssueUrl: phaseIssue.url,
          })
          await github.updateProjectFields(
            projectId,
            projectItem.id,
            item,
            projectConfig,
            projectItem.created,
          )
          await saveUatStage('completed', 'Exported', {
            issueId,
            issueUrl: found.url,
            projectItemId: projectItem.id,
            managedContentHash,
          })
          return reply(200, {
            issueUrl: found.url,
            parentIssueUrl: parentIssue.url,
            phaseIssueUrl: phaseIssue.url,
            alreadyExported: false,
          })
        }
        if (path === 'translate-evidence') {
          const body = z
            .object({
              assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
              evidenceId: z.string().min(1).max(200),
            })
            .strict()
            .parse(payload)
          const resourceId = process.env.TRANSLATOR_RESOURCE_ID
          if (!resourceId)
            return reply(503, {
              error: 'Japanese translation is not configured',
            })
          const assessment = await store.assessment(body.assessmentId)
          const evidence = assessment.event.evidence.find(
            (item) => item.id === body.evidenceId,
          )
          if (
            !evidence ||
            !isTranslatableOfficialEvidence(assessment.event, evidence)
          )
            return reply(404, {
              error: 'Official Microsoft evidence not found',
            })
          if (evidence.fact.length > 50_000)
            return reply(413, { error: 'Evidence is too large to translate' })
          const translationId = hash({
            sourceVersion: evidence.sourceVersion,
            sourceFact: hash(evidence.fact),
            targetLanguage: 'ja',
            provider: 'Azure AI Translator',
            apiVersion: '3.0',
          })
          try {
            const cached = await store.get<{ translatedText: string }>(
              'translations',
              translationId,
            )
            return reply(200, {
              translatedText: cached.translatedText,
              provider: 'Azure AI Translator',
              cached: true,
            })
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 404)
              throw error
          }
          const translatedText = await translateOfficialHtmlToJapanese({
            resourceId,
            text: evidence.fact,
          })
          await store.put('translations', translationId, {
            sourceVersion: evidence.sourceVersion,
            translatedText,
            targetLanguage: 'ja',
            provider: 'Azure AI Translator',
            apiVersion: '3.0',
            translatedAt: new Date().toISOString(),
          })
          return reply(200, {
            translatedText,
            provider: 'Azure AI Translator',
            cached: false,
          })
        }
        if (path === 'revise') {
          requireUserRole(principal, apiRolePolicy.review)
          const body = z
            .object({
              assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
              packageHash: z.string().regex(/^[a-f0-9]{64}$/),
              correction: correctionSchema,
            })
            .strict()
            .parse(payload)
          const original = await store.assessment(body.assessmentId)
          const prior = await store.head(
            hash({
              eventId: original.event.id,
              workloadId: original.workloadId,
            }),
          )
          if (
            !prior ||
            prior.assessmentId !== original.id ||
            prior.packageHash !== body.packageHash
          )
            return reply(409, { error: 'Stale assessment' })
          const revised = reviseAssessment(
            original,
            body.correction,
            principal.id,
            new Date().toISOString(),
          )
          await store.commitAssessment(revised, prior)
          return reply(200, { assessmentId: revised.id })
        }
        if (path === 'review') {
          requireUserRole(principal, apiRolePolicy.review)
          const body = z
            .object({
              assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
              packageHash: z.string().regex(/^[a-f0-9]{64}$/),
              approvedItemIds: z.array(z.string()),
              reason: z.string().min(1).max(2000),
              result: z.enum(['Approved', 'Partial', 'Returned', 'Held']),
            })
            .strict()
            .parse(payload)
          const assessment = await store.assessment(body.assessmentId)
          if (assessment.humanContext?.scopeDisposition === 'OutOfScope')
            return reply(409, {
              error: 'Out-of-scope assessment cannot approve work items',
            })
          const approval = approvalSchema.parse({
            ...body,
            id: hash(randomUUID()),
            reviewerId: principal.id,
            reviewedAt: new Date().toISOString(),
          })
          if (
            !['Approved', 'Partial'].includes(approval.result) &&
            approval.approvedItemIds.length
          )
            return reply(400, {
              error: 'Unapproved result cannot select work items',
            })
          const syntheticUat = isSyntheticUatAssessment(assessment)
          await store.approve(assessment, approval, syntheticUat)
          if (!syntheticUat && process.env.EXPORT_ENABLED === 'true')
            await store.dispatchOutbox()
          return reply(200, {
            reviewId: approval.id,
            exportEnabled:
              !syntheticUat && process.env.EXPORT_ENABLED === 'true',
          })
        }
      }
      return reply(404, { error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        message === 'Forbidden' ||
        message === 'Application identity required'
      )
        return reply(403, { error: 'Forbidden' })
      if (error instanceof z.ZodError && !uatFailureTarget)
        return reply(400, { error: 'Invalid request' })
      if (/JWT|token|tenant|principal|signature/i.test(message))
        return reply(401, { error: 'Authentication failed' })
      if (/Stale|承認対象|未承認|検証不適合/.test(message))
        return reply(409, { error: 'Review conflict or validation failed' })
      if (/origin|content-type/.test(message))
        return reply(403, { error: 'Write origin rejected' })
      const facts = failureFacts(error)
      const githubFailure =
        error instanceof GitHubGraphQLError
          ? {
              operation: error.operation,
              providerCode: error.providerCode,
            }
          : { operation: null, providerCode: null }
      const errorType =
        error instanceof Error &&
        /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(error.name)
          ? error.name
          : 'Error'
      if (uatFailureTarget) {
        try {
          await uatFailureTarget.store.table.updateEntity(
            {
              partitionKey: uatFailureTarget.partitionKey,
              rowKey: uatFailureTarget.rowKey,
              entityKind: 'synthetic-uat-export',
              state: 'Failed',
              stage: processingStage,
              errorCategory: facts.category,
              errorHttpStatus: facts.httpStatus,
              errorOperation: githubFailure.operation,
              errorProviderCode: githubFailure.providerCode,
              correlationId,
              updatedAt: new Date().toISOString(),
            },
            'Merge',
          )
        } catch (statusError) {
          logProcessingFailure('uat-status-persist', statusError, correlationId)
        }
      }
      logProcessingFailure(processingStage, error, correlationId)
      return reply(503, {
        error: 'Processing failed',
        stage: processingStage,
        category: facts.category,
        httpStatus: facts.httpStatus,
        operation: githubFailure.operation,
        providerCode: githubFailure.providerCode,
        errorType,
        correlationId,
      })
    }
  },
})

app.http('web', {
  route: '{*path}',
  authLevel: 'anonymous',
  methods: ['GET'],
  handler: async (request) => {
    const root = resolve(process.cwd(), 'public')
    const name = String(request.params.path ?? '') || 'index.html'
    const path = resolve(root, name)
    if (!path.startsWith(root + sep) || name.startsWith('api'))
      return { status: 404 }
    try {
      const content = await readFile(path)
      const mime = path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.html')
            ? 'text/html'
            : path.endsWith('.svg')
              ? 'image/svg+xml'
              : 'application/octet-stream'
      return {
        body: content,
        headers: {
          'Content-Type': mime,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
        },
      }
    } catch {
      return { status: 404 }
    }
  },
})
app.storageQueue('assess', {
  queueName: 'assessments',
  connection: 'DATA_QUEUE',
  handler: async (message) =>
    withProcessingFailureLog('assessment-queue', async () => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'sync'
      ) {
        await synchronize()
      } else await assessSnapshot(message)
    }),
})
app.timer('daily', {
  schedule: '0 0 0 * * *',
  handler: async () =>
    withProcessingFailureLog('daily-sync', async () => {
      if (process.env.SYNC_ENABLED === 'true') await synchronize()
    }),
})
app.timer('outbox', {
  schedule: '0 */5 * * * *',
  handler: async () =>
    withProcessingFailureLog('export-outbox', async () => {
      if (process.env.EXPORT_ENABLED === 'true')
        await new AzureStore(config().account).dispatchOutbox()
    }),
})
app.timer('receiptOutbox', {
  schedule: '0 */2 * * * *',
  handler: async () =>
    withProcessingFailureLog('receipt-outbox', async () => {
      if (process.env.INGEST_ENABLED === 'true')
        await new AzureStore(config().account).dispatchReceipts()
    }),
})

app.timer('projectProgress', {
  schedule: '0 */15 * * * *',
  handler: async () =>
    withProcessingFailureLog('project-progress-import', async () => {
      if (process.env.PROJECT_PROGRESS_SYNC_ENABLED !== 'true') return
      const github = new GitHubClient(
        required('GITHUB_OWNER'),
        required('GITHUB_REPOSITORY'),
        required('GITHUB_TOKEN'),
      )
      const progress = await github.readProjectProgress(
        required('GITHUB_PROJECT_ID'),
        required('GITHUB_PROJECT_STATUS_FIELD_ID'),
      )
      await new AzureStore(config().account).recordProjectProgress(progress)
    }),
})

import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  approvalSchema,
  businessContextSchema,
  correctionSchema,
  documentSourceSchema,
  documentGroundingSchema,
  sampleDocumentImpactEvaluationSchema,
} from '@arp/contracts'
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
  readLimitedRequestText,
  RequestBodyTooLargeError,
  verifyWriteRequest,
  failureFacts,
  GitHubGraphQLError,
  logProcessingFailure,
  withProcessingFailureLog,
  type Principal,
  translateOfficialHtmlToJapanese,
  extractDocumentText,
  extractDocumentFacts,
  bindDocumentFactProposalsFromResponse,
  documentFactDependencyResourceIds,
  DOCUMENT_FACT_EXTRACTION_PROMPT_VERSION,
  DocumentFactExtractionResponseError,
  readDocumentFactResponseCache,
  splitDocumentTextForFactExtraction,
} from '@arp/adapters'
import {
  assessSnapshot,
  config,
  evaluateSyntheticUat,
  applyReviewWorkflowPolicy,
  isTestReevaluation,
  processDecisionReevaluation,
  processSharePointSync,
  synchronize,
} from './service.ts'
import {
  sharePointFactExtractionModeEnabled,
  sharePointSourceModeEnabled,
} from './sharepoint-mode.ts'
import {
  createSyntheticUatAssessment,
  hasCompleteSyntheticUatIssueHierarchy,
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
      let principal: Principal
      try {
        principal = await verifier(token)
      } catch {
        return reply(401, { error: 'Authentication failed' })
      }
      const path = String(request.params.path ?? '').replace(/^\/+|\/+$/g, '')
      if (path === 'ingest' && request.method === 'POST') {
        requireApplicationRole(principal, apiRolePolicy.notification)
        if (process.env.INGEST_ENABLED !== 'true')
          return reply(503, { error: 'Ingestion disabled' })
        const content = await readLimitedRequestText(request, 200_000)
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
          testModeEnabled: process.env.TEST_MODE_ENABLED === 'true',
          syntheticUatEnabled:
            process.env.TEST_MODE_ENABLED === 'true' &&
            process.env.SYNTHETIC_UAT_ENABLED === 'true',
          decisionReevaluationEnabled:
            process.env.TEST_MODE_ENABLED === 'true' &&
            process.env.DECISION_REEVALUATION_ENABLED === 'true',
          canReevaluate:
            principal.kind === 'User' && principal.roles.includes('Governance'),
          canManageSharePoint:
            principal.kind === 'User' && principal.roles.includes('Governance'),
          sharePointSyncEnabled: process.env.SHAREPOINT_SYNC_ENABLED === 'true',
          sharePointFactExtractionEnabled:
            process.env.SHAREPOINT_FACT_EXTRACTION_ENABLED === 'true',
          sharePointSampleSourcesEnabled: sharePointSourceModeEnabled(true),
          sharePointLiveSourcesEnabled: sharePointSourceModeEnabled(false),
          canSync:
            principal.kind === 'User' &&
            principal.roles.some((role) =>
              ['Operator', 'Governance'].includes(role),
            ),
          canReview:
            principal.kind === 'User' &&
            principal.roles.some((role) =>
              ['Reviewer', 'Governance'].includes(role),
            ),
        })
      const store = new AzureStore(config().account)
      if (request.method === 'GET' && path === 'decision-reevaluation-status') {
        requireUserRole(principal, apiRolePolicy.decisionReevaluation)
        if (
          process.env.TEST_MODE_ENABLED !== 'true' ||
          process.env.DECISION_REEVALUATION_ENABLED !== 'true'
        )
          return reply(404, { error: 'Decision reevaluation is disabled' })
        const query = z
          .object({ runId: z.string().uuid() })
          .strict()
          .parse({ runId: request.query.get('runId') })
        return reply(200, await store.decisionReevaluation(query.runId))
      }
      if (
        request.method === 'GET' &&
        path === 'decision-reevaluation-response-diagnostics'
      ) {
        requireUserRole(principal, apiRolePolicy.decisionReevaluation)
        if (
          process.env.TEST_MODE_ENABLED !== 'true' ||
          process.env.DECISION_REEVALUATION_ENABLED !== 'true'
        )
          return reply(404, { error: 'Decision reevaluation is disabled' })
        const query = z
          .object({ assessmentId: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .parse({ assessmentId: request.query.get('assessmentId') })
        const assessment = await store.assessment(query.assessmentId)
        if (!assessment.reevaluation)
          return reply(404, { error: 'Reevaluation assessment not found' })
        const logicalId = hash({
          eventId: assessment.event.id,
          workloadId: assessment.workloadId,
        })
        const head = await store.head(logicalId)
        if (!head || head.assessmentId !== assessment.id)
          return reply(409, { error: 'Assessment is not the current version' })
        const failedStages = (assessment.modelInvocations ?? [])
          .filter((invocation) => invocation.status === 'Failed')
          .map((invocation) => invocation.stage)
        const diagnostics = await Promise.all(
          failedStages.map(async (stage) => ({
            stage,
            ...(await store.modelResponseDiagnostics(assessment.id, stage)),
          })),
        )
        return reply(200, { assessmentId: assessment.id, diagnostics })
      }
      if (request.method === 'GET' && path === 'uat/export-status') {
        if (
          process.env.TEST_MODE_ENABLED !== 'true' ||
          process.env.SYNTHETIC_UAT_ENABLED !== 'true'
        )
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
            candidate.title.startsWith('[SYNTHETIC UAT]'),
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
      if (request.method === 'GET' && path === 'assessments') {
        const includeNoAction = request.query.get('includeNoAction') === 'true'
        return reply(200, await store.list(includeNoAction))
      }
      if (request.method === 'GET' && path === 'project-progress')
        return reply(200, await store.projectProgress())
      if (request.method === 'GET' && path === 'sharepoint-source') {
        requireUserRole(principal, apiRolePolicy.businessContext)
        const query = z
          .object({ sourceId: z.string().min(1).max(100) })
          .strict()
          .parse({ sourceId: request.query.get('sourceId') })
        return reply(200, await store.sharePointSource(query.sourceId))
      }
      if (request.method === 'GET' && path === 'sharepoint-sources') {
        requireUserRole(principal, apiRolePolicy.sync)
        return reply(200, await store.sharePointSources())
      }
      if (request.method === 'GET' && path === 'sharepoint-snapshot') {
        requireUserRole(principal, apiRolePolicy.sync)
        const query = z
          .object({ sourceId: z.string().min(1).max(100) })
          .strict()
          .parse({ sourceId: request.query.get('sourceId') })
        return reply(200, await store.sharePointSnapshot(query.sourceId))
      }
      if (request.method === 'GET' && path === 'sharepoint-facts') {
        requireUserRole(principal, apiRolePolicy.businessContext)
        const query = z
          .object({
            sourceId: z.string().min(1).max(100),
            workloadId: z.string().min(1).max(200),
          })
          .strict()
          .parse({
            sourceId: request.query.get('sourceId'),
            workloadId: request.query.get('workloadId'),
          })
        const registered = await store.sharePointSource(query.sourceId)
        if (
          !registered ||
          !registered.source.workloadIds.includes(query.workloadId) ||
          !sharePointSourceModeEnabled(registered.source.sampleOnly)
        )
          return reply(404, { error: 'Eligible SharePoint source not found' })
        const grounding = await store.documentGrounding(
          query.workloadId,
          registered.source.sampleOnly,
        )
        return reply(200, {
          grounding,
          groundingHash: grounding ? hash(grounding) : null,
        })
      }
      if (
        request.method === 'GET' &&
        path === 'sharepoint-sample-impact-evaluation'
      ) {
        requireUserRole(principal, apiRolePolicy.businessContext)
        if (
          process.env.TEST_MODE_ENABLED !== 'true' ||
          !sharePointSourceModeEnabled(true)
        )
          return reply(404, { error: 'Sample evaluation is disabled' })
        const query = z
          .object({
            sourceId: z.string().min(1).max(100),
            workloadId: z.string().min(1).max(200),
            assessmentId: z.string().min(1).max(200),
          })
          .strict()
          .parse({
            sourceId: request.query.get('sourceId'),
            workloadId: request.query.get('workloadId'),
            assessmentId: request.query.get('assessmentId'),
          })
        const registered = await store.sharePointSource(query.sourceId)
        if (
          !registered?.source.sampleOnly ||
          !registered.source.workloadIds.includes(query.workloadId)
        )
          return reply(404, { error: 'Sample SharePoint source not found' })
        const assessment = await store.assessment(query.assessmentId)
        if (
          !isSyntheticUatAssessment(assessment) ||
          assessment.workloadId !== query.workloadId
        )
          return reply(404, { error: 'Synthetic sample assessment not found' })
        const grounding = await store.documentGrounding(query.workloadId, true)
        if (!grounding) return reply(200, null)
        const groundingHash = hash(grounding)
        const evaluationId = hash({
          sourceId: query.sourceId,
          assessmentId: assessment.id,
          groundingHash,
        })
        try {
          return reply(
            200,
            sampleDocumentImpactEvaluationSchema.parse(
              await store.get('sample-impact-evaluations', evaluationId),
            ),
          )
        } catch (error) {
          if ((error as { statusCode?: number }).statusCode === 404)
            return reply(200, null)
          throw error
        }
      }
      if (request.method === 'GET' && path === 'sharepoint-sync-status') {
        requireUserRole(principal, apiRolePolicy.sync)
        const query = z
          .object({ runId: z.uuid() })
          .strict()
          .parse({ runId: request.query.get('runId') })
        return reply(200, await store.sharePointSyncRun(query.runId))
      }
      if (request.method === 'GET' && path === 'business-context') {
        const query = z
          .object({ workloadId: z.string().min(1).max(200) })
          .strict()
          .parse({ workloadId: request.query.get('workloadId') })
        return reply(200, await store.businessContext(query.workloadId))
      }
      if (request.method === 'POST') {
        verifyWriteRequest(
          request.headers.get('origin'),
          required('APP_ORIGIN'),
          request.headers.get('content-type'),
          request.headers.get('x-arp-request'),
        )
        const requestContent = await readLimitedRequestText(request, 200_000)
        if (path === 'business-context') {
          requireUserRole(principal, apiRolePolicy.businessContext)
          const payload = businessContextSchema
            .omit({ reviewedBy: true, reviewedAt: true })
            .parse(JSON.parse(requestContent))
          await store.saveBusinessContext({
            ...payload,
            reviewedBy: principal.id,
            reviewedAt: new Date().toISOString(),
          })
          return reply(200, await store.businessContext(payload.workloadId))
        }
        if (path === 'sharepoint-sample-impact-evaluation') {
          requireUserRole(principal, apiRolePolicy.businessContext)
          if (
            process.env.TEST_MODE_ENABLED !== 'true' ||
            !sharePointSourceModeEnabled(true)
          )
            return reply(404, { error: 'Sample evaluation is disabled' })
          const body = z
            .object({
              sourceId: z.string().min(1).max(100),
              workloadId: z.string().min(1).max(200),
              assessmentId: z.string().min(1).max(200),
              groundingHash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          const registered = await store.sharePointSource(body.sourceId)
          if (
            !registered?.source.sampleOnly ||
            !registered.source.workloadIds.includes(body.workloadId)
          )
            return reply(404, { error: 'Sample SharePoint source not found' })
          const assessment = await store.assessment(body.assessmentId)
          if (
            !isSyntheticUatAssessment(assessment) ||
            assessment.workloadId !== body.workloadId
          )
            return reply(404, {
              error: 'Synthetic sample assessment not found',
            })
          const grounding = await store.documentGrounding(body.workloadId, true)
          if (!grounding || hash(grounding) !== body.groundingHash)
            return reply(409, {
              error: 'Sample document facts changed; reload before evaluation',
            })
          const revisions = new Map(
            grounding.documentRevisions.map((revision) => [
              `${revision.sourceId}:${revision.itemId}:${revision.contentHash}`,
              revision,
            ]),
          )
          const assessmentResources = new Set(
            assessment.resources.map((resource) => resource.id.toLowerCase()),
          )
          const facts = grounding.facts.map((fact) => {
            const revision = revisions.get(
              `${fact.sourceId}:${fact.documentItemId}:${fact.documentContentHash}`,
            )
            if (!revision)
              throw new Error('Sample fact document revision is missing')
            const isConfirmed =
              fact.reviewStatus === 'Confirmed' &&
              Boolean(fact.reviewedBy && fact.reviewedAt)
            const linkedResourceIds = isConfirmed
              ? (fact.resourceIds ?? []).slice(0, 20)
              : []
            return {
              factId: fact.factId,
              kind: fact.kind,
              statement: fact.statement,
              reviewStatus: fact.reviewStatus,
              documentName: revision.name,
              locator: fact.locator,
              linkedResourceIds,
              matchedResourceIds: linkedResourceIds.filter((resourceId) =>
                assessmentResources.has(resourceId.toLowerCase()),
              ),
            }
          })
          const allMatchedResourceIds = [
            ...new Set(facts.flatMap((fact) => fact.matchedResourceIds)),
          ]
          const matchedResourceIds = allMatchedResourceIds.slice(0, 500)
          const displayedFacts = facts.slice(0, 500)
          const candidateCount = facts.filter(
            (fact) => fact.reviewStatus === 'Candidate',
          ).length
          const confirmedCount = facts.filter(
            (fact) => fact.reviewStatus === 'Confirmed',
          ).length
          const outcome = candidateCount
            ? 'NeedsFactReview'
            : confirmedCount === 0
              ? 'NoConfirmedFacts'
              : allMatchedResourceIds.length
                ? 'MatchedResources'
                : 'NoResourceLinks'
          const evaluation = sampleDocumentImpactEvaluationSchema.parse({
            schemaVersion: '1',
            evaluationId: hash({
              sourceId: body.sourceId,
              assessmentId: assessment.id,
              groundingHash: body.groundingHash,
            }),
            sampleOnly: true,
            assessmentId: assessment.id,
            workloadId: body.workloadId,
            eventTitle: assessment.event.title,
            groundingHash: body.groundingHash,
            evaluatedAt: new Date().toISOString(),
            outcome,
            matchedResourceIds,
            facts: displayedFacts,
            limitations: [
              'この結果はテスト専用のサンプル文書評価で、通常のAssessmentやGitHub Projectには登録されません。',
              '文書に明記された事実と、Governanceが確認して合成Assessment内のリソースへ紐付けた関係を表示します。',
              '影響度・優先度は判定しません。サンプル文書の記述だけから実環境の影響を確定できません。',
              ...(facts.length > displayedFacts.length ||
              allMatchedResourceIds.length > matchedResourceIds.length
                ? [
                    '表示件数の安全上限（Fact 500件／リソース500件）を超えた残りは省略しています。',
                  ]
                : []),
            ],
          })
          await store.put(
            'sample-impact-evaluations',
            evaluation.evaluationId,
            evaluation,
          )
          return reply(200, evaluation)
        }
        if (path === 'sharepoint-source') {
          requireUserRole(principal, apiRolePolicy.businessContext)
          const input = z
            .object({
              sourceId: z.string().min(1).max(100),
              siteId: z.string().min(1).max(500),
              driveId: z.string().min(1).max(500),
              folderItemId: z.string().min(1).max(500),
              displayName: z.string().min(1).max(200),
              workloadIds: z.array(z.string().min(1).max(200)).min(1),
              configurationVersion: z.string().min(1).max(100),
              sampleOnly: z.boolean(),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          const source = documentSourceSchema.parse({
            ...input,
            tenantId: config().tenantId,
            includeSubfolders: true,
            allowedExtensions: ['.docx', '.xlsx'],
            sampleOnly: input.sampleOnly,
          })
          if (!sharePointSourceModeEnabled(source.sampleOnly))
            return reply(403, { error: 'SharePoint source mode is disabled' })
          const sourceHash = await store.saveSharePointSource(source)
          return reply(200, { source, sourceHash })
        }
        if (path === 'sharepoint-facts/reset') {
          requireUserRole(principal, apiRolePolicy.businessContext)
          const body = z
            .object({
              sourceId: z.string().min(1).max(100),
              workloadId: z.string().min(1).max(200),
              groundingHash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          const registered = await store.sharePointSource(body.sourceId)
          if (
            !registered ||
            !sharePointSourceModeEnabled(registered.source.sampleOnly) ||
            !registered.source.workloadIds.includes(body.workloadId)
          )
            return reply(404, { error: 'Eligible SharePoint source not found' })
          const existing = await store.documentGrounding(
            body.workloadId,
            registered.source.sampleOnly,
          )
          if (!existing || hash(existing) !== body.groundingHash)
            return reply(409, {
              error: 'Document facts changed; reload before reset',
            })
          if (
            existing.sourceConfigurationVersion ===
            registered.source.configurationVersion
          )
            return reply(409, {
              error: 'Grounding already uses the current source version',
            })
          const resetAt = new Date().toISOString()
          const reset = documentGroundingSchema.parse({
            schemaVersion: '1',
            workloadId: body.workloadId,
            sampleOnly: registered.source.sampleOnly,
            sourceConfigurationVersion: registered.source.configurationVersion,
            documentRevisions: [],
            facts: [],
            extractionRecords: [],
            supersedesGroundingHash: body.groundingHash,
            observedAt: resetAt,
          })
          try {
            const groundingHash = await store.saveDocumentGrounding(
              reset,
              body.groundingHash,
            )
            return reply(200, { grounding: reset, groundingHash })
          } catch (error) {
            if (/changed during review/.test(String(error)))
              return reply(409, {
                error: 'Document facts changed; reload before reset',
              })
            throw error
          }
        }
        if (path === 'sharepoint-facts/extract') {
          processingStage = 'sharepoint-fact-extraction-request'
          requireUserRole(principal, apiRolePolicy.businessContext)
          const body = z
            .object({
              sourceId: z.string().min(1).max(100),
              workloadId: z.string().min(1).max(200),
              itemId: z.string().min(1).max(500),
              assessmentId: z.string().min(1).max(200).nullable(),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          processingStage = 'sharepoint-fact-source-read'
          const registered = await store.sharePointSource(body.sourceId)
          if (
            !registered ||
            !sharePointFactExtractionModeEnabled(
              registered.source.sampleOnly,
            ) ||
            !registered.source.workloadIds.includes(body.workloadId)
          )
            return reply(404, { error: 'Eligible SharePoint source not found' })
          processingStage = 'sharepoint-fact-assessment-read'
          const assessment = body.assessmentId
            ? await store.assessment(body.assessmentId)
            : null
          if (assessment && assessment.workloadId !== body.workloadId)
            return reply(409, {
              error: 'Selected assessment belongs to a different Workload',
            })
          processingStage = 'sharepoint-fact-snapshot-read'
          const snapshot = await store.sharePointSnapshot(body.sourceId)
          const revision = snapshot?.documents.find(
            (document) => document.itemId === body.itemId,
          )
          if (
            !snapshot?.enumerationComplete ||
            snapshot.configurationVersion !==
              registered.source.configurationVersion ||
            !revision ||
            revision.sampleOnly !== registered.source.sampleOnly
          )
            return reply(409, {
              error: 'Document is not in the current snapshot',
            })
          processingStage = 'sharepoint-fact-grounding-read'
          const existing = await store.documentGrounding(
            body.workloadId,
            registered.source.sampleOnly,
          )
          if (
            existing &&
            existing.sourceConfigurationVersion !==
              registered.source.configurationVersion
          )
            return reply(409, {
              error: 'Review existing facts before changing the source version',
            })
          const endpoint = required('EXPLANATION_ENDPOINT')
          const deployment = required('EXPLANATION_DEPLOYMENT')
          const modelVersion = required('EXPLANATION_MODEL_VERSION')
          processingStage = 'sharepoint-fact-document-read'
          const document = await store.sharePointDocument(
            body.sourceId,
            revision.contentHash,
          )
          processingStage = 'sharepoint-fact-document-parse'
          const extractedText = await extractDocumentText(document, {
            sourceId: revision.sourceId,
            itemId: revision.itemId,
            name: revision.name,
            extension: revision.extension,
            eTag: revision.eTag,
            lastModifiedAt: revision.lastModifiedAt,
            sampleOnly: revision.sampleOnly,
            observedAt: revision.observedAt,
          })
          processingStage = 'sharepoint-fact-batching'
          const batches = splitDocumentTextForFactExtraction(extractedText)
          const priorExtraction = existing?.extractionRecords?.find(
            (record) =>
              record.sourceId === body.sourceId &&
              record.itemId === revision.itemId &&
              record.contentHash === revision.contentHash &&
              record.promptVersion ===
                DOCUMENT_FACT_EXTRACTION_PROMPT_VERSION &&
              record.deployment === deployment &&
              record.modelVersion === modelVersion,
          )
          const legacyRawId = hash({
            sourceId: body.sourceId,
            itemId: body.itemId,
            contentHash: revision.contentHash,
            promptVersion: DOCUMENT_FACT_EXTRACTION_PROMPT_VERSION,
            deployment,
            modelVersion,
          })
          const factCandidates = new Map<
            string,
            ReturnType<typeof bindDocumentFactProposalsFromResponse>[number]
          >()
          let reusedExtraction = batches.length > 0
          for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex]!
            const rawId = hash({
              sourceId: body.sourceId,
              itemId: body.itemId,
              contentHash: revision.contentHash,
              promptVersion: DOCUMENT_FACT_EXTRACTION_PROMPT_VERSION,
              deployment,
              modelVersion,
              sampleOnly: registered.source.sampleOnly,
              batchIndex,
              batchHash: hash(
                batch.blocks.map(({ blockId, text }) => ({ blockId, text })),
              ),
            })
            processingStage = 'sharepoint-fact-cached-response-read'
            const cachedExtraction = await readDocumentFactResponseCache({
              rawId,
              read: (id) => store.get('model-raw', id),
              validate: (raw) => {
                processingStage = 'sharepoint-fact-cached-response-validate'
                return bindDocumentFactProposalsFromResponse({
                  document: batch,
                  workloadId: body.workloadId,
                  raw,
                  availableResources: assessment?.resources ?? [],
                })
              },
              ...(priorExtraction &&
              registered.source.sampleOnly &&
              batches.length === 1
                ? { fallbackIds: [legacyRawId] }
                : {}),
            })
            let factsForBatch = cachedExtraction.facts ?? undefined
            const rawCacheId = cachedExtraction.writeId
            if (factsForBatch === undefined) {
              reusedExtraction = false
              processingStage = 'sharepoint-fact-budget-reservation'
              await store.reserveModelCall(config().modelCalls)
              const batchResult = await extractDocumentFacts(
                endpoint,
                deployment,
                batch,
                body.workloadId,
                async (response) =>
                  store.put('model-raw', rawCacheId, response),
                assessment?.resources ?? [],
                (stage) => {
                  processingStage = `sharepoint-fact-${stage}`
                },
              )
              factsForBatch = batchResult.facts
            }
            for (const fact of factsForBatch)
              factCandidates.set(fact.factId, fact)
          }
          const extraction = {
            facts: [...factCandidates.values()],
            promptVersion: DOCUMENT_FACT_EXTRACTION_PROMPT_VERSION,
          }
          const current = existing ?? {
            schemaVersion: '1' as const,
            workloadId: body.workloadId,
            sampleOnly: registered.source.sampleOnly,
            sourceConfigurationVersion: registered.source.configurationVersion,
            documentRevisions: [],
            facts: [],
            extractionRecords: [],
            observedAt: new Date().toISOString(),
          }
          const revisions = new Map(
            current.documentRevisions.map((item) => [
              `${item.sourceId}:${item.itemId}:${item.contentHash}`,
              item,
            ]),
          )
          revisions.set(
            `${revision.sourceId}:${revision.itemId}:${revision.contentHash}`,
            revision,
          )
          const facts = new Map(
            current.facts.map((fact) => [fact.factId, fact]),
          )
          let addedCandidateCount = 0
          let updatedLinkCandidateCount = 0
          for (const fact of extraction.facts)
            if (!facts.has(fact.factId)) {
              facts.set(fact.factId, fact)
              addedCandidateCount++
            } else {
              const previous = facts.get(fact.factId)!
              if (
                previous.reviewStatus === 'Candidate' &&
                JSON.stringify(previous.resourceLinkCandidates ?? []) !==
                  JSON.stringify(fact.resourceLinkCandidates ?? [])
              ) {
                facts.set(fact.factId, {
                  ...previous,
                  ...(fact.resourceLinkCandidates?.length
                    ? { resourceLinkCandidates: fact.resourceLinkCandidates }
                    : { resourceLinkCandidates: undefined }),
                })
                updatedLinkCandidateCount++
              }
            }
          if (
            priorExtraction &&
            addedCandidateCount === 0 &&
            updatedLinkCandidateCount === 0
          )
            return reply(200, {
              grounding: existing,
              groundingHash: hash(existing),
              addedCandidateCount: 0,
              updatedLinkCandidateCount: 0,
              promptVersion: extraction.promptVersion,
              alreadyExtracted: reusedExtraction,
            })
          const grounding = documentGroundingSchema.parse({
            ...current,
            documentRevisions: [...revisions.values()],
            facts: [...facts.values()],
            extractionRecords: [
              ...(current.extractionRecords ?? []).filter(
                (record) =>
                  !(
                    record.sourceId === body.sourceId &&
                    record.itemId === revision.itemId &&
                    record.contentHash === revision.contentHash &&
                    record.promptVersion === extraction.promptVersion &&
                    record.deployment === deployment &&
                    record.modelVersion === modelVersion
                  ),
              ),
              {
                sourceId: body.sourceId,
                itemId: revision.itemId,
                contentHash: revision.contentHash,
                promptVersion: extraction.promptVersion,
                deployment,
                modelVersion,
                completedAt: new Date().toISOString(),
              },
            ],
            observedAt: new Date().toISOString(),
          })
          let groundingHash: string
          processingStage = 'sharepoint-fact-grounding-save'
          try {
            groundingHash = await store.saveDocumentGrounding(
              grounding,
              existing ? hash(existing) : null,
            )
          } catch (error) {
            if (/changed during review/.test(String(error)))
              return reply(409, {
                error: 'Document facts changed; reload before extraction',
              })
            throw error
          }
          return reply(200, {
            grounding,
            groundingHash,
            addedCandidateCount,
            updatedLinkCandidateCount,
            promptVersion: extraction.promptVersion,
            alreadyExtracted: reusedExtraction,
          })
        }
        if (path === 'sharepoint-facts/review') {
          requireUserRole(principal, apiRolePolicy.businessContext)
          const body = z
            .object({
              sourceId: z.string().min(1).max(100),
              workloadId: z.string().min(1).max(200),
              assessmentId: z.string().min(1).max(200).nullable(),
              groundingHash: z.string().regex(/^[a-f0-9]{64}$/),
              decisions: z
                .array(
                  z
                    .object({
                      factId: z.string().min(1).max(200),
                      reviewStatus: z.enum(['Confirmed', 'Rejected']),
                      statement: z.string().trim().min(1).max(4000),
                      resourceIds: z
                        .array(z.string().regex(/^\/subscriptions\//i))
                        .max(100),
                      relatedFactIds: z
                        .array(z.string().min(1).max(200))
                        .max(20)
                        .optional(),
                    })
                    .strict(),
                )
                .min(1)
                .max(200),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          const registered = await store.sharePointSource(body.sourceId)
          if (
            !registered ||
            !registered.source.workloadIds.includes(body.workloadId) ||
            !sharePointSourceModeEnabled(registered.source.sampleOnly)
          )
            return reply(404, { error: 'Eligible SharePoint source not found' })
          const existing = await store.documentGrounding(
            body.workloadId,
            registered.source.sampleOnly,
          )
          if (!existing || hash(existing) !== body.groundingHash)
            return reply(409, {
              error: 'Document facts changed; reload before review',
            })
          const decisions = new Map(
            body.decisions.map((decision) => [decision.factId, decision]),
          )
          if (decisions.size !== body.decisions.length)
            return reply(400, {
              error: 'Duplicate fact decisions are not allowed',
            })
          if (
            body.decisions.some((decision) => {
              const fact = existing.facts.find(
                (item) => item.factId === decision.factId,
              )
              if (!fact) return true
              if (fact.reviewStatus === 'Candidate') return false
              if (
                fact.reviewStatus !== 'Confirmed' ||
                decision.reviewStatus !== 'Confirmed' ||
                decision.relatedFactIds === undefined ||
                decision.statement.trim() !== fact.statement
              )
                return true
              const priorIds = (fact.resourceIds ?? []).map((id) =>
                id.toLowerCase(),
              )
              const requestedIds = decision.resourceIds.map((id) =>
                id.toLowerCase(),
              )
              return (
                priorIds.length !== requestedIds.length ||
                priorIds.some((id) => !requestedIds.includes(id))
              )
            })
          )
            return reply(409, {
              error:
                'Only candidate facts can be reviewed; confirmed facts can only update explicit dependency links',
            })
          const assessment = body.assessmentId
            ? await store.assessment(body.assessmentId)
            : null
          if (assessment && assessment.workloadId !== body.workloadId)
            return reply(409, {
              error: 'Selected assessment belongs to a different Workload',
            })
          const requestedLinkedFactIds = body.decisions.flatMap(
            (decision) => decision.relatedFactIds ?? [],
          )
          const requestedLinkedResourceIds =
            requestedLinkedFactIds.length > 0
              ? documentFactDependencyResourceIds(
                  existing,
                  requestedLinkedFactIds,
                )
              : []
          if (
            body.decisions.some((decision) => {
              const fact = existing.facts.find(
                (item) => item.factId === decision.factId,
              )
              if (!fact) return true
              if (
                fact.kind !== 'ResourceDependency' &&
                decision.resourceIds.length > 0
              )
                return true
              if (
                new Set(decision.resourceIds.map((id) => id.toLowerCase()))
                  .size !== decision.resourceIds.length
              )
                return true
              if (
                decision.relatedFactIds?.length &&
                (!assessment ||
                  requestedLinkedResourceIds.some(
                    (resourceId) =>
                      !assessment.resources.some(
                        (resource) =>
                          resource.id.toLowerCase() ===
                          resourceId.toLowerCase(),
                      ),
                  ))
              )
                return true
              return decision.resourceIds.some(
                (resourceId) =>
                  !assessment?.resources.some(
                    (resource) =>
                      resource.id.toLowerCase() === resourceId.toLowerCase(),
                  ),
              )
            })
          )
            return reply(400, {
              error: 'Resource links must reference the selected assessment',
            })
          const now = new Date().toISOString()
          const facts = existing.facts.map((fact) => {
            const decision = decisions.get(fact.factId)
            if (!decision) return fact
            return {
              ...fact,
              statement: decision.statement.trim(),
              reviewStatus: decision.reviewStatus,
              reviewedBy: principal.id,
              reviewedAt: now,
              resourceIds: decision.resourceIds,
              ...(decision.relatedFactIds
                ? { relatedFactIds: decision.relatedFactIds }
                : {}),
            }
          })
          const updatedResult = documentGroundingSchema.safeParse({
            ...existing,
            facts,
            observedAt: now,
          })
          if (!updatedResult.success)
            return reply(400, {
              error:
                'Dependency links must connect eligible confirmed facts without cycles',
            })
          const updated = updatedResult.data
          let groundingHash: string
          try {
            groundingHash = await store.saveDocumentGrounding(
              updated,
              body.groundingHash,
            )
          } catch (error) {
            if (/changed during review/.test(String(error)))
              return reply(409, {
                error: 'Document facts changed; reload before review',
              })
            throw error
          }
          return reply(200, { grounding: updated, groundingHash })
        }
        if (path === 'sharepoint-sync') {
          requireUserRole(principal, apiRolePolicy.sync)
          if (process.env.SHAREPOINT_SYNC_ENABLED !== 'true')
            return reply(503, { error: 'SharePoint document sync disabled' })
          const body = z
            .object({ sourceId: z.string().min(1).max(100) })
            .strict()
            .parse(JSON.parse(requestContent))
          const registered = await store.sharePointSource(body.sourceId)
          if (!registered)
            return reply(404, { error: 'SharePoint source not found' })
          if (
            registered.source.tenantId !== config().tenantId ||
            !sharePointSourceModeEnabled(registered.source.sampleOnly)
          )
            return reply(400, {
              error: 'SharePoint source mode is not enabled',
            })
          const now = new Date().toISOString()
          const run = await store.createSharePointSyncRun({
            runId: randomUUID(),
            source: registered.source,
            sourceConfigurationHash: registered.sourceHash,
            requestedBy: principal.id,
            requestedAt: now,
          })
          try {
            await store.dispatchSharePointSyncs()
          } catch (error) {
            logProcessingFailure(
              'sharepoint-sync-dispatch',
              error,
              correlationId,
            )
          }
          return reply(202, await store.sharePointSyncRun(run.runId))
        }
        if (path === 'sync') {
          requireUserRole(principal, apiRolePolicy.sync)
          const body = z
            .object({
              assessmentIds: z
                .array(z.string().regex(/^[a-f0-9]{64}$/))
                .max(10)
                .default([]),
            })
            .strict()
            .parse(JSON.parse(requestContent))
          return reply(202, await synchronize(body.assessmentIds))
        }
        const payload: unknown = JSON.parse(requestContent)
        if (path === 'decision-reevaluation') {
          requireUserRole(principal, apiRolePolicy.decisionReevaluation)
          if (
            process.env.TEST_MODE_ENABLED !== 'true' ||
            process.env.DECISION_REEVALUATION_ENABLED !== 'true'
          )
            return reply(404, { error: 'Decision reevaluation is disabled' })
          const body = z
            .object({
              assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
              runId: z.string().uuid(),
              reason: z.string().trim().min(10).max(500),
            })
            .strict()
            .parse(payload)
          const assessment = await store.assessment(body.assessmentId)
          if (
            assessment.event.trackingId === 'ARP-SYNTHETIC-UAT-001' ||
            assessment.event.classification === 'OutOfScope' ||
            assessment.humanContext?.scopeDisposition === 'OutOfScope'
          )
            return reply(400, {
              error: 'Only an in-scope real notice can be reevaluated',
            })
          if (!assessment.discoveryScope)
            return reply(409, {
              error: 'Stored discovery snapshot is missing; synchronize first',
            })
          const logicalId = hash({
            eventId: assessment.event.id,
            workloadId: assessment.workloadId,
          })
          const head = await store.head(logicalId)
          if (!head || head.assessmentId !== assessment.id)
            return reply(409, {
              error: 'Assessment is not the current version',
            })
          const now = new Date().toISOString()
          const run = await store.createDecisionReevaluation({
            runId: body.runId,
            assessmentId: assessment.id,
            state: 'Pending',
            requestedBy: principal.id,
            requestedAt: now,
            reason: body.reason,
            resultAssessmentId: null,
            error: null,
            updatedAt: now,
          })
          if (run.state === 'Pending') {
            try {
              await store.dispatchDecisionReevaluations()
            } catch (error) {
              logProcessingFailure(
                'decision-reevaluation-dispatch',
                error,
                correlationId,
              )
            }
          }
          return reply(202, run)
        }
        if (path === 'uat/seed') {
          requireUserRole(principal, apiRolePolicy.review)
          if (
            process.env.TEST_MODE_ENABLED !== 'true' ||
            process.env.SYNTHETIC_UAT_ENABLED !== 'true'
          )
            return reply(404, { error: 'Synthetic UAT is disabled' })
          z.object({}).strict().parse(payload)
          const sample = createSyntheticUatAssessment()
          const logicalId = hash({
            eventId: sample.event.id,
            workloadId: sample.workloadId,
          })
          const prior = await store.head(logicalId)
          let source = sample
          if (prior) {
            const existing = await store.assessment(prior.assessmentId)
            if (!isSyntheticUatAssessment(existing))
              return reply(409, { error: 'Synthetic UAT identity conflict' })
            if (
              existing.modelInvocations?.some(
                (invocation) =>
                  invocation.stage === 'Decision' &&
                  invocation.status === 'Succeeded',
              )
            )
              return reply(200, {
                assessmentId: existing.id,
                created: false,
                decisionStatus: existing.decision.status,
              })
            source = existing
          }
          processingStage = 'synthetic-uat-decision'
          const evaluated = await evaluateSyntheticUat(source)
          await store.commitAssessment(evaluated, prior)
          return reply(201, {
            assessmentId: evaluated.id,
            created: true,
            decisionStatus: evaluated.decision.status,
          })
        }
        if (path === 'uat/export') {
          requireUserRole(principal, apiRolePolicy.review)
          if (
            process.env.TEST_MODE_ENABLED !== 'true' ||
            process.env.SYNTHETIC_UAT_ENABLED !== 'true'
          )
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
          if (!item || !item.title.startsWith('[SYNTHETIC UAT]'))
            return reply(400, {
              error: 'Only a synthetic UAT work item can be exported',
            })
          if (
            assessment.modelInvocations?.find(
              (invocation) => invocation.stage === 'Decision',
            )?.status !== 'Succeeded'
          )
            return reply(409, {
              error: 'Decision-1 evaluation must succeed before UAT export',
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
          const alreadyExported =
            row.state === 'Exported' &&
            safeGitHubIssueUrl(row.issueUrl) !== null
          if (hasCompleteSyntheticUatIssueHierarchy(row))
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
            assessment,
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
            alreadyExported,
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
          const region = process.env.TRANSLATOR_REGION
          if (!resourceId || !region)
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
            region,
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
          if (isTestReevaluation(original))
            return reply(409, {
              error: 'Test reevaluation assessments are read-only',
            })
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
          const revised = applyReviewWorkflowPolicy(
            reviseAssessment(
              original,
              body.correction,
              principal.id,
              new Date().toISOString(),
            ),
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
              result: z.enum([
                'Approved',
                'Partial',
                'Returned',
                'Held',
                'NoAction',
              ]),
            })
            .strict()
            .parse(payload)
          const assessment = await store.assessment(body.assessmentId)
          if (isTestReevaluation(assessment))
            return reply(409, {
              error: 'Test reevaluation assessments cannot be approved',
            })
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
          if (approval.result === 'NoAction' && !approval.reason.trim())
            return reply(400, { error: 'No-action decision requires a reason' })
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
      if (error instanceof RequestBodyTooLargeError)
        return reply(413, { error: 'Request too large' })
      if (
        message === 'Forbidden' ||
        message === 'Application identity required'
      )
        return reply(403, { error: 'Forbidden' })
      if (error instanceof z.ZodError && !uatFailureTarget)
        return reply(400, { error: 'Invalid request' })
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
        ...(error instanceof DocumentFactExtractionResponseError
          ? { extractionFailureCode: error.failureCode }
          : {}),
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
      } else if (
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'decision-reevaluation'
      ) {
        const job = z
          .object({
            kind: z.literal('decision-reevaluation'),
            runId: z.string().uuid(),
          })
          .strict()
          .parse(message)
        await processDecisionReevaluation(job.runId)
      } else await assessSnapshot(message)
    }),
})
app.storageQueue('sharepointDocumentSync', {
  queueName: 'sharepoint-document-syncs',
  connection: 'DATA_QUEUE',
  handler: async (message) =>
    withProcessingFailureLog('sharepoint-document-sync', async () => {
      const job = z.object({ runId: z.uuid() }).strict().parse(message)
      await processSharePointSync(job.runId)
    }),
})
app.storageQueue('sharepointDocumentSyncPoison', {
  queueName: 'sharepoint-document-syncs-poison',
  connection: 'DATA_QUEUE',
  handler: async (message) =>
    withProcessingFailureLog('sharepoint-document-sync-poison', async () => {
      const job = z.object({ runId: z.uuid() }).strict().parse(message)
      await new AzureStore(config().account).failExhaustedSharePointSyncRun(
        job.runId,
      )
    }),
})
app.timer('sharepointDocumentSyncDispatch', {
  schedule: '0 */1 * * * *',
  handler: async () =>
    withProcessingFailureLog('sharepoint-document-sync-dispatch', async () => {
      if (process.env.SHAREPOINT_SYNC_ENABLED !== 'true') return
      await new AzureStore(config().account).dispatchSharePointSyncs()
    }),
})
app.timer('decisionReevaluationDispatch', {
  schedule: '0 */1 * * * *',
  handler: async () =>
    withProcessingFailureLog('decision-reevaluation-dispatch', async () => {
      const store = new AzureStore(config().account)
      await store.recoverStaleDecisionReevaluations()
      await store.dispatchDecisionReevaluations()
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

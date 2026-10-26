import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { z } from 'zod'
import { approvalSchema, correctionSchema } from '@arp/contracts'
import { hash, reviseAssessment } from '@arp/domain'
import {
  AzureStore,
  createVerifier,
  requireApplicationRole,
  requireUserRole,
  apiRolePolicy,
  required,
  verifyWriteRequest,
  logProcessingFailure,
  withProcessingFailureLog,
} from '@arp/adapters'
import { assessSnapshot, config, synchronize } from './service.ts'

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
app.http('api', {
  route: 'api/{*path}',
  authLevel: 'anonymous',
  methods: ['GET', 'POST'],
  handler: async (request: HttpRequest) => {
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
      const store = new AzureStore(config().account)
      if (request.method === 'GET' && path === 'assessments')
        return reply(200, await store.list())
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
          requireRole(principal, ['Reviewer', 'Governance'])
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
          await store.approve(assessment, approval)
          if (process.env.EXPORT_ENABLED === 'true')
            await store.dispatchOutbox()
          return reply(200, {
            reviewId: approval.id,
            exportEnabled: process.env.EXPORT_ENABLED === 'true',
          })
        }
      }
      return reply(404, { error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'Forbidden' || message === 'Application identity required')
        return reply(403, { error: 'Forbidden' })
      if (error instanceof z.ZodError)
        return reply(400, { error: 'Invalid request' })
      if (/JWT|token|tenant|principal|signature/i.test(message))
        return reply(401, { error: 'Authentication failed' })
      if (/Stale|承認対象|未承認|検証不適合/.test(message))
        return reply(409, { error: 'Review conflict or validation failed' })
      if (/origin|content-type/.test(message))
        return reply(403, { error: 'Write origin rejected' })
      const correlationId = randomUUID()
      logProcessingFailure('http', error, correlationId)
      return reply(503, {
        error: 'Processing failed',
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

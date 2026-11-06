export type SafeFailureCategory =
  | 'Unauthorized'
  | 'Forbidden'
  | 'Throttled'
  | 'UpstreamUnavailable'
  | 'Timeout'
  | 'InvalidResponse'
  | 'NetworkError'
  | 'Unknown'

export class GitHubGraphQLError extends Error {
  category: SafeFailureCategory
  operation: string
  providerCode: string | null
  httpStatus = 200
  constructor(
    category: SafeFailureCategory,
    operation: string,
    providerCode: string | null = null,
  ) {
    super('GitHub GraphQL operation failed')
    this.name = 'GitHubGraphQLError'
    this.category = category
    this.operation = operation
    this.providerCode = providerCode
  }
}

export class RemoteError extends Error {
  status: number
  retryAfterMs: number
  constructor(status: number, retryAfterMs = 1000) {
    super(`Remote service failed (${status})`)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the size limit')
    this.name = 'RequestBodyTooLargeError'
  }
}

export async function readLimitedRequestText(
  request: {
    headers: Headers
    body: unknown
  },
  maxBytes: number,
): Promise<string> {
  const body = request.body as ReadableStream<unknown> | null
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > maxBytes) {
    await body?.cancel().catch(() => undefined)
    throw new RequestBodyTooLargeError()
  }
  const reader = body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    if (!(part.value instanceof Uint8Array))
      throw new TypeError('Request body stream returned invalid data')
    size += part.value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new RequestBodyTooLargeError()
    }
    chunks.push(part.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks, size))
}

export async function jsonRequest(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after') ?? '1')
    throw new RemoteError(
      response.status,
      Number.isFinite(retry)
        ? Math.max(0, Math.min(30000, retry * 1000))
        : 1000,
    )
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > 8_000_000) throw new Error('Remote response too large')
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  if (reader)
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 8_000_000) {
        await reader.cancel()
        throw new Error('Remote response too large')
      }
      chunks.push(part.value)
    }
  if (!size) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function safeModelEndpoint(raw: string): string {
  const url = new URL(raw)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    ![
      '.cognitiveservices.azure.com',
      '.openai.azure.com',
      '.services.ai.azure.com',
    ].some((s) => url.hostname.endsWith(s))
  )
    throw new Error('Unapproved model endpoint')
  return url.origin
}
export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing setting: ${name}`)
  return value
}

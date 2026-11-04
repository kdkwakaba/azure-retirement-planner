import { randomUUID } from 'node:crypto'
import type {
  DiscoveryFailure,
  DiscoveryFailureSource,
  ModelInvocation,
} from '@arp/contracts'
import { GitHubGraphQLError, RemoteError } from './http.ts'

export interface ProcessingFailureRecord {
  event: 'ProcessingFailure'
  stage: string
  correlationId: string
  errorType: string
  category: DiscoveryFailure['category']
  httpStatus: number | null
}

export function failureFacts(error: unknown): {
  category: DiscoveryFailure['category']
  httpStatus: number | null
} {
  if (error instanceof GitHubGraphQLError)
    return { category: error.category, httpStatus: error.httpStatus }
  const status =
    error instanceof RemoteError
      ? error.status
      : typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : null
  if (
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  ) {
    return {
      category:
        status === 401
          ? 'Unauthorized'
          : status === 403
            ? 'Forbidden'
            : status === 429
              ? 'Throttled'
              : status === 408
                ? 'Timeout'
                : status >= 500
                  ? 'UpstreamUnavailable'
                  : status >= 400
                    ? 'InvalidResponse'
                    : 'Unknown',
      httpStatus: status,
    }
  }
  const name = error instanceof Error ? error.name : ''
  return {
    category:
      name === 'TimeoutError' || name === 'AbortError'
        ? 'Timeout'
        : name === 'SyntaxError' || name === 'ZodError'
          ? 'InvalidResponse'
          : name === 'TypeError'
            ? 'NetworkError'
            : 'Unknown',
    httpStatus: null,
  }
}

/** Emit only safe source, category, status and correlation metadata. */
export function recordDependencyFailure(
  source: DiscoveryFailureSource,
  error: unknown,
): DiscoveryFailure {
  const details = failureFacts(error)
  const result: DiscoveryFailure = {
    source,
    ...details,
    correlationId: randomUUID(),
  }
  console.error(
    JSON.stringify({ event: 'ExternalDependencyFailure', ...result }),
  )
  return result
}

/** Model telemetry deliberately excludes prompts, inputs and model outputs. */
export function recordModelInvocation(invocation: ModelInvocation): void {
  console.info(JSON.stringify({ event: 'ModelInvocation', ...invocation }))
}

/**
 * Emit a small, structured operational record without logging payloads,
 * resource identifiers, exception messages, or stack traces.
 */
export function logProcessingFailure(
  stage: string,
  error: unknown,
  correlationId = randomUUID(),
): string {
  const rawType =
    error instanceof Error
      ? error.name
      : typeof error === 'string'
        ? 'Error'
        : 'UnknownError'
  const errorType = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(rawType)
    ? rawType
    : 'Error'
  const record: ProcessingFailureRecord = {
    event: 'ProcessingFailure',
    stage,
    correlationId,
    errorType,
    ...failureFacts(error),
  }
  console.error(JSON.stringify(record))
  return correlationId
}

/** Log and rethrow so Azure Functions keeps its retry and poison behavior. */
export async function withProcessingFailureLog<T>(
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    logProcessingFailure(stage, error)
    throw error
  }
}

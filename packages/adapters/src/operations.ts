export interface ProcessingFailureRecord {
  event: 'ProcessingFailure'
  stage: string
  correlationId: string
  errorType: string
}

/**
 * Emit a small, structured operational record without logging payloads,
 * resource identifiers, exception messages, or stack traces.
 */
export function logProcessingFailure(
  stage: string,
  error: unknown,
  correlationId = crypto.randomUUID(),
): string {
  const rawType =
    error instanceof Error ? error.name : typeof error === 'string' ? 'Error' : 'UnknownError'
  const errorType = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(rawType)
    ? rawType
    : 'Error'
  const record: ProcessingFailureRecord = {
    event: 'ProcessingFailure',
    stage,
    correlationId,
    errorType,
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

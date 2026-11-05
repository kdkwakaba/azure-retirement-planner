export type SharePointModeEnvironment = Record<string, string | undefined>

/**
 * Keep SharePoint sample content confined to the explicit test mode. Live
 * sources are a separate opt-in and are unavailable while test mode is on.
 */
export function sharePointSourceModeEnabled(
  sampleOnly: boolean,
  environment: SharePointModeEnvironment = process.env,
): boolean {
  if (environment.SHAREPOINT_SYNC_ENABLED !== 'true') return false
  if (sampleOnly) return environment.TEST_MODE_ENABLED === 'true'
  return (
    environment.TEST_MODE_ENABLED !== 'true' &&
    environment.SHAREPOINT_LIVE_SOURCES_ENABLED === 'true'
  )
}

export function sharePointFactExtractionModeEnabled(
  sampleOnly: boolean,
  environment: SharePointModeEnvironment = process.env,
): boolean {
  return (
    environment.SHAREPOINT_FACT_EXTRACTION_ENABLED === 'true' &&
    sharePointSourceModeEnabled(sampleOnly, environment)
  )
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sharePointFactExtractionModeEnabled,
  sharePointSourceModeEnabled,
} from '../apps/assessment-api/src/sharepoint-mode.ts'

test('SharePoint sample sources are enabled only in test mode', () => {
  const testMode = {
    TEST_MODE_ENABLED: 'true',
    SHAREPOINT_SYNC_ENABLED: 'true',
    SHAREPOINT_FACT_EXTRACTION_ENABLED: 'true',
    SHAREPOINT_LIVE_SOURCES_ENABLED: 'true',
  }

  assert.equal(sharePointSourceModeEnabled(true, testMode), true)
  assert.equal(sharePointFactExtractionModeEnabled(true, testMode), true)
  assert.equal(sharePointSourceModeEnabled(false, testMode), false)
  assert.equal(sharePointFactExtractionModeEnabled(false, testMode), false)
})

test('live SharePoint sources require test mode off and an explicit feature flag', () => {
  const liveMode = {
    TEST_MODE_ENABLED: 'false',
    SHAREPOINT_SYNC_ENABLED: 'true',
    SHAREPOINT_FACT_EXTRACTION_ENABLED: 'true',
    SHAREPOINT_LIVE_SOURCES_ENABLED: 'true',
  }

  assert.equal(sharePointSourceModeEnabled(false, liveMode), true)
  assert.equal(sharePointFactExtractionModeEnabled(false, liveMode), true)
  assert.equal(sharePointSourceModeEnabled(true, liveMode), false)
  assert.equal(
    sharePointSourceModeEnabled(false, {
      ...liveMode,
      SHAREPOINT_LIVE_SOURCES_ENABLED: 'false',
    }),
    false,
  )
  assert.equal(
    sharePointSourceModeEnabled(false, {
      ...liveMode,
      SHAREPOINT_SYNC_ENABLED: 'false',
    }),
    false,
  )
})

test('fact extraction also requires its own feature flag', () => {
  assert.equal(
    sharePointFactExtractionModeEnabled(false, {
      TEST_MODE_ENABLED: 'false',
      SHAREPOINT_SYNC_ENABLED: 'true',
      SHAREPOINT_FACT_EXTRACTION_ENABLED: 'false',
      SHAREPOINT_LIVE_SOURCES_ENABLED: 'true',
    }),
    false,
  )
})

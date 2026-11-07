import type { Assessment } from '@arp/contracts'

export const testModeEvaluationTrackingId = 'ARP-TEST-MODE-EVALUATION-001'
const legacyTestModeEvaluationTrackingId = 'ARP-SYNTHETIC-UAT-001'

export function isTestModeEvaluationTrackingId(trackingId: string): boolean {
  return [
    testModeEvaluationTrackingId,
    legacyTestModeEvaluationTrackingId,
  ].includes(trackingId)
}

export function visibleAssessments(
  assessments: Assessment[],
  testModeEnabled: boolean,
  testModeEvaluationEnabled: boolean,
  includeNoAction = false,
): Assessment[] {
  return assessments.filter(
    (item) =>
      (includeNoAction || item.reviewDisposition !== 'NoAction') &&
      ((testModeEnabled && testModeEvaluationEnabled) ||
        !isTestModeEvaluationTrackingId(item.event.trackingId)),
  )
}

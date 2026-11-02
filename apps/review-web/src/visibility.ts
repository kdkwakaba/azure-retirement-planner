import type { Assessment } from '@arp/contracts'

export const syntheticUatTrackingId = 'ARP-SYNTHETIC-UAT-001'

export function visibleAssessments(
  assessments: Assessment[],
  testModeEnabled: boolean,
  syntheticUatEnabled: boolean,
  includeNoAction = false,
): Assessment[] {
  return assessments.filter(
    (item) =>
      (includeNoAction || item.reviewDisposition !== 'NoAction') &&
      ((testModeEnabled && syntheticUatEnabled) ||
        item.event.trackingId !== syntheticUatTrackingId),
  )
}

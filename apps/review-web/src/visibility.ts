import type { Assessment } from '@arp/contracts'

export const syntheticUatTrackingId = 'ARP-SYNTHETIC-UAT-001'

export function visibleAssessments(
  assessments: Assessment[],
  testModeEnabled: boolean,
  syntheticUatEnabled: boolean,
): Assessment[] {
  if (!testModeEnabled || !syntheticUatEnabled)
    return assessments.filter(
      (item) => item.event.trackingId !== syntheticUatTrackingId,
    )
  return assessments
}

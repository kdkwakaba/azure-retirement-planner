import type { Assessment } from '@arp/contracts'

export interface AssessmentSummary {
  totalRecords: number
  humanReviewRequired: number
  highPriority: number
  incompleteDiscovery: number
}

export function summarizeAssessments(
  assessments: Assessment[],
): AssessmentSummary {
  return assessments.reduce<AssessmentSummary>(
    (summary, assessment) => {
      summary.totalRecords += 1
      if (assessment.humanReviewRequired !== false)
        summary.humanReviewRequired += 1
      if (['P1', 'P2'].includes(assessment.effectivePriority ?? ''))
        summary.highPriority += 1
      if (assessment.scopeComplete !== true) summary.incompleteDiscovery += 1
      return summary
    },
    {
      totalRecords: 0,
      humanReviewRequired: 0,
      highPriority: 0,
      incompleteDiscovery: 0,
    },
  )
}

import type { Impact, Priority } from '@arp/contracts'
import { validateEvaluationManifest } from './evaluation-manifest.ts'
import type {
  EvaluationManifest,
  EvaluationSplit,
} from './evaluation-manifest.ts'

export interface EvaluationCase {
  caseId: string
  knownResourceIds: string[]
  expected: {
    impactedResourceIds: string[]
    impactIfUnaddressed: Impact | null
    impactDuringChange: Impact | null
    priority: Priority | null
    ownerTeam: string | null
    requiredWorkItemKeys: string[]
    retirementNotice: boolean
  }
  observed: {
    candidateResourceIds: string[]
    verificationConfirmedResourceIds: string[]
    impactIfUnaddressed: Impact | null
    impactDuringChange: Impact | null
    priority: Priority | null
    ownerTeam: string | null
    workItemKeys: string[]
    generatedResourceIds: string[]
    validationAcceptedResourceIds: string[]
    factualClaimCount: number
    unsupportedFactualClaimCount: number
    humanOverrideCount: number
    humanJudgementCount: number
    retirementDetected: boolean
  }
}

export interface EvaluationScore {
  observationId: string
  result: EvaluationCase
}

export interface SplitEvaluationResult {
  observationCount: number
  independentScenarioCount: number
  observationIds: string[]
  metrics: EvaluationReport
}

export interface EvaluationBenchmarkReport {
  schemaVersion: '1'
  benchmarkVersion: string
  observationCount: number
  independentScenarioCount: number
  splits: Record<EvaluationSplit, SplitEvaluationResult | null>
}

export interface EvaluationRate {
  numerator: number
  denominator: number
  value: number | null
}

export interface EvaluationReport {
  schemaVersion: '1'
  caseCount: number
  resourceDiscovery: {
    precision: EvaluationRate
    recall: EvaluationRate
    verificationConfirmedRecall: EvaluationRate
  }
  impactIfUnaddressed: {
    exactAgreement: EvaluationRate
    weightedAgreement: EvaluationRate
    underestimationCount: number
  }
  impactDuringChange: {
    exactAgreement: EvaluationRate
    weightedAgreement: EvaluationRate
    underestimationCount: number
  }
  priority: {
    exactAgreement: EvaluationRate
    weightedAgreement: EvaluationRate
    underestimationCount: number
  }
  ownerTeam: {
    exactAgreement: EvaluationRate
    eligibleCases: number
    abstainedCases: number
  }
  fabricatedResources: {
    generated: EvaluationRate
    validationPassed: EvaluationRate
  }
  unsupportedFactualClaims: EvaluationRate
  requiredWorkItems: {
    precision: EvaluationRate
    recall: EvaluationRate
  }
  humanOverrides: EvaluationRate
  retirementDetection: {
    misses: number
    expectedNotices: number
    missRate: number | null
  }
}

const impactRank: Record<Impact, number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Critical: 3,
}
const priorityRank: Record<Priority, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
}

function rate(numerator: number, denominator: number): EvaluationRate {
  return {
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
  }
}

function validateCases(cases: EvaluationCase[]): void {
  const ids = new Set<string>()
  for (const item of cases) {
    if (!item.caseId.trim() || ids.has(item.caseId))
      throw new Error('Evaluation case IDs must be non-empty and unique')
    ids.add(item.caseId)
    for (const value of [
      item.observed.factualClaimCount,
      item.observed.unsupportedFactualClaimCount,
      item.observed.humanOverrideCount,
      item.observed.humanJudgementCount,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`Evaluation case ${item.caseId} has an invalid count`)
    }
    if (
      item.observed.unsupportedFactualClaimCount >
        item.observed.factualClaimCount ||
      item.observed.humanOverrideCount > item.observed.humanJudgementCount
    )
      throw new Error(`Evaluation case ${item.caseId} has inconsistent counts`)
    const known = new Set(item.knownResourceIds)
    if (
      item.expected.impactedResourceIds.some((id) => !known.has(id)) ||
      item.observed.verificationConfirmedResourceIds.some(
        (id) => !item.observed.candidateResourceIds.includes(id),
      )
    )
      throw new Error(
        `Evaluation case ${item.caseId} has inconsistent resources`,
      )
  }
}

function setCounts(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  let truePositive = 0
  for (const item of actualSet) if (expectedSet.has(item)) truePositive++
  return {
    truePositive,
    actualCount: actualSet.size,
    expectedCount: expectedSet.size,
  }
}

function agreement<T extends Impact | Priority>(
  cases: EvaluationCase[],
  expected: (item: EvaluationCase) => T | null,
  observed: (item: EvaluationCase) => T | null,
  ranks: Record<T, number>,
  underestimated: (expectedRank: number, observedRank: number) => boolean,
) {
  let exact = 0
  let weighted = 0
  let denominator = 0
  let underestimationCount = 0
  for (const item of cases) {
    const expectedValue = expected(item)
    if (expectedValue === null) continue
    denominator++
    const observedValue = observed(item)
    if (observedValue === null) continue
    const expectedRank = ranks[expectedValue]
    const observedRank = ranks[observedValue]
    if (expectedValue === observedValue) exact++
    weighted += 1 - Math.abs(expectedRank - observedRank) / 3
    if (underestimated(expectedRank, observedRank)) underestimationCount++
  }
  return {
    exactAgreement: rate(exact, denominator),
    weightedAgreement: rate(weighted, denominator),
    underestimationCount,
  }
}

export function evaluateCases(cases: EvaluationCase[]): EvaluationReport {
  validateCases(cases)
  let resourceTp = 0,
    resourcePredicted = 0,
    resourceExpected = 0,
    verifiedTp = 0,
    ownerExact = 0,
    ownerEligible = 0,
    ownerAbstained = 0,
    generatedFabricated = 0,
    generatedCount = 0,
    acceptedFabricated = 0,
    acceptedCount = 0,
    unsupportedClaims = 0,
    factualClaims = 0,
    workTp = 0,
    workPredicted = 0,
    workExpected = 0,
    overrideCount = 0,
    humanJudgementCount = 0,
    retirementMisses = 0,
    expectedNotices = 0

  for (const item of cases) {
    const discovered = setCounts(
      item.expected.impactedResourceIds,
      item.observed.candidateResourceIds,
    )
    const verified = setCounts(
      item.expected.impactedResourceIds,
      item.observed.verificationConfirmedResourceIds,
    )
    const work = setCounts(
      item.expected.requiredWorkItemKeys,
      item.observed.workItemKeys,
    )
    resourceTp += discovered.truePositive
    resourcePredicted += discovered.actualCount
    resourceExpected += discovered.expectedCount
    verifiedTp += verified.truePositive
    workTp += work.truePositive
    workPredicted += work.actualCount
    workExpected += work.expectedCount
    for (const id of item.observed.generatedResourceIds) {
      generatedCount++
      if (!item.knownResourceIds.includes(id)) generatedFabricated++
    }
    for (const id of item.observed.validationAcceptedResourceIds) {
      acceptedCount++
      if (!item.knownResourceIds.includes(id)) acceptedFabricated++
    }
    if (item.expected.ownerTeam !== null) {
      ownerEligible++
      if (item.observed.ownerTeam === null) ownerAbstained++
      else if (item.observed.ownerTeam === item.expected.ownerTeam) ownerExact++
    }
    factualClaims += item.observed.factualClaimCount
    unsupportedClaims += item.observed.unsupportedFactualClaimCount
    overrideCount += item.observed.humanOverrideCount
    humanJudgementCount += item.observed.humanJudgementCount
    if (item.expected.retirementNotice) {
      expectedNotices++
      if (!item.observed.retirementDetected) retirementMisses++
    }
  }

  const unaddressed = agreement(
    cases,
    (item) => item.expected.impactIfUnaddressed,
    (item) => item.observed.impactIfUnaddressed,
    impactRank,
    (expectedRank, observedRank) => observedRank < expectedRank,
  )
  const duringChange = agreement(
    cases,
    (item) => item.expected.impactDuringChange,
    (item) => item.observed.impactDuringChange,
    impactRank,
    (expectedRank, observedRank) => observedRank < expectedRank,
  )
  const priority = agreement(
    cases,
    (item) => item.expected.priority,
    (item) => item.observed.priority,
    priorityRank,
    (expectedRank, observedRank) => observedRank > expectedRank,
  )

  return {
    schemaVersion: '1',
    caseCount: cases.length,
    resourceDiscovery: {
      precision: rate(resourceTp, resourcePredicted),
      recall: rate(resourceTp, resourceExpected),
      verificationConfirmedRecall: rate(verifiedTp, resourceExpected),
    },
    impactIfUnaddressed: unaddressed,
    impactDuringChange: duringChange,
    priority,
    ownerTeam: {
      exactAgreement: rate(ownerExact, ownerEligible),
      eligibleCases: ownerEligible,
      abstainedCases: ownerAbstained,
    },
    fabricatedResources: {
      generated: rate(generatedFabricated, generatedCount),
      validationPassed: rate(acceptedFabricated, acceptedCount),
    },
    unsupportedFactualClaims: rate(unsupportedClaims, factualClaims),
    requiredWorkItems: {
      precision: rate(workTp, workPredicted),
      recall: rate(workTp, workExpected),
    },
    humanOverrides: rate(overrideCount, humanJudgementCount),
    retirementDetection: {
      misses: retirementMisses,
      expectedNotices,
      missRate: expectedNotices ? retirementMisses / expectedNotices : null,
    },
  }
}

export function evaluateManifest(
  input: EvaluationManifest,
  scores: EvaluationScore[],
): EvaluationBenchmarkReport {
  const manifest = validateEvaluationManifest(input)
  const observationsById = new Map(
    manifest.cases.map((observation) => [
      observation.observationId,
      observation,
    ]),
  )
  const scoresBySplit: Record<EvaluationSplit, EvaluationScore[]> = {
    Development: [],
    Calibration: [],
    Holdout: [],
  }
  const scoreByObservationId = new Map<string, EvaluationScore>()

  for (const score of scores) {
    if (!score.observationId.trim())
      throw new Error('Evaluation score observationId must be non-empty')
    if (scoreByObservationId.has(score.observationId))
      throw new Error('Evaluation scores contain duplicate observationId')
    const observation = observationsById.get(score.observationId)
    if (!observation)
      throw new Error('Evaluation score references an unknown observationId')
    scoreByObservationId.set(score.observationId, score)
  }

  if (scoreByObservationId.size !== observationsById.size)
    throw new Error('Evaluation scores must cover every manifest observation')
  for (const observation of manifest.cases) {
    const score = scoreByObservationId.get(observation.observationId)
    if (score) scoresBySplit[observation.split].push(score)
  }

  const splits = Object.fromEntries(
    (['Development', 'Calibration', 'Holdout'] as const).map((split) => {
      const splitScores = scoresBySplit[split]
      return [
        split,
        splitScores.length
          ? {
              observationCount: splitScores.length,
              independentScenarioCount: new Set(
                splitScores.map((score) => {
                  const observation = observationsById.get(score.observationId)!
                  return JSON.stringify([
                    observation.retirementFamilyKey,
                    observation.scenarioId,
                  ])
                }),
              ).size,
              observationIds: splitScores.map((score) => score.observationId),
              metrics: evaluateCases(splitScores.map((score) => score.result)),
            }
          : null,
      ]
    }),
  ) as Record<EvaluationSplit, SplitEvaluationResult | null>

  return {
    schemaVersion: '1',
    benchmarkVersion: manifest.benchmarkVersion,
    observationCount: manifest.cases.length,
    independentScenarioCount: new Set(
      manifest.cases.map((observation) =>
        JSON.stringify([
          observation.retirementFamilyKey,
          observation.scenarioId,
        ]),
      ),
    ).size,
    splits,
  }
}

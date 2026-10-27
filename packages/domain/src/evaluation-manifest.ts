export type EvaluationSplit = 'Development' | 'Calibration' | 'Holdout'
export type EvaluationSourceKind =
  'Synthetic' | 'OfficialSnapshot' | 'LiveReconstruction'
export type AdjudicationStatus =
  'Unreviewed' | 'SingleReviewer' | 'IndependentlyReviewed' | 'Consensus'

export interface EvaluationManifest {
  schemaVersion: '1'
  benchmarkVersion: string
  cases: EvaluationObservation[]
}

export interface EvaluationObservation {
  observationId: string
  scenarioId: string
  retirementFamilyKey: string
  split: EvaluationSplit
  repetition: number
  source: {
    kind: EvaluationSourceKind
    referenceIds: string[]
    capturedAt: string
    asOf: string
    contentHash: string
  }
  versions: {
    decisionModel: string | null
    decisionDeploymentVersion: string | null
    explanationModel: string | null
    explanationDeploymentVersion: string | null
    promptVersion: string | null
    ruleVersion: string
    contractVersion: string
  }
  run: {
    runId: string
    inputHash: string
    outputHash: string
    startedAt: string
    durationMs: number | null
  }
  adjudication: {
    status: AdjudicationStatus
    reviewerCount: number
    adjudicatedAt: string | null
  }
}

function record(
  value: unknown,
  path: string,
  keys: string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${path}: object required`)
  const result = value as Record<string, unknown>
  const actual = Object.keys(result).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${path}: unexpected or missing properties`)
  return result
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${path}: non-empty string required`)
  return value
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : nonEmpty(value, path)
}

function isoDateTime(value: unknown, path: string): string {
  const text = nonEmpty(value, path)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(
      text,
    ) ||
    !validDatePrefix(text) ||
    !Number.isFinite(Date.parse(text))
  )
    throw new Error(`${path}: ISO-8601 timestamp required`)
  return text
}

function validDatePrefix(value: string): boolean {
  try {
    dateOnly(value.slice(0, 10), 'timestamp')
    return true
  } catch {
    return false
  }
}

function dateOnly(value: unknown, path: string): string {
  const text = nonEmpty(value, path)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text
  )
    throw new Error(`${path}: valid YYYY-MM-DD date required`)
  return text
}

function sha256(value: unknown, path: string): string {
  const text = nonEmpty(value, path)
  if (!/^[a-f0-9]{64}$/i.test(text))
    throw new Error(`${path}: SHA-256 hex digest required`)
  return text.toLowerCase()
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`${path}: unsupported value`)
  return value as T
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path}: string array required`)
  const items = value.map((item, index) => nonEmpty(item, `${path}[${index}]`))
  if (new Set(items).size !== items.length)
    throw new Error(`${path}: duplicate values are not allowed`)
  return items
}

function count(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error(`${path}: integer >= ${minimum} required`)
  return value as number
}

function parseObservation(
  value: unknown,
  index: number,
): EvaluationObservation {
  const path = `cases[${index}]`
  const item = record(value, path, [
    'observationId',
    'scenarioId',
    'retirementFamilyKey',
    'split',
    'repetition',
    'source',
    'versions',
    'run',
    'adjudication',
  ])
  const source = record(item.source, `${path}.source`, [
    'kind',
    'referenceIds',
    'capturedAt',
    'asOf',
    'contentHash',
  ])
  const versions = record(item.versions, `${path}.versions`, [
    'decisionModel',
    'decisionDeploymentVersion',
    'explanationModel',
    'explanationDeploymentVersion',
    'promptVersion',
    'ruleVersion',
    'contractVersion',
  ])
  const run = record(item.run, `${path}.run`, [
    'runId',
    'inputHash',
    'outputHash',
    'startedAt',
    'durationMs',
  ])
  const adjudication = record(item.adjudication, `${path}.adjudication`, [
    'status',
    'reviewerCount',
    'adjudicatedAt',
  ])
  const parsedSource = {
    kind: enumValue(
      source.kind,
      ['Synthetic', 'OfficialSnapshot', 'LiveReconstruction'] as const,
      `${path}.source.kind`,
    ),
    referenceIds: stringArray(
      source.referenceIds,
      `${path}.source.referenceIds`,
    ),
    capturedAt: isoDateTime(source.capturedAt, `${path}.source.capturedAt`),
    asOf: dateOnly(source.asOf, `${path}.source.asOf`),
    contentHash: sha256(source.contentHash, `${path}.source.contentHash`),
  }
  if (
    parsedSource.kind !== 'Synthetic' &&
    parsedSource.referenceIds.length === 0
  )
    throw new Error(`${path}.source.referenceIds: required for source kind`)
  const parsedRun = {
    runId: nonEmpty(run.runId, `${path}.run.runId`),
    inputHash: sha256(run.inputHash, `${path}.run.inputHash`),
    outputHash: sha256(run.outputHash, `${path}.run.outputHash`),
    startedAt: isoDateTime(run.startedAt, `${path}.run.startedAt`),
    durationMs:
      run.durationMs === null
        ? null
        : count(run.durationMs, `${path}.run.durationMs`, 0),
  }
  const adjudicationStatus = enumValue(
    adjudication.status,
    [
      'Unreviewed',
      'SingleReviewer',
      'IndependentlyReviewed',
      'Consensus',
    ] as const,
    `${path}.adjudication.status`,
  )
  const reviewerCount = count(
    adjudication.reviewerCount,
    `${path}.adjudication.reviewerCount`,
    0,
  )
  const adjudicatedAt =
    adjudication.adjudicatedAt === null
      ? null
      : isoDateTime(
          adjudication.adjudicatedAt,
          `${path}.adjudication.adjudicatedAt`,
        )
  if (
    (adjudicationStatus === 'Unreviewed' &&
      (reviewerCount !== 0 || adjudicatedAt !== null)) ||
    (adjudicationStatus === 'SingleReviewer' &&
      (reviewerCount !== 1 || adjudicatedAt === null)) ||
    (['IndependentlyReviewed', 'Consensus'].includes(adjudicationStatus) &&
      (reviewerCount < 2 || adjudicatedAt === null))
  )
    throw new Error(`${path}.adjudication: inconsistent review state`)
  return {
    observationId: nonEmpty(item.observationId, `${path}.observationId`),
    scenarioId: nonEmpty(item.scenarioId, `${path}.scenarioId`),
    retirementFamilyKey: nonEmpty(
      item.retirementFamilyKey,
      `${path}.retirementFamilyKey`,
    ),
    split: enumValue(
      item.split,
      ['Development', 'Calibration', 'Holdout'] as const,
      `${path}.split`,
    ),
    repetition: count(item.repetition, `${path}.repetition`, 1),
    source: parsedSource,
    versions: {
      decisionModel: nullableString(
        versions.decisionModel,
        `${path}.versions.decisionModel`,
      ),
      decisionDeploymentVersion: nullableString(
        versions.decisionDeploymentVersion,
        `${path}.versions.decisionDeploymentVersion`,
      ),
      explanationModel: nullableString(
        versions.explanationModel,
        `${path}.versions.explanationModel`,
      ),
      explanationDeploymentVersion: nullableString(
        versions.explanationDeploymentVersion,
        `${path}.versions.explanationDeploymentVersion`,
      ),
      promptVersion: nullableString(
        versions.promptVersion,
        `${path}.versions.promptVersion`,
      ),
      ruleVersion: nonEmpty(
        versions.ruleVersion,
        `${path}.versions.ruleVersion`,
      ),
      contractVersion: nonEmpty(
        versions.contractVersion,
        `${path}.versions.contractVersion`,
      ),
    },
    run: parsedRun,
    adjudication: {
      status: adjudicationStatus,
      reviewerCount,
      adjudicatedAt,
    },
  }
}

export function validateEvaluationManifest(value: unknown): EvaluationManifest {
  const manifest = record(value, 'manifest', [
    'schemaVersion',
    'benchmarkVersion',
    'cases',
  ])
  if (manifest.schemaVersion !== '1')
    throw new Error('manifest.schemaVersion: unsupported version')
  if (!Array.isArray(manifest.cases))
    throw new Error('manifest.cases: array required')
  const cases = manifest.cases.map(parseObservation)
  if (!cases.length)
    throw new Error('manifest.cases: at least one case required')
  const observations = new Set<string>()
  const runIds = new Set<string>()
  const repetitions = new Set<string>()
  const splitByFamily = new Map<string, EvaluationSplit>()
  for (const item of cases) {
    if (observations.has(item.observationId))
      throw new Error('manifest: duplicate observationId')
    observations.add(item.observationId)
    if (runIds.has(item.run.runId)) throw new Error('manifest: duplicate runId')
    runIds.add(item.run.runId)
    const repetitionKey = `${item.retirementFamilyKey}:${item.scenarioId}:${item.repetition}`
    if (repetitions.has(repetitionKey))
      throw new Error('manifest: duplicate scenario repetition')
    repetitions.add(repetitionKey)
    const priorSplit = splitByFamily.get(item.retirementFamilyKey)
    if (priorSplit && priorSplit !== item.split)
      throw new Error('manifest: retirement family spans evaluation splits')
    splitByFamily.set(item.retirementFamilyKey, item.split)
  }
  return {
    schemaVersion: '1',
    benchmarkVersion: nonEmpty(
      manifest.benchmarkVersion,
      'manifest.benchmarkVersion',
    ),
    cases,
  }
}

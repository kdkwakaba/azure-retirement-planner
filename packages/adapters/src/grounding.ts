import type {
  Decision,
  DocumentGrounding,
  Evidence,
  LifecycleEvent,
  ResourceImpact,
  WorkItem,
} from '@arp/contracts'
import { documentGroundingSchema } from '@arp/contracts'
import { hash } from '@arp/domain'

export function confirmedDocumentGroundingInputHash(
  value: DocumentGrounding,
): string {
  const grounding = documentGroundingSchema.parse(value)
  const facts = grounding.facts.filter(
    (fact) => fact.reviewStatus === 'Confirmed',
  )
  const revisionKeys = new Set(
    facts.map(
      (fact) =>
        `${fact.sourceId}:${fact.documentItemId}:${fact.documentContentHash}`,
    ),
  )
  return hash({
    workloadId: grounding.workloadId,
    sampleOnly: grounding.sampleOnly,
    sourceConfigurationVersion: grounding.sourceConfigurationVersion,
    documentRevisions: grounding.documentRevisions
      .filter((revision) =>
        revisionKeys.has(
          `${revision.sourceId}:${revision.itemId}:${revision.contentHash}`,
        ),
      )
      .map(({ sourceId, itemId, name, contentHash }) => ({
        sourceId,
        itemId,
        name,
        contentHash,
      }))
      .sort((a, b) =>
        `${a.sourceId}:${a.itemId}`.localeCompare(`${b.sourceId}:${b.itemId}`),
      ),
    facts: facts.toSorted((a, b) => a.factId.localeCompare(b.factId)),
  })
}

export function confirmedDocumentFactEvidence(
  value: DocumentGrounding,
): Evidence[] {
  const grounding = documentGroundingSchema.parse(value)
  if (grounding.sampleOnly)
    throw new Error('Sample document grounding cannot enter a live assessment')
  const revisions = new Map(
    grounding.documentRevisions.map((revision) => [
      `${revision.sourceId}:${revision.itemId}:${revision.contentHash}`,
      revision,
    ]),
  )
  return grounding.facts.flatMap((fact) => {
    if (fact.reviewStatus !== 'Confirmed') return []
    const revision = revisions.get(
      `${fact.sourceId}:${fact.documentItemId}:${fact.documentContentHash}`,
    )
    if (!revision) throw new Error('Confirmed document fact revision missing')
    const location = [
      fact.locator.heading,
      fact.locator.sheet,
      fact.locator.table,
      fact.locator.row === null ? null : `行${fact.locator.row}`,
      fact.locator.cell === null ? null : `セル${fact.locator.cell}`,
      fact.locator.page === null ? null : `ページ${fact.locator.page}`,
    ].filter((value): value is string => Boolean(value))
    return [
      {
        id: hash({
          kind: 'confirmed-document-fact',
          sourceConfigurationVersion: grounding.sourceConfigurationVersion,
          factId: fact.factId,
        }),
        sourceType: 'Internal' as const,
        sourceVersion: fact.documentContentHash,
        observedAt: revision.observedAt,
        subjectIds: [grounding.workloadId],
        fact: `確認済み文書事実: ${fact.statement}。出典: ${revision.name}${location.length ? `（${location.join(' / ')}）` : ''}`,
        officialUrl: null,
      },
    ]
  })
}

export function groundedInput(
  event: LifecycleEvent,
  resources: ResourceImpact[],
  workloadId: string,
  decision?: Decision,
) {
  const resourceAliases = new Map(
    resources.map((r, i) => [`resource-${i + 1}`, r.id]),
  )
  const teamNames = [
    ...new Set(
      resources.map((r) => r.ownerTeam).filter((t): t is string => !!t),
    ),
  ]
  const teamAliases = new Map(teamNames.map((t, i) => [`team-${i + 1}`, t]))
  const replacements = [
    ...resourceAliases.entries(),
    ...teamAliases.entries(),
    ['workload-1', workloadId],
  ]
  const redact = (text: string) =>
    replacements.reduce(
      (value, [alias, actual]) =>
        actual ? value.replaceAll(actual!, alias!) : value,
      text,
    )
  const state = {
    event: {
      versionId: event.versionId,
      title: redact(event.title),
      body: redact(event.body),
      kinds: event.kinds,
      milestones: event.milestones.map((m) => ({
        ...m,
        scope: redact(m.scope),
      })),
      evidence: event.evidence.map((e) => ({
        ...e,
        subjectIds: e.subjectIds.map(redact),
        fact: redact(e.fact),
      })),
    },
    resources: resources.map((r, i) => ({
      id: `resource-${i + 1}`,
      workloadId: 'workload-1',
      type: r.type,
      sku: r.sku,
      region: r.region,
      environment: r.environment,
      classification: r.classification,
      classificationReason: r.classificationReason,
      missingAttributes: r.missingAttributes,
      verificationRequired: r.verificationRequired,
      evidenceIds: r.evidenceIds,
      ownerTeam: r.ownerTeam
        ? ([...teamAliases].find(([, name]) => name === r.ownerTeam)?.[0] ??
          null)
        : null,
      // Resource properties are an open-ended ARM payload and can contain
      // tenant-specific values. The model receives only the typed fields above;
      // profile matching and rule evaluation use the full properties before
      // the grounding package is built.
    })),
    workloadId: 'workload-1',
    ...(decision ? { decision } : {}),
  }
  if (Buffer.byteLength(JSON.stringify(state)) > 120000)
    throw new Error('Model grounding package too large; narrow workload first')
  return {
    state,
    resolve: (item: WorkItem): WorkItem => ({
      ...item,
      workloadId:
        item.workloadId === 'workload-1' ? workloadId : item.workloadId,
      resourceIds: item.resourceIds.map((id) => resourceAliases.get(id) ?? id),
      ownerTeam: item.ownerTeam
        ? (teamAliases.get(item.ownerTeam) ?? item.ownerTeam)
        : null,
    }),
  }
}

const EXPLANATION_TEXT_LIMITS = {
  title: 180,
  body: 600,
  milestoneScope: 120,
  evidenceTotal: 1200,
  resourceReason: 160,
} as const
const EXPLANATION_TRUNCATION_MARKER = ' […] '

function excerpt(text: string, maxCharacters: number): string {
  const characters = Array.from(text)
  if (characters.length <= maxCharacters) return text
  const marker = Array.from(EXPLANATION_TRUNCATION_MARKER)
  const available = Math.max(0, maxCharacters - marker.length)
  const headLength = Math.ceil(available * 0.65)
  const tailLength = available - headLength
  return [
    ...characters.slice(0, headLength),
    ...marker,
    ...(tailLength ? characters.slice(-tailLength) : []),
  ].join('')
}

/**
 * Builds a request-only compact view. The persisted event/evidence and the
 * Decision-1 input remain untouched; identifiers, official URLs and evidence
 * rows are retained while long prose is excerpted.
 */
export function compactExplanationInput<T>(input: T): T {
  if (typeof input !== 'object' || input === null) return input
  const compact = structuredClone(input) as Record<string, unknown>
  const event = compact.event
  if (typeof event === 'object' && event !== null) {
    const eventRecord = event as Record<string, unknown>
    if (typeof eventRecord.title === 'string')
      eventRecord.title = excerpt(
        eventRecord.title,
        EXPLANATION_TEXT_LIMITS.title,
      )
    if (typeof eventRecord.body === 'string')
      eventRecord.body = excerpt(eventRecord.body, EXPLANATION_TEXT_LIMITS.body)
    if (Array.isArray(eventRecord.milestones)) {
      eventRecord.milestones = eventRecord.milestones.map((milestone) => {
        if (typeof milestone !== 'object' || milestone === null)
          return milestone
        const record = milestone as Record<string, unknown>
        return typeof record.scope === 'string'
          ? {
              ...record,
              scope: excerpt(
                record.scope,
                EXPLANATION_TEXT_LIMITS.milestoneScope,
              ),
            }
          : record
      })
    }
    if (Array.isArray(eventRecord.evidence)) {
      const evidence = eventRecord.evidence
      const perFactLimit = evidence.length
        ? Math.max(
            1,
            Math.floor(EXPLANATION_TEXT_LIMITS.evidenceTotal / evidence.length),
          )
        : 0
      eventRecord.evidence = evidence.map((item) => {
        if (typeof item !== 'object' || item === null) return item
        const record = item as Record<string, unknown>
        return typeof record.fact === 'string'
          ? { ...record, fact: excerpt(record.fact, perFactLimit) }
          : record
      })
    }
  }
  if (Array.isArray(compact.resources)) {
    compact.resources = compact.resources.map((resource) => {
      if (typeof resource !== 'object' || resource === null) return resource
      const record = resource as Record<string, unknown>
      return typeof record.classificationReason === 'string'
        ? {
            ...record,
            classificationReason: excerpt(
              record.classificationReason,
              EXPLANATION_TEXT_LIMITS.resourceReason,
            ),
          }
        : record
    })
  }
  if (typeof compact.decision === 'object' && compact.decision !== null) {
    const decision = compact.decision as Record<string, unknown>
    delete decision.probabilities
    delete decision.model
    delete decision.modelVersion
    delete decision.promptVersion
    delete decision.ruleVersion
  }
  return compact as T
}

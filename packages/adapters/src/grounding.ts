import type {
  Decision,
  LifecycleEvent,
  ResourceImpact,
  WorkItem,
} from '@arp/contracts'

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
      properties: r.properties,
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

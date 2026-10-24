import { PlatformIdentity } from './identity.ts'
import { z } from 'zod'
import type { Evidence, LifecycleEvent, ResourceImpact } from '@arp/contracts'
import { classifyResource, hash, normalizeNotice } from '@arp/domain'
import { jsonRequest, RemoteError } from './http.ts'

export const credential = new PlatformIdentity()
export async function arm(path: string, body?: unknown): Promise<unknown> {
  if (!path.startsWith('/') || path.includes('://'))
    throw new Error('Invalid ARM path')
  const token = await credential.getToken(
    'https://management.azure.com/.default',
  )
  for (let attempt = 0; ; attempt++) {
    try {
      return await jsonRequest('https://management.azure.com' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof RemoteError) ||
        ![429, 503].includes(error.status)
      )
        throw error
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          error.retryAfterMs + Math.floor(Math.random() * 250),
        ),
      )
    }
  }
}
export async function argRows(
  subscriptionIds: string[],
  query: string,
): Promise<Record<string, unknown>[]> {
  subscriptionIds.forEach((id) => z.uuid().parse(id))
  const rows: Record<string, unknown>[] = []
  let skipToken: string | undefined
  const seen = new Set<string>()
  do {
    const page = z
      .object({
        data: z.array(z.record(z.string(), z.unknown())),
        $skipToken: z.string().optional(),
        resultTruncated: z.union([z.string(), z.boolean()]).optional(),
      })
      .parse(
        await arm(
          '/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01',
          {
            subscriptions: subscriptionIds,
            query,
            options: {
              resultFormat: 'objectArray',
              ...(skipToken ? { $skipToken: skipToken } : {}),
            },
          },
        ),
      )
    rows.push(...page.data)
    skipToken = page.$skipToken
    if (skipToken) {
      if (seen.has(skipToken)) throw new Error('ARG pagination loop')
      seen.add(skipToken)
    } else if (page.resultTruncated === true || page.resultTruncated === 'true')
      throw new Error('ARG response truncated')
    if (rows.length > 50000) throw new Error('ARG result limit exceeded')
  } while (skipToken)
  return rows
}
export async function discover(subscriptionIds: string[], tenantId: string) {
  const events: LifecycleEvent[] = [],
    resources: ResourceImpact[] = [],
    evidence: Evidence[] = [],
    failures: string[] = []
  for (const subscription of subscriptionIds) {
    try {
      const notices = await argRows(
        [subscription],
        "servicehealthresources | where type =~ 'microsoft.resourcehealth/events' | where tostring(properties.EventType) =~ 'HealthAdvisory' | project id, properties",
      )
      for (const notice of notices) {
        const p = z.record(z.string(), z.unknown()).parse(notice.properties)
        const tracking = String(p.TrackingId ?? '')
        const updated = String(p.LastUpdateTime ?? '')
        if (!tracking || !Number.isFinite(Date.parse(updated))) {
          failures.push(`通知の識別子・更新日時不足: ${subscription}`)
          continue
        }
        events.push(
          normalizeNotice({
            tenantId,
            trackingId: tracking,
            title: String(p.Title ?? ''),
            body: String(p.Description ?? p.Summary ?? ''),
            updatedAt: new Date(updated).toISOString(),
            metadata: {
              EventType: p.EventType,
              EventSubType: p.EventSubType,
              incidentType: p.incidentType,
              EventTags: p.EventTags,
            },
          }),
        )
      }
      const inventory = await argRows(
        [subscription],
        "resources | where type in~ ('microsoft.network/loadbalancers','microsoft.storage/storageaccounts','microsoft.insights/webtests') | project id, type, location, kind, skuName=tostring(sku.name), workloadId=tostring(tags.WorkloadId), environment=tostring(tags.Environment), ownerTeam=tostring(tags.OwnerTeam), webTestKind=tostring(properties.Kind)",
      )
      for (const row of inventory) {
        const id = String(row.id),
          observedAt = new Date().toISOString()
        const eid = hash({ row, observedAt })
        evidence.push({
          id: eid,
          sourceType: 'Azure',
          sourceVersion: hash(row),
          observedAt,
          subjectIds: [id],
          fact: JSON.stringify(row),
          officialUrl: null,
        })
        resources.push({
          id,
          type: String(row.type),
          region: String(row.location),
          sku: row.skuName ? String(row.skuName) : null,
          workloadId: row.workloadId ? String(row.workloadId) : null,
          environment: row.environment ? String(row.environment) : null,
          ownerTeam: row.ownerTeam ? String(row.ownerTeam) : null,
          classification: 'Unknown',
          verificationRequired: false,
          evidenceIds: [eid],
          properties: {
            kind: row.kind ?? null,
            webTestKind: row.webTestKind ?? null,
          },
        })
      }
    } catch {
      failures.push(`Service Health／構成取得失敗: ${subscription}`)
    }
  }
  return {
    events,
    resources,
    evidence,
    scopeComplete: failures.length === 0,
    failures,
  }
}
export async function explicitResourceIds(
  event: LifecycleEvent,
  subscriptions: string[],
): Promise<Set<string>> {
  // Tracking IDは公式通知から取得した英数記号だけを許可しKQLリテラル注入を避ける。
  if (!/^[A-Za-z0-9_-]+$/.test(event.trackingId))
    throw new Error('Unsupported tracking ID')
  const tracking = event.trackingId
  const direct = await argRows(
    subscriptions,
    `servicehealthresources | where type =~ 'microsoft.resourcehealth/events/impactedresources' | where id contains '${tracking}' | project resourceId=tostring(properties.targetResourceId)`,
  )
  const ids = new Set(
    direct
      .map((r) => String(r.resourceId).toLowerCase())
      .filter((id) => id.startsWith('/subscriptions/')),
  )
  if (event.kinds.includes('Retirement')) {
    const advisor = await argRows(
      subscriptions,
      `advisorresources | where type =~ 'microsoft.advisor/metadata' | mv-expand trackingId=properties.sourceProperties.serviceRetirement.serviceHealth.trackingIds | where tostring(trackingId) == '${tracking}' | extend recommendationTypeId=tostring(properties.recommendationTypeId) | project recommendationTypeId | join kind=inner (advisorresources | where type =~ 'microsoft.advisor/recommendations' | extend recommendationTypeId=tostring(properties.recommendationTypeId) | project recommendationTypeId, resourceId=tostring(properties.resourceMetadata.resourceId)) on recommendationTypeId | project resourceId`,
    )
    advisor.forEach((r) => {
      const id = String(r.resourceId).toLowerCase()
      if (id.startsWith('/subscriptions/')) ids.add(id)
    })
  }
  return ids
}
export function matchProfile(
  event: LifecycleEvent,
  resource: ResourceImpact,
  explicit: Set<string>,
): ResourceImpact {
  const text = (event.title + ' ' + event.body).toLowerCase()
  let conditionMatches: boolean | null = null,
    excluded = false
  // 保守する3つの公式条件だけを適用。別機能や未知の条件をLLMで補完しない。
  if (
    /basic.{0,20}load balancer/.test(text) &&
    resource.type.toLowerCase() === 'microsoft.network/loadbalancers'
  ) {
    conditionMatches = resource.sku?.toLowerCase() === 'basic'
    excluded = resource.sku?.toLowerCase() === 'standard'
  }
  if (
    /general.purpose.v1|gpv1/.test(text) &&
    resource.type.toLowerCase() === 'microsoft.storage/storageaccounts'
  ) {
    conditionMatches = resource.properties.kind === 'Storage'
    excluded = resource.properties.kind === 'StorageV2'
  }
  if (
    /url ping|ping test/.test(text) &&
    resource.type.toLowerCase() === 'microsoft.insights/webtests'
  ) {
    conditionMatches = resource.properties.webTestKind === 'ping'
    excluded = resource.properties.webTestKind === 'standard'
  }
  return {
    ...resource,
    classification: classifyResource({
      explicitlyListed: explicit.has(resource.id.toLowerCase()),
      conditionMatches,
      explicitlyExcluded: excluded,
      dependencyEvidence: false,
      usageRequired: false,
    }),
  }
}

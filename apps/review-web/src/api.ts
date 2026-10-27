import { z } from 'zod'
import { discoveryFailureSchema } from '@arp/contracts'

export async function request(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
) {
  const response = await fetch('/api/' + path, {
    method,
    credentials: 'same-origin',
    ...(method === 'POST'
      ? {
          headers: { 'Content-Type': 'application/json', 'X-ARP-Request': '1' },
          body: JSON.stringify(body ?? {}),
        }
      : {}),
  })
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'サインインが必要です'
        : response.status === 403
          ? 'この操作の権限がありません'
          : `処理できませんでした (${response.status})`,
    )
  return response.json()
}

export function syncFeedback(value: unknown) {
  const result = z
    .object({
      events: z.number().int().nonnegative(),
      resources: z.number().int().nonnegative(),
      scopeComplete: z.boolean(),
      failures: z.array(z.string()),
      failureDetails: z.array(discoveryFailureSchema).optional().default([]),
    })
    .parse(value)
  const sourceNames: Record<string, string> = {
    ServiceHealthAdvisory: 'Service Health通知',
    ResourceGraphInventory: 'Resource Graphインベントリ',
    ServiceHealthImpactedResources: 'Service Health影響リソース',
    AdvisorRetirementRecommendations: 'Azure Advisor推奨',
    OfficialReference: '公式参照',
  }
  const categoryNames: Record<string, string> = {
    Unauthorized: '認証エラー (401)',
    Forbidden: '権限エラー (403)',
    Throttled: 'スロットリング (429)',
    UpstreamUnavailable: '上流サービス障害',
    Timeout: 'タイムアウト',
    InvalidResponse: '応答形式不正',
    NetworkError: 'ネットワークエラー',
    Unknown: '原因未分類',
  }
  const details = result.failureDetails.map(
    (failure) =>
      `${sourceNames[failure.source]}: ${categoryNames[failure.category]}${failure.httpStatus ? ` HTTP ${failure.httpStatus}` : ''} (照会ID ${failure.correlationId})`,
  )
  const failures = [...result.failures, ...details]
  return {
    notice: `通知${result.events}件、構成${result.resources}件を取得しました。評価はバックグラウンドで実行されます。`,
    error:
      result.scopeComplete && failures.length === 0
        ? ''
        : `取得が不完全です。${failures.join(' / ') || '取得範囲の完全性を確認できません。'} 通知0件でも影響なしとは判断できません。`,
  }
}

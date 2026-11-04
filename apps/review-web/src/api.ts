import { z } from 'zod'
import { discoveryFailureSchema } from '@arp/contracts'

export class ApiRequestError extends Error {
  status: number
  stage: string | null
  category: string | null
  upstreamHttpStatus: number | null
  correlationId: string | null
  operation: string | null
  providerCode: string | null
  constructor(
    status: number,
    details: {
      stage?: unknown
      category?: unknown
      httpStatus?: unknown
      correlationId?: unknown
      operation?: unknown
      providerCode?: unknown
    },
  ) {
    const stage = typeof details.stage === 'string' ? details.stage : null
    const category =
      typeof details.category === 'string' ? details.category : null
    const upstreamHttpStatus =
      typeof details.httpStatus === 'number' ? details.httpStatus : null
    const correlationId =
      typeof details.correlationId === 'string' &&
      /^[0-9a-f-]{36}$/i.test(details.correlationId)
        ? details.correlationId
        : null
    const operation =
      typeof details.operation === 'string' ? details.operation : null
    const providerCode =
      typeof details.providerCode === 'string' ? details.providerCode : null
    const categoryLabels: Record<string, string> = {
      Unauthorized: '認証エラー',
      Forbidden: '権限エラー',
      Throttled: 'スロットリング',
      UpstreamUnavailable: '上流サービス障害',
      Timeout: 'タイムアウト',
      InvalidResponse: '応答形式不正',
      NetworkError: 'ネットワークエラー',
      Unknown: '原因未分類',
    }
    const stageLabels: Record<string, string> = {
      'sharepoint-fact-extraction-request': '文書事実抽出の要求確認',
      'sharepoint-fact-source-read': 'SharePoint参照元の読込',
      'sharepoint-fact-assessment-read': '評価情報の読込',
      'sharepoint-fact-snapshot-read': 'SharePoint同期結果の読込',
      'sharepoint-fact-grounding-read': '既存の抽出結果の読込',
      'sharepoint-fact-document-read': '保存文書の読込',
      'sharepoint-fact-document-parse': '文書本文の抽出',
      'sharepoint-fact-cached-response-read': '抽出済みモデル応答の読込',
      'sharepoint-fact-budget-reservation': 'モデル利用枠の確保',
      'sharepoint-fact-model-extraction': 'モデルによる事実候補の抽出',
      'sharepoint-fact-grounding-save': '抽出結果の保存',
    }
    const pieces = [
      status === 401
        ? 'サインインが必要です'
        : status === 403
          ? 'この操作の権限がありません'
          : `処理できませんでした (HTTP ${status})`,
      stage ? `段階: ${stageLabels[stage] ?? stage}` : '',
      category ? `分類: ${categoryLabels[category] ?? category}` : '',
      operation ? `操作: ${operation}` : '',
      providerCode ? `GitHubコード: ${providerCode}` : '',
      upstreamHttpStatus !== null
        ? `上流サービス応答: HTTP ${upstreamHttpStatus}`
        : '',
      correlationId ? `照会ID: ${correlationId}` : '',
    ].filter(Boolean)
    super(pieces.join(' / '))
    this.name = 'ApiRequestError'
    this.status = status
    this.stage = stage
    this.category = category
    this.upstreamHttpStatus = upstreamHttpStatus
    this.correlationId = correlationId
    this.operation = operation
    this.providerCode = providerCode
  }
}

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
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => ({}))
    const details =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : {}
    throw new ApiRequestError(response.status, details)
  }
  return response.json()
}

export function syncFeedback(value: unknown) {
  const result = z
    .object({
      events: z.number().int().nonnegative(),
      resources: z.number().int().nonnegative(),
      reassessedEvents: z.number().int().nonnegative().default(0),
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
    notice: `通知${result.events}件、構成${result.resources}件を取得しました。${result.reassessedEvents ? `既存通知${result.reassessedEvents}件の再評価を受付けました。` : ''}評価はバックグラウンドで実行されます。`,
    error:
      result.scopeComplete && failures.length === 0
        ? ''
        : `取得が不完全です。${failures.join(' / ') || '取得範囲の完全性を確認できません。'} 通知0件でも影響なしとは判断できません。`,
  }
}

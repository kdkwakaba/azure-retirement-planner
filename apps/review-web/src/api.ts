import { z } from 'zod'

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
    })
    .parse(value)
  return {
    notice: `通知${result.events}件、構成${result.resources}件を取得しました。評価はバックグラウンドで実行されます。`,
    error:
      result.scopeComplete && result.failures.length === 0
        ? ''
        : `取得が不完全です。${result.failures.join(' / ') || '取得範囲の完全性を確認できません。'} 通知0件でも影響なしとは判断できません。`,
  }
}

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

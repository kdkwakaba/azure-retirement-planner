import { z } from 'zod'

// App Service / Functionsの公式ローカルMIプロトコルに限定。
// SDKのDefaultAzureCredentialに含まれる既知脆弱性依存を避け、他の資格情報へ自動Fallbackしない。
// https://learn.microsoft.com/azure/app-service/overview-managed-identity
export class PlatformIdentity {
  cache = new Map<string, { token: string; expiresOnTimestamp: number }>()
  async getToken(
    scopes: string | string[],
  ): Promise<{ token: string; expiresOnTimestamp: number }> {
    const scope = Array.isArray(scopes) ? scopes[0] : scopes
    if (Array.isArray(scopes) && scopes.length !== 1)
      throw new Error('One identity scope required')
    if (
      !scope ||
      ![
        'https://management.azure.com/.default',
        'https://cognitiveservices.azure.com/.default',
        'https://storage.azure.com/.default',
        'https://vault.azure.net/.default',
      ].includes(scope)
    )
      throw new Error('Unapproved identity scope')
    const cached = this.cache.get(scope)
    if (cached && cached.expiresOnTimestamp > Date.now() + 300000) return cached
    const raw = process.env.IDENTITY_ENDPOINT,
      header = process.env.IDENTITY_HEADER
    if (!raw || !header)
      throw new Error('Platform managed identity unavailable')
    const url = new URL(raw)
    if (
      url.protocol !== 'http:' ||
      !/^(127\.0\.0\.1|localhost|169\.254\.\d+\.\d+)$/.test(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid platform identity endpoint')
    url.searchParams.set('api-version', '2019-08-01')
    url.searchParams.set('resource', scope.replace(/\/.default$/, ''))
    const response = await fetch(url, {
      headers: { 'X-IDENTITY-HEADER': header },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error('Managed identity request failed')
    const result = z
      .object({
        access_token: z.string().min(1),
        expires_on: z.coerce.number(),
      })
      .parse(await response.json())
    const token = {
      token: result.access_token,
      expiresOnTimestamp: result.expires_on * 1000,
    }
    if (token.expiresOnTimestamp <= Date.now())
      throw new Error('Expired managed identity token')
    this.cache.set(scope, token)
    return token
  }
}

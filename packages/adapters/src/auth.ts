import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'

export interface Principal {
  id: string
  roles: string[]
  kind?: 'User' | 'Application'
}
export function createVerifier(
  tenantId: string,
  audience: string,
  keys?: JWTVerifyGetKey,
) {
  z.uuid().parse(tenantId)
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  const jwks =
    keys ??
    createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      ),
    )
  return async (token: string): Promise<Principal> => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
      algorithms: ['RS256'],
    })
    if (payload.tid !== tenantId || typeof payload.oid !== 'string')
      throw new Error('Invalid tenant/principal')
    return {
      id: payload.oid,
      roles: z.array(z.string()).parse(payload.roles ?? []),
      kind: payload.idtyp === 'app' ? 'Application' : 'User',
    }
  }
}
export const apiRolePolicy = {
  read: ['Reader', 'Reviewer', 'Governance', 'Operator'],
  sync: ['Operator', 'Governance'],
  review: ['Reviewer', 'Governance'],
  decisionReevaluation: ['Governance'],
  businessContext: ['Governance'],
  notification: ['NotificationSender'],
} as const

export function requireRole(
  principal: Principal,
  allowed: readonly string[],
): void {
  if (!principal.roles.some((r) => allowed.includes(r)))
    throw new Error('Forbidden')
}
export function requireUserRole(
  principal: Principal,
  allowed: readonly string[],
): void {
  if (principal.kind !== 'User') throw new Error('Forbidden')
  requireRole(principal, allowed)
}
export function requireApplicationRole(
  principal: Principal,
  allowed: readonly string[],
): void {
  if (principal.kind !== 'Application')
    throw new Error('Application identity required')
  requireRole(principal, allowed)
}
export function verifyWriteRequest(
  origin: string | null,
  expectedOrigin: string,
  contentType: string | null,
  marker: string | null,
): void {
  if (
    origin !== expectedOrigin ||
    !contentType?.startsWith('application/json') ||
    marker !== '1'
  )
    throw new Error('Write origin/content-type rejected')
}

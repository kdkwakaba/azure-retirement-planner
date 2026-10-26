import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apiRolePolicy,
  requireApplicationRole,
  requireUserRole,
} from '@arp/adapters'

test('user roles follow the API access matrix', () => {
  const cases: {
    role: string
    allowed: readonly (readonly string[])[]
  }[] = [
    { role: 'Reader', allowed: [apiRolePolicy.read] },
    {
      role: 'Reviewer',
      allowed: [apiRolePolicy.read, apiRolePolicy.review],
    },
    {
      role: 'Governance',
      allowed: [
        apiRolePolicy.read,
        apiRolePolicy.sync,
        apiRolePolicy.review,
      ],
    },
    { role: 'Operator', allowed: [apiRolePolicy.read, apiRolePolicy.sync] },
  ]

  for (const { role, allowed } of cases) {
    const principal = { id: role, roles: [role], kind: 'User' as const }
    for (const policy of [
      apiRolePolicy.read,
      apiRolePolicy.sync,
      apiRolePolicy.review,
    ]) {
      if (allowed.includes(policy)) {
        assert.doesNotThrow(() => requireUserRole(principal, policy))
      } else {
        assert.throws(() => requireUserRole(principal, policy), /Forbidden/)
      }
    }
    assert.throws(
      () => requireApplicationRole(principal, apiRolePolicy.notification),
      /Application identity required/,
    )
  }
})

test('only the notification application role can use app authorization', () => {
  const sender = {
    id: 'synthetic-sender',
    roles: [...apiRolePolicy.notification],
    kind: 'Application' as const,
  }
  assert.doesNotThrow(() =>
    requireApplicationRole(sender, apiRolePolicy.notification),
  )
  assert.throws(
    () => requireApplicationRole(sender, apiRolePolicy.read),
    /Forbidden/,
  )
  assert.throws(
    () =>
      requireUserRole(
        { ...sender, roles: ['Governance'] },
        apiRolePolicy.sync,
      ),
    /Forbidden/,
  )
})

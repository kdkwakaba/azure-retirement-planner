import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apiRolePolicy,
  requireApplicationRole,
  requireUserRole,
} from '@arp/adapters'

test('user roles follow the API access matrix', () => {
  const cases = [
    { role: 'Reader', read: true, sync: false, review: false },
    { role: 'Reviewer', read: true, sync: false, review: true },
    { role: 'Operator', read: true, sync: true, review: false },
    { role: 'Governance', read: true, sync: true, review: true },
  ]

  for (const entry of cases) {
    const principal = {
      id: entry.role,
      roles: [entry.role],
      kind: 'User' as const,
    }
    for (const [policy, allowed] of [
      [apiRolePolicy.read, entry.read],
      [apiRolePolicy.sync, entry.sync],
      [apiRolePolicy.review, entry.review],
    ] as const) {
      if (allowed) {
        assert.doesNotThrow(() => requireUserRole(principal, policy))
      } else {
        assert.throws(() => requireUserRole(principal, policy), /Forbidden/)
      }
    }
  }
})

test('notification role requires application identity', () => {
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

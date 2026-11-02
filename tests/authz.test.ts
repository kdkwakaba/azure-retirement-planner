import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apiRolePolicy,
  requireApplicationRole,
  requireUserRole,
} from '@arp/adapters'

const user = (role: string) => ({
  id: role,
  roles: [role],
  kind: 'User' as const,
})

test('Reader is read only', () => {
  const principal = user('Reader')
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.read))
  assert.throws(() => requireUserRole(principal, apiRolePolicy.sync))
  assert.throws(() => requireUserRole(principal, apiRolePolicy.review))
})

test('Reviewer can read and review', () => {
  const principal = user('Reviewer')
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.read))
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.review))
  assert.throws(() => requireUserRole(principal, apiRolePolicy.sync))
})

test('business context writes are denied to non-Governance users', () => {
  assert.throws(() =>
    requireUserRole(user('Reviewer'), apiRolePolicy.businessContext),
  )
  assert.throws(() =>
    requireUserRole(user('Operator'), apiRolePolicy.businessContext),
  )
})

test('Operator can read and sync', () => {
  const principal = user('Operator')
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.read))
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.sync))
  assert.throws(() => requireUserRole(principal, apiRolePolicy.review))
})

test('Governance can use all user APIs', () => {
  const principal = user('Governance')
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.read))
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.sync))
  assert.doesNotThrow(() => requireUserRole(principal, apiRolePolicy.review))
  assert.doesNotThrow(() =>
    requireUserRole(principal, apiRolePolicy.businessContext),
  )
  assert.doesNotThrow(() =>
    requireUserRole(principal, apiRolePolicy.decisionReevaluation),
  )
})

test('decision reevaluation is restricted to Governance users', () => {
  assert.throws(() =>
    requireUserRole(user('Reviewer'), apiRolePolicy.decisionReevaluation),
  )
  assert.throws(() =>
    requireUserRole(user('Operator'), apiRolePolicy.decisionReevaluation),
  )
  assert.throws(() =>
    requireUserRole(
      { id: 'app', roles: ['Governance'], kind: 'Application' as const },
      apiRolePolicy.decisionReevaluation,
    ),
  )
})

test('notification sender requires application identity', () => {
  const principal = {
    id: 'synthetic-sender',
    roles: [...apiRolePolicy.notification],
    kind: 'Application' as const,
  }
  assert.doesNotThrow(() =>
    requireApplicationRole(principal, apiRolePolicy.notification),
  )
  assert.throws(() =>
    requireUserRole(
      { ...principal, roles: ['Governance'] },
      apiRolePolicy.sync,
    ),
  )
})

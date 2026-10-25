import test from 'node:test'
import assert from 'node:assert/strict'
import { decisionRevision } from '../apps/assessment-api/src/service.ts'

test('Decision configuration changes produce a new assessment revision', (t) => {
  const keys = [
    'DECISION_ENDPOINT',
    'DECISION_DEPLOYMENT',
    'DECISION_MODEL_VERSION',
  ] as const
  const original = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  )
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })
  for (const key of keys) delete process.env[key]
  assert.equal(decisionRevision(200), null)
  process.env.DECISION_ENDPOINT = 'https://foundry.example.test'
  process.env.DECISION_DEPLOYMENT = 'decision-test'
  process.env.DECISION_MODEL_VERSION = '1'
  const first = decisionRevision(200)
  assert.ok(first)
  assert.equal(decisionRevision(0), null)
  process.env.DECISION_MODEL_VERSION = '2'
  assert.notEqual(decisionRevision(200), first)
})

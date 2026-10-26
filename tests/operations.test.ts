import test from 'node:test'
import assert from 'node:assert/strict'
import { logProcessingFailure } from '@arp/adapters'

test('failure logs exclude exception messages', (t) => {
  let record = ''
  t.mock.method(console, 'error', (line: string) => {
    record = line
  })
  logProcessingFailure('assessment-queue', new Error('synthetic-secret'))
  assert.ok(record.includes('"event":"ProcessingFailure"'))
  assert.ok(!record.includes('synthetic-secret'))
})

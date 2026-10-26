import test from 'node:test'
import assert from 'node:assert/strict'
import {
  logProcessingFailure,
  withProcessingFailureLog,
} from '@arp/adapters'

test('failure logs omit exception details', async (t) => {
  const records: string[] = []
  t.mock.method(console, 'error', (record: string) => records.push(record))

  const correlationId = logProcessingFailure(
    'assessment-queue',
    new Error('synthetic-secret-resource-id'),
    '00000000-0000-4000-8000-000000000001',
  )
  assert.equal(correlationId, '00000000-0000-4000-8000-000000000001')
  assert.deepEqual(JSON.parse(records[0]!), {
    event: 'ProcessingFailure',
    stage: 'assessment-queue',
    correlationId,
    errorType: 'Error',
  })
  assert.ok(!records[0]!.includes('synthetic-secret-resource-id'))

  await assert.rejects(
    withProcessingFailureLog('daily-sync', async () => {
      throw new Error('synthetic-payload')
    }),
    /synthetic-payload/,
  )
  assert.equal(JSON.parse(records[1]!).stage, 'daily-sync')
  assert.ok(!records[1]!.includes('synthetic-payload'))
})

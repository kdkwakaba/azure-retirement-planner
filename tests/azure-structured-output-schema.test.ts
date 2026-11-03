import assert from 'node:assert/strict'
import test from 'node:test'
import { explanationResponseJsonSchema } from '../packages/adapters/src/models.ts'

const unsupportedKeywords = [
  'contains',
  'format',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'patternProperties',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
]

function visitSchema(value: unknown, path = 'schema'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSchema(item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object' || value === null) return

  const schema = value as Record<string, unknown>
  for (const keyword of unsupportedKeywords)
    assert.equal(Object.hasOwn(schema, keyword), false, `${path}.${keyword}`)
  assert.equal(Object.hasOwn(schema, '$schema'), false, `${path}.$schema`)
  assert.equal(Object.hasOwn(schema, 'const'), false, `${path}.const`)

  if (schema.type === 'object' && typeof schema.properties === 'object') {
    const properties = schema.properties as Record<string, unknown>
    const required = schema.required as string[] | undefined
    assert.equal(
      schema.additionalProperties,
      false,
      `${path}.additionalProperties`,
    )
    assert.deepEqual(
      [...(required ?? [])].sort(),
      Object.keys(properties).sort(),
      `${path}.required`,
    )
  }

  for (const key of ['properties', '$defs', 'definitions']) {
    const definitions = schema[key]
    if (typeof definitions === 'object' && definitions !== null)
      Object.values(definitions).forEach((child) =>
        visitSchema(child, `${path}.${key}`),
      )
  }
  for (const key of ['items', 'additionalProperties'])
    visitSchema(schema[key], `${path}.${key}`)
  for (const key of ['anyOf', 'allOf', 'oneOf'])
    visitSchema(schema[key], `${path}.${key}`)
}

test('explanation Structured Outputs schema uses Azure-supported keywords and required properties', () => {
  const schema = explanationResponseJsonSchema([
    'evidence-1',
    'evidence-2',
  ]) as {
    properties: {
      explanation: {
        properties: Record<string, { anyOf: Array<Record<string, unknown>> }>
      }
      workItems: {
        properties: Record<string, { anyOf: Array<Record<string, unknown>> }>
      }
    }
    $defs: {
      explanation_claim: {
        type: string
        properties: Record<string, unknown>
      }
      explanation_work_item: {
        type: string
        properties: Record<string, unknown>
      }
    }
  }

  visitSchema(schema)
  assert.equal(
    Object.hasOwn(
      schema.$defs.explanation_work_item.properties,
      'workflowRouting',
    ),
    false,
  )
  assert.deepEqual(
    (
      schema.$defs.explanation_work_item.properties.humanApprovalRequired as {
        enum?: unknown[]
      }
    ).enum,
    [true],
  )
  assert.equal(
    JSON.stringify(schema.properties.explanation.properties.impact!.anyOf[0]),
    JSON.stringify({ $ref: '#/$defs/explanation_claim' }),
  )
  assert.equal(
    JSON.stringify(
      schema.properties.explanation.properties.humanChecks!.anyOf[0],
    ),
    JSON.stringify({ $ref: '#/$defs/explanation_claim' }),
  )
  for (const section of Object.values(schema.properties.explanation.properties))
    assert.equal(
      section.anyOf.some((branch) => branch.type === 'array'),
      false,
    )
  assert.deepEqual(Object.keys(schema.properties.workItems.properties), [
    'item1',
    'item2',
  ])
  assert.equal(
    JSON.stringify(schema.properties.workItems.properties.item1!.anyOf[0]),
    JSON.stringify({ $ref: '#/$defs/explanation_work_item' }),
  )
  assert.equal(
    JSON.stringify(schema.properties.workItems.properties.item2!.anyOf[0]),
    JSON.stringify({ $ref: '#/$defs/explanation_work_item' }),
  )
  assert.ok(
    JSON.stringify(
      schema.$defs.explanation_claim.properties.evidenceRefs,
    ).includes('evidence-1'),
  )
  assert.ok(
    JSON.stringify(
      schema.$defs.explanation_claim.properties.evidenceRefs,
    ).includes('evidence-2'),
  )
  assert.equal(JSON.stringify(schema).includes('actual-evidence-id'), false)
  assert.ok(schema.$defs.explanation_claim)
  assert.equal(schema.$defs.explanation_claim.type, 'object')
  assert.ok(schema.$defs.explanation_claim.properties.text)
  assert.ok(schema.$defs.explanation_work_item)
  assert.ok(JSON.stringify(schema).length < 5000)
})

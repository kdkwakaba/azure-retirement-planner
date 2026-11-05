import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiRequestError } from '../apps/review-web/src/api.ts'

test('API errors show the SharePoint extraction stage in Japanese', () => {
  const error = new ApiRequestError(503, {
    stage: 'sharepoint-fact-model-extraction',
    category: 'Unknown',
    extractionFailureCode: 'Truncated',
    correlationId: '8be6c32e-0fe1-4790-910f-96a626fc4551',
  })

  assert.match(error.message, /段階: モデルによる事実候補の抽出/)
  assert.match(error.message, /出力上限に達して応答が途中で終了しました/)
  assert.match(error.message, /原因未分類/)
  assert.match(error.message, /照会ID: 8be6c32e-0fe1-4790-910f-96a626fc4551/)
})

test('API error labels upstream HTTP status without assuming GitHub', () => {
  const error = new ApiRequestError(503, {
    stage: 'sharepoint-fact-model-extraction',
    httpStatus: 429,
  })

  assert.match(error.message, /上流サービス応答: HTTP 429/)
  assert.doesNotMatch(error.message, /GitHub応答/)
})

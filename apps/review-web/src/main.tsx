import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { assessmentSchema, type Assessment } from '@arp/contracts'
import './styles.css'
import { CorrectionForm } from './CorrectionForm.tsx'
import { EvidenceCard, safeOfficialEvidenceUrl } from './EvidenceFact.tsx'
import { summarizeAssessments } from './summary.ts'

import { ApiRequestError, request, syncFeedback } from './api.ts'

const discoveryOutcomeLabels: Record<string, string> = {
  CandidatesFound: '影響候補あり',
  NoResourcesDetected: '該当リソースなし',
  NoImpactMatched: '対象外のみ（根拠確認済み）',
  ProfileUnavailable: '適用可能なプロファイルなし',
  Incomplete: '調査不完全',
}
const classificationReasonLabels: Record<string, string> = {
  ConflictingEvidence: '影響対象と対象外の根拠が矛盾',
  AssessmentPending: 'イベント別評価前',
  ExplicitMicrosoftImpact: 'Microsoftの明示対象',
  ExplicitExclusion: '適用条件による除外',
  ProfileConditionMatched: '対応プロファイルの条件一致',
  DependencyEvidence: '依存関係の根拠あり',
  RequiredAttributeMissing: '必要なAzure属性が不足',
  UsageRequiresVerification: '利用状況の確認が必要',
  NoMatchingProfileCondition: '対応プロファイルの条件に不一致',
  NoApplicableProfile: '対応する判定プロファイルなし',
  LegacyUnrecorded: '旧データのため理由未記録',
}
const modelStageLabels: Record<string, string> = {
  Decision: '影響判断',
  Explanation: '説明・作業案生成',
}
const modelStatusLabels: Record<string, string> = {
  NotRequired: '実行対象外',
  NotConfigured: '未設定',
  NotStarted: '実行開始前に停止',
  Succeeded: '完了',
  SucceededWithFallback: '完了（必須説明を固定テンプレートで補完）',
  Failed: '失敗',
}
const operationSourceLabels: Record<string, string> = {
  ServiceHealthAdvisory: 'Service Health通知',
  ResourceGraphInventory: 'Resource Graphインベントリ',
  ServiceHealthImpactedResources: 'Service Health影響リソース',
  AdvisorRetirementRecommendations: 'Azure Advisor推奨',
  OfficialReference: '公式参照',
}
const failureCategoryLabels: Record<string, string> = {
  Unauthorized: '認証エラー',
  Forbidden: '権限エラー',
  Throttled: 'スロットリング',
  UpstreamUnavailable: '上流サービス障害',
  Timeout: 'タイムアウト',
  InvalidResponse: '応答形式不正',
  NetworkError: 'ネットワークエラー',
  Unknown: '原因未分類',
  DailyLimit: '日次呼出上限',
  StorageFailure: '監査保存失敗',
}

const syntheticUatTrackingId = 'ARP-SYNTHETIC-UAT-001'
type UatExportStatus = {
  state: string
  stage: string | null
  issueUrl: string | null
  errorCategory: string | null
  errorHttpStatus: number | null
  correlationId: string | null
  operation: string | null
  providerCode: string | null
  updatedAt: string | null
}
const uatStages = [
  ['finding-or-creating-issue', 'Issueを確認中'],
  ['creating-issue', 'Issueを作成中'],
  ['updating-issue', 'Issue内容を更新中'],
  ['verifying-issue', 'Issueを確認中'],
  ['adding-to-project', 'Projectに登録中'],
  ['updating-project-fields', 'Project項目を更新中'],
  ['completed', '登録完了'],
] as const
const uatStageLabels = Object.fromEntries(uatStages) as Record<string, string>
function uatProgressLabel(status: UatExportStatus | null): string {
  if (!status || status.state === 'NotStarted') return '未開始'
  if (status.state === 'Exported') return '登録済み'
  if (status.state === 'Failed') return '失敗'
  if (!status.stage) return '処理中'
  return uatStageLabels[status.stage] ?? '処理中'
}
function uatStepState(
  status: UatExportStatus,
  stage: string,
): 'pending' | 'active' | 'complete' | 'failed' {
  const currentIndex = uatStages.findIndex(([key]) => key === status.stage)
  const index = uatStages.findIndex(([key]) => key === stage)
  if (status.state === 'Failed' && status.stage === stage) return 'failed'
  if (status.state === 'Exported' && stage === 'completed') return 'complete'
  if (index < currentIndex) return 'complete'
  if (index === currentIndex) return 'active'
  return 'pending'
}
function uatFailureStageLabel(status: UatExportStatus): string {
  if (!status.stage) return '不明'
  return uatStageLabels[status.stage] ?? status.stage
}
function uatErrorCategoryLabel(category: string | null): string {
  return failureCategoryLabels[category ?? ''] ?? category ?? '未取得'
}

function App() {
  const [items, setItems] = useState<Assessment[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState(''),
    [uatEnabled, setUatEnabled] = useState(false),
    [uatIssueUrl, setUatIssueUrl] = useState(''),
    [uatExportStatus, setUatExportStatus] = useState<UatExportStatus | null>(
      null,
    ),
    [projectProgress, setProjectProgress] = useState<
      Array<{ workItemId: string; status: string | null; syncedAt: string }>
    >([])
  const current = items.find((a) => a.id === selected)
  const summary = summarizeAssessments(items)
  async function refresh() {
    setError('')
    try {
      const data = assessmentSchema
        .array()
        .parse(await request('assessments', 'GET'))
      setItems(data)
      const uat = await request('uat/status', 'GET')
      setUatEnabled(uat.enabled === true)
      const progress = await request('project-progress', 'GET')
      setProjectProgress(
        Array.isArray(progress)
          ? progress.filter(
              (
                item,
              ): item is {
                workItemId: string
                status: string | null
                syncedAt: string
              } =>
                typeof item === 'object' &&
                item !== null &&
                typeof item.workItemId === 'string' &&
                (typeof item.status === 'string' || item.status === null) &&
                typeof item.syncedAt === 'string',
            )
          : [],
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗')
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  useEffect(() => {
    const item = current?.workItems.find(
      (candidate) =>
        candidate.title === '[SYNTHETIC UAT] GitHub Issue連携を確認',
    )
    if (
      !uatEnabled ||
      current?.event.trackingId !== syntheticUatTrackingId ||
      !current ||
      !item
    ) {
      return
    }
    let active = true
    const loadStatus = async () => {
      try {
        const status = (await request(
          `uat/export-status?assessmentId=${encodeURIComponent(current.id)}&itemId=${encodeURIComponent(item.id)}`,
          'GET',
        )) as UatExportStatus
        if (!active) return
        setUatExportStatus((currentStatus) =>
          currentStatus?.state === 'Failed' && status.state !== 'Failed'
            ? currentStatus
            : status,
        )
        if (status.issueUrl) setUatIssueUrl(status.issueUrl)
      } catch {
        // The export response contains the same correlation details if polling is unavailable.
      }
    }
    void loadStatus()
    if (!busy)
      return () => {
        active = false
      }
    const timer = window.setInterval(() => void loadStatus(), 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selected, uatEnabled, busy])
  async function sync() {
    setBusy(true)
    setError('')
    try {
      const feedback = syncFeedback(await request('sync', 'POST'))
      await refresh()
      setNotice(feedback.notice)
      if (feedback.error) setError(feedback.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : '同期失敗')
    } finally {
      setBusy(false)
    }
  }
  async function seedSyntheticUat() {
    setBusy(true)
    setError('')
    setUatIssueUrl('')
    try {
      const result = await request('uat/seed', 'POST', {})
      await refresh()
      setSelected(result.assessmentId)
      setNotice(
        '合成UATを作成しました。実リソースは読み取らず、作業を選択して人間承認してください。',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '合成UAT作成失敗')
    } finally {
      setBusy(false)
    }
  }
  async function exportSyntheticUat() {
    if (!current || current.event.trackingId !== syntheticUatTrackingId) return
    const item = current.workItems[0]
    if (!item) return
    if (
      !window.confirm(
        '合成UATの承認済み作業1件をGitHub IssueとProjectへ登録します。実環境の作業ではありません。続けますか？',
      )
    )
      return
    setBusy(true)
    setError('')
    setNotice('')
    setUatIssueUrl('')
    setUatExportStatus({
      state: 'Processing',
      stage: 'finding-or-creating-issue',
      issueUrl: null,
      errorCategory: null,
      errorHttpStatus: null,
      correlationId: null,
      operation: null,
      providerCode: null,
      updatedAt: new Date().toISOString(),
    })
    try {
      const result = await request('uat/export', 'POST', {
        assessmentId: current.id,
        packageHash: current.packageHash,
        itemId: item.id,
      })
      setUatIssueUrl(result.issueUrl)
      setUatExportStatus((status) =>
        status
          ? {
              ...status,
              state: 'Exported',
              stage: 'completed',
              issueUrl: result.issueUrl,
            }
          : status,
      )
      setNotice('合成UAT IssueをGitHub Projectへ登録しました。')
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setUatExportStatus((status) => ({
          state: 'Failed',
          stage: e.stage ?? status?.stage ?? null,
          issueUrl: status?.issueUrl ?? null,
          errorCategory: e.category,
          errorHttpStatus: e.upstreamHttpStatus,
          correlationId: e.correlationId,
          operation: e.operation,
          providerCode: e.providerCode,
          updatedAt: new Date().toISOString(),
        }))
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Issue登録失敗。処理状況を確認してください。',
      )
    } finally {
      setBusy(false)
    }
  }
  async function review(result: 'Approved' | 'Partial' | 'Returned' | 'Held') {
    if (!current) return
    setBusy(true)
    setError('')
    try {
      const response = await request('review', 'POST', {
        assessmentId: current.id,
        packageHash: current.packageHash,
        approvedItemIds: ['Approved', 'Partial'].includes(result)
          ? checked
          : [],
        reason,
        result,
      })
      let exportNotice = '外部登録は無効です。'
      if (response.exportEnabled)
        exportNotice = '承認済み作業を登録待ちへ送ります。'
      else if (current.event.trackingId === syntheticUatTrackingId)
        exportNotice =
          '通常の外部登録は無効です。合成UATのIssue登録は専用ボタンから実行できます。'
      setNotice(`レビューを記録しました。${exportNotice}`)
      setChecked([])
      setReason('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '記録失敗')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">AZURE LIFECYCLE GOVERNANCE</p>
          <h1>Retirement Planner</h1>
          <p>非推奨・サポート終了・廃止の根拠を確認し、対応を判断する</p>
        </div>
        <a href="/.auth/logout">サインアウト</a>
      </header>
      <main>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void sync()}>
            Azure情報を取得・評価
          </button>
          <button disabled={busy} onClick={() => void refresh()}>
            評価結果を更新
          </button>
          {uatEnabled && (
            <button disabled={busy} onClick={() => void seedSyntheticUat()}>
              合成UATを作成
            </button>
          )}
          <span>評価対象は読み取り専用</span>
        </div>
        <section className="operations-summary" aria-labelledby="summary-title">
          <h2 id="summary-title">評価状況</h2>
          <p>
            現在取得済みの評価レコード単位の集計です。業務システム単位の件数ではありません。
          </p>
          <div className="metrics">
            <article>
              <small>評価レコード</small>
              <strong>{summary.totalRecords}</strong>
            </article>
            <article>
              <small>人間確認が必要</small>
              <strong>{summary.humanReviewRequired}</strong>
            </article>
            <article>
              <small>P1・P2</small>
              <strong>{summary.highPriority}</strong>
            </article>
            <article>
              <small>調査不完全・未確認</small>
              <strong>{summary.incompleteDiscovery}</strong>
            </article>
          </div>
        </section>
        {error && (
          <div role="alert" className="error">
            {error} <a href="/.auth/login/aad">サインイン</a>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {uatIssueUrl && (
          <p>
            <a href={uatIssueUrl} target="_blank" rel="noopener noreferrer">
              作成した合成UAT Issueを開く
            </a>
          </p>
        )}
        <div className="layout">
          <aside>
            <h2>ライフサイクル通知</h2>
            {!items.length && (
              <p>
                評価結果はまだありません。設定・権限を確認してAzure情報を取得してください。サンプル結果は表示しません。
              </p>
            )}
            {items.map((item) => (
              <button
                className={selected === item.id ? 'selected' : 'event'}
                key={item.id}
                onClick={() => {
                  setSelected(item.id)
                  setChecked([])
                  setReason('')
                }}
              >
                <strong>{item.event.title}</strong>
                <small>
                  {item.workloadId} · {item.effectivePriority ?? '未確定'}
                </small>
                <small>
                  {item.humanContext?.scopeDisposition === 'OutOfScope'
                    ? '人間確認済み・対象外'
                    : `${item.createdAt} · 暫定／人間確認待ち`}
                </small>
              </button>
            ))}
          </aside>
          <section>
            {!current ? (
              <p>通知を選択すると、業務影響・根拠・作業案を確認できます。</p>
            ) : (
              <>
                <h2>{current.event.title}</h2>
                <p>
                  Workload: {current.workloadId} ／ 評価基準日: {current.asOf}
                </p>
                {current.humanContext?.scopeDisposition === 'OutOfScope' && (
                  <div role="status" className="notice">
                    <b>人間確認済み・対象外</b>
                    <p>{current.humanContext.reason}</p>
                    <small>
                      Evidence:{' '}
                      {current.humanContext.reviewEvidenceIds?.join(', ') ??
                        '根拠IDなし'}
                    </small>
                    <p>
                      この案件には優先度・移行作業がありません。判定を変更する場合は上の訂正欄から再評価してください。
                    </p>
                  </div>
                )}
                {current.humanContext?.scopeDisposition === 'OutOfScope' ? (
                  <p>
                    対象外判定前のモデル判断は監査用に保持されています。現在の対応影響・優先度としては扱いません。
                  </p>
                ) : (
                  <>
                    <div className="metrics">
                      <article>
                        <small>未対応時</small>
                        <strong>
                          {(current.humanContext
                            ? current.humanContext.impactIfUnaddressed
                            : current.decision.impactIfUnaddressed) ??
                            '判断保留'}
                        </strong>
                      </article>
                      <article>
                        <small>対応時・対応後</small>
                        <strong>
                          {(current.humanContext
                            ? current.humanContext.impactDuringAndAfterChange
                            : current.decision.impactDuringAndAfterChange) ??
                            '判断保留'}
                        </strong>
                      </article>
                      <article>
                        <small>暫定優先度</small>
                        <strong>{current.effectivePriority ?? '未確定'}</strong>
                      </article>
                    </div>
                    <p>
                      Model: {current.decision.model} /{' '}
                      {current.decision.modelVersion} ·{' '}
                      {current.decision.status}
                    </p>
                    <details>
                      <summary>モデル呼び出しの監査記録</summary>
                      {!current.modelInvocations?.length ? (
                        <p>
                          旧評価レコードのため、モデル実行記録はありません。
                        </p>
                      ) : (
                        <ul>
                          {current.modelInvocations.map((invocation) => (
                            <li key={invocation.correlationId}>
                              {modelStageLabels[invocation.stage]} —{' '}
                              {modelStatusLabels[invocation.status]} —{' '}
                              {invocation.provider} / {invocation.deployment}
                              {invocation.modelVersion
                                ? ` / ${invocation.modelVersion}`
                                : ''}
                              {invocation.durationMs !== null
                                ? ` / ${invocation.durationMs} ms`
                                : ''}
                              {invocation.failureCategory
                                ? ` / ${failureCategoryLabels[invocation.failureCategory]}${invocation.httpStatus ? ` HTTP ${invocation.httpStatus}` : ''}`
                                : ''}
                              {' / 照会ID '}
                              {invocation.correlationId}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p>
                        入力・プロンプト・モデル応答はこの画面やApplication
                        Insightsのトレースには含めません。
                      </p>
                    </details>
                  </>
                )}
                <CorrectionForm
                  key={current.id}
                  assessment={current}
                  onRevised={async (id) => {
                    await refresh()
                    setSelected(id)
                    setChecked([])
                    setReason('')
                  }}
                />
                <h3>
                  {current.humanReviewRequired === false
                    ? '評価レビュー省略可能（定型結果）'
                    : '人間による確認が必要'}
                </h3>
                {current.humanReviewRequired === false && (
                  <p>
                    評価レビューの省略は業務影響なしを意味しません。作業項目の承認・外部登録は別途人間の承認が必要です。
                  </p>
                )}
                <ul>
                  {[
                    ...new Set([
                      ...current.reviewReasons,
                      ...current.missingInformation,
                    ]),
                  ].map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                <h3>公式期限</h3>
                {!current.event.milestones.length ? (
                  <p>
                    適用期限は未確認です。非推奨開始日から廃止日を推測しません。
                  </p>
                ) : (
                  <ul>
                    {current.event.milestones.map((m) => (
                      <li key={m.id}>
                        {m.kind}: {m.date ?? m.rawDateText ?? '未発表'} —{' '}
                        {m.scope}
                      </li>
                    ))}
                  </ul>
                )}
                <h3>対象リソース</h3>
                <p>
                  調査結果:{' '}
                  {current.impactDiscoveryOutcome
                    ? discoveryOutcomeLabels[current.impactDiscoveryOutcome]
                    : '旧データ／未記録'}
                  {' · '}取得範囲:{' '}
                  {current.scopeComplete ? '取得完了' : '一部取得失敗'}
                </p>
                {current.discoveryScope && (
                  <details>
                    <summary>調査範囲の詳細</summary>
                    <p>
                      Subscription:{' '}
                      {current.discoveryScope.subscriptionIds.join(', ') ||
                        'なし'}
                    </p>
                    <p>
                      Resource Type:{' '}
                      {current.discoveryScope.resourceTypes.join(', ') ||
                        'なし'}
                    </p>
                    <p>
                      適用プロファイル:{' '}
                      {current.discoveryScope.profileIds.join(', ') || 'なし'}
                    </p>
                    <p>
                      プロファイル版:{' '}
                      {current.discoveryScope.profileRegistryVersion}
                    </p>
                    <p>
                      取得リソース数: {current.discoveryScope.resourceCount}
                    </p>
                    {current.discoveryScope.failureDetails?.length ? (
                      <>
                        <h4>取得失敗の内訳</h4>
                        <ul>
                          {current.discoveryScope.failureDetails.map(
                            (failure) => (
                              <li key={failure.correlationId}>
                                {operationSourceLabels[failure.source]} —{' '}
                                {failureCategoryLabels[failure.category]}
                                {failure.httpStatus
                                  ? ` (HTTP ${failure.httpStatus})`
                                  : ''}
                                {' / 照会ID '}
                                {failure.correlationId}
                              </li>
                            ),
                          )}
                        </ul>
                        <p>
                          照会IDでApplication
                          InsightsのExternalDependencyFailureまたはModelInvocation記録を検索できます。入力内容・Resource
                          IDは監査トレースへ記録しません。
                        </p>
                      </>
                    ) : null}
                  </details>
                )}
                {current.impactDiscoveryOutcome === 'NoResourcesDetected' && (
                  <p>
                    該当リソースなし（調査範囲と取得完了を確認済み）。これは業務影響なしや対応不要の判定ではありません。
                  </p>
                )}
                {current.impactDiscoveryOutcome === 'NoImpactMatched' && (
                  <p>
                    調査範囲内のリソースは、確認済み根拠により対象外と判定されています。
                  </p>
                )}
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Resource ID</th>
                        <th>分類</th>
                        <th>環境</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.resources.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td>
                            {r.classification}
                            <small>
                              {classificationReasonLabels[
                                r.classificationReason
                              ] ?? '分類理由を確認してください'}
                              {r.verificationRequired
                                ? ' — 人による確認が必要'
                                : ''}
                              {r.missingAttributes.length
                                ? ` — 不足: ${r.missingAttributes.join(', ')}`
                                : ''}
                            </small>
                          </td>
                          <td>{r.environment ?? '不明'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>
                  {current.humanContext?.scopeDisposition === 'OutOfScope'
                    ? '対象外判定前の原評価・根拠'
                    : '説明と根拠'}
                </h3>
                {Object.entries(current.explanation).map(([name, claims]) => (
                  <details key={name}>
                    <summary>
                      {name} ({claims.length})
                    </summary>
                    {claims.map((c) => (
                      <p key={c.id}>
                        <b>{c.kind}</b> — {c.text}
                        <small>
                          Evidence:{' '}
                          {c.evidenceIds.join(', ') || 'なし／不明・仮定を確認'}
                        </small>
                      </p>
                    ))}
                  </details>
                ))}
                <details>
                  <summary>Evidence一覧</summary>
                  {current.event.evidence.map((e) => (
                    <article className="evidence-item" key={e.id}>
                      <div className="evidence-heading">
                        <b>
                          {e.sourceType === 'Microsoft'
                            ? 'Microsoft公式情報'
                            : e.sourceType === 'Azure'
                              ? 'Azure構成情報'
                              : e.sourceType}
                        </b>
                        <small>{e.observedAt}</small>
                      </div>
                      <EvidenceCard
                        evidence={e}
                        event={current.event}
                        assessmentId={current.id}
                      />
                      {safeOfficialEvidenceUrl(e.officialUrl) && (
                        <p className="evidence-source-link">
                          <a
                            href={safeOfficialEvidenceUrl(e.officialUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            公式参照を開く
                          </a>
                        </p>
                      )}
                      <details className="evidence-id">
                        <summary>Evidence ID</summary>
                        <code>{e.id}</code>
                      </details>
                    </article>
                  ))}
                </details>
                {current.humanContext?.scopeDisposition === 'OutOfScope' ? (
                  <p>
                    対象外判定により作業案は取り下げられ、承認・登録できません。
                  </p>
                ) : (
                  <>
                    <h3>作業案・部分承認</h3>
                    {uatEnabled &&
                      current.event.trackingId === syntheticUatTrackingId && (
                        <div className="notice">
                          <b>合成UAT専用</b>
                          <p>
                            この通知とリソースは架空です。実Azureリソースへの変更はなく、
                            通常Exporter／Outboxは使用しません。
                          </p>
                          <button
                            disabled={
                              busy || current.validationErrors.length > 0
                            }
                            onClick={() => void exportSyntheticUat()}
                          >
                            {busy
                              ? '登録処理中…'
                              : '承認済み合成作業をGitHub Issueへ登録'}
                          </button>
                          {uatExportStatus &&
                            uatExportStatus.state !== 'NotStarted' && (
                              <div
                                className="uat-progress"
                                role="status"
                                aria-live="polite"
                              >
                                <b>
                                  {uatExportStatus.state === 'Failed'
                                    ? '登録処理に失敗しました'
                                    : (uatStageLabels[
                                        uatExportStatus.stage ?? ''
                                      ] ?? '登録状況を確認中')}
                                </b>
                                <ol>
                                  {uatStages.map(([stage, label]) => (
                                    <li
                                      className={`uat-step uat-step-${uatStepState(
                                        uatExportStatus,
                                        stage,
                                      )}`}
                                      key={stage}
                                    >
                                      {label}
                                    </li>
                                  ))}
                                </ol>
                                {uatExportStatus.state === 'Failed' && (
                                  <p className="uat-diagnostic">
                                    失敗段階:{' '}
                                    {uatFailureStageLabel(uatExportStatus)}
                                    {' ／ '}分類:{' '}
                                    {uatErrorCategoryLabel(
                                      uatExportStatus.errorCategory,
                                    )}
                                    {uatExportStatus.errorHttpStatus !==
                                      null && (
                                      <>
                                        {' ／ GitHub通信 HTTP '}
                                        {uatExportStatus.errorHttpStatus}
                                        {' (GraphQL応答)'}
                                      </>
                                    )}
                                    {uatExportStatus.operation && (
                                      <> ／ 操作 {uatExportStatus.operation}</>
                                    )}
                                    {uatExportStatus.providerCode && (
                                      <>
                                        {' ／ GitHubコード '}
                                        {uatExportStatus.providerCode}
                                      </>
                                    )}
                                    {uatExportStatus.correlationId && (
                                      <>
                                        {' '}
                                        ／ 照会ID{' '}
                                        {uatExportStatus.correlationId}
                                      </>
                                    )}
                                  </p>
                                )}
                                {uatExportStatus.issueUrl && (
                                  <p>
                                    <a
                                      href={uatExportStatus.issueUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      作成済みIssueを開く
                                    </a>
                                  </p>
                                )}
                              </div>
                            )}
                        </div>
                      )}
                    {current.validationErrors.length > 0 && (
                      <div className="error">
                        検証不適合のため承認できません。
                        <ul>
                          {current.validationErrors.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {current.workItems.map((w) => (
                      <article className="work" key={w.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={checked.includes(w.id)}
                            onChange={(e) =>
                              setChecked((v) =>
                                e.target.checked
                                  ? [...v, w.id]
                                  : v.filter((id) => id !== w.id),
                              )
                            }
                          />
                          <b>{w.title}</b>
                        </label>
                        <p>
                          {w.category} · {w.necessity} ·{' '}
                          {w.priority ?? '未確定'}
                        </p>
                        <p>{w.description}</p>
                        {w.description.includes(
                          '合成デモ用業務コンテキスト',
                        ) && (
                          <small className="notice">
                            合成デモデータ（実際の部署・契約・費用ではありません）
                          </small>
                        )}
                        <small>
                          {current.event.trackingId ===
                          syntheticUatTrackingId ? (
                            <>
                              合成UAT登録状態:{' '}
                              {uatProgressLabel(uatExportStatus)}
                            </>
                          ) : (
                            <>
                              GitHub Project進捗:{' '}
                              {projectProgress.find(
                                (p) => p.workItemId === w.id,
                              )?.status ?? '未同期'}
                            </>
                          )}
                        </small>
                        <p>
                          開始 {w.plannedStartDate ?? '未確定'} ／ 完了{' '}
                          {w.dueDate ?? '未確定'} ／ Owner{' '}
                          {w.ownerTeam ?? '未確定'}
                        </p>
                        {w.workflowRouting && (
                          <div className="notice">
                            <b>
                              企業ワークフロー候補（設定{' '}
                              {w.workflowRouting.policyVersion}）
                            </b>
                            <p>
                              担当チーム候補（複数可・未確定）:{' '}
                              {w.workflowRouting.teamCandidates
                                .map((r) => r.displayName)
                                .join('、') || '未設定'}
                            </p>
                            <p>
                              調整部署:{' '}
                              {w.workflowRouting.coordinationCandidates
                                .map((r) => r.displayName)
                                .join('、') || '未設定'}
                            </p>
                            <p>
                              設定上の承認段階:{' '}
                              {w.workflowRouting.approvalStages
                                .map((s) => s.title)
                                .join(' → ') || '未設定'}
                            </p>
                            <p>
                              作業順序:{' '}
                              {w.workflowRouting.sequenceOrder ?? '未設定'} ／
                              前提カテゴリ:{' '}
                              {w.workflowRouting.dependsOnCategories.join(
                                '、',
                              ) || 'なし'}
                            </p>
                            {w.workflowRouting.unresolvedReasons.map(
                              (reason) => (
                                <p key={reason}>人間確認: {reason}</p>
                              ),
                            )}
                          </div>
                        )}
                        <ul>
                          {w.completionCriteria.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                    <label>
                      判断理由
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={2000}
                      />
                    </label>
                    <p role="note">
                      承認は作業案の選択と判断理由が必要です。差し戻し・保留は判断理由を入力すると有効になります。検証不適合が表示されている間は承認できません。操作結果や失敗理由はこの画面上部に表示されます。
                    </p>
                    <div className="toolbar">
                      <button
                        disabled={
                          busy ||
                          !reason.trim() ||
                          !checked.length ||
                          !!current.validationErrors.length
                        }
                        onClick={() =>
                          void review(
                            checked.length === current.workItems.length
                              ? 'Approved'
                              : 'Partial',
                          )
                        }
                      >
                        選択した作業を承認
                      </button>
                      <button
                        disabled={busy || !reason.trim()}
                        onClick={() => void review('Returned')}
                      >
                        差し戻し
                      </button>
                      <button
                        disabled={busy || !reason.trim()}
                        onClick={() => void review('Held')}
                      >
                        保留
                      </button>
                    </div>
                    <p>
                      本番変更の実行承認ではありません。承認対象の版とHashを記録します。
                    </p>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)

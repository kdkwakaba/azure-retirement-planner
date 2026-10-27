import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { assessmentSchema, type Assessment } from '@arp/contracts'
import './styles.css'
import { CorrectionForm } from './CorrectionForm.tsx'
import { EvidenceCard, safeOfficialEvidenceUrl } from './EvidenceFact.tsx'
import { summarizeAssessments } from './summary.ts'

import { request, syncFeedback } from './api.ts'

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

function App() {
  const [items, setItems] = useState<Assessment[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState(''),
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
      setNotice(
        `レビューを記録しました。${response.exportEnabled ? '承認済み作業を登録待ちへ送ります。' : '外部登録は無効です。'}`,
      )
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
                        <small>
                          GitHub Project進捗:{' '}
                          {projectProgress.find((p) => p.workItemId === w.id)
                            ?.status ?? '未同期'}
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
                              担当チーム候補:{' '}
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

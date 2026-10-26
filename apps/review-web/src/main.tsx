import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { assessmentSchema, type Assessment } from '@arp/contracts'
import './styles.css'
import { CorrectionForm } from './CorrectionForm.tsx'

import { request, syncFeedback } from './api.ts'

const classificationReasonLabels: Record<string, string> = {
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

function App() {
  const [items, setItems] = useState<Assessment[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState('')
  const current = items.find((a) => a.id === selected)
  async function refresh() {
    setError('')
    try {
      const data = assessmentSchema
        .array()
        .parse(await request('assessments', 'GET'))
      setItems(data)
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
                <small>{item.createdAt} · 暫定／人間確認待ち</small>
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
                <div className="metrics">
                  <article>
                    <small>未対応時</small>
                    <strong>
                      {(current.humanContext
                        ? current.humanContext.impactIfUnaddressed
                        : current.decision.impactIfUnaddressed) ?? '判断保留'}
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
                  {current.decision.modelVersion} · {current.decision.status}
                </p>
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
                <h3>人間による確認が必要</h3>
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
                  取得範囲:{' '}
                  {current.scopeComplete ? '取得完了' : '一部取得失敗'}
                  。空の対象一覧は「影響なし」を意味しません。
                </p>
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
                <h3>説明と根拠</h3>
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
                    <article key={e.id}>
                      <b>{e.sourceType}</b>
                      <small>
                        {e.id} · {e.observedAt}
                      </small>
                      <pre>{e.fact}</pre>
                    </article>
                  ))}
                </details>
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
                      {w.category} · {w.necessity} · {w.priority ?? '未確定'}
                    </p>
                    <p>{w.description}</p>
                    <p>
                      開始 {w.plannedStartDate ?? '未確定'} ／ 完了{' '}
                      {w.dueDate ?? '未確定'} ／ Owner {w.ownerTeam ?? '未確定'}
                    </p>
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
          </section>
        </div>
      </main>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)

import { useState } from 'react'
import type { Assessment, Correction } from '@arp/contracts'

export function CorrectionForm({
  assessment,
  onRevised,
}: {
  assessment: Assessment
  onRevised: (id: string) => Promise<void>
}) {
  const [form, setForm] = useState<Correction>(
    assessment.humanContext
      ? {
          scopeDisposition:
            assessment.humanContext.scopeDisposition ??
            assessment.event.classification,
          impactIfUnaddressed: assessment.humanContext.impactIfUnaddressed,
          impactDuringAndAfterChange:
            assessment.humanContext.impactDuringAndAfterChange,
          criticalWorkload: assessment.humanContext.criticalWorkload,
          alternativeApproved: assessment.humanContext.alternativeApproved,
          remainingCalendarDays: assessment.humanContext.remainingCalendarDays,
          retirementDate: assessment.humanContext.retirementDate,
          supportEndDate: assessment.humanContext.supportEndDate,
          creationStopDate: assessment.humanContext.creationStopDate,
          deprecationDate: assessment.humanContext.deprecationDate,
          applicableKind: assessment.humanContext.applicableKind,
          reason: '',
          workItemUpdates: assessment.workItems.map((w) => ({
            id: w.id,
            ownerTeam: w.ownerTeam,
            plannedStartDate: w.plannedStartDate,
            dueDate: w.dueDate,
          })),
        }
      : {
          scopeDisposition: assessment.event.classification,
          impactIfUnaddressed: assessment.decision.impactIfUnaddressed,
          impactDuringAndAfterChange:
            assessment.decision.impactDuringAndAfterChange,
          criticalWorkload: assessment.criticalWorkload,
          alternativeApproved: false,
          remainingCalendarDays: null,
          retirementDate: null,
          supportEndDate: null,
          creationStopDate: null,
          deprecationDate: null,
          applicableKind: null,
          reason: '',
          workItemUpdates: assessment.workItems.map((w) => ({
            id: w.id,
            ownerTeam: w.ownerTeam,
            plannedStartDate: w.plannedStartDate,
            dueDate: w.dueDate,
          })),
        },
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false)
  async function save() {
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/revise', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-ARP-Request': '1' },
        body: JSON.stringify({
          assessmentId: assessment.id,
          packageHash: assessment.packageHash,
          correction: form,
        }),
      })
      if (!response.ok)
        throw new Error(`訂正できませんでした (${response.status})`)
      const result = await response.json()
      await onRevised(result.assessmentId)
    } catch (e) {
      setError(e instanceof Error ? e.message : '訂正失敗')
    } finally {
      setBusy(false)
    }
  }
  return (
    <details>
      <summary>業務影響・公式期限・計画を確認／訂正する</summary>
      <p>
        公式資料と業務情報を確認して入力してください。元のモデル回答は維持し、人間による訂正を別に記録します。
      </p>
      <label className="field">
        通知の対象判定
        <select
          value={form.scopeDisposition ?? 'ReviewRequired'}
          onChange={(e) =>
            setForm({
              ...form,
              scopeDisposition: e.target
                .value as Correction['scopeDisposition'],
            })
          }
        >
          <option value="ReviewRequired">未確定・確認が必要</option>
          <option value="InScope">対象</option>
          <option value="OutOfScope">対象外</option>
        </select>
        <small>
          対象外を選ぶ場合は、通知のライフサイクル変更が管理対象外である根拠を理由欄に記録してください。
        </small>
      </label>
      {(['impactIfUnaddressed', 'impactDuringAndAfterChange'] as const).map(
        (key) => (
          <label className="field" key={key}>
            {key === 'impactIfUnaddressed'
              ? '未対応時の影響'
              : '対応時・対応後の影響'}
            <select
              value={form[key] ?? ''}
              onChange={(e) =>
                setForm({ ...form, [key]: e.target.value || null })
              }
            >
              <option value="">判断保留</option>
              {['Low', 'Medium', 'High', 'Critical'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ),
      )}
      {(
        [
          ['deprecationDate', '非推奨開始日'],
          ['creationStopDate', '新規作成停止日'],
          ['supportEndDate', 'サポート終了日'],
          ['retirementDate', '廃止日'],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          {label}
          <input
            type="date"
            value={form[key] ?? ''}
            onChange={(e) =>
              setForm({ ...form, [key]: e.target.value || null })
            }
          />
        </label>
      ))}
      <label className="field">
        当該対応に適用する期限
        <select
          value={form.applicableKind ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              applicableKind: (e.target.value ||
                null) as Correction['applicableKind'],
            })
          }
        >
          <option value="">未確定</option>
          <option value="NewCreationBlocked">新規作成停止</option>
          <option value="SupportEnded">サポート終了</option>
          <option value="Retirement">廃止</option>
        </select>
      </label>
      <label className="field">
        残工程の暦日数（依存関係・禁止期間・予備期間を含む）
        <input
          type="number"
          min="0"
          step="1"
          value={form.remainingCalendarDays ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              remainingCalendarDays:
                e.target.value === '' ? null : Number(e.target.value),
            })
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.criticalWorkload}
          onChange={(e) =>
            setForm({ ...form, criticalWorkload: e.target.checked })
          }
        />
        Critical workload
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.alternativeApproved}
          onChange={(e) =>
            setForm({ ...form, alternativeApproved: e.target.checked })
          }
        />
        対応リスクの対策・代替策を確認済み
      </label>
      {form.workItemUpdates.map((item, i) => (
        <fieldset key={item.id}>
          <legend>
            {assessment.workItems.find((w) => w.id === item.id)?.title}
          </legend>
          {(
            [
              ['ownerTeam', 'Owner Team', 'text'],
              ['plannedStartDate', '開始日', 'date'],
              ['dueDate', '完了日', 'date'],
            ] as const
          ).map(([key, label, type]) => (
            <label className="field" key={key}>
              {label}
              <input
                type={type}
                value={item[key] ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    workItemUpdates: form.workItemUpdates.map((v, j) =>
                      j === i ? { ...v, [key]: e.target.value || null } : v,
                    ),
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
      <label>
        訂正の理由・確認した根拠
        <textarea
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        通知の対象・日付・適用範囲・業務情報を確認しました
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy || !confirmed || !form.reason.trim()}
        onClick={() => void save()}
      >
        訂正版を作成して再評価
      </button>
    </details>
  )
}

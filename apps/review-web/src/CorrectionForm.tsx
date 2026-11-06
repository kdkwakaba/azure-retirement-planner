import { useState } from 'react'
import type { Assessment, Correction } from '@arp/contracts'

const initialWorkItemAdditions = (assessment: Assessment) => {
  if (!assessment.event.title.toLowerCase().includes('foundry agent service'))
    return []
  return [
    {
      clientId: crypto.randomUUID(),
      category: 'Cross-Team Coordination' as const,
      title: '関係チームとの影響確認を調整',
      description:
        '社内外の利用者・関係チームと確認日程および回答を調整し、情報システム部門が窓口となる。',
      completionCriteria: ['関係者、回答、未解決事項、次の確認日を記録する'],
      ownerTeam: '情報システム部門',
    },
    {
      clientId: crypto.randomUUID(),
      category: 'Cost Assessment' as const,
      title: '追加費用と予算確保の要否を確認',
      description:
        '選択肢と見積りを確認して追加費用の有無を整理し、必要な場合に情報システム部門が予算調整を行う。費用や予算の発生は未確定。',
      completionCriteria: [
        '費用の根拠または未確定理由と、予算調整の要否を記録する',
      ],
      ownerTeam: '情報システム部門',
    },
    {
      clientId: crypto.randomUUID(),
      category: 'Change Management' as const,
      title: '承認要件と関係者調整を確認',
      description:
        '必要な社内承認・外部調整の有無を確認し、情報システム部門が調整する。承認者や承認結果は未確認のままとする。',
      completionCriteria: ['必要な承認役割・調整事項・判断結果を記録する'],
      ownerTeam: '情報システム部門',
    },
  ]
}
const initialWorkItemUpdates = (assessment: Assessment) => {
  const isFoundryNotice = assessment.event.title
    .toLowerCase()
    .includes('foundry agent service')
  const verificationId = isFoundryNotice
    ? assessment.workItems.find(
        (item) => item.category === 'Impact Verification',
      )?.id
    : undefined
  return assessment.workItems.map((item) => ({
    id: item.id,
    title:
      item.id === verificationId
        ? 'Foundry Agent Service classic APIの利用有無を確認'
        : item.title,
    description:
      item.id === verificationId
        ? '対象Workloadの構成・コード・利用者に確認し、classic APIを利用しているかを確認する。現時点では利用有無未確認のため、移行要否は判断しない。'
        : item.description,
    completionCriteria:
      item.id === verificationId
        ? ['確認した構成・担当部署・根拠を記録し、利用有無を人が判断する']
        : item.completionCriteria,
    ownerTeam: item.ownerTeam,
    plannedStartDate: item.plannedStartDate,
    dueDate: item.dueDate,
  }))
}

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
          workItemUpdates: initialWorkItemUpdates(assessment),
          workItemAdditions: assessment.humanContext.workItemAdditions ?? [],
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
          workItemUpdates: initialWorkItemUpdates(assessment),
          workItemAdditions: initialWorkItemAdditions(assessment),
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
          <option value="ReviewRequired">
            確認中（対象範囲を判断する根拠の確認が必要）
          </option>
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
              <option value="">
                確認前（Workload責任者が業務影響を確認して選択）
              </option>
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
          <option value="">公式期限の種類を確認後に選択</option>
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
        Critical workload（チェック時のみ指定）
      </label>
      {form.criticalWorkload && (
        <small>
          Criticalとして指定されています。根拠と業務責任者の確認を記録してください。
        </small>
      )}
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
            {item.title ??
              assessment.workItems.find((w) => w.id === item.id)?.title}
          </legend>
          <label className="field">
            作業名
            <input
              value={item.title ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemUpdates: form.workItemUpdates.map((v, j) =>
                    j === i ? { ...v, title: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            作業内容
            <textarea
              value={item.description ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemUpdates: form.workItemUpdates.map((v, j) =>
                    j === i ? { ...v, description: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            完了条件（1行に1項目）
            <textarea
              value={item.completionCriteria?.join('\n') ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemUpdates: form.workItemUpdates.map((v, j) =>
                    j === i
                      ? {
                          ...v,
                          completionCriteria: e.target.value
                            .split('\n')
                            .filter(Boolean),
                        }
                      : v,
                  ),
                })
              }
            />
          </label>
          {(
            [
              ['ownerTeam', 'Owner Team', 'text'],
              ['plannedStartDate', '開始日', 'date'],
              ['dueDate', '完了日', 'date'],
            ] as const
          ).map(([key, label, type]) => (
            <label className="field" key={key}>
              {label}
              <small>
                {key === 'ownerTeam'
                  ? 'Azureタグ値だけでは実担当を確定しません。Workload責任者と担当部門を確認してください。'
                  : '公式期限・工程期間・担当が根拠付きで確認できる場合に入力してください。'}
              </small>
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
      <h3>追加する作業案</h3>
      <p>
        追加作業は推奨・未承認として登録されます。担当候補と調整候補はポリシーから提示し、承認時に再確認します。
      </p>
      {form.workItemAdditions.map((item, i) => (
        <fieldset key={item.clientId}>
          <legend>追加作業 {i + 1}</legend>
          <label className="field">
            カテゴリ
            <select
              value={item.category}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemAdditions: form.workItemAdditions.map((v, j) =>
                    j === i
                      ? { ...v, category: e.target.value as typeof v.category }
                      : v,
                  ),
                })
              }
            >
              {[
                'Impact Verification',
                'Cross-Team Coordination',
                'Customer Communication',
                'Cost Assessment',
                'Change Management',
                'Vendor Assessment',
                'Contract Review',
                'Documentation Update',
              ].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="field">
            作業名
            <input
              value={item.title}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemAdditions: form.workItemAdditions.map((v, j) =>
                    j === i ? { ...v, title: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            作業内容
            <textarea
              value={item.description}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemAdditions: form.workItemAdditions.map((v, j) =>
                    j === i ? { ...v, description: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            完了条件
            <textarea
              value={item.completionCriteria.join('\n')}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemAdditions: form.workItemAdditions.map((v, j) =>
                    j === i
                      ? {
                          ...v,
                          completionCriteria: e.target.value
                            .split('\n')
                            .filter(Boolean),
                        }
                      : v,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            Owner Team（Workload責任者と担当部門を確認して選択）
            <select
              value={item.ownerTeam ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  workItemAdditions: form.workItemAdditions.map((v, j) =>
                    j === i ? { ...v, ownerTeam: e.target.value || null } : v,
                  ),
                })
              }
            >
              <option value="">担当確認後に選択</option>
              <option value="インフラ部門">インフラ部門</option>
              <option value="アプリ部門">アプリ部門</option>
              <option value="情報システム部門">情報システム部門</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              setForm({
                ...form,
                workItemAdditions: form.workItemAdditions.filter(
                  (_, j) => j !== i,
                ),
              })
            }
          >
            この作業案を削除
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setForm({
            ...form,
            workItemAdditions: [
              ...form.workItemAdditions,
              {
                clientId: crypto.randomUUID(),
                category: 'Cross-Team Coordination',
                title: '',
                description: '',
                completionCriteria: [''],
                ownerTeam: null,
              },
            ],
          })
        }
      >
        作業案を追加
      </button>
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

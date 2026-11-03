import type {
  Assessment,
  Explanation,
  Evidence,
  ModelInvocation,
  ResourceImpact,
  WorkItem,
} from '@arp/contracts'
import { resourceVerificationReason } from '@arp/domain/resource-verification-reasons'

type WorkRouting = NonNullable<WorkItem['workflowRouting']>
type ExplanationClaim = Explanation['impact'][number]

const explanationDatePattern =
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\d{4}年\d{1,2}月\d{1,2}日|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/gi

function normalizeExplanationText(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function explanationSentences(text: string): string[] {
  return text.match(/[^。！？.!?\n]+[。！？.!?]?/g)?.filter(Boolean) ?? []
}

function explanationDates(text: string): string[] {
  return [...text.matchAll(explanationDatePattern)].map((match) => {
    const value = match[0]
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/(?:st|nd|rd|th)\b/gi, '')
    const numeric = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
    const japanese = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/)
    const english = value.match(
      /^(?:(\w+)\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+(\w+)\s+(\d{4}))$/,
    )
    const monthNames = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ]
    const monthNumber = (month: string) =>
      monthNames.findIndex((name) => month.startsWith(name)) + 1
    const parts = numeric ?? japanese
    if (parts)
      return `${parts[1]}-${parts[2]!.padStart(2, '0')}-${parts[3]!.padStart(2, '0')}`
    if (english) {
      const month = monthNumber(english[1] ?? english[5] ?? '')
      const day = english[2] ?? english[4] ?? ''
      const year = english[3] ?? english[6] ?? ''
      if (month)
        return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`
    }
    return normalizeExplanationText(match[0])
  })
}

function isScheduleOnlySentence(text: string): boolean {
  const schedule =
    /廃止|退役|終了|期限|retir|sunset|endofsupport|deadline/i.test(text)
  const describesImpact =
    /停止|利用不可|使用不可|継続利用|影響|機能|アクセス|停止|unavailable|outage|impact|cannot|willnotbeavailable/i.test(
      normalizeExplanationText(text),
    )
  return schedule && !describesImpact
}

export function deduplicateExplanationClaims(
  explanation: Explanation,
): Array<[string, ExplanationClaim[]]> {
  const entries = Object.entries(explanation).filter(
    ([name, claims]) => name !== 'humanChecks' && claims.length > 0,
  ) as Array<[string, ExplanationClaim[]]>
  const officialFacts = entries.find(([name]) => name === 'microsoftFacts')?.[1]
  const officialDates = new Set(
    (officialFacts ?? []).flatMap((claim) => explanationDates(claim.text)),
  )
  const preferredEntries = [
    ...entries.filter(([name]) => name === 'microsoftFacts'),
    ...entries.filter(([name]) => name !== 'microsoftFacts'),
  ]
  const seen = new Map<string, ExplanationClaim>()
  const officialClaimsByDate = new Map<string, ExplanationClaim>()
  const deduplicated = new Map<string, ExplanationClaim[]>()

  for (const [name, claims] of preferredEntries) {
    const kept: ExplanationClaim[] = []
    for (const claim of claims) {
      const displayedClaim: ExplanationClaim = {
        ...claim,
        evidenceIds: [...claim.evidenceIds],
        decisionRefs: [...claim.decisionRefs],
      }
      if (name === 'microsoftFacts') {
        for (const date of explanationDates(claim.text))
          officialClaimsByDate.set(date, displayedClaim)
      }
      const remainingSentences = explanationSentences(claim.text).filter(
        (sentence) => {
          if (name === 'microsoftFacts') return true
          const repeatedDates = explanationDates(sentence).filter((date) =>
            officialDates.has(date),
          )
          if (repeatedDates.length && isScheduleOnlySentence(sentence)) {
            for (const date of repeatedDates) {
              const officialClaim = officialClaimsByDate.get(date)
              if (officialClaim) {
                officialClaim.evidenceIds = [
                  ...new Set([
                    ...officialClaim.evidenceIds,
                    ...displayedClaim.evidenceIds,
                  ]),
                ]
              }
            }
            return false
          }
          return true
        },
      )
      const uniqueSentences: string[] = []
      for (const sentence of remainingSentences) {
        const key = normalizeExplanationText(sentence)
        if (!key) continue
        const existing = seen.get(key)
        if (existing) {
          existing.evidenceIds = [
            ...new Set([
              ...existing.evidenceIds,
              ...displayedClaim.evidenceIds,
            ]),
          ]
          existing.decisionRefs = [
            ...new Set([
              ...existing.decisionRefs,
              ...displayedClaim.decisionRefs,
            ]),
          ]
          continue
        }
        uniqueSentences.push(sentence)
        seen.set(key, displayedClaim)
      }
      if (uniqueSentences.length) {
        displayedClaim.text = uniqueSentences.join('')
        kept.push(displayedClaim)
      }
    }
    deduplicated.set(name, kept)
  }

  return entries
    .map(([name]): [string, ExplanationClaim[]] => [
      name,
      deduplicated.get(name) ?? [],
    ])
    .filter(([, claims]) => claims.length > 0)
}

export function resourceConfirmationReasons(
  resources: ResourceImpact[],
  missingInformation: string[],
  reviewReasons: string[] = [],
): string[] {
  const usageVerificationResources = resources.filter(
    (resource) =>
      resource.classificationReason === 'UsageRequiresVerification' &&
      (resource.verificationRequired ||
        ['Unknown', 'Possible', 'Verification Required'].includes(
          resource.classification,
        )),
  )
  const otherResourceReasons = resources.flatMap((resource) => {
    if (
      usageVerificationResources.includes(resource) &&
      !resource.missingAttributes.length
    )
      return []
    const reason = resourceVerificationReason(resource)
    return reason ? [`${resource.type}（${resource.id}）: ${reason}`] : []
  })
  const usageVerificationReason = usageVerificationResources.length
    ? `利用実態を確認できない対象リソース（${usageVerificationResources.length}件）があります。Azureの管理プレーン情報だけでは利用有無を判断できず、接続元アプリの設定、コード参照、実行状況も取得していません。対象Workloadでの利用有無を確認してください。`
    : null
  const remainingMissingInformation = [
    ...missingInformation,
    ...reviewReasons,
  ].filter(
    (reason) =>
      !isPlanSchedulingNote(reason) &&
      !isModelDecisionStatusOnlyReviewReason(reason) &&
      !(
        usageVerificationResources.length &&
        isResourceUsageVerificationReason(reason)
      ),
  )
  return [
    ...new Set([
      ...otherResourceReasons,
      ...(usageVerificationReason ? [usageVerificationReason] : []),
      ...remainingMissingInformation,
    ]),
  ]
}

export function isModelDecisionStatusOnlyReviewReason(reason: string): boolean {
  return reason === 'モデル判断を確定できない'
}

export function isResourceUsageVerificationReason(reason: string): boolean {
  return reason.startsWith('制御プレーン情報から利用実態を確認できない')
}

export function priorityDisplay(priority: string | null): string {
  return priority
    ? `優先度 ${priority}`
    : '優先度は算定保留（対象範囲と影響を確認後に決定）'
}

export function impactDisplay(
  value: string | null,
  axis: '未対応時' | '対応時・対応後',
): string {
  const impactLabels: Record<string, string> = {
    Low: '小',
    Medium: '中',
    High: '大',
    Critical: '重大',
  }
  return value
    ? `評価値: ${impactLabels[value] ?? value}`
    : `影響度は未確定（${axis}）`
}

export function environmentDisplay(environment: string | null): string {
  return environment ?? 'Environmentタグ値なし（Azureタグ設定を確認）'
}

export function ownerTagDisplay(ownerTeam: string | null): string {
  return ownerTeam ?? 'OwnerTeamタグ値なし（実担当をWorkload責任者と確認）'
}

export function modelVersionDisplay(version: string | null): string {
  return version ?? 'モデル版の記録なし（監査記録を確認）'
}

export function modelInvocationStatusDisplay(
  invocation: Pick<ModelInvocation, 'stage' | 'status'>,
): string {
  if (invocation.stage === 'Explanation') {
    const explanationLabels: Record<string, string> = {
      NotRequired: '説明生成対象外',
      NotConfigured: '説明LLM未設定（説明文は生成されていません）',
      NotStarted: '説明生成未開始（説明文はありません）',
      Succeeded: '説明生成完了',
      SucceededWithFallback: '過去評価: 一部項目を補足',
      Failed: '説明生成失敗（生成文は表示していません）',
    }
    return explanationLabels[invocation.status] ?? '説明生成状態を確認'
  }

  const decisionLabels: Record<string, string> = {
    NotRequired: '実行対象外',
    NotConfigured: '構成なし（実行されていません）',
    NotStarted: '実行開始前に停止',
    Succeeded: '完了',
    SucceededWithFallback: '完了（過去評価で一部項目を補足）',
    Failed: '失敗',
  }
  return decisionLabels[invocation.status] ?? 'モデル実行状態を確認'
}

export function explanationSectionDisplay(name: string): string {
  const labels: Record<string, string> = {
    impact: '影響',
    increasingFactors: '影響を高める要因',
    reducingFactors: '影響を下げる要因',
    startRationale: '着手時期の理由',
    missingInformation: '不足情報',
    changeConditions: '判断が変わる条件',
    microsoftFacts: 'Microsoft公式情報',
    internalFacts: '社内情報',
    judgments: '判断',
    humanChecks: '人が確認する事項',
  }
  return labels[name] ?? '説明'
}

export function claimKindDisplay(kind: string): string {
  const labels: Record<string, string> = {
    'Confirmed Fact': '確認済み事実',
    'Derived Fact': '根拠から導いた事実',
    'General Impact': '一般的な影響想定',
    'Model Decision': 'モデル判断',
    Assumption: '仮定',
    Unknown: '根拠不足で不明',
    Recommendation: '推奨',
  }
  return labels[kind] ?? '説明区分を確認'
}

export function workloadDisplay(workloadId: string): string {
  return workloadId === 'unassigned'
    ? 'Workload未割当（情報システム部門が初動で振り分け）'
    : `Workload ${workloadId}`
}

export function assessmentStatusDisplay(assessment: Assessment): string {
  if (assessment.reviewDisposition === 'NoAction')
    return '対応不要として非表示中（理由・履歴を保存）'
  if (assessment.humanContext?.scopeDisposition === 'OutOfScope')
    return '人間確認済み・対象外'
  if (assessment.humanReviewRequired === false)
    return '定型結果（評価レビュー省略可能。作業承認は別途必要）'
  return '人による評価確認が必要'
}

export function criticalWorkloadDisplay(isCritical: boolean): string {
  return isCritical
    ? 'Criticalとして指定済み（人間確認）'
    : 'Critical指定なし（非該当の人間確認とは区別）'
}

export function plannedDateDisplay(
  date: string | null,
  field: '開始日' | '完了日',
): string {
  return date
    ? `${field}: ${date}`
    : `${field}: 未算定（担当と公式期限を確認後、計画担当が設定）`
}

export function ownerDisplay(
  ownerTeam: string | null,
  routing: WorkRouting | undefined,
): string {
  if (ownerTeam) return `確定担当: ${ownerTeam}`
  const teams = routing?.teamCandidates.map((team) => team.displayName) ?? []
  if (teams.length === 1)
    return `初動担当候補: ${teams[0]}（作業承認時に担当を確定）`
  if (teams.length > 1)
    return `担当候補: ${teams.join('、')}。情報システム部門が調整し、Workload責任者が決定`
  return '担当候補なし。情報システム部門が初動窓口となり、Workload責任者と割当を決定'
}

export function coordinationDisplay(routing: WorkRouting): string {
  const departments = routing.coordinationCandidates.map(
    (department) => department.displayName,
  )
  return departments.length
    ? departments.join('、')
    : '情報システム部門（初動調整窓口）'
}

export function approvalDisplay(routing: WorkRouting): string {
  const stages = routing.approvalStages.map((stage) => {
    const roles = stage.approverRoles.map((role) => role.displayName)
    return roles.length ? `${stage.title}（${roles.join('、')}）` : stage.title
  })
  return stages.length
    ? stages.join(' → ')
    : 'Workload責任者が業務影響・作業内容を確認 → ガバナンス責任者が方針・例外を確認（標準確認経路）'
}

export function routingDisplay(routing: WorkRouting | undefined): string {
  if (!routing)
    return '設定経路なし。情報システム部門が初動窓口となり、Workload責任者と担当・承認役割を決定'
  const teams = routing.teamCandidates.map((team) => team.displayName)
  if (teams.length === 1) return `初動担当候補: ${teams[0]}`
  if (teams.length > 1)
    return `担当候補: ${teams.join('、')}（情報システム部門が調整）`
  return '担当候補なし（情報システム部門が初動で割当調整）'
}

export function sequenceDisplay(routing: WorkRouting): string {
  const order =
    routing.sequenceOrder === null
      ? '個別の順序指定なし'
      : `設定順 ${routing.sequenceOrder + 1}`
  const prerequisites = routing.dependsOnCategories.length
    ? `前提: ${routing.dependsOnCategories.join('、')}`
    : '前提作業なし'
  return `${order}。${prerequisites}`
}

export function projectProgressDisplay(status: string | null): string {
  return status ?? 'Project Status未取得（登録状態と同期結果を確認）'
}

export function evidenceDisplay(
  evidenceIds: string[],
  evidence: Evidence[],
): Array<{ label: string; evidenceIndex: number | null }> {
  if (!evidenceIds.length)
    return [
      {
        label: '根拠が紐付いていません',
        evidenceIndex: null,
      },
    ]

  const sourceLabels: Record<Evidence['sourceType'], string> = {
    Microsoft: 'Microsoft公式情報',
    Azure: 'Azure構成情報',
    Internal: '社内情報',
    Rule: '評価ルール',
    Human: '人による確認',
  }
  return [...new Set(evidenceIds)].map((id) => {
    const evidenceIndex = evidence.findIndex((item) => item.id === id)
    const item = evidence[evidenceIndex]
    if (!item)
      return { label: '参照先の根拠を特定できません', evidenceIndex: null }
    const observedDate = item.observedAt.slice(0, 10)
    return {
      label: `${sourceLabels[item.sourceType]}（${observedDate}）`,
      evidenceIndex,
    }
  })
}

export function officialDeadlineDisplay(): string {
  return 'この評価に適用できる公式期限は記録されていません。非推奨開始日から推定せず、公式通知の更新確認を次の作業とします。'
}

export function milestoneKindDisplay(kind: string): string {
  const labels: Record<string, string> = {
    Deprecation: '非推奨開始日',
    NewCreationBlocked: '新規作成停止日',
    SupportEnded: 'サポート終了日',
    Retirement: '廃止日',
    Unknown: 'ライフサイクル種別の確認',
  }
  return labels[kind] ?? 'ライフサイクル種別の確認'
}

export function milestoneDateDisplay(
  date: string | null,
  rawDateText: string | null,
): string {
  if (date) return date
  if (rawDateText)
    return `公式原文の記載: ${rawDateText}（日付の適用範囲を確認）`
  return '日付を特定できていません（公式通知の原文を確認）'
}

export function undecidedDecisionFields(
  decision: Assessment['decision'],
): string[] {
  const fields: Array<[keyof Assessment['decision'], string]> = [
    ['impactIfUnaddressed', '未対応時の影響度'],
    ['impactDuringAndAfterChange', '対応時・対応後の影響度'],
    ['priority', '優先度'],
    ['startWindow', '対応開始時期'],
    ['complexity', '移行難易度'],
    ['projectRequired', 'プロジェクト化の要否'],
    ['ownerTeam', '担当チーム'],
  ]
  return fields
    .filter(([key]) => decision[key] === null)
    .map(([, label]) => label)
}

export function decisionStatusDisplay(
  status: string,
  undecidedFields: string[] = [],
): string {
  const labels: Record<string, string> = {
    Proposed: '判断案あり（人の確認前）',
    Abstained: undecidedFields.length
      ? `モデル判断保留（確定できなかった項目: ${undecidedFields.join('、')}）`
      : 'モデル判断保留（未確定項目が結果に記録されていません）',
    Unavailable: '判断機能を利用できず保留',
    NotRequired: '定型結果のため判断機能は不要',
    NotConfigured: '判断機能が構成されていません。手動確認が必要',
    NotStarted: '判断未実行。手動確認が必要',
    Failed: '判断処理失敗。手動確認が必要',
  }
  return labels[status] ?? '判断状態を確認してください'
}

export function reviewReasonDisplay(reason: string): string {
  if (
    reason.includes('クラシック API') &&
    (reason.includes('使用有無') || reason.includes('利用有無'))
  )
    return 'クラシック API の使用有無を判断できないため、対象リソースとプロジェクトでの利用状況の確認が必要です。'
  if (reason.includes('担当チーム候補が設定されていません'))
    return '担当チームが選定されていません。情報システム部門が初動調整し、Workload責任者と担当部門を決めます。'
  if (reason.includes('未確認のOwner Team'))
    return '担当チームの根拠がありません。Workload責任者と担当部門を確認してください。'
  return reason
}

export function isKnownReviewReason(reason: string): boolean {
  return (
    reason.includes('クラシック API') &&
    (reason.includes('使用有無') || reason.includes('利用有無'))
  )
}

export function isPlanSchedulingNote(reason: string): boolean {
  return (
    reason.includes('期限または承認済み工程期間が未確定') ||
    reason.includes('計画日を算定できません')
  )
}

export function planSchedulingNoteDisplay(reason: string): string {
  if (reason.includes('期限または承認済み工程期間が未確定'))
    return '計画日を算定できません。適用期限と承認済みの工程期間を確認後、計画担当が設定します。'
  return reason
}

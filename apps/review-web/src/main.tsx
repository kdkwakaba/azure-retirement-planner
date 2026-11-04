import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  assessmentSchema,
  type Assessment,
  type Evidence,
} from '@arp/contracts'
import { generalImpactNarratives } from '@arp/domain/impact-narratives'
import './styles.css'
import { CorrectionForm } from './CorrectionForm.tsx'
import { SharePointPanel } from './SharePointPanel.tsx'
import {
  approvalDisplay,
  assessmentStatusDisplay,
  claimKindDisplay,
  coordinationDisplay,
  criticalWorkloadDisplay,
  decisionStatusDisplay,
  environmentDisplay,
  evidenceDisplay,
  explanationSectionDisplay,
  impactDisplay,
  isKnownReviewReason,
  isModelDecisionStatusOnlyReviewReason,
  isPlanSchedulingNote,
  modelInvocationStatusDisplay,
  officialDeadlineDisplay,
  milestoneDateDisplay,
  milestoneKindDisplay,
  ownerDisplay,
  ownerTagDisplay,
  modelVersionDisplay,
  plannedDateDisplay,
  priorityDisplay,
  planSchedulingNoteDisplay,
  projectProgressDisplay,
  deduplicateExplanationClaims,
  resourceConfirmationReasons,
  isResourceUsageVerificationReason,
  reviewReasonDisplay,
  routingDisplay,
  sequenceDisplay,
  workloadDisplay,
  undecidedDecisionFields,
} from './display-completeness.ts'
import { EvidenceCard, safeOfficialEvidenceUrl } from './EvidenceFact.tsx'
import { summarizeAssessments } from './summary.ts'

import { ApiRequestError, request, syncFeedback } from './api.ts'
import { syntheticUatTrackingId, visibleAssessments } from './visibility.ts'

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
const priorityDescriptions: Record<string, string> = {
  P1: '至急判断・着手。期限内に対応できるか、またはリスクを受容するかを至急確定します。P1は本番変更の即時実行を意味しません。GitHubラベルはHighです。',
  P2: '早期に計画を確定し、調査・設計・体制確保を開始します。GitHubラベルはMediumです。',
  P3: '通常の変更計画へ組み込み、進捗を確認します。GitHubラベルはMediumです。',
  P4: '影響が限定的で余裕がある状態です。経過観察または将来計画として扱います。GitHubラベルはLowです。',
}
const impactDescriptions: Record<'未対応時' | '対応時・対応後', string> = {
  未対応時:
    '通知の適用条件に該当する場合、未対応で起こり得る機能・運用上の影響を一般的な想定として示します。影響度の評価値とは別の説明です。個別業務との対応情報がない場合は処理名を特定しません。',
  '対応時・対応後':
    '更新・移行・切替を行う場合に想定される作業上の影響を示します。作業方式と構成が分からない場合、停止の有無や時間は断定しません。',
}
function HelpTip({
  label,
  placement = 'left',
  children,
}: {
  label: string
  placement?: 'left' | 'right'
  children: ReactNode
}) {
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  return (
    <span
      className={`help-tip-container help-tip-container--${placement}`}
      data-open={open}
    >
      <button
        className="help-tip-button"
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            event.currentTarget.blur()
          }
        }}
      >
        ?
      </button>
      <span className="help-tip-tooltip" id={tooltipId} role="tooltip">
        {children}
      </span>
    </span>
  )
}

function PriorityHelp({
  placement = 'left',
}: {
  placement?: 'left' | 'right'
}) {
  return (
    <HelpTip label="P1からP4の優先度の説明を表示" placement={placement}>
      <span className="help-tip-summary">この件数はP1とP2の合計です。</span>
      {Object.entries(priorityDescriptions).map(([priority, description]) => (
        <span className="help-tip-item" key={priority}>
          <strong>{priority}</strong>
          <span>{description}</span>
        </span>
      ))}
    </HelpTip>
  )
}

function ImpactHelp({ axis }: { axis: '未対応時' | '対応時・対応後' }) {
  return (
    <HelpTip label={`${axis}の業務影響について`}>
      <span>{impactDescriptions[axis]}</span>
    </HelpTip>
  )
}

function ImpactNarrative({
  claim,
  evidence,
  onOpenEvidence,
}: {
  claim: Assessment['explanation']['impact'][number] | undefined
  evidence: Evidence[]
  onOpenEvidence: (index: number) => void
}) {
  if (!claim) return null
  return (
    <div className="impact-narrative">
      <span>一般的な影響想定</span>
      <p>{claim.text}</p>
      <EvidenceReferences
        evidenceIds={claim.evidenceIds}
        evidence={evidence}
        onOpenEvidence={onOpenEvidence}
      />
    </div>
  )
}

function EvidenceReferences({
  evidenceIds,
  evidence,
  onOpenEvidence,
}: {
  evidenceIds: string[]
  evidence: Evidence[]
  onOpenEvidence: (index: number) => void
}) {
  const references = evidenceDisplay(evidenceIds, evidence)
  return (
    <small className="evidence-references">
      根拠:{' '}
      {references.map((reference, index) =>
        reference.evidenceIndex === null ? (
          <span key={`${reference.label}-${index}`}>{reference.label}</span>
        ) : (
          <button
            className="evidence-reference"
            key={`${reference.evidenceIndex}-${index}`}
            onClick={() => onOpenEvidence(reference.evidenceIndex!)}
            type="button"
          >
            {reference.label}
          </button>
        ),
      )}
    </small>
  )
}

function SummaryHelp({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return <HelpTip label={label}>{children}</HelpTip>
}

type UatExportStatus = {
  state: string
  stage: string | null
  issueUrl: string | null
  parentIssueUrl: string | null
  phaseIssueUrl: string | null
  errorCategory: string | null
  errorHttpStatus: number | null
  correlationId: string | null
  operation: string | null
  providerCode: string | null
  updatedAt: string | null
}
type FeatureStatus = {
  testModeEnabled: boolean
  syntheticUatEnabled: boolean
  decisionReevaluationEnabled: boolean
  canReevaluate: boolean
  canSync: boolean
  canReview: boolean
  canManageSharePoint: boolean
  sharePointSyncEnabled: boolean
  sharePointFactExtractionEnabled: boolean
}
type DecisionReevaluationStatus = {
  runId: string
  assessmentId: string
  state: 'Pending' | 'Queued' | 'Processing' | 'Completed' | 'Failed'
  resultAssessmentId: string | null
  error: string | null
}
const reevaluationStateLabels: Record<string, string> = {
  Pending: '再評価を待機中',
  Queued: '再評価をキューに登録中',
  Processing: 'Decision-1と説明LLMで再評価中',
  Completed: '再評価が完了しました',
  Failed: '再評価に失敗しました',
}
const reevaluationErrorLabels: Record<string, string> = {
  StaleAssessment: '選択した評価は最新ではありません。画面を更新してください。',
  MissingSnapshot:
    '保存済みの調査情報がありません。Azure情報を再取得してください。',
  ModelUnavailable:
    'Decision-1または説明LLMを利用できませんでした。モデル設定と実行記録を確認してください。',
  DailyLimit: '本日のモデル呼び出し上限に達しました。',
  ProcessingFailed: '処理に失敗しました。照会記録から原因を確認してください。',
}
const uatStages = [
  ['finding-or-creating-parent', '親Issueを確認中'],
  ['adding-parent-to-project', '親IssueをProjectに登録中'],
  ['finding-or-creating-phase', '作業フェーズを確認中'],
  ['linking-phase-to-parent', 'フェーズを親Issueに登録中'],
  ['finding-or-creating-issue', '作業Issueを確認中'],
  ['creating-issue', 'Issueを作成中'],
  ['updating-issue', 'Issue内容を更新中'],
  ['verifying-issue', 'Issueを確認中'],
  ['linking-sub-issue', '親IssueのSub-Issueに登録中'],
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
  const evidencePanelRef = useRef<HTMLDetailsElement>(null)
  const [items, setItems] = useState<Assessment[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [notice, setNotice] = useState(''),
    [testModeEnabled, setTestModeEnabled] = useState(false),
    [syntheticUatEnabled, setSyntheticUatEnabled] = useState(false),
    [confirmingUatExport, setConfirmingUatExport] = useState(false),
    [decisionReevaluationEnabled, setDecisionReevaluationEnabled] =
      useState(false),
    [canReevaluate, setCanReevaluate] = useState(false),
    [canSync, setCanSync] = useState(false),
    [canManageSharePoint, setCanManageSharePoint] = useState(false),
    [sharePointSyncEnabled, setSharePointSyncEnabled] = useState(false),
    [sharePointFactExtractionEnabled, setSharePointFactExtractionEnabled] =
      useState(false),
    [canReview, setCanReview] = useState(false),
    [showNoAction, setShowNoAction] = useState(false),
    [reevaluationStatus, setReevaluationStatus] =
      useState<DecisionReevaluationStatus | null>(null),
    [uatIssueUrl, setUatIssueUrl] = useState(''),
    [uatExportStatus, setUatExportStatus] = useState<UatExportStatus | null>(
      null,
    ),
    [projectProgress, setProjectProgress] = useState<
      Array<{ workItemId: string; status: string | null; syncedAt: string }>
    >([])
  const current = items.find((a) => a.id === selected)
  const summary = summarizeAssessments(items)
  const storedImpactNarratives = current?.explanation.impact.filter(
    (claim) => claim.kind === 'General Impact',
  )
  const impactNarratives = current
    ? storedImpactNarratives?.length
      ? storedImpactNarratives
      : generalImpactNarratives(current.event, current.resources)
    : []
  const impactNarrativeFor = (decisionRef: string) =>
    impactNarratives.find((claim) => claim.decisionRefs.includes(decisionRef))
  const explanationSections = current
    ? deduplicateExplanationClaims(current.explanation)
        .map(
          ([name, claims]) =>
            [
              name,
              name === 'impact'
                ? claims.filter((claim) => claim.kind !== 'General Impact')
                : claims,
            ] as const,
        )
        .filter(([, claims]) => claims.length > 0)
    : []
  const explanationClaimCount = explanationSections.reduce(
    (count, [, claims]) => count + claims.length,
    0,
  )
  const resourceReasons = current
    ? resourceConfirmationReasons(
        current.resources,
        current.missingInformation,
        current.reviewReasons,
      )
    : []
  const discoveryReviewReasons = current
    ? [
        ...(current.discoveryScope?.profileIds.length === 0
          ? [
              `この通知に対応するResource Type判定プロファイルがありません。${current.resources.length ? '明示対象以外のAzureリソースは通知内容との関係を判定できません。' : '該当するAzureリソース種別を判定できません。'}公式通知の適用範囲を確認してください。`,
            ]
          : []),
        ...(current.discoveryScope?.failureDetails?.length
          ? current.discoveryScope.failureDetails.map(
              (failure) =>
                `${operationSourceLabels[failure.source]}の取得に失敗したため、影響範囲を判断できません（${failureCategoryLabels[failure.category]}${failure.httpStatus ? ` HTTP ${failure.httpStatus}` : ''}）。`,
            )
          : !current.scopeComplete
            ? [
                'Azure情報の調査範囲が完了していないため、影響範囲を確定できません。取得結果と対象範囲を確認してください。',
              ]
            : []),
      ]
    : []
  const confirmationReasons = current
    ? [
        ...new Set(
          [
            ...resourceReasons,
            ...discoveryReviewReasons,
            ...current.reviewReasons.filter(
              (reason) =>
                !isPlanSchedulingNote(reason) &&
                !isResourceUsageVerificationReason(reason) &&
                !isModelDecisionStatusOnlyReviewReason(reason),
            ),
            ...current.explanation.humanChecks
              .filter(
                (claim) =>
                  isKnownReviewReason(claim.text) &&
                  !isPlanSchedulingNote(claim.text) &&
                  !isResourceUsageVerificationReason(claim.text),
              )
              .map((claim) => claim.text),
          ].map(reviewReasonDisplay),
        ),
      ]
    : []
  const planningNotes = current
    ? [
        ...new Set(
          [
            ...current.reviewReasons,
            ...current.missingInformation,
            ...current.explanation.humanChecks.map((claim) => claim.text),
          ]
            .filter(isPlanSchedulingNote)
            .map(planSchedulingNoteDisplay),
        ),
      ]
    : []
  const additionalHumanChecks = current
    ? current.explanation.humanChecks.filter(
        (claim) =>
          !isPlanSchedulingNote(claim.text) &&
          !isKnownReviewReason(claim.text) &&
          !confirmationReasons.includes(reviewReasonDisplay(claim.text)),
      )
    : []
  const confirmationReasonCount =
    confirmationReasons.length +
    new Set(additionalHumanChecks.map((claim) => claim.text)).size
  function openEvidence(index: number) {
    const panel = evidencePanelRef.current
    const target = document.getElementById(`evidence-card-${index}`)
    if (!panel || !target) return
    panel.open = true
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.focus({ preventScroll: true })
    })
  }
  async function refresh() {
    setError('')
    try {
      const data = assessmentSchema
        .array()
        .parse(
          await request(`assessments?includeNoAction=${showNoAction}`, 'GET'),
        )
      const uat = (await request('uat/status', 'GET')) as FeatureStatus
      const showSynthetic = uat.testModeEnabled && uat.syntheticUatEnabled
      const visible = visibleAssessments(
        data,
        uat.testModeEnabled,
        uat.syntheticUatEnabled,
        showNoAction,
      )
      setItems(visible)
      setTestModeEnabled(uat.testModeEnabled)
      setSyntheticUatEnabled(showSynthetic)
      setDecisionReevaluationEnabled(
        uat.testModeEnabled && uat.decisionReevaluationEnabled,
      )
      setCanReevaluate(uat.canReevaluate)
      setCanSync(uat.canSync)
      setCanManageSharePoint(uat.canManageSharePoint)
      setSharePointSyncEnabled(uat.sharePointSyncEnabled)
      setSharePointFactExtractionEnabled(uat.sharePointFactExtractionEnabled)
      setCanReview(uat.canReview)
      if (selected && !visible.some((item) => item.id === selected))
        setSelected(null)
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
  }, [showNoAction])
  useEffect(() => {
    const item = current?.workItems.find((candidate) =>
      candidate.title.startsWith('[SYNTHETIC UAT]'),
    )
    if (
      !syntheticUatEnabled ||
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
  }, [selected, syntheticUatEnabled, busy])
  useEffect(() => {
    if (
      !reevaluationStatus ||
      !['Pending', 'Queued', 'Processing'].includes(reevaluationStatus.state)
    )
      return
    let active = true
    const poll = async () => {
      try {
        const status = (await request(
          `decision-reevaluation-status?runId=${encodeURIComponent(reevaluationStatus.runId)}`,
          'GET',
        )) as DecisionReevaluationStatus
        if (!active) return
        setReevaluationStatus(status)
        if (
          ['Completed', 'Failed'].includes(status.state) &&
          status.resultAssessmentId
        ) {
          await refresh()
          setSelected(status.resultAssessmentId)
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : '再評価状況を取得できません',
          )
      }
    }
    const timer = window.setInterval(() => void poll(), 2000)
    void poll()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [reevaluationStatus?.runId, reevaluationStatus?.state])
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
      const result = (await request('uat/seed', 'POST', {})) as {
        assessmentId: string
        created: boolean
        decisionStatus: 'Proposed' | 'Abstained' | 'Unavailable'
      }
      await refresh()
      setSelected(result.assessmentId)
      setNotice(
        `合成通知をDecision-1で評価しました（${result.decisionStatus}）。結果を確認し、人間承認後にGitHub Projectへ登録できます。`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '合成UAT作成失敗')
    } finally {
      setBusy(false)
    }
  }
  async function reevaluateCurrentNotice() {
    if (!current || current.event.trackingId === syntheticUatTrackingId) return
    const reason = window.prompt(
      '再評価理由を入力してください（10〜500文字）。保存済みの調査結果を使い、Decision-1とGPT-6 Lunaを最大各1回実行します。',
    )
    if (!reason?.trim() || reason.trim().length < 10) return
    if (
      !window.confirm(
        '選択中の実通知・ワークロード1件だけを再評価します。保存済み通知本文・根拠・型付き構成属性をDecision-1とGPT-6 Lunaへ送信します。Resource ID、Owner Team、Workload IDは別名化し、Resourceの未定義propertiesは送信しません。保存済みの調査結果を使うため、Azure情報の再取得や対象リソースの変更は行いません。モデル呼出しは最大各1回です。新しい検証用評価版を作成し、承認・修正・Issue登録はできません。続けますか？',
      )
    )
      return
    setBusy(true)
    setError('')
    setNotice('1件限定のDecision-1・説明LLM再評価を依頼しています。')
    try {
      const result = (await request('decision-reevaluation', 'POST', {
        assessmentId: current.id,
        runId: crypto.randomUUID(),
        reason: reason.trim(),
      })) as DecisionReevaluationStatus
      setReevaluationStatus(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '再評価の依頼に失敗しました')
    } finally {
      setBusy(false)
    }
  }
  async function exportSyntheticUat() {
    if (!current || current.event.trackingId !== syntheticUatTrackingId) return
    const item = current.workItems[0]
    if (!item) return
    setConfirmingUatExport(false)
    setBusy(true)
    setError('')
    setNotice('')
    setUatIssueUrl('')
    setUatExportStatus({
      state: 'Processing',
      stage: 'finding-or-creating-parent',
      issueUrl: null,
      parentIssueUrl: null,
      phaseIssueUrl: null,
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
              parentIssueUrl: result.parentIssueUrl,
              phaseIssueUrl: result.phaseIssueUrl,
            }
          : status,
      )
      setNotice(
        '合成UATの親Issue・フェーズIssue・作業IssueをProjectへ登録しました。',
      )
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setUatExportStatus((status) => ({
          state: 'Failed',
          stage: e.stage ?? status?.stage ?? null,
          issueUrl: status?.issueUrl ?? null,
          parentIssueUrl: status?.parentIssueUrl ?? null,
          phaseIssueUrl: status?.phaseIssueUrl ?? null,
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
  async function refreshCurrentResources() {
    if (!current) return
    if (
      !window.confirm(
        '保存済みの通知内容を使い、Azure構成を再取得してこの通知のリソース候補を再評価します。新しい評価版が作成され、以前の承認は引き継がれません。続けますか？',
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      const result = await request('sync', 'POST', {
        assessmentIds: [current.id],
      })
      const feedback = syncFeedback(result)
      await refresh()
      setNotice(
        `${feedback.notice}${feedback.error ? ` ${feedback.error}` : ''}`,
      )
      if (feedback.error) setError(feedback.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : '既存通知の再評価に失敗')
    } finally {
      setBusy(false)
    }
  }
  async function review(
    result: 'Approved' | 'Partial' | 'Returned' | 'Held' | 'NoAction',
  ) {
    if (!current) return
    if (
      result === 'NoAction' &&
      !window.confirm(
        'この通知を「対応不要」として通常一覧から非表示にします。通知本文・根拠・レビュー履歴は監査用に保持されます。よろしいですか？',
      )
    )
      return
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
      let exportNotice =
        'GitHub Issue／Projectへの外部登録は環境設定（ARP_EXPORT_ENABLED=falseまたは未設定）で無効です。有効化前に未配送Outboxを確認し、設定変更後に手動CDで再配置してください。'
      if (result === 'NoAction')
        exportNotice =
          '対応不要の判断を記録し、通知を通常一覧から外しました。履歴から再表示できます。'
      else if (response.exportEnabled)
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
          <label className="inline-toggle">
            <input
              type="checkbox"
              checked={showNoAction}
              onChange={(event) => setShowNoAction(event.target.checked)}
            />
            対応不要の通知も表示
          </label>
          {syntheticUatEnabled && (
            <button disabled={busy} onClick={() => void seedSyntheticUat()}>
              合成UATを作成・Decision-1評価
            </button>
          )}
          {testModeEnabled && <span className="notice">テストモード</span>}
          <span>評価対象は読み取り専用</span>
        </div>
        {canSync && (
          <SharePointPanel
            canConfigure={canManageSharePoint}
            canSync={canSync}
            syncEnabled={sharePointSyncEnabled}
            factExtractionEnabled={sharePointFactExtractionEnabled}
          />
        )}
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
              <small className="summary-caption">
                人間確認が必要
                <SummaryHelp label="人間確認が必要の件数について">
                  この件数は、人間レビューが不要と明示されていない評価レコードです。判断の不確実性や高リスクの確認を示し、作業項目の承認済み件数ではありません。
                </SummaryHelp>
              </small>
              <strong>{summary.humanReviewRequired}</strong>
            </article>
            <article>
              <small className="summary-caption">
                優先度 <PriorityHelp placement="right" />
              </small>
              <strong>{summary.highPriority}</strong>
            </article>
            <article>
              <small className="summary-caption">
                調査不完全・未確認
                <SummaryHelp label="調査不完全・未確認の件数について">
                  この件数は、Resource
                  Graphなどによる影響調査の取得範囲が完全と確認できていない評価レコードです。該当リソースがないことや、影響がないことを意味しません。
                </SummaryHelp>
              </small>
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
        {syntheticUatEnabled && uatIssueUrl && (
          <p>
            <a href={uatIssueUrl} target="_blank" rel="noopener noreferrer">
              作成した合成UAT Issueを開く
            </a>
          </p>
        )}
        {syntheticUatEnabled && uatExportStatus?.parentIssueUrl && (
          <p>
            <a
              href={uatExportStatus.parentIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              合成UATの親Issueを開く
            </a>
            {uatExportStatus.phaseIssueUrl && (
              <>
                {' · '}
                <a
                  href={uatExportStatus.phaseIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  フェーズIssueを開く
                </a>
              </>
            )}
          </p>
        )}
        <div className="layout">
          <aside>
            <h2>ライフサイクル通知</h2>
            {!items.length && (
              <p>
                {showNoAction
                  ? '表示できる通知履歴はありません。'
                  : '表示中の通知はありません。対応不要とした通知は「対応不要の通知も表示」から確認できます。必要ならAzure情報を取得してください。'}
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
                  {workloadDisplay(item.workloadId)} ·{' '}
                  {priorityDisplay(item.effectivePriority)}
                </small>
                <small>
                  {item.createdAt} · {assessmentStatusDisplay(item)}
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
                {current.reviewDisposition === 'NoAction' && (
                  <div className="notice" role="status">
                    <b>対応不要として一覧から外した履歴</b>
                    <p>
                      通知原本・根拠・以前のレビュー記録は保持されています。ここで新しいレビューを記録すると通常一覧に戻ります。
                    </p>
                  </div>
                )}
                <p>
                  {workloadDisplay(current.workloadId)} ／ 評価基準日:{' '}
                  {current.asOf}
                </p>
                {canSync &&
                  current.event.trackingId !== syntheticUatTrackingId &&
                  current.humanContext?.scopeDisposition !== 'OutOfScope' && (
                    <div
                      className="notice"
                      role="region"
                      aria-label="既存通知の再評価"
                    >
                      <b>既存通知を最新のAzure構成で再評価</b>
                      <p>
                        通知本文は保存済みのものを使い、Azure構成と明示影響対象を再取得します。新しい評価版をバックグラウンドで作成し、以前の承認は引き継ぎません。
                      </p>
                      <button
                        disabled={busy}
                        onClick={() => void refreshCurrentResources()}
                      >
                        {busy ? '処理中…' : 'リソース候補を再評価'}
                      </button>
                    </div>
                  )}
                {decisionReevaluationEnabled &&
                  canReevaluate &&
                  current.event.trackingId !== syntheticUatTrackingId && (
                    <div
                      className="notice"
                      role="region"
                      aria-label="テスト用再評価"
                    >
                      <b>テスト用：実通知1件を再評価</b>
                      <p>
                        保存済みの実リソース調査結果を使い、選択中の通知・WorkloadだけをDecision-1で再評価します。Azure再取得、対象環境への変更、作業承認、GitHub登録は行いません。再評価は新しい版として記録され、既存の承認は引き継がれません。
                      </p>
                      <button
                        disabled={
                          busy ||
                          (reevaluationStatus?.assessmentId === current.id &&
                            ['Pending', 'Queued', 'Processing'].includes(
                              reevaluationStatus.state,
                            ))
                        }
                        onClick={() => void reevaluateCurrentNotice()}
                      >
                        {busy
                          ? '処理中…'
                          : reevaluationStatus?.assessmentId === current.id &&
                              ['Pending', 'Queued', 'Processing'].includes(
                                reevaluationStatus.state,
                              )
                            ? reevaluationStateLabels[reevaluationStatus.state]
                            : 'この1件を再評価'}
                      </button>
                      {reevaluationStatus?.assessmentId === current.id && (
                        <p role="status" aria-live="polite">
                          {reevaluationStateLabels[reevaluationStatus.state] ??
                            reevaluationStatus.state}
                          {reevaluationStatus.error
                            ? ` — ${reevaluationErrorLabels[reevaluationStatus.error] ?? reevaluationStatus.error}`
                            : ''}
                          {reevaluationStatus.resultAssessmentId
                            ? ` ／ 評価ID ${reevaluationStatus.resultAssessmentId}`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}
                {current.humanContext?.scopeDisposition === 'OutOfScope' && (
                  <div role="status" className="notice">
                    <b>人間確認済み・対象外</b>
                    <p>{current.humanContext.reason}</p>
                    <small>
                      Evidence:{' '}
                      {current.humanContext.reviewEvidenceIds?.join(', ') ??
                        'Evidenceなし（対象外判定の根拠を追加してください）'}
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
                        <small className="summary-caption">
                          未対応時 <ImpactHelp axis="未対応時" />
                        </small>
                        <strong>
                          {impactDisplay(
                            current.humanContext
                              ? current.humanContext.impactIfUnaddressed
                              : current.decision.impactIfUnaddressed,
                            '未対応時',
                          )}
                        </strong>
                        <ImpactNarrative
                          claim={impactNarrativeFor('impactIfUnaddressed')}
                          evidence={current.event.evidence}
                          onOpenEvidence={openEvidence}
                        />
                      </article>
                      <article>
                        <small className="summary-caption">
                          対応時・対応後 <ImpactHelp axis="対応時・対応後" />
                        </small>
                        <strong>
                          {impactDisplay(
                            current.humanContext
                              ? current.humanContext.impactDuringAndAfterChange
                              : current.decision.impactDuringAndAfterChange,
                            '対応時・対応後',
                          )}
                        </strong>
                        <ImpactNarrative
                          claim={impactNarrativeFor(
                            'impactDuringAndAfterChange',
                          )}
                          evidence={current.event.evidence}
                          onOpenEvidence={openEvidence}
                        />
                      </article>
                      <article>
                        <small className="priority-caption">
                          暫定優先度 <PriorityHelp placement="right" />
                        </small>
                        <strong>
                          {priorityDisplay(current.effectivePriority)}
                        </strong>
                      </article>
                    </div>
                    <p>
                      モデル: {current.decision.model} /{' '}
                      {modelVersionDisplay(current.decision.modelVersion)} ·{' '}
                      {decisionStatusDisplay(
                        current.decision.status,
                        undecidedDecisionFields(current.decision),
                      )}
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
                              {modelInvocationStatusDisplay(invocation)} —{' '}
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
                {!current.reevaluation && (
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
                )}
                {planningNotes.length > 0 && (
                  <details className="review-info-group">
                    <summary>
                      計画上の留意事項（{planningNotes.length}）
                    </summary>
                    <ul>
                      {planningNotes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <details className="review-info-group">
                  <summary>
                    確認が必要な理由（{confirmationReasonCount}）
                  </summary>
                  {current.humanReviewRequired === false && (
                    <p>
                      評価レビューは省略可能な定型結果ですが、業務影響なしを意味しません。作業項目の承認・外部登録は別途人間の確認が必要です。
                    </p>
                  )}
                  {confirmationReasons.length > 0 && (
                    <ul>
                      {confirmationReasons.map((text) => (
                        <li key={text}>{reviewReasonDisplay(text)}</li>
                      ))}
                    </ul>
                  )}
                  {additionalHumanChecks.length > 0 && (
                    <>
                      <h4>追加の確認事項</h4>
                      {additionalHumanChecks.map((claim) => (
                        <p key={claim.id}>
                          {claim.text}
                          <EvidenceReferences
                            evidenceIds={claim.evidenceIds}
                            evidence={current.event.evidence}
                            onOpenEvidence={openEvidence}
                          />
                        </p>
                      ))}
                    </>
                  )}
                  {confirmationReasonCount === 0 && (
                    <p>確認理由は登録されていません。</p>
                  )}
                </details>
                <p>
                  重要Workload:{' '}
                  {criticalWorkloadDisplay(current.criticalWorkload)}
                </p>
                <h3>公式期限</h3>
                {!current.event.milestones.length ? (
                  <p>{officialDeadlineDisplay()}</p>
                ) : (
                  <ul>
                    {current.event.milestones.map((m) => (
                      <li key={m.id}>
                        {milestoneKindDisplay(m.kind)}:{' '}
                        {milestoneDateDisplay(m.date, m.rawDateText)} —{' '}
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
                    : '過去評価（調査結果・範囲の記録なし。最新構成を再取得して再評価）'}
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
                        <th>Environmentタグ</th>
                        <th>OwnerTeamタグ</th>
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
                          <td>{environmentDisplay(r.environment)}</td>
                          <td>{ownerTagDisplay(r.ownerTeam)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>
                  {current.humanContext?.scopeDisposition === 'OutOfScope'
                    ? '対象外判定前の記録'
                    : '評価内容と根拠'}
                </h3>
                <details className="review-info-group">
                  <summary>説明（{explanationClaimCount}）</summary>
                  {explanationSections.length === 0 ? (
                    <p>
                      説明はありません。根拠のない内容は補わず、確認事項を参照してください。
                    </p>
                  ) : (
                    explanationSections.map(([name, claims]) => (
                      <section key={name} className="explanation-section">
                        <h4>{explanationSectionDisplay(name)}</h4>
                        {Array.from(
                          new Set(claims.map((claim) => claim.kind)),
                        ).map((kind) => (
                          <div key={kind} className="explanation-claim-group">
                            <h5>{claimKindDisplay(kind)}</h5>
                            {claims
                              .filter((claim) => claim.kind === kind)
                              .map((claim) => (
                                <p key={claim.id}>
                                  {claim.text}
                                  <EvidenceReferences
                                    evidenceIds={claim.evidenceIds}
                                    evidence={current.event.evidence}
                                    onOpenEvidence={openEvidence}
                                  />
                                </p>
                              ))}
                          </div>
                        ))}
                      </section>
                    ))
                  )}
                </details>
                <details className="review-info-group" ref={evidencePanelRef}>
                  <summary>根拠（{current.event.evidence.length}）</summary>
                  {current.event.evidence.length === 0 && (
                    <p>保存された根拠はありません。</p>
                  )}
                  {current.event.evidence.map((e, evidenceIndex) => (
                    <article
                      className="evidence-item"
                      id={`evidence-card-${evidenceIndex}`}
                      key={e.id}
                      tabIndex={-1}
                    >
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
                          {e.sourceType === 'Microsoft' && (
                            <b>Microsoft公式URL: </b>
                          )}
                          <a
                            href={safeOfficialEvidenceUrl(e.officialUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {safeOfficialEvidenceUrl(e.officialUrl)}
                          </a>
                        </p>
                      )}
                      {e.sourceType === 'Microsoft' &&
                        !safeOfficialEvidenceUrl(e.officialUrl) && (
                          <p className="evidence-source-link">
                            Microsoft公式URLを確認できません。保存済みEvidenceと公式通知の出典を確認してください。
                          </p>
                        )}
                      <details className="evidence-id">
                        <summary>Evidence ID</summary>
                        <code>{e.id}</code>
                      </details>
                    </article>
                  ))}
                </details>
                {current.humanContext?.scopeDisposition === 'OutOfScope' && (
                  <p>
                    対象外判定前のモデル判断・説明・根拠は監査用に保持されています。現在の対応判断とは分けて確認してください。
                  </p>
                )}
                {current.humanContext?.scopeDisposition === 'OutOfScope' ? (
                  <p>
                    対象外判定により作業案は取り下げられ、承認・登録できません。
                  </p>
                ) : (
                  <>
                    <h3>作業案・部分承認</h3>
                    {current.reevaluation && (
                      <div className="notice" role="note">
                        <b>テスト用再評価結果・参照専用</b>
                        <p>
                          Decision-1と説明LLMの動作確認用です。この評価は修正・承認・対応不要判定・外部登録の対象にできません。元の評価と履歴は保持されています。
                        </p>
                      </div>
                    )}
                    {syntheticUatEnabled &&
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
                            onClick={() => setConfirmingUatExport(true)}
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
                            <li key={e}>{reviewReasonDisplay(e)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {current.workItems.map((w) => (
                      <article className="work" key={w.id}>
                        <label>
                          <input
                            type="checkbox"
                            disabled={Boolean(current.reevaluation)}
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
                          {w.category} · {w.necessity} · 優先度{' '}
                          {priorityDisplay(w.priority)} <PriorityHelp />
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
                              {projectProgressDisplay(
                                projectProgress.find(
                                  (p) => p.workItemId === w.id,
                                )?.status ?? null,
                              )}
                            </>
                          )}
                        </small>
                        <p>
                          {plannedDateDisplay(w.plannedStartDate, '開始日')} ／{' '}
                          {plannedDateDisplay(w.dueDate, '完了日')} ／{' '}
                          {ownerDisplay(w.ownerTeam, w.workflowRouting)}
                        </p>
                        <div className="notice">
                          <b>
                            担当・調整・承認の進め方
                            {w.workflowRouting
                              ? `（設定 ${w.workflowRouting.policyVersion}）`
                              : ''}
                          </b>
                          <p>{routingDisplay(w.workflowRouting)}</p>
                          <p>
                            調整部署:{' '}
                            {w.workflowRouting
                              ? coordinationDisplay(w.workflowRouting)
                              : '情報システム部門（初動調整窓口）'}
                          </p>
                          <p>
                            標準確認経路:{' '}
                            {w.workflowRouting
                              ? approvalDisplay(w.workflowRouting)
                              : 'Workload責任者が業務影響・作業内容を確認 → ガバナンス責任者が方針・例外を確認'}
                          </p>
                          {w.workflowRouting && (
                            <p>
                              作業順序: {sequenceDisplay(w.workflowRouting)}
                            </p>
                          )}
                          {w.workflowRouting?.unresolvedReasons.map(
                            (reason) => (
                              <p key={reason}>人間確認: {reason}</p>
                            ),
                          )}
                        </div>
                        <ul>
                          {w.completionCriteria.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                    {current.workItems.length === 0 && (
                      <p>
                        この評価には作業案がありません。調査結果と確認事項を確認し、必要な作業はReviewerまたはGovernanceが根拠を添えて追加してください。
                      </p>
                    )}
                    {!current.reevaluation && (
                      <>
                        <label>
                          判断理由
                          <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={2000}
                          />
                        </label>
                        <p role="note">
                          承認・対応不要・保留には判断理由が必要です。対応不要を選ぶと通常一覧から非表示になりますが、通知・根拠・判断履歴は保持されます。検証不適合が表示されている間は作業を承認できません。
                        </p>
                        <div className="toolbar">
                          <button
                            disabled={
                              busy ||
                              !canReview ||
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
                            disabled={busy || !canReview || !reason.trim()}
                            onClick={() => void review('NoAction')}
                          >
                            対応不要として一覧から外す
                          </button>
                          <button
                            disabled={busy || !canReview || !reason.trim()}
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
              </>
            )}
          </section>
        </div>
      </main>
      {confirmingUatExport && (
        <div
          className="confirmation-backdrop"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) setConfirmingUatExport(false)
            if (event.key === 'Tab') {
              const buttons = event.currentTarget.querySelectorAll('button')
              const first = buttons.item(0)
              const last = buttons.item(buttons.length - 1)
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy)
              setConfirmingUatExport(false)
          }}
        >
          <section
            aria-labelledby="uat-export-confirmation-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <h2 id="uat-export-confirmation-title">
              GitHub Issueへの登録を確認
            </h2>
            <p>
              合成UATの承認済み作業1件について、親Issue・作業フェーズIssue・作業Issueを作成し、Sub-Issue関係とProject登録を行います。
            </p>
            <p>
              この通知とリソースは合成データです。実環境の作業やAzureリソースの変更は行いません。
            </p>
            <div className="confirmation-actions">
              <button
                autoFocus
                disabled={busy}
                onClick={() => setConfirmingUatExport(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                disabled={busy}
                onClick={() => void exportSyntheticUat()}
                type="button"
              >
                IssueとProjectに登録
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)

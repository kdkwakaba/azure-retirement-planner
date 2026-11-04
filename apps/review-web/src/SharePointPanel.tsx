import { useEffect, useState, type FormEvent } from 'react'
import {
  documentSourceSchema,
  sharePointSnapshotSchema,
  sharePointSyncRunSchema,
  type DocumentSource,
  type SharePointSnapshot,
  type SharePointSyncRun,
} from '@arp/contracts'
import { request } from './api.ts'
import { z } from 'zod'

const stateLabels: Record<SharePointSyncRun['state'], string> = {
  Pending: '実行待ち',
  Queued: 'Queue登録済み',
  Processing: 'フォルダを取得中',
  Retrying: 'エラー後に再試行中',
  Succeeded: '同期完了',
  Failed: '同期失敗',
}
const categoryLabels: Record<string, string> = {
  Unauthorized: '認証エラー',
  Forbidden: 'GraphまたはSharePointの読み取り権限がありません',
  Throttled: 'Graphの呼び出し制限',
  UpstreamUnavailable: 'Microsoft Graphが利用できません',
  Timeout: 'Graph応答がタイムアウトしました',
  InvalidResponse: 'Graph応答を検証できません',
  NetworkError: 'ネットワークエラー',
  Unknown: '原因を分類できませんでした',
}
type SourceDraft = {
  sourceId: string
  displayName: string
  siteId: string
  driveId: string
  folderItemId: string
  workloadIds: string
  configurationVersion: string
}
const emptyDraft: SourceDraft = {
  sourceId: '',
  displayName: '',
  siteId: '',
  driveId: '',
  folderItemId: '',
  workloadIds: '',
  configurationVersion: 'v1',
}

export function SharePointPanel({
  canConfigure,
  canSync,
  syncEnabled,
}: {
  canConfigure: boolean
  canSync: boolean
  syncEnabled: boolean
}) {
  const [sources, setSources] = useState<DocumentSource[]>([])
  const [snapshots, setSnapshots] = useState<
    Record<string, SharePointSnapshot | null>
  >({})
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [run, setRun] = useState<SharePointSyncRun | null>(null)
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadSources() {
    const registered = documentSourceSchema
      .array()
      .parse(await request('sharepoint-sources', 'GET'))
    setSources(registered)
    const nextSnapshots: Record<string, SharePointSnapshot | null> = {}
    await Promise.all(
      registered.map(async (source) => {
        const value = await request(
          `sharepoint-snapshot?sourceId=${encodeURIComponent(source.sourceId)}`,
          'GET',
        )
        nextSnapshots[source.sourceId] = value
          ? sharePointSnapshotSchema.parse(value)
          : null
      }),
    )
    setSnapshots(nextSnapshots)
    setSelectedSourceId((current) =>
      registered.some((source) => source.sourceId === current)
        ? current
        : (registered[0]?.sourceId ?? ''),
    )
  }

  useEffect(() => {
    if (!canSync) return
    void loadSources().catch((reason) =>
      setError(reason instanceof Error ? reason.message : 'Source取得失敗'),
    )
  }, [canSync])

  useEffect(() => {
    if (
      !run ||
      !['Pending', 'Queued', 'Processing', 'Retrying'].includes(run.state)
    )
      return
    let active = true
    const poll = async () => {
      try {
        const current = sharePointSyncRunSchema.parse(
          await request(
            `sharepoint-sync-status?runId=${encodeURIComponent(run.runId)}`,
            'GET',
          ),
        )
        if (!active) return
        setRun(current)
        if (current.state === 'Succeeded') {
          const value = await request(
            `sharepoint-snapshot?sourceId=${encodeURIComponent(current.sourceId)}`,
            'GET',
          )
          if (active)
            setSnapshots((existing) => ({
              ...existing,
              [current.sourceId]: value
                ? sharePointSnapshotSchema.parse(value)
                : null,
            }))
        }
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'SharePoint同期状態を取得できません',
          )
      }
    }
    const timer = window.setInterval(() => void poll(), 2000)
    void poll()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [run?.runId, run?.state])

  const selectedSource = sources.find(
    (source) => source.sourceId === selectedSourceId,
  )
  const snapshot = selectedSourceId ? snapshots[selectedSourceId] : null

  function editSource(source: DocumentSource) {
    setDraft({
      sourceId: source.sourceId,
      displayName: source.displayName,
      siteId: source.siteId,
      driveId: source.driveId,
      folderItemId: source.folderItemId,
      workloadIds: source.workloadIds.join(', '),
      configurationVersion: source.configurationVersion,
    })
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const source = z
        .object({
          sourceId: z.string().min(1).max(100),
          displayName: z.string().min(1).max(200),
          siteId: z.string().min(1).max(500),
          driveId: z.string().min(1).max(500),
          folderItemId: z.string().min(1).max(500),
          workloadIds: z.array(z.string().min(1).max(200)).min(1),
          configurationVersion: z.string().min(1).max(100),
        })
        .parse({
          sourceId: draft.sourceId.trim(),
          displayName: draft.displayName.trim(),
          siteId: draft.siteId.trim(),
          driveId: draft.driveId.trim(),
          folderItemId: draft.folderItemId.trim(),
          workloadIds: draft.workloadIds
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
          configurationVersion: draft.configurationVersion.trim(),
        })
      await request('sharepoint-source', 'POST', source)
      await loadSources()
      setSelectedSourceId(source.sourceId)
      setNotice('サンプル用Source設定を保存しました。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Source保存失敗')
    } finally {
      setBusy(false)
    }
  }

  async function startSync() {
    if (!selectedSource) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const nextRun = sharePointSyncRunSchema.parse(
        await request('sharepoint-sync', 'POST', {
          sourceId: selectedSource.sourceId,
        }),
      )
      setRun(nextRun)
      setNotice('SharePointの読み取りをQueueへ登録しました。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '同期依頼失敗')
    } finally {
      setBusy(false)
    }
  }

  if (!canSync) return null

  return (
    <section className="sharepoint-panel" aria-labelledby="sharepoint-title">
      <div className="sharepoint-heading">
        <div>
          <h2 id="sharepoint-title">SharePointサンプル設計書</h2>
          <p>
            専用のサンプルフォルダ1件を読み取り専用で取得します。実業務用Sourceは登録できません。
          </p>
        </div>
        <span className={syncEnabled ? 'status-enabled' : 'status-disabled'}>
          同期{syncEnabled ? '有効' : '無効'}
        </span>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {sources.length > 0 ? (
        <div className="sharepoint-source-list">
          {sources.map((source) => (
            <div className="sharepoint-source-row" key={source.sourceId}>
              <button
                className={
                  source.sourceId === selectedSourceId ? 'selected' : ''
                }
                onClick={() => setSelectedSourceId(source.sourceId)}
                type="button"
              >
                {source.displayName}
              </button>
              {canConfigure && (
                <button
                  className="secondary-button"
                  onClick={() => editSource(source)}
                  type="button"
                >
                  設定を編集
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>登録済みのサンプルフォルダはありません。</p>
      )}

      {selectedSource && (
        <div className="sharepoint-content">
          <div className="sharepoint-sync-actions">
            <div>
              <strong>{selectedSource.displayName}</strong>
              <small>
                Workload: {selectedSource.workloadIds.join(', ')} · 設定版:{' '}
                {selectedSource.configurationVersion}
              </small>
            </div>
            <button
              disabled={busy || !syncEnabled}
              onClick={() => void startSync()}
              type="button"
            >
              SharePointから同期
            </button>
          </div>
          {!syncEnabled && (
            <p className="muted">
              同期機能は無効です。管理者が同期設定を有効にし、Graph権限とSiteアクセスを設定した後に実行できます。
            </p>
          )}
          {run?.sourceId === selectedSource.sourceId && (
            <div className="sharepoint-run" role="status">
              <strong>{stateLabels[run.state]}</strong>
              <small>
                試行回数: {run.attemptCount} · 更新: {run.updatedAt}
              </small>
              {run.errorCategory && (
                <p>
                  {categoryLabels[run.errorCategory] ?? run.errorCategory}
                  {run.errorHttpStatus ? ` (HTTP ${run.errorHttpStatus})` : ''}
                </p>
              )}
              {run.state === 'Succeeded' && (
                <p>
                  追加 {run.addedItemIds.length}件・変更{' '}
                  {run.changedItemIds.length}件・不在{' '}
                  {run.removedItemIds.length}件・不変{' '}
                  {run.unchangedItemIds.length}件
                </p>
              )}
            </div>
          )}
          {snapshot ? (
            <div className="sharepoint-snapshot">
              <h3>取得済み文書 ({snapshot.documents.length}件)</h3>
              <small>
                全ページ列挙完了 · {snapshot.observedAt} · 設定版{' '}
                {snapshot.configurationVersion} · サンプルデータ
              </small>
              {snapshot.documents.length ? (
                <ul>
                  {snapshot.documents.map((document) => (
                    <li key={`${document.itemId}-${document.contentHash}`}>
                      <strong>{document.name}</strong>
                      <small>
                        {document.extension.toUpperCase()} · 更新{' '}
                        {document.lastModifiedAt ?? '日時なし'} · 内容Hash{' '}
                        {document.contentHash.slice(0, 12)}…
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>対象形式の文書は見つかりませんでした。</p>
              )}
              {snapshot.skipped.length > 0 && (
                <details>
                  <summary>
                    対象外形式のため読み取らなかった項目 (
                    {snapshot.skipped.length}件)
                  </summary>
                  <ul>
                    {snapshot.skipped.map((item) => (
                      <li key={item.itemId}>{item.name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="muted">まだ完全取得済みのSnapshotはありません。</p>
          )}
        </div>
      )}

      {canConfigure && (
        <details className="sharepoint-config">
          <summary>サンプルフォルダを登録・更新</summary>
          <p>
            Site ID、Drive ID、Folder Item
            IDを入力します。Source設定を変更するときは設定版も更新してください。同期範囲は指定フォルダ配下のDOCX／XLSXに固定されます。
          </p>
          <form onSubmit={(event) => void saveSource(event)}>
            <label>
              Source ID
              <input
                maxLength={100}
                onChange={(event) =>
                  setDraft({ ...draft, sourceId: event.target.value })
                }
                required
                value={draft.sourceId}
              />
            </label>
            <label>
              表示名
              <input
                maxLength={200}
                onChange={(event) =>
                  setDraft({ ...draft, displayName: event.target.value })
                }
                required
                value={draft.displayName}
              />
            </label>
            <label>
              Site ID
              <input
                maxLength={500}
                onChange={(event) =>
                  setDraft({ ...draft, siteId: event.target.value })
                }
                required
                value={draft.siteId}
              />
            </label>
            <label>
              Drive ID
              <input
                maxLength={500}
                onChange={(event) =>
                  setDraft({ ...draft, driveId: event.target.value })
                }
                required
                value={draft.driveId}
              />
            </label>
            <label>
              Folder Item ID
              <input
                maxLength={500}
                onChange={(event) =>
                  setDraft({ ...draft, folderItemId: event.target.value })
                }
                required
                value={draft.folderItemId}
              />
            </label>
            <label>
              Workload ID (複数の場合はカンマ区切り)
              <input
                maxLength={2000}
                onChange={(event) =>
                  setDraft({ ...draft, workloadIds: event.target.value })
                }
                required
                value={draft.workloadIds}
              />
            </label>
            <label>
              設定版
              <input
                maxLength={100}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    configurationVersion: event.target.value,
                  })
                }
                required
                value={draft.configurationVersion}
              />
            </label>
            <div className="sharepoint-config-actions">
              <button disabled={busy} type="submit">
                Source設定を保存
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setDraft(emptyDraft)}
                type="button"
              >
                新規入力
              </button>
            </div>
          </form>
        </details>
      )}
    </section>
  )
}

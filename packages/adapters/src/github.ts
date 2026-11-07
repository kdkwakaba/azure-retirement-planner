import type { Assessment, Priority, WorkItem } from '@arp/contracts'
import { hash } from '@arp/domain'
import { z } from 'zod'
import {
  GitHubGraphQLError,
  RemoteError,
  jsonRequest,
  type SafeFailureCategory,
} from './http.ts'

const managedStart = '<!-- arp:managed:start -->'
const managedEnd = '<!-- arp:managed:end -->'
const categoryLabels: Record<string, string> = {
  'Impact Verification': '影響確認',
  'Owner Confirmation': '担当者確認',
  'Migration Assessment': '移行評価',
  'Architecture Design': 'アーキテクチャ設計',
  'Proof of Concept': '概念実証',
  'Application Change': 'アプリケーション変更',
  'Infrastructure Change': 'インフラ変更',
  'Network Change': 'ネットワーク変更',
  'Security Review': 'セキュリティレビュー',
  Test: 'テスト',
  'Change Management': '変更管理',
  'Production Migration': '本番移行',
  Validation: '検証',
  'Rollback Preparation': 'ロールバック準備',
  'Legacy Resource Removal': '旧リソース削除',
  'Documentation Update': 'ドキュメント更新',
  'CMDB Update': 'CMDB更新',
  'Policy and IaC Update': 'ポリシー・IaC更新',
}
const phaseLabels: Record<string, string> = {
  'Impact Verification': '影響確認',
  'Owner Confirmation': '影響確認',
  'Migration Assessment': '設計',
  'Architecture Design': '設計',
  'Proof of Concept': '設計',
  'Application Change': '変更',
  'Infrastructure Change': '変更',
  'Network Change': '変更',
  'Security Review': '設計',
  Test: 'テスト',
  'Change Management': '変更',
  'Production Migration': '変更',
  Validation: 'テスト',
  'Rollback Preparation': 'テスト',
  'Legacy Resource Removal': '変更',
  'Documentation Update': '変更',
  'CMDB Update': '変更',
  'Policy and IaC Update': '変更',
  'Customer Communication': '影響確認',
  'Cross-Team Coordination': '影響確認',
  'Vendor Assessment': '設計',
  'Cost Assessment': '設計',
  'Budget Approval': '設計',
  'Contract Review': '設計',
}
const priorityLabels: Record<Priority, string> = {
  P1: 'Priority: High',
  P2: 'Priority: Medium',
  P3: 'Priority: Medium',
  P4: 'Priority: Low',
}
const issueLabelColors: Record<string, string> = {
  'Priority: High': 'd73a4a',
  'Priority: Medium': 'fbca04',
  'Priority: Low': '0e8a16',
  'Phase: 影響確認': '1d76db',
  'Phase: 設計': '5319e7',
  'Phase: 変更': 'e99695',
  'Phase: テスト': 'bfd4f2',
  'ARP: Retirement': '0052cc',
}
export function workItemPhase(category: string): string {
  const phase = phaseLabels[category]
  if (!phase) throw new Error('Unsupported work item category for Issue phase')
  return phase
}
function phaseLabel(category: string): string {
  return `Phase: ${workItemPhase(category)}`
}
export function priorityIssueLabel(priority: Priority | null): string | null {
  return priority ? priorityLabels[priority] : null
}
function issueSafeText(value: string): string {
  return value
    .replace(
      /\/subscriptions\/[^\s`<>\])}]+/gi,
      '[リソースIDはレビュー画面を参照]',
    )
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      '[メールアドレス省略]',
    )
}
function safeOfficialReference(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      [
        'learn.microsoft.com',
        'azure.microsoft.com',
        'status.azure.com',
        'portal.azure.com',
      ].includes(url.hostname.toLowerCase())
      ? url.toString()
      : null
  } catch {
    return null
  }
}
function boundedTitle(value: string): string {
  return issueSafeText(value)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180)
    .trim()
}
function priorityOf(assessment: Assessment): Priority | null {
  return assessment.effectivePriority
}
export type GitHubIssueReference = {
  id: string
  databaseId: number
  number: number
  url: string
}
export type GitHubIssueGroupInput = {
  marker: string
  title: string
  body: string
  labels: string[]
}
function graphQLOperation(query: string): string {
  if (query.includes('addProjectV2ItemById')) return 'ProjectAdd'
  if (query.includes('updateProjectV2ItemFieldValue'))
    return 'ProjectFieldUpdate'
  if (query.includes('updateIssue')) return 'IssueUpdate'
  if (query.includes('ProjectV2')) return 'ProjectRead'
  if (query.includes('...on Issue')) return 'IssueRead'
  return query.startsWith('mutation') ? 'GraphQLMutation' : 'GraphQLQuery'
}
function throwGraphQLErrors(errors: unknown, operation: string): void {
  if (!errors) return
  const entries = Array.isArray(errors) ? errors : [errors]
  const codes = entries
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return ''
      const value = entry as {
        type?: unknown
        extensions?: { code?: unknown }
      }
      return [value.type, value.extensions?.code]
        .filter((code): code is string => typeof code === 'string')
        .join(' ')
        .toUpperCase()
    })
    .join(' ')
  const providerCode =
    codes.split(/\s+/).find((code) => /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) ??
    null
  let category: SafeFailureCategory = 'Unknown'
  if (/FORBIDDEN|RESOURCE_NOT_ACCESSIBLE/.test(codes)) category = 'Forbidden'
  else if (/UNAUTHORIZED/.test(codes)) category = 'Unauthorized'
  else if (/RATE_LIMIT|THROTTL/.test(codes)) category = 'Throttled'
  else if (/TIMEOUT/.test(codes)) category = 'Timeout'
  else if (codes) category = 'InvalidResponse'
  throw new GitHubGraphQLError(category, operation, providerCode)
}
function japaneseCategory(category: string): string {
  return categoryLabels[category] ?? category
}
export function managedIssueContent(
  item: WorkItem,
  assessment?: Assessment,
): string {
  // Work Itemの承認済み作業内容を転記し、Resource ID・メールは外部へ複製しない。
  return [
    ...(item.title.startsWith('[TEST MODE EVALUATION]') ||
    item.title.startsWith('[SYNTHETIC UAT]')
      ? [
          '> **テストモード評価** — 合成データのみを使用します。Azureリソースの変更は実行しません。',
        ]
      : []),
    `カテゴリ: ${japaneseCategory(item.category)}`,
    `作業フェーズ: ${workItemPhase(item.category)}`,
    `対象ワークロード（匿名化）: ${hash(item.workloadId).slice(0, 12)}`,
    `優先度: ${item.priority ?? '未確定'}`,
    `優先度ラベル: ${priorityIssueLabel(item.priority) ?? '未設定'}`,
    `対応開始日: ${item.plannedStartDate ?? '未確定'}`,
    `対応期限: ${item.dueDate ?? '未確定'}`,
    `担当チーム候補: ${item.ownerTeam ?? '未設定'}`,
    ...(item.workflowRouting?.teamCandidates.length
      ? [
          `担当候補: ${item.workflowRouting.teamCandidates.map((team) => team.displayName).join('、')}`,
        ]
      : []),
    ...(item.workflowRouting?.coordinationCandidates.length
      ? [
          `調整候補: ${item.workflowRouting.coordinationCandidates.map((team) => team.displayName).join('、')}`,
        ]
      : []),
    ...(assessment
      ? [
          '## 通知情報',
          `通知: ${issueSafeText(assessment.event.title).slice(0, 500)}`,
          ...assessment.event.evidence
            .filter((e) => e.sourceType === 'Microsoft' && e.officialUrl)
            .slice(0, 1)
            .map(
              (e) => `公式通知要約: ${issueSafeText(e.fact).slice(0, 1200)}`,
            ),
          `公式日付: ${
            assessment.event.milestones
              .filter((m) => m.kind !== 'Deprecation')
              .map((m) => `${m.kind} ${m.date}`)
              .join('、') || '未確定'
          }`,
          ...assessment.event.evidence
            .filter((e) => e.sourceType === 'Microsoft' && e.officialUrl)
            .slice(0, 3)
            .map((e) => safeOfficialReference(e.officialUrl!))
            .filter((url): url is string => url !== null)
            .map((url) => `公式情報: ${url}`),
        ]
      : []),
    `必要性: ${item.necessity === 'Required' ? '必須作業' : '推奨作業'}`,
    '## 作業内容',
    issueSafeText(item.description).slice(0, 8000),
    '## 完了条件',
    ...item.completionCriteria.map(
      (criterion) => `- ${issueSafeText(criterion).slice(0, 1000)}`,
    ),
    '## 前提・依存作業',
    ...(item.prerequisites.length
      ? item.prerequisites.map(
          (value) => `- ${issueSafeText(value).slice(0, 1000)}`,
        )
      : ['- なし']),
    `依存Work Item ID: ${item.dependencyIds.join(', ') || 'なし'}`,
    `対象リソース数: ${item.resourceIds.length}（識別子は認証済みレビュー画面を参照）`,
    `根拠ID: ${item.evidenceIds.join(', ')}`,
    `承認済み作業項目ID: ${item.id}`,
    '根拠の詳細と個別リソース情報は、認証済みレビュー画面を参照してください。',
  ].join('\n\n')
}
export function issueText(item: WorkItem): string {
  return [
    `<!-- arp:${item.id} -->`,
    '',
    managedStart,
    managedIssueContent(item),
    managedEnd,
  ].join('\n')
}
export function parentIssueKey(assessment: Assessment): string {
  return hash({
    eventId: assessment.event.id,
    workloadId: assessment.workloadId,
  })
}
export function parentIssueInput(
  assessment: Assessment,
): GitHubIssueGroupInput {
  const title = boundedTitle(assessment.event.title)
  const priority = priorityOf(assessment)
  const marker = `arp-parent:${parentIssueKey(assessment)}`
  return {
    marker,
    title:
      `[ARP][リタイアメント対応] ${title} — Workload ${hash(assessment.workloadId).slice(0, 8)}`.slice(
        0,
        256,
      ),
    body: [
      `<!-- ${marker} -->`,
      '',
      '> Azureのライフサイクル通知に対する対応を、ワークロード単位で追跡する親Issueです。',
      '',
      `通知: ${issueSafeText(assessment.event.title).slice(0, 1000)}`,
      `Tracking ID: ${issueSafeText(assessment.event.trackingId).slice(0, 200)}`,
      `対象ワークロード（匿名化）: ${hash(assessment.workloadId).slice(0, 12)}`,
      '優先度ラベルは親Issueのラベルを参照してください。',
      '',
      '## 対応タスク',
      '影響確認・設計・変更・テストの各フェーズで、承認済み作業をSub-Issueとして管理します。',
      '',
      '個別リソース情報と根拠の詳細は、認証済みレビュー画面を参照してください。',
    ].join('\n'),
    labels: [
      'ARP: Retirement',
      ...(priority ? [priorityLabels[priority]] : []),
    ],
  }
}
export function parentIssueText(assessment: Assessment): string {
  return parentIssueInput(assessment).body
}
export function parentIssueTitle(assessment: Assessment): string {
  return parentIssueInput(assessment).title
}
export function phaseIssueInput(
  assessment: Assessment,
  item: WorkItem,
): GitHubIssueGroupInput {
  const phase = workItemPhase(item.category)
  const key = hash({ parentKey: parentIssueKey(assessment), phase })
  const label = `Phase: ${phase}`
  return {
    marker: `arp-phase:${key}`,
    title:
      `[ARP][${phase}] ${boundedTitle(assessment.event.title)} — Workload ${hash(assessment.workloadId).slice(0, 8)}`.slice(
        0,
        256,
      ),
    body: [
      `<!-- arp-phase:${key} -->`,
      '',
      `親Issue配下で「${phase}」フェーズの承認済み作業をまとめます。`,
      '',
      `通知: ${issueSafeText(assessment.event.title).slice(0, 1000)}`,
      `Tracking ID: ${issueSafeText(assessment.event.trackingId).slice(0, 200)}`,
      `対象ワークロード（匿名化）: ${hash(assessment.workloadId).slice(0, 12)}`,
      '',
      'このフェーズに属する個別タスクはSub-Issueとして登録されます。',
    ].join('\n'),
    labels: ['ARP: Retirement', label],
  }
}
export type ProjectFieldConfig = {
  statusFieldId?: string
  todoOptionId?: string
  priorityFieldId?: string
  priorityOptionIds?: Partial<Record<'P1' | 'P2' | 'P3' | 'P4', string>>
  dueDateFieldId?: string
}
export class GitHubClient {
  owner: string
  repo: string
  token: string
  constructor(owner: string, repo: string, token: string) {
    if (!/^[\w-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
      throw new Error('Invalid repository')
    this.owner = owner
    this.repo = repo
    this.token = token
  }
  async request(
    path: string,
    body?: unknown,
    method?: 'GET' | 'POST' | 'DELETE',
  ) {
    const result = await jsonRequest('https://api.github.com' + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (
      path === '/graphql' &&
      typeof result === 'object' &&
      result !== null &&
      'errors' in result
    ) {
      const query =
        typeof body === 'object' &&
        body !== null &&
        'query' in body &&
        typeof body.query === 'string'
          ? body.query
          : 'GraphQL'
      throwGraphQLErrors(
        (result as { errors?: unknown }).errors,
        graphQLOperation(query),
      )
    }
    return result
  }
  async find(itemId: string): Promise<{
    id: string
    url: string
    databaseId?: number
    number?: number
  } | null> {
    // 検索索引の反映待ちを避けRepositoryの全Issueをページング。上限到達は不明として停止。
    for (let page = 1; page <= 50; page++) {
      const items = z
        .array(
          z.object({
            node_id: z.string(),
            id: z.number().int().positive().optional(),
            number: z.number().int().positive().optional(),
            body: z.string().nullable(),
            html_url: z.url(),
          }),
        )
        .parse(
          await this.request(
            `/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&page=${page}`,
          ),
        )
      const found = items.filter((i) =>
        i.body?.includes(`<!-- arp:${itemId} -->`),
      )
      if (found.length > 1) throw new Error('Duplicate external work item')
      if (found[0])
        return {
          id: found[0].node_id,
          url: found[0].html_url,
          ...(found[0].id ? { databaseId: found[0].id } : {}),
          ...(found[0].number ? { number: found[0].number } : {}),
        }
      if (items.length < 100) return null
    }
    throw new Error('External reconciliation incomplete')
  }
  async recoverAmbiguousCreate(itemId: string): Promise<{
    id: string
    url: string
    databaseId?: number
    number?: number
  }> {
    const found = await this.find(itemId)
    if (!found)
      throw new Error('Ambiguous external creation; issue not yet discoverable')
    return found
  }
  async create(item: WorkItem): Promise<{ id: string; url: string }> {
    const labels = [
      priorityIssueLabel(item.priority),
      phaseLabel(item.category),
    ].filter((label): label is string => Boolean(label))
    await this.ensureLabels(labels)
    const result = z.object({ node_id: z.string(), html_url: z.url() }).parse(
      await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
        title:
          item.title.startsWith('[TEST MODE EVALUATION]') ||
          item.title.startsWith('[SYNTHETIC UAT]')
            ? `[ARP][TEST MODE EVALUATION][${japaneseCategory(item.category)}] ${boundedTitle(item.title)} (${item.id.slice(0, 8)})`.slice(
                0,
                256,
              )
            : `[ARP][${japaneseCategory(item.category)}] ${boundedTitle(item.title)} (${item.id.slice(0, 8)})`.slice(
                0,
                256,
              ),
        body: issueText(item),
        ...(labels.length ? { labels } : {}),
      }),
    )
    return { id: result.node_id, url: result.html_url }
  }

  async ensureLabels(labels: string[]): Promise<void> {
    for (const name of [...new Set(labels)]) {
      const color = issueLabelColors[name]
      if (!color) throw new Error('Unsupported managed GitHub label')
      const path = `/repos/${this.owner}/${this.repo}/labels/${encodeURIComponent(name)}`
      try {
        await this.request(path)
      } catch (error) {
        if (!(error instanceof RemoteError) || error.status !== 404) throw error
        try {
          await this.request(`/repos/${this.owner}/${this.repo}/labels`, {
            name,
            color,
            description: `Azure Retirement Planner: ${name}`,
          })
        } catch (createError) {
          // Concurrent registrations may create the same shared label first.
          if (
            !(createError instanceof RemoteError) ||
            createError.status !== 422
          )
            throw createError
          await this.request(path)
        }
      }
    }
  }

  async findParent(
    assessment: Assessment,
  ): Promise<GitHubIssueReference | null> {
    return this.findGroupIssue(`arp-parent:${parentIssueKey(assessment)}`)
  }

  async findGroupIssue(markerId: string): Promise<GitHubIssueReference | null> {
    if (!/^arp-(parent|phase):[a-f0-9]{64}$/.test(markerId))
      throw new Error('Invalid managed Issue marker')
    const marker = `<!-- ${markerId} -->`
    for (let page = 1; page <= 50; page++) {
      const items = z
        .array(
          z.object({
            node_id: z.string(),
            id: z.number().int().positive(),
            number: z.number().int().positive(),
            body: z.string().nullable(),
            html_url: z.url(),
          }),
        )
        .parse(
          await this.request(
            `/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&page=${page}`,
          ),
        )
      const found = items.filter((issue) => issue.body?.includes(marker))
      if (found.length > 1) throw new Error('Duplicate parent Issue')
      if (found[0])
        return {
          id: found[0].node_id,
          databaseId: found[0].id,
          number: found[0].number,
          url: found[0].html_url,
        }
      if (items.length < 100) return null
    }
    throw new Error('Parent Issue reconciliation incomplete')
  }

  async createParent(assessment: Assessment): Promise<GitHubIssueReference> {
    return this.createGroupIssue({
      marker: `arp-parent:${parentIssueKey(assessment)}`,
      title: parentIssueTitle(assessment),
      body: parentIssueText(assessment),
      labels: [
        'ARP: Retirement',
        ...(priorityIssueLabel(priorityOf(assessment))
          ? [priorityIssueLabel(priorityOf(assessment))!]
          : []),
      ],
    })
  }

  async createGroupIssue(
    input: GitHubIssueGroupInput,
  ): Promise<GitHubIssueReference> {
    if (!/^arp-(parent|phase):[a-f0-9]{64}$/.test(input.marker))
      throw new Error('Invalid managed Issue marker')
    await this.ensureLabels(input.labels)
    return z
      .object({
        node_id: z.string(),
        id: z.number().int().positive(),
        number: z.number().int().positive(),
        html_url: z.url(),
      })
      .transform((issue) => ({
        id: issue.node_id,
        databaseId: issue.id,
        number: issue.number,
        url: issue.html_url,
      }))
      .parse(
        await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
          title: input.title.slice(0, 256),
          body: input.body,
          labels: input.labels,
        }),
      )
  }

  async recoverAmbiguousParent(
    assessment: Assessment,
  ): Promise<GitHubIssueReference> {
    const found = await this.findParent(assessment)
    if (!found)
      throw new Error(
        'Ambiguous parent Issue creation; parent is not yet discoverable',
      )
    return found
  }

  async getIssueReference(issueId: string): Promise<GitHubIssueReference> {
    const result = z
      .object({
        data: z.object({
          node: z
            .object({
              id: z.string(),
              databaseId: z.number().int().positive(),
              number: z.number().int().positive(),
              url: z.url(),
            })
            .nullable(),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query:
            'query($id:ID!){node(id:$id){...on Issue{id databaseId number url}}}',
          variables: { id: issueId },
        }),
      )
    throwGraphQLErrors(result.errors, 'IssueRead')
    if (!result.data.node) throw new Error('Issue reference unavailable')
    return {
      id: result.data.node.id,
      databaseId: result.data.node.databaseId,
      number: result.data.node.number,
      url: result.data.node.url,
    }
  }

  async ensureSubIssue(
    parentIssueNumber: number,
    childDatabaseId: number,
  ): Promise<void> {
    const path = `/repos/${this.owner}/${this.repo}/issues/${parentIssueNumber}/sub_issues`
    const children = z
      .array(z.object({ id: z.number().int().positive() }))
      .parse(await this.request(path))
    if (children.some((child) => child.id === childDatabaseId)) return
    await this.request(path, { sub_issue_id: childDatabaseId })
  }

  async syncWorkItemLabels(issueNumber: number, item: WorkItem): Promise<void> {
    const desired = [
      priorityIssueLabel(item.priority),
      phaseLabel(item.category),
    ].filter((label): label is string => Boolean(label))
    await this.ensureLabels(desired)
    const path = `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels`
    const current = z
      .array(z.object({ name: z.string() }))
      .parse(await this.request(path))
      .map((label) => label.name)
    const obsolete = current.filter(
      (name) =>
        (name.startsWith('Priority: ') || name.startsWith('Phase: ')) &&
        !desired.includes(name),
    )
    for (const name of obsolete)
      await this.request(
        `${path}/${encodeURIComponent(name)}`,
        undefined,
        'DELETE',
      )
    const missing = desired.filter((name) => !current.includes(name))
    if (missing.length) await this.request(path, { labels: missing })
  }

  async syncParentLabels(
    issueNumber: number,
    assessment: Assessment,
  ): Promise<void> {
    const desired = [
      'ARP: Retirement',
      priorityIssueLabel(priorityOf(assessment)),
    ].filter((label): label is string => Boolean(label))
    await this.ensureLabels(desired)
    const path = `/repos/${this.owner}/${this.repo}/issues/${issueNumber}/labels`
    const current = z
      .array(z.object({ name: z.string() }))
      .parse(await this.request(path))
      .map((label) => label.name)
    const obsolete = current.filter(
      (name) => name.startsWith('Priority: ') && !desired.includes(name),
    )
    for (const name of obsolete)
      await this.request(
        `${path}/${encodeURIComponent(name)}`,
        undefined,
        'DELETE',
      )
    const missing = desired.filter((name) => !current.includes(name))
    if (missing.length) await this.request(path, { labels: missing })
  }

  async updateManagedIssue(
    issueId: string,
    item: WorkItem,
    previousManagedHash: string | null,
    assessment?: Assessment,
  ): Promise<string> {
    const current = z
      .object({
        data: z.object({
          node: z.object({ body: z.string().nullable() }).nullable(),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query: 'query($id:ID!){node(id:$id){...on Issue{body}}}',
          variables: { id: issueId },
        }),
      )
    throwGraphQLErrors(current.errors, 'IssueRead')
    const body = current.data.node?.body
    if (body === null || body === undefined)
      throw new Error('Issue body unavailable')
    const start = body.indexOf(managedStart)
    const end = body.indexOf(managedEnd)
    if (start < 0 || end < start || body.indexOf(managedStart, start + 1) >= 0)
      throw new Error('Managed Issue section missing or ambiguous')
    const contentStart = start + managedStart.length
    const previousContent = body
      .slice(contentStart, end)
      .replace(/^\n|\n$/g, '')
    const nextContent = managedIssueContent(item, assessment)
    const currentHash = hash(previousContent)
    if (
      previousManagedHash
        ? currentHash !== previousManagedHash
        : previousContent !== nextContent
    )
      throw new Error(
        'Managed Issue section changed; human conflict review required',
      )
    if (previousContent === nextContent) return currentHash
    const updatedBody =
      body.slice(0, contentStart) + '\n' + nextContent + '\n' + body.slice(end)
    const updated = z
      .object({
        data: z.object({
          updateIssue: z.object({ issue: z.object({ id: z.string() }) }),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query:
            'mutation($id:ID!,$body:String!){updateIssue(input:{id:$id,body:$body}){issue{id}}}',
          variables: { id: issueId, body: updatedBody },
        }),
      )
    throwGraphQLErrors(updated.errors, 'IssueUpdate')
    return hash(nextContent)
  }
  async ensureProjectItem(
    projectId: string,
    contentId: string,
  ): Promise<{ id: string; created: boolean }> {
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const result = z
        .object({
          data: z.object({
            node: z
              .object({
                items: z.object({
                  nodes: z.array(
                    z.object({
                      id: z.string(),
                      content: z
                        .object({
                          __typename: z.string(),
                          id: z.string().optional(),
                        })
                        .nullable(),
                    }),
                  ),
                  pageInfo: z.object({
                    hasNextPage: z.boolean(),
                    endCursor: z.string().nullable(),
                  }),
                }),
              })
              .nullable(),
          }),
          errors: z.unknown().optional(),
        })
        .parse(
          await this.request('/graphql', {
            query:
              'query($id:ID!,$cursor:String){node(id:$id){...on ProjectV2{items(first:100,after:$cursor){nodes{id content{__typename ...on Issue{id}}}pageInfo{hasNextPage endCursor}}}}}',
            variables: { id: projectId, cursor },
          }),
        )
      if (result.errors) throwGraphQLErrors(result.errors, 'ProjectRead')
      if (!result.data.node)
        throw new GitHubGraphQLError('InvalidResponse', 'ProjectRead')
      const matches = result.data.node.items.nodes.filter(
        (projectItem) => projectItem.content?.id === contentId,
      )
      if (matches.length > 1) throw new Error('Duplicate Project item')
      if (matches[0]) return { id: matches[0].id, created: false }
      const pageInfo = result.data.node.items.pageInfo
      if (!pageInfo.hasNextPage) break
      if (!pageInfo.endCursor) throw new Error('Project pagination incomplete')
      cursor = pageInfo.endCursor
      if (page === 49) throw new Error('Project reconciliation incomplete')
    }
    return {
      id: await this.addToProject(projectId, contentId),
      created: true,
    }
  }
  async readProjectProgress(
    projectId: string,
    statusFieldId: string,
  ): Promise<
    Array<{
      projectItemId: string
      issueId: string
      statusName: string | null
      statusOptionId: string | null
    }>
  > {
    if (!projectId || !statusFieldId)
      throw new Error('Project progress configuration incomplete')
    const progress: Array<{
      projectItemId: string
      issueId: string
      statusName: string | null
      statusOptionId: string | null
    }> = []
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const result = z
        .object({
          data: z.object({
            node: z
              .object({
                items: z.object({
                  nodes: z.array(
                    z.object({
                      id: z.string(),
                      content: z
                        .object({
                          __typename: z.string(),
                          id: z.string().optional(),
                        })
                        .nullable(),
                      fieldValues: z.object({
                        nodes: z.array(
                          z.object({
                            name: z.string().optional(),
                            optionId: z.string().optional(),
                            field: z.object({ id: z.string() }).optional(),
                          }),
                        ),
                      }),
                    }),
                  ),
                  pageInfo: z.object({
                    hasNextPage: z.boolean(),
                    endCursor: z.string().nullable(),
                  }),
                }),
              })
              .nullable(),
          }),
          errors: z.unknown().optional(),
        })
        .parse(
          await this.request('/graphql', {
            query:
              'query($id:ID!,$cursor:String){node(id:$id){...on ProjectV2{items(first:100,after:$cursor){nodes{id content{...on Issue{id}} fieldValues(first:100){nodes{...on ProjectV2ItemFieldSingleSelectValue{name optionId field{...on ProjectV2SingleSelectField{id}}}}}} pageInfo{hasNextPage endCursor}}}}}',
            variables: { id: projectId, cursor },
          }),
        )
      if (result.errors || !result.data.node)
        throw new Error('Project progress read failed')
      for (const item of result.data.node.items.nodes) {
        if (item.content?.__typename !== 'Issue' || !item.content.id) continue
        const statuses = item.fieldValues.nodes.filter(
          (value) => value.field?.id === statusFieldId,
        )
        if (statuses.length > 1)
          throw new Error('Project status field is ambiguous')
        progress.push({
          projectItemId: item.id,
          issueId: item.content.id,
          statusName: statuses[0]?.name ?? null,
          statusOptionId: statuses[0]?.optionId ?? null,
        })
      }
      const pageInfo = result.data.node.items.pageInfo
      if (!pageInfo.hasNextPage) return progress
      if (!pageInfo.endCursor) throw new Error('Project pagination incomplete')
      cursor = pageInfo.endCursor
    }
    throw new Error('Project progress reconciliation incomplete')
  }

  async updateProjectFields(
    projectId: string,
    itemId: string,
    item: WorkItem,
    config: ProjectFieldConfig,
    initializeStatus: boolean,
  ): Promise<void> {
    if (Boolean(config.statusFieldId) !== Boolean(config.todoOptionId))
      throw new Error('Project status field configuration incomplete')
    if (initializeStatus && config.statusFieldId && config.todoOptionId)
      await this.setProjectField(projectId, itemId, config.statusFieldId, {
        singleSelectOptionId: config.todoOptionId,
      })
    if (Boolean(config.priorityFieldId) !== Boolean(config.priorityOptionIds))
      throw new Error('Project priority field configuration incomplete')
    if (config.priorityFieldId && config.priorityOptionIds && item.priority) {
      const optionId = config.priorityOptionIds[item.priority]
      if (!optionId)
        throw new Error('Project priority option is not configured')
      await this.setProjectField(projectId, itemId, config.priorityFieldId, {
        singleSelectOptionId: optionId,
      })
    }
    if (config.dueDateFieldId && item.dueDate)
      await this.setProjectField(projectId, itemId, config.dueDateFieldId, {
        date: item.dueDate,
      })
  }
  async updateProjectParentFields(
    projectId: string,
    itemId: string,
    priority: Priority | null,
    config: ProjectFieldConfig,
    initializeStatus: boolean,
  ): Promise<void> {
    if (Boolean(config.statusFieldId) !== Boolean(config.todoOptionId))
      throw new Error('Project status field configuration incomplete')
    if (initializeStatus && config.statusFieldId && config.todoOptionId)
      await this.setProjectField(projectId, itemId, config.statusFieldId, {
        singleSelectOptionId: config.todoOptionId,
      })
    if (Boolean(config.priorityFieldId) !== Boolean(config.priorityOptionIds))
      throw new Error('Project priority field configuration incomplete')
    if (config.priorityFieldId && config.priorityOptionIds && priority) {
      const optionId = config.priorityOptionIds[priority]
      if (!optionId)
        throw new Error('Project priority option is not configured')
      await this.setProjectField(projectId, itemId, config.priorityFieldId, {
        singleSelectOptionId: optionId,
      })
    }
  }
  async setProjectField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: { singleSelectOptionId?: string; date?: string },
  ): Promise<void> {
    if (!fieldId || Object.keys(value).length !== 1)
      throw new Error('Invalid Project field update')
    const result = z
      .object({
        data: z.object({
          updateProjectV2ItemFieldValue: z.object({
            projectV2Item: z.object({ id: z.string() }),
          }),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query:
            'mutation($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){projectV2Item{id}}}',
          variables: {
            project: projectId,
            item: itemId,
            field: fieldId,
            value,
          },
        }),
      )
    throwGraphQLErrors(result.errors, 'ProjectFieldUpdate')
  }

  async addToProject(projectId: string, contentId: string): Promise<string> {
    const result = z
      .object({
        data: z.object({
          addProjectV2ItemById: z.object({
            item: z.object({ id: z.string() }),
          }),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query:
            'mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{id}}}',
          variables: { project: projectId, content: contentId },
        }),
      )
    throwGraphQLErrors(result.errors, 'ProjectAdd')
    return result.data.addProjectV2ItemById.item.id
  }
}
export async function ensureIssueForExport(
  github: GitHubClient,
  item: WorkItem,
  state: string | null,
  existingIssueId: string | null,
  markSending: () => Promise<void>,
  persistIssue: (issueId: string) => Promise<void>,
): Promise<string> {
  let issueId = existingIssueId
  if (!issueId && state === 'Sending')
    issueId = (await github.recoverAmbiguousCreate(item.id)).id
  if (!issueId) {
    const found = await github.find(item.id)
    if (found) issueId = found.id
    else {
      await markSending()
      issueId = (await github.create(item)).id
    }
  }
  await persistIssue(issueId)
  return issueId
}

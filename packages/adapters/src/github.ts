import type { WorkItem } from '@arp/contracts'
import { hash } from '@arp/domain'
import { z } from 'zod'
import { jsonRequest } from './http.ts'

const managedStart = '<!-- arp:managed:start -->'
const managedEnd = '<!-- arp:managed:end -->'
export function managedIssueContent(item: WorkItem): string {
  // 外部には最小限の管理属性のみ送信し、本文の手編集領域と分離する。
  return [
    `Category: ${item.category}`,
    `Workload alias: ${hash(item.workloadId).slice(0, 12)}`,
    `Priority: ${item.priority ?? 'Unconfirmed'}`,
    `Start: ${item.plannedStartDate ?? 'Unconfirmed'}`,
    `Due: ${item.dueDate ?? 'Unconfirmed'}`,
    `Evidence IDs: ${item.evidenceIds.join(', ')}`,
    `Approved work item: ${item.id}`,
    'Detailed description and completion criteria are available in the authenticated review application.',
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
  async request(path: string, body?: unknown) {
    return jsonRequest('https://api.github.com' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  async find(itemId: string): Promise<{ id: string; url: string } | null> {
    // 検索索引の反映待ちを避けRepositoryの全Issueをページング。上限到達は不明として停止。
    for (let page = 1; page <= 50; page++) {
      const items = z
        .array(
          z.object({
            node_id: z.string(),
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
      if (found[0]) return { id: found[0].node_id, url: found[0].html_url }
      if (items.length < 100) return null
    }
    throw new Error('External reconciliation incomplete')
  }
  async recoverAmbiguousCreate(
    itemId: string,
  ): Promise<{ id: string; url: string }> {
    const found = await this.find(itemId)
    if (!found)
      throw new Error('Ambiguous external creation; issue not yet discoverable')
    return found
  }
  async create(item: WorkItem): Promise<{ id: string; url: string }> {
    const result = z.object({ node_id: z.string(), html_url: z.url() }).parse(
      await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
        title: `[ARP] ${item.category} ${item.id.slice(0, 8)}`,
        body: issueText(item),
      }),
    )
    return { id: result.node_id, url: result.html_url }
  }

  async updateManagedIssue(
    issueId: string,
    item: WorkItem,
    previousManagedHash: string | null,
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
    if (current.errors) throw new Error('Issue read failed')
    const body = current.data.node?.body
    if (body === null || body === undefined)
      throw new Error('Issue body unavailable')
    const start = body.indexOf(managedStart)
    const end = body.indexOf(managedEnd)
    if (start < 0 || end < start || body.indexOf(managedStart, start + 1) >= 0)
      throw new Error('Managed Issue section missing or ambiguous')
    const contentStart = start + managedStart.length
    const previousContent = body.slice(contentStart, end).replace(/^\\n|\\n$/g, '')
    const nextContent = managedIssueContent(item)
    const currentHash = hash(previousContent)
    if (
      previousManagedHash
        ? currentHash !== previousManagedHash
        : previousContent !== nextContent
    )
      throw new Error('Managed Issue section changed; human conflict review required')
    if (previousContent === nextContent) return currentHash
    const updatedBody =
      body.slice(0, contentStart) +
      '\\n' +
      nextContent +
      '\\n' +
      body.slice(end)
    const updated = z
      .object({
        data: z.object({
          updateIssue: z.object({ issue: z.object({ id: z.string() }) }),
        }),
        errors: z.unknown().optional(),
      })
      .parse(
        await this.request('/graphql', {
          query: 'mutation($id:ID!,$body:String!){updateIssue(input:{id:$id,body:$body}){issue{id}}}',
          variables: { id: issueId, body: updatedBody },
        }),
      )
    if (updated.errors) throw new Error('Issue update failed')
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
            query: 'query($id:ID!,$cursor:String){node(id:$id){...on ProjectV2{items(first:100,after:$cursor){nodes{id content{...on Issue{id}}}pageInfo{hasNextPage endCursor}}}}}',
            variables: { id: projectId, cursor },
          }),
        )
      if (result.errors || !result.data.node)
        throw new Error('Project read failed')
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
      if (!optionId) throw new Error('Project priority option is not configured')
      await this.setProjectField(projectId, itemId, config.priorityFieldId, {
        singleSelectOptionId: optionId,
      })
    }
    if (config.dueDateFieldId && item.dueDate)
      await this.setProjectField(projectId, itemId, config.dueDateFieldId, {
        date: item.dueDate,
      })
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
          query: 'mutation($project:ID!,$item:ID!,$field:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:$value}){projectV2Item{id}}}',
          variables: { project: projectId, item: itemId, field: fieldId, value },
        }),
      )
    if (result.errors) throw new Error('Project field update failed')
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
    if (result.errors) throw new Error('Project mutation failed')
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

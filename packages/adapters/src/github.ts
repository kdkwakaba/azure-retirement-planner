import type { WorkItem } from '@arp/contracts'
import { hash } from '@arp/domain'
import { z } from 'zod'
import { jsonRequest } from './http.ts'

export function issueText(item: WorkItem): string {
  // 実Resource ID、Workload名、自由文のEvidenceや内部URLは外部へ複製しない。
  return [
    `<!-- arp:${item.id} -->`,
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
  async create(item: WorkItem): Promise<{ id: string; url: string }> {
    const result = z.object({ node_id: z.string(), html_url: z.url() }).parse(
      await this.request(`/repos/${this.owner}/${this.repo}/issues`, {
        title: `[ARP] ${item.category} ${item.id.slice(0, 8)}`,
        body: issueText(item),
      }),
    )
    return { id: result.node_id, url: result.html_url }
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

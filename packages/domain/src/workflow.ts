import { z } from 'zod'
import {
  categorySchema,
  resourceClassSchema,
  type ResourceImpact,
  type WorkItem,
} from '@arp/contracts'

const roleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    displayName: z.string().min(1).max(100),
    kind: z.enum(['Team', 'Department', 'Approver']),
  })
  .strict()
const approvalStageSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    title: z.string().min(1).max(120),
    roleIds: z.array(z.string()).min(1),
  })
  .strict()
const assignmentMatchSchema = z
  .object({
    categories: z.array(categorySchema).optional(),
    resourceTypes: z.array(z.string().min(1)).optional(),
    environments: z.array(z.string().min(1)).optional(),
    classifications: z.array(resourceClassSchema).optional(),
  })
  .strict()
  .superRefine((match, context) => {
    if (!Object.values(match).some((values) => values?.length))
      context.addIssue({
        code: 'custom',
        message: '割当条件に少なくとも1つの一致条件が必要です',
      })
  })
const assignmentRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    match: assignmentMatchSchema,
    teamRoleIds: z.array(z.string()).default([]),
    coordinationRoleIds: z.array(z.string()).default([]),
    approvalStages: z.array(approvalStageSchema).default([]),
  })
  .strict()
const sequenceRuleSchema = z
  .object({
    category: categorySchema,
    dependsOnCategories: z.array(categorySchema).default([]),
  })
  .strict()
export const workflowPolicySchema = z
  .object({
    schemaVersion: z.literal('1'),
    version: z.string().min(1).max(100),
    roles: z.array(roleSchema),
    assignmentRules: z.array(assignmentRuleSchema),
    sequence: z.array(sequenceRuleSchema),
  })
  .strict()
  .superRefine((policy, context) => {
    const roles = new Map(policy.roles.map((role) => [role.id, role]))
    if (roles.size !== policy.roles.length)
      context.addIssue({
        code: 'custom',
        path: ['roles'],
        message: 'Role IDが重複しています',
      })
    const ruleIds = new Set<string>()
    for (const [index, rule] of policy.assignmentRules.entries()) {
      if (ruleIds.has(rule.id))
        context.addIssue({
          code: 'custom',
          path: ['assignmentRules', index, 'id'],
          message: 'Assignment Rule IDが重複しています',
        })
      ruleIds.add(rule.id)
      for (const id of [
        ...rule.teamRoleIds,
        ...rule.coordinationRoleIds,
        ...rule.approvalStages.flatMap((stage) => stage.roleIds),
      ])
        if (!roles.has(id))
          context.addIssue({
            code: 'custom',
            path: ['assignmentRules', index],
            message: `未定義Role: ${id}`,
          })
      for (const roleId of rule.teamRoleIds)
        if (roles.get(roleId)?.kind !== 'Team')
          context.addIssue({
            code: 'custom',
            path: ['assignmentRules', index, 'teamRoleIds'],
            message: `Team以外のRoleを担当候補に指定: ${roleId}`,
          })
      for (const roleId of rule.coordinationRoleIds)
        if (roles.get(roleId)?.kind !== 'Department')
          context.addIssue({
            code: 'custom',
            path: ['assignmentRules', index, 'coordinationRoleIds'],
            message: `Department以外のRoleを調整候補に指定: ${roleId}`,
          })
      for (const stage of rule.approvalStages)
        for (const roleId of stage.roleIds)
          if (roles.get(roleId)?.kind !== 'Approver')
            context.addIssue({
              code: 'custom',
              path: ['assignmentRules', index, 'approvalStages'],
              message: `Approver以外のRoleを承認者に指定: ${roleId}`,
            })
    }
    const sequence = new Map<string, string[]>()
    for (const [index, item] of policy.sequence.entries()) {
      const key = item.category
      if (sequence.has(key))
        context.addIssue({
          code: 'custom',
          path: ['sequence', index, 'category'],
          message: `Categoryの順序定義が重複: ${key}`,
        })
      sequence.set(key, item.dependsOnCategories)
    }
    const active = new Set<string>()
    const complete = new Set<string>()
    const visit = (category: string) => {
      if (active.has(category)) {
        context.addIssue({
          code: 'custom',
          path: ['sequence'],
          message: '作業順序に循環があります',
        })
        return
      }
      if (complete.has(category)) return
      active.add(category)
      for (const dependency of sequence.get(category) ?? [])
        if (sequence.has(dependency)) visit(dependency)
      active.delete(category)
      complete.add(category)
    }
    for (const category of sequence.keys()) visit(category)
  })
export type WorkflowPolicy = z.infer<typeof workflowPolicySchema>
type Role = WorkflowPolicy['roles'][number]
type WorkflowRouting = NonNullable<WorkItem['workflowRouting']>

export function applyWorkflowPolicy(
  workItems: WorkItem[],
  resources: ResourceImpact[],
  policy: WorkflowPolicy,
): { workItems: WorkItem[]; reviewReasons: string[]; errors: string[] } {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]))
  const roles = new Map(policy.roles.map((role) => [role.id, role]))
  const sequence = new Map(
    policy.sequence.map((rule, index) => [rule.category, { ...rule, index }]),
  )
  const errors: string[] = []
  const reviewReasons: string[] = []
  const routed = workItems.map((item) => {
    const targetResources = item.resourceIds
      .map((id) => resourcesById.get(id.toLowerCase()) ?? resourcesById.get(id))
      .filter((resource): resource is ResourceImpact => Boolean(resource))
    const matches = policy.assignmentRules.filter((rule) => {
      const condition = rule.match
      if (condition.categories && !condition.categories.includes(item.category))
        return false
      const resourceSelectors = [
        condition.resourceTypes?.length,
        condition.environments?.length,
        condition.classifications?.length,
      ].some(Boolean)
      if (!resourceSelectors) return true
      return targetResources.some(
        (resource) =>
          (!condition.resourceTypes?.length ||
            condition.resourceTypes.some(
              (type) => type.toLowerCase() === resource.type.toLowerCase(),
            )) &&
          (!condition.environments?.length ||
            condition.environments.some(
              (environment) =>
                environment.toLowerCase() ===
                (resource.environment ?? '').toLowerCase(),
            )) &&
          (!condition.classifications?.length ||
            condition.classifications.includes(resource.classification)),
      )
    })
    const teamRoles = uniqueRoles(
      matches.flatMap((rule) => rule.teamRoleIds),
      roles,
      'Team',
    )
    const coordinationRoles = uniqueRoles(
      matches.flatMap((rule) => rule.coordinationRoleIds),
      roles,
      'Department',
    )
    const stages = new Map<string, WorkflowRouting['approvalStages'][number]>()
    for (const stage of matches.flatMap((rule) => rule.approvalStages)) {
      const previous = stages.get(stage.id)
      if (previous && previous.title !== stage.title)
        errors.push(`承認段階ID ${stage.id} の名称が一致しません`)
      stages.set(stage.id, {
        id: stage.id,
        title: stage.title,
        approverRoles: uniqueRoles(stage.roleIds, roles, 'Approver'),
      })
    }
    const step = sequence.get(item.category)
    const dependsOnCategories = step?.dependsOnCategories ?? []
    const dependencyIds = new Set(item.dependencyIds)
    for (const category of dependsOnCategories) {
      const preceding = workItems.filter(
        (candidate) =>
          candidate.category === category && candidate.id !== item.id,
      )
      if (!preceding.length) {
        errors.push(
          `${item.id}: 設定された前提作業カテゴリ ${category} が作業案にありません`,
        )
        continue
      }
      for (const candidate of preceding) dependencyIds.add(candidate.id)
    }
    const unresolvedReasons: string[] = []
    if (teamRoles.length > 1)
      unresolvedReasons.push('担当チーム候補が複数あり、割当判断が必要です')
    if (!teamRoles.length && !item.ownerTeam)
      unresolvedReasons.push('担当チーム候補が設定されていません')
    if (unresolvedReasons.length)
      reviewReasons.push(...unresolvedReasons.map((reason) => `${item.title}: ${reason}`))
    const workflowRouting: WorkflowRouting = {
      policyVersion: policy.version,
      teamCandidates: teamRoles,
      coordinationCandidates: coordinationRoles,
      approvalStages: [...stages.values()],
      sequenceOrder: step?.index ?? null,
      dependsOnCategories,
      policyRuleIds: matches.map((rule) => rule.id),
      unresolvedReasons,
    }
    return {
      ...item,
      dependencyIds: [...dependencyIds].sort(),
      workflowRouting,
    }
  })
  return { workItems: routed, reviewReasons: [...new Set(reviewReasons)], errors }
}

function uniqueRoles<K extends Role['kind']>(
  ids: string[],
  roles: Map<string, Role>,
  kind: K,
): { id: string; displayName: string; kind: K }[] {
  return [...new Set(ids)].flatMap((id) => {
    const role = roles.get(id)
    return role?.kind === kind
      ? [{ id: role.id, displayName: role.displayName, kind }]
      : []
  })
}

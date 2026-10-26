import test from 'node:test'
import assert from 'node:assert/strict'
import { applyWorkflowPolicy, workflowPolicySchema } from '@arp/domain'
import { fixture, resourceId } from './fixtures.ts'

const policy = {
  schemaVersion: '1',
  version: 'synthetic-1',
  roles: [
    { id: 'platform-team', displayName: 'Platform Team', kind: 'Team' },
    { id: 'security-dept', displayName: 'Security', kind: 'Department' },
    { id: 'change-approver', displayName: 'Change Approver', kind: 'Approver' },
  ],
  assignmentRules: [
    {
      id: 'network-verification',
      match: {
        categories: ['Impact Verification'],
        resourceTypes: ['Microsoft.Network/loadBalancers'],
      },
      teamRoleIds: ['platform-team'],
      coordinationRoleIds: ['security-dept'],
      approvalStages: [
        {
          id: 'change-review',
          title: 'Change review',
          roleIds: ['change-approver'],
        },
      ],
    },
  ],
  sequence: [],
}

test('workflow policy validates role references and routes without replacing confirmed owner', () => {
  const parsed = workflowPolicySchema.parse(policy)
  const assessment = fixture()
  assessment.workItems[0]!.ownerTeam = 'Existing Owner'
  const result = applyWorkflowPolicy(
    assessment.workItems,
    assessment.resources,
    parsed,
  )
  assert.equal(result.errors.length, 0)
  assert.equal(result.workItems[0]!.ownerTeam, 'Existing Owner')
  assert.equal(
    result.workItems[0]!.workflowRouting?.teamCandidates[0]?.displayName,
    'Platform Team',
  )
  assert.equal(
    result.workItems[0]!.workflowRouting?.coordinationCandidates[0]
      ?.displayName,
    'Security',
  )
  assert.equal(
    result.workItems[0]!.workflowRouting?.approvalStages[0]?.approverRoles[0]
      ?.kind,
    'Approver',
  )
  assert.deepEqual(result.reviewReasons, [])
})

test('unmatched team routing requests human review and does not invent an owner', () => {
  const parsed = workflowPolicySchema.parse({ ...policy, assignmentRules: [] })
  const assessment = fixture()
  const result = applyWorkflowPolicy(
    assessment.workItems,
    assessment.resources,
    parsed,
  )
  assert.equal(result.workItems[0]!.ownerTeam, null)
  assert.match(
    result.workItems[0]!.workflowRouting!.unresolvedReasons[0]!,
    /候補が設定されていません/,
  )
  assert.equal(result.reviewReasons.length, 1)
})

test('configured predecessor missing from the plan is an error', () => {
  const parsed = workflowPolicySchema.parse({
    ...policy,
    sequence: [
      {
        category: 'Production Migration',
        dependsOnCategories: ['Architecture Design'],
      },
    ],
  })
  const assessment = fixture()
  const work = {
    ...assessment.workItems[0]!,
    category: 'Production Migration' as const,
  }
  const result = applyWorkflowPolicy([work], assessment.resources, parsed)
  assert.match(result.errors[0]!, /Architecture Design/)
})

test('workflow policy rejects wrong role kinds, unknown references, and dependency cycles', () => {
  const wrongRole = {
    ...policy,
    assignmentRules: [
      {
        ...policy.assignmentRules[0],
        approvalStages: [
          { id: 'bad-stage', title: 'Bad stage', roleIds: ['platform-team'] },
        ],
      },
    ],
  }
  assert.equal(workflowPolicySchema.safeParse(wrongRole).success, false)
  assert.equal(
    workflowPolicySchema.safeParse({
      ...policy,
      assignmentRules: [
        { ...policy.assignmentRules[0], teamRoleIds: ['missing-team'] },
      ],
    }).success,
    false,
  )
  assert.equal(
    workflowPolicySchema.safeParse({
      ...policy,
      sequence: [
        {
          category: 'Architecture Design',
          dependsOnCategories: ['Proof of Concept'],
        },
        {
          category: 'Proof of Concept',
          dependsOnCategories: ['Architecture Design'],
        },
      ],
    }).success,
    false,
  )
})

test('resource matching is case-insensitive and limited to selected resources', () => {
  const parsed = workflowPolicySchema.parse(policy)
  const assessment = fixture()
  const result = applyWorkflowPolicy(assessment.workItems, assessment.resources, parsed)
  assert.deepEqual(result.workItems[0]!.resourceIds, [resourceId])
  assert.deepEqual(result.workItems[0]!.workflowRouting!.policyRuleIds, [
    'network-verification',
  ])
})

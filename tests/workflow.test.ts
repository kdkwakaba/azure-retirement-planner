import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyWorkflowPolicy,
  generateBusinessWorkflowTasks,
  packageHash,
  validateAssessment,
  workflowPolicySchema,
} from '@arp/domain'
import { fixture, resourceId } from './fixtures.ts'
import examplePolicy from '../config/examples/workflow-policy.example.json' with { type: 'json' }
import departmentPolicy from '../config/workflow-policy.json' with { type: 'json' }

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
  const result = applyWorkflowPolicy(
    assessment.workItems,
    assessment.resources,
    parsed,
  )
  assert.deepEqual(result.workItems[0]!.resourceIds, [resourceId])
  assert.deepEqual(result.workItems[0]!.workflowRouting!.policyRuleIds, [
    'network-verification',
  ])
})

test('multiple team candidates are all retained without review solely due to count', () => {
  const multiple = workflowPolicySchema.parse({
    ...policy,
    roles: [
      ...policy.roles,
      { id: 'application-team', displayName: 'Application Team', kind: 'Team' },
    ],
    assignmentRules: [
      ...policy.assignmentRules,
      {
        id: 'application-coordination',
        match: { categories: ['Impact Verification'] },
        teamRoleIds: ['application-team'],
      },
    ],
  })
  const result = applyWorkflowPolicy(
    fixture().workItems,
    fixture().resources,
    multiple,
  )
  assert.deepEqual(
    result.workItems[0]!.workflowRouting!.teamCandidates.map((r) => r.id),
    ['platform-team', 'application-team'],
  )
  assert.deepEqual(result.reviewReasons, [])
})

test('business coordination and commercial work categories are supported by policy', () => {
  const extended = workflowPolicySchema.parse({
    ...policy,
    assignmentRules: [
      {
        id: 'business-coordination',
        match: {
          categories: ['Customer Communication', 'Cross-Team Coordination'],
        },
        coordinationRoleIds: ['security-dept'],
      },
      {
        id: 'commercial-review',
        match: {
          categories: [
            'Vendor Assessment',
            'Cost Assessment',
            'Budget Approval',
            'Contract Review',
          ],
        },
        teamRoleIds: ['platform-team'],
        approvalStages: [
          {
            id: 'commercial-approval',
            title: 'Commercial approval',
            roleIds: ['change-approver'],
          },
        ],
      },
    ],
  })
  assert.equal(extended.assignmentRules.length, 2)
})

test('example workflow policy conforms to the runtime contract', () => {
  const parsed = workflowPolicySchema.parse(examplePolicy)
  assert.equal(parsed.version, 'example-synthetic-1')
  assert.ok(
    parsed.roles.every((role) => !role.displayName.startsWith('サンプル: ')),
  )
})

test('business workflow templates generate only triggered, evidence-backed sample tasks', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
    })),
  }
  const generated = generateBusinessWorkflowTasks({
    policy,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2',
    existingWorkItems: assessment.workItems,
    asOf: assessment.asOf,
  })
  assert.deepEqual(
    generated.workItems.map((item) => item.category).sort(),
    [
      'Cost Assessment',
      'Cross-Team Coordination',
      'Customer Communication',
      'Vendor Assessment',
    ].sort(),
  )
  assert.ok(
    generated.workItems.every((item) => item.necessity === 'Recommended'),
  )
  assert.equal(generated.evidence.length, 1)
  assert.match(generated.evidence[0]!.fact, /合成例データ/)
  assert.ok(
    generated.workItems.every((item) =>
      item.evidenceIds.includes(generated.evidence[0]!.id),
    ),
  )
})

test('business profile does not create budget approval before additional cost is confirmed', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
      additionalCost: 'Possible' as const,
      vendorUse: 'No' as const,
      businessImpact: 'Unknown' as const,
      contractReview: 'Unknown' as const,
    })),
  }
  const generated = generateBusinessWorkflowTasks({
    policy,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2',
    existingWorkItems: [],
    asOf: assessment.asOf,
  })
  assert.deepEqual(
    generated.workItems.map((item) => item.category),
    ['Cost Assessment'],
  )
  assert.equal(generated.workItems[0]!.necessity, 'Recommended')
})

test('business task generation does not apply example profiles to unmatched workloads', () => {
  const parsed = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const result = generateBusinessWorkflowTasks({
    policy: parsed,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: null,
    existingWorkItems: [],
    asOf: assessment.asOf,
  })
  assert.deepEqual(result, { workItems: [], evidence: [] })
})

test('business tasks remain recommended for uncertain resources and validate with deprecation events', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  assessment.resources[0]!.classification = 'Unknown'
  assessment.resources[0]!.verificationRequired = true
  assessment.event.milestones.push({
    id: 'deprecation-start',
    kind: 'Deprecation',
    date: '2026-09-01',
    rawDateText: 'September 2026',
    scope: 'synthetic test only',
    evidenceIds: [assessment.event.evidence[0]!.id],
  })
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
    })),
  }
  const generated = generateBusinessWorkflowTasks({
    policy,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2',
    existingWorkItems: assessment.workItems,
    asOf: assessment.asOf,
  })
  assert.ok(
    generated.workItems.every((item) => item.necessity === 'Recommended'),
  )
  assert.ok(
    generated.workItems.every(
      (item) => item.applicableMilestoneIds.length === 0,
    ),
  )
  assessment.event.evidence.push(...generated.evidence)
  assessment.workItems.push(...generated.workItems)
  assessment.packageHash = packageHash(assessment)
  assert.deepEqual(validateAssessment(assessment), [])
})

test('unknown vendor use proposes recommended verification without assuming a vendor or contract', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
      businessImpact: 'Unknown' as const,
      vendorUse: 'Unknown' as const,
      additionalCost: 'None' as const,
      contractReview: 'Unknown' as const,
    })),
  }
  const generated = generateBusinessWorkflowTasks({
    policy,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2',
    existingWorkItems: [],
    asOf: assessment.asOf,
  })
  assert.deepEqual(
    generated.workItems.map((item) => item.category),
    ['Vendor Assessment'],
  )
  assert.equal(generated.workItems[0]!.necessity, 'Recommended')
  assert.match(
    generated.workItems[0]!.description,
    /ベンダー作業・契約が利用されているか/,
  )
})

test('budget and contract categories cannot bypass confirmed prerequisites through template triggers', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
      businessImpact: 'Confirmed' as const,
      vendorUse: 'Unknown' as const,
      additionalCost: 'Possible' as const,
      contractReview: 'Required' as const,
    })),
    businessTaskTemplates: [
      ...example.businessTaskTemplates,
      {
        id: 'unsafe-budget-trigger',
        trigger: 'BusinessImpact' as const,
        category: 'Budget Approval' as const,
        title: 'Budget approval',
        description: 'Must not bypass cost confirmation',
        necessity: 'Required' as const,
        completionCriteria: ['Check the approval'],
      },
      {
        id: 'unsafe-contract-trigger',
        trigger: 'BusinessImpact' as const,
        category: 'Contract Review' as const,
        title: 'Contract review',
        description: 'Must not bypass vendor confirmation',
        necessity: 'Required' as const,
        completionCriteria: ['Check the contract'],
      },
    ],
  }
  const generated = generateBusinessWorkflowTasks({
    policy,
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2',
    existingWorkItems: [],
    asOf: assessment.asOf,
  })
  assert.ok(
    !generated.workItems.some((item) => item.category === 'Budget Approval'),
  )
  assert.ok(
    !generated.workItems.some((item) => item.category === 'Contract Review'),
  )
})

test('business task IDs remain stable across routing-only policy version bumps', () => {
  const example = workflowPolicySchema.parse(examplePolicy)
  const assessment = fixture()
  const policy = {
    ...example,
    businessContextProfiles: example.businessContextProfiles.map((profile) => ({
      ...profile,
      workloadId: assessment.workloadId,
    })),
  }
  const args = {
    event: assessment.event,
    workloadId: assessment.workloadId,
    resources: assessment.resources,
    priority: 'P2' as const,
    existingWorkItems: assessment.workItems,
    asOf: assessment.asOf,
  }
  const original = generateBusinessWorkflowTasks({ policy, ...args })
  const updated = generateBusinessWorkflowTasks({
    policy: { ...policy, version: `${policy.version}-routing-change` },
    ...args,
  })
  assert.deepEqual(
    updated.workItems.map((item) => item.id),
    original.workItems.map((item) => item.id),
  )
})

test('department policy routes technical discovery and coordination without assigning an owner', () => {
  const parsed = workflowPolicySchema.parse(departmentPolicy)
  const assessment = fixture()
  const technical = {
    ...assessment.workItems[0]!,
    id: 'technical-check',
    category: 'Impact Verification' as const,
    ownerTeam: null,
    workflowRouting: undefined,
  }
  const coordination = {
    ...technical,
    id: 'coordination',
    category: 'Cross-Team Coordination' as const,
  }
  const result = applyWorkflowPolicy(
    [technical, coordination],
    assessment.resources,
    parsed,
  )
  assert.deepEqual(
    result.workItems[0]?.workflowRouting?.teamCandidates.map(
      (candidate) => candidate.displayName,
    ),
    ['インフラ部門', 'アプリ部門'],
  )
  assert.deepEqual(
    result.workItems.map(
      (item) => item.workflowRouting?.coordinationCandidates[0]?.displayName,
    ),
    ['情報システム部門', '情報システム部門'],
  )
  assert.equal(result.workItems[0]?.ownerTeam, null)
})

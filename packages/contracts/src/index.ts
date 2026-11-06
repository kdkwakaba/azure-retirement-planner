import { z } from 'zod'

export const impactSchema = z.enum(['Low', 'Medium', 'High', 'Critical'])
export const prioritySchema = z.enum(['P1', 'P2', 'P3', 'P4'])
export const lifecycleKindSchema = z.enum([
  'Deprecation',
  'NewCreationBlocked',
  'SupportEnded',
  'Retirement',
  'Unknown',
])
export const resourceClassSchema = z.enum([
  'Confirmed',
  'Probable',
  'Possible',
  'Verification Required',
  'Not Impacted',
  'Unknown',
])
export const resourceClassificationReasonSchema = z.enum([
  'AssessmentPending',
  'ExplicitMicrosoftImpact',
  'ExplicitExclusion',
  'ProfileConditionMatched',
  'DependencyEvidence',
  'RequiredAttributeMissing',
  'UsageRequiresVerification',
  'NoMatchingProfileCondition',
  'NoApplicableProfile',
  'LegacyUnrecorded',
  'ConflictingEvidence',
])
export const categorySchema = z.enum([
  'Impact Verification',
  'Owner Confirmation',
  'Migration Assessment',
  'Architecture Design',
  'Proof of Concept',
  'Application Change',
  'Infrastructure Change',
  'Network Change',
  'Security Review',
  'Test',
  'Change Management',
  'Production Migration',
  'Validation',
  'Rollback Preparation',
  'Legacy Resource Removal',
  'Documentation Update',
  'CMDB Update',
  'Policy and IaC Update',
  'Customer Communication',
  'Cross-Team Coordination',
  'Vendor Assessment',
  'Cost Assessment',
  'Budget Approval',
  'Contract Review',
])
export const dateSchema = z.iso.date()
export const discoveryFailureSchema = z
  .object({
    source: z.enum([
      'ServiceHealthAdvisory',
      'ResourceGraphInventory',
      'ServiceHealthImpactedResources',
      'AdvisorRetirementRecommendations',
      'OfficialReference',
    ]),
    category: z.enum([
      'Unauthorized',
      'Forbidden',
      'Throttled',
      'UpstreamUnavailable',
      'Timeout',
      'InvalidResponse',
      'NetworkError',
      'Unknown',
    ]),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    correlationId: z.string().uuid(),
  })
  .strict()
export const modelInvocationSchema = z
  .object({
    stage: z.enum(['Decision', 'Explanation']),
    provider: z.literal('Microsoft Foundry'),
    deployment: z.string().min(1).max(80),
    modelVersion: z.string().max(80).nullable(),
    promptVersion: z.string().max(80).nullable(),
    status: z.enum([
      'NotRequired',
      'NotConfigured',
      'NotStarted',
      'Succeeded',
      'SucceededWithFallback',
      'Failed',
    ]),
    correlationId: z.string().min(1).max(64),
    durationMs: z.number().int().nonnegative().nullable(),
    failureCategory: z
      .enum([
        'Unauthorized',
        'Forbidden',
        'Throttled',
        'UpstreamUnavailable',
        'Timeout',
        'InvalidResponse',
        'NetworkError',
        'DailyLimit',
        'StorageFailure',
        'Unknown',
      ])
      .nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
  })
  .strict()
export const evidenceSchema = z
  .object({
    id: z.string().min(1),
    sourceType: z.enum(['Microsoft', 'Azure', 'Internal', 'Rule', 'Human']),
    sourceVersion: z.string().min(1),
    observedAt: z.iso.datetime(),
    subjectIds: z.array(z.string()),
    fact: z.string().min(1),
    officialUrl: z.url().nullable(),
  })
  .strict()
export const businessContextSchema = z
  .object({
    schemaVersion: z.literal('1'),
    workloadId: z.string().min(1).max(200),
    sourceSystem: z.string().min(1).max(100),
    sourceRecordId: z.string().min(1).max(200),
    sourceUpdatedAt: z.iso.datetime(),
    reviewedBy: z.string().uuid(),
    reviewedAt: z.iso.datetime(),
    businessImpact: z.enum(['Confirmed', 'None', 'Unknown']),
    vendorUse: z.enum(['Confirmed', 'No', 'Unknown']),
    additionalCost: z.enum(['Confirmed', 'Possible', 'None', 'Unknown']),
    contractReview: z.enum(['Required', 'NotRequired', 'Unknown']),
  })
  .strict()
// SharePoint document grounding contract. Sources are an array from the first
// revision so future multi-folder support does not require a schema redesign.
export const documentSourceSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    tenantId: z.uuid(),
    siteId: z.string().min(1).max(500),
    driveId: z.string().min(1).max(500),
    folderItemId: z.string().min(1).max(500),
    displayName: z.string().min(1).max(200),
    workloadIds: z.array(z.string().min(1).max(200)).min(1),
    includeSubfolders: z.boolean(),
    allowedExtensions: z.array(z.enum(['.docx', '.xlsx'])).min(1),
    sampleOnly: z.boolean(),
    configurationVersion: z.string().min(1).max(100),
  })
  .strict()
export const documentRevisionSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    itemId: z.string().min(1).max(500),
    name: z.string().min(1).max(500),
    extension: z.enum(['.docx', '.xlsx']),
    eTag: z.string().min(1).max(500).nullable(),
    lastModifiedAt: z.iso.datetime().nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.iso.datetime(),
    sampleOnly: z.boolean(),
  })
  .strict()
export const sharePointSnapshotSchema = z
  .object({
    schemaVersion: z.literal('1'),
    sourceId: z.string().min(1).max(100),
    sampleOnly: z.boolean(),
    configurationVersion: z.string().min(1).max(100),
    observedAt: z.iso.datetime(),
    enumerationComplete: z.literal(true),
    documents: z.array(documentRevisionSchema).max(100),
    skipped: z
      .array(
        z
          .object({
            itemId: z.string().min(1).max(500),
            name: z.string().min(1).max(500),
            reason: z.literal('UnsupportedExtension'),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const seen = new Set<string>()
    snapshot.documents.forEach((document, index) => {
      if (document.sourceId !== snapshot.sourceId)
        context.addIssue({
          code: 'custom',
          path: ['documents', index, 'sourceId'],
          message: 'Document revision source does not match snapshot source',
        })
      if (document.sampleOnly !== snapshot.sampleOnly)
        context.addIssue({
          code: 'custom',
          path: ['documents', index, 'sampleOnly'],
          message: 'Document sample classification does not match snapshot',
        })
      if (document.observedAt !== snapshot.observedAt)
        context.addIssue({
          code: 'custom',
          path: ['documents', index, 'observedAt'],
          message: 'Document observation time does not match snapshot',
        })
      if (seen.has(document.itemId))
        context.addIssue({
          code: 'custom',
          path: ['documents', index, 'itemId'],
          message: 'Snapshot contains a duplicate document item',
        })
      seen.add(document.itemId)
    })
  })
export const sharePointSyncRunSchema = z
  .object({
    runId: z.uuid(),
    sourceId: z.string().min(1).max(100),
    sourceConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    configurationVersion: z.string().min(1).max(100),
    sampleOnly: z.boolean(),
    requestedBy: z.uuid(),
    requestedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    state: z.enum([
      'Pending',
      'Queued',
      'Processing',
      'Retrying',
      'Succeeded',
      'Failed',
    ]),
    attemptCount: z.number().int().min(0).max(10),
    snapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    addedItemIds: z.array(z.string().min(1).max(500)).max(100),
    changedItemIds: z.array(z.string().min(1).max(500)).max(100),
    removedItemIds: z.array(z.string().min(1).max(500)).max(100),
    unchangedItemIds: z.array(z.string().min(1).max(500)).max(100),
    errorCategory: z
      .enum([
        'Unauthorized',
        'Forbidden',
        'Throttled',
        'UpstreamUnavailable',
        'Timeout',
        'InvalidResponse',
        'NetworkError',
        'Unknown',
      ])
      .nullable(),
    errorHttpStatus: z.number().int().min(100).max(599).nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.state === 'Succeeded' && run.snapshotHash === null)
      context.addIssue({
        code: 'custom',
        path: ['snapshotHash'],
        message: 'Successful SharePoint sync requires a snapshot',
      })
    if (run.state === 'Failed' && run.errorCategory === null)
      context.addIssue({
        code: 'custom',
        path: ['errorCategory'],
        message: 'Failed SharePoint sync requires a safe error category',
      })
  })
export const documentTextBlockSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    itemId: z.string().min(1).max(500),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    blockId: z.string().min(1).max(200),
    kind: z.enum(['Paragraph', 'SpreadsheetCell']),
    text: z.string().min(1).max(20000),
    heading: z.string().max(500).nullable(),
    sheet: z.string().max(200).nullable(),
    row: z.number().int().positive().nullable(),
    cell: z.string().max(20).nullable(),
    sampleOnly: z.boolean(),
  })
  .strict()
export const documentTextSchema = z
  .object({
    schemaVersion: z.literal('1'),
    revision: documentRevisionSchema,
    blocks: z.array(documentTextBlockSchema).max(20000),
  })
  .strict()
export const documentFactSchema = z
  .object({
    factId: z.string().min(1).max(200),
    workloadId: z.string().min(1).max(200),
    kind: z.enum([
      'BusinessProcess',
      'ResourceDependency',
      'FeatureUsage',
      'AlternativePath',
      'Tolerance',
      'ChangeImpact',
    ]),
    statement: z.string().min(1).max(4000),
    sourceId: z.string().min(1).max(100),
    documentItemId: z.string().min(1).max(500),
    documentContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    resourceIds: z
      .array(z.string().regex(/^\/subscriptions\//i))
      .max(100)
      .optional(),
    resourceLinkCandidates: z
      .array(
        z
          .object({
            resourceId: z.string().regex(/^\/subscriptions\//i),
            matchKind: z.enum(['ExactResourceId', 'ExactResourceName']),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    relatedFactIds: z.array(z.string().min(1).max(200)).max(20).optional(),
    locator: z
      .object({
        heading: z.string().max(500).nullable(),
        sheet: z.string().max(200).nullable().optional(),
        table: z.string().max(200).nullable(),
        row: z.number().int().nonnegative().nullable(),
        cell: z.string().max(100).nullable(),
        page: z.number().int().positive().nullable(),
      })
      .strict(),
    reviewStatus: z.enum(['Candidate', 'Confirmed', 'Rejected']),
    reviewedBy: z.string().min(1).max(200).nullable().optional(),
    reviewedAt: z.iso.datetime().nullable().optional(),
    sampleOnly: z.boolean(),
  })
  .strict()
export const documentFactProposalSchema = z
  .object({
    blockId: z.string().min(1).max(200),
    kind: z.enum([
      'BusinessProcess',
      'ResourceDependency',
      'FeatureUsage',
      'AlternativePath',
      'Tolerance',
      'ChangeImpact',
    ]),
    statement: z.string().min(1).max(4000),
  })
  .strict()
export const documentGroundingSchema = z
  .object({
    schemaVersion: z.literal('1'),
    workloadId: z.string().min(1).max(200),
    sampleOnly: z.boolean(),
    sourceConfigurationVersion: z.string().min(1).max(100),
    documentRevisions: z.array(documentRevisionSchema),
    facts: z.array(documentFactSchema),
    supersedesGroundingHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    extractionRecords: z
      .array(
        z
          .object({
            sourceId: z.string().min(1).max(100),
            itemId: z.string().min(1).max(500),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            promptVersion: z.string().min(1).max(100),
            deployment: z.string().min(1).max(80),
            modelVersion: z.string().min(1).max(100),
            completedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    observedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((grounding, context) => {
    const factsById = new Map(
      grounding.facts.map((fact) => [fact.factId, fact]),
    )
    if (factsById.size !== grounding.facts.length)
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'Document fact IDs must be unique within a grounding',
      })
    const revisions = new Map(
      grounding.documentRevisions.map((revision) => [
        `${revision.sourceId}:${revision.itemId}:${revision.contentHash}`,
        revision,
      ]),
    )
    grounding.facts.forEach((fact, index) => {
      if (fact.workloadId !== grounding.workloadId)
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'workloadId'],
          message: 'Document fact workload does not match grounding workload',
        })
      if (fact.sampleOnly !== grounding.sampleOnly)
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'sampleOnly'],
          message: 'Sample classification must match document grounding',
        })
      if (fact.kind !== 'ResourceDependency' && fact.resourceIds?.length)
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'resourceIds'],
          message: 'Only resource dependency facts can link Azure resources',
        })
      if (
        fact.kind !== 'ResourceDependency' &&
        fact.resourceLinkCandidates?.length
      )
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'resourceLinkCandidates'],
          message: 'Only resource dependency facts can suggest Azure resources',
        })
      if (fact.relatedFactIds?.length) {
        if (
          fact.reviewStatus !== 'Confirmed' ||
          !fact.reviewedBy ||
          !fact.reviewedAt
        )
          context.addIssue({
            code: 'custom',
            path: ['facts', index, 'relatedFactIds'],
            message: 'Only audited confirmed facts can link dependency facts',
          })
        if (new Set(fact.relatedFactIds).size !== fact.relatedFactIds.length)
          context.addIssue({
            code: 'custom',
            path: ['facts', index, 'relatedFactIds'],
            message: 'Duplicate dependency fact links are not allowed',
          })
        for (const relatedFactId of fact.relatedFactIds) {
          const target = factsById.get(relatedFactId)
          const allowed =
            (fact.kind === 'BusinessProcess' &&
              (target?.kind === 'FeatureUsage' ||
                target?.kind === 'ResourceDependency')) ||
            (fact.kind === 'FeatureUsage' &&
              target?.kind === 'ResourceDependency') ||
            (fact.kind === 'ResourceDependency' &&
              target?.kind === 'ResourceDependency')
          if (
            !target ||
            relatedFactId === fact.factId ||
            !allowed ||
            target.reviewStatus !== 'Confirmed' ||
            !target.reviewedBy ||
            !target.reviewedAt
          )
            context.addIssue({
              code: 'custom',
              path: ['facts', index, 'relatedFactIds'],
              message:
                'Dependency links must target an audited confirmed fact of an allowed kind',
            })
        }
      }
      if (
        !revisions.has(
          `${fact.sourceId}:${fact.documentItemId}:${fact.documentContentHash}`,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'documentItemId'],
          message: 'Document fact must reference an included document revision',
        })
    })
    grounding.documentRevisions.forEach((revision, index) => {
      if (revision.sampleOnly !== grounding.sampleOnly)
        context.addIssue({
          code: 'custom',
          path: ['documentRevisions', index, 'sampleOnly'],
          message: 'Sample classification must match document grounding',
        })
    })
    const indegree = new Map(grounding.facts.map((fact) => [fact.factId, 0]))
    for (const fact of grounding.facts)
      for (const targetId of fact.relatedFactIds ?? [])
        if (indegree.has(targetId))
          indegree.set(targetId, indegree.get(targetId)! + 1)
    const roots = [...indegree]
      .filter(([, degree]) => degree === 0)
      .map(([factId]) => factId)
    let visitedCount = 0
    while (roots.length) {
      const factId = roots.pop()!
      visitedCount++
      for (const targetId of factsById.get(factId)?.relatedFactIds ?? []) {
        if (!indegree.has(targetId)) continue
        const degree = indegree.get(targetId)! - 1
        indegree.set(targetId, degree)
        if (degree === 0) roots.push(targetId)
      }
    }
    if (visitedCount !== grounding.facts.length)
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'Dependency fact links must be acyclic',
      })
  })
export const sampleDocumentImpactEvaluationSchema = z
  .object({
    schemaVersion: z.literal('1'),
    evaluationId: z.string().regex(/^[a-f0-9]{64}$/),
    sampleOnly: z.literal(true),
    assessmentId: z.string().min(1).max(200),
    workloadId: z.string().min(1).max(200),
    eventTitle: z.string().min(1).max(1000),
    groundingHash: z.string().regex(/^[a-f0-9]{64}$/),
    evaluatedAt: z.iso.datetime(),
    outcome: z.enum([
      'MatchedResources',
      'NoResourceLinks',
      'NoConfirmedFacts',
      'NeedsFactReview',
    ]),
    matchedResourceIds: z
      .array(z.string().regex(/^\/subscriptions\//i))
      .max(500),
    facts: z
      .array(
        z
          .object({
            factId: z.string().min(1).max(200),
            kind: documentFactProposalSchema.shape.kind,
            statement: z.string().min(1).max(4000),
            reviewStatus: z.enum(['Candidate', 'Confirmed', 'Rejected']),
            documentName: z.string().min(1).max(500),
            locator: documentFactSchema.shape.locator,
            linkedResourceIds: z
              .array(z.string().regex(/^\/subscriptions\//i))
              .max(20),
            matchedResourceIds: z
              .array(z.string().regex(/^\/subscriptions\//i))
              .max(20),
          })
          .strict(),
      )
      .max(500),
    limitations: z.array(z.string().min(1).max(500)).max(10),
  })
  .strict()
export const milestoneSchema = z
  .object({
    id: z.string().min(1),
    kind: lifecycleKindSchema,
    date: dateSchema.nullable(),
    rawDateText: z.string().nullable(),
    scope: z.string(),
    evidenceIds: z.array(z.string()).min(1),
  })
  .strict()
export const eventSchema = z
  .object({
    schemaVersion: z.literal('1'),
    id: z.string(),
    versionId: z.string(),
    tenantId: z.uuid(),
    trackingId: z.string().min(1),
    source: z.literal('ServiceHealth'),
    title: z.string().min(1),
    body: z.string(),
    sourceUpdatedAt: z.iso.datetime(),
    contentHash: z.string(),
    classification: z.enum(['InScope', 'OutOfScope', 'ReviewRequired']),
    kinds: z.array(lifecycleKindSchema),
    milestones: z.array(milestoneSchema),
    evidence: z.array(evidenceSchema),
    rawMetadata: z.record(z.string(), z.unknown()),
  })
  .strict()
export const impactDiscoveryOutcomeSchema = z.enum([
  'CandidatesFound',
  'NoResourcesDetected',
  'NoImpactMatched',
  'ProfileUnavailable',
  'Incomplete',
])
export const resourceSchema = z
  .object({
    id: z.string().regex(/^\/subscriptions\//i),
    workloadId: z.string().nullable(),
    type: z.string(),
    sku: z.string().nullable(),
    region: z.string(),
    environment: z.string().nullable(),
    ownerTeam: z.string().nullable(),
    classification: resourceClassSchema,
    classificationReason:
      resourceClassificationReasonSchema.default('LegacyUnrecorded'),
    missingAttributes: z.array(z.string()).default([]),
    verificationRequired: z.boolean(),
    evidenceIds: z.array(z.string()),
    properties: z.record(z.string(), z.unknown()),
  })
  .strict()
export const decisionSchema = z
  .object({
    impactIfUnaddressed: impactSchema.nullable(),
    impactDuringAndAfterChange: impactSchema.nullable(),
    priority: prioritySchema.nullable(),
    startWindow: z
      .enum([
        'Immediate',
        'Within 30 days',
        'Within 90 days',
        'Within 180 days',
        'Later',
        'No action',
      ])
      .nullable(),
    complexity: z.enum(['Low', 'Medium', 'High']).nullable(),
    projectRequired: z.boolean().nullable(),
    ownerTeam: z.string().nullable(),
    scoreValues: z
      .object({
        impactIfUnaddressed: z.number().finite().min(0).max(3).optional(),
        impactDuringAndAfterChange: z
          .number()
          .finite()
          .min(0)
          .max(3)
          .optional(),
      })
      .strict()
      .optional(),
    probabilities: z.record(
      z.string(),
      z.record(z.string(), z.number().min(0).max(1)),
    ),
    status: z.enum(['Proposed', 'Unavailable', 'Abstained']),
    model: z.string(),
    modelVersion: z.string(),
    promptVersion: z.string(),
    ruleVersion: z.string(),
  })
  .strict()
export const confidenceSchema = z
  .object({
    kind: z.enum(['EvidenceSupport', 'ModelProbability', 'Human']),
    value: z.number().min(0).max(1).nullable(),
    method: z.string(),
    limitations: z.array(z.string()),
  })
  .strict()
export const workflowRoutingSchema = z
  .object({
    policyVersion: z.string(),
    teamCandidates: z.array(
      z
        .object({
          id: z.string(),
          displayName: z.string(),
          kind: z.literal('Team'),
        })
        .strict(),
    ),
    coordinationCandidates: z.array(
      z
        .object({
          id: z.string(),
          displayName: z.string(),
          kind: z.literal('Department'),
        })
        .strict(),
    ),
    approvalStages: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          approverRoles: z.array(
            z
              .object({
                id: z.string(),
                displayName: z.string(),
                kind: z.literal('Approver'),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    sequenceOrder: z.number().int().nonnegative().nullable(),
    dependsOnCategories: z.array(categorySchema),
    policyRuleIds: z.array(z.string()),
    unresolvedReasons: z.array(z.string()),
  })
  .strict()
export const workItemSchema = z
  .object({
    id: z.string(),
    category: categorySchema,
    title: z.string().min(1),
    description: z.string().min(1),
    workloadId: z.string(),
    resourceIds: z.array(z.string()),
    ownerTeam: z.string().nullable(),
    necessity: z.enum(['Required', 'Recommended']),
    priority: prioritySchema.nullable(),
    plannedStartDate: dateSchema.nullable(),
    dueDate: dateSchema.nullable(),
    applicableMilestoneIds: z.array(z.string()),
    prerequisites: z.array(z.string()),
    completionCriteria: z.array(z.string()).min(1),
    humanApprovalRequired: z.literal(true),
    evidenceIds: z.array(z.string()).min(1),
    sourceType: z.enum(['Official', 'Internal', 'AIProposal', 'Mixed']),
    officialReferenceIds: z.array(z.string()),
    dependencyIds: z.array(z.string()),
    status: z.enum([
      'Draft',
      'Approved',
      'Exported',
      'In Progress',
      'Completed',
      'Cancelled',
    ]),
    confidence: confidenceSchema,
    workflowRouting: workflowRoutingSchema.optional(),
  })
  .strict()
export const claimSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    kind: z.enum([
      'Confirmed Fact',
      'Derived Fact',
      'General Impact',
      'Model Decision',
      'Assumption',
      'Unknown',
      'Recommendation',
    ]),
    evidenceIds: z.array(z.string()),
    decisionRefs: z.array(z.string()),
  })
  .strict()
export const explanationSchema = z
  .object({
    impact: z.array(claimSchema),
    increasingFactors: z.array(claimSchema),
    reducingFactors: z.array(claimSchema),
    startRationale: z.array(claimSchema),
    missingInformation: z.array(claimSchema),
    changeConditions: z.array(claimSchema),
    microsoftFacts: z.array(claimSchema),
    internalFacts: z.array(claimSchema),
    judgments: z.array(claimSchema),
    humanChecks: z.array(claimSchema),
  })
  .strict()
export const correctionSchema = z
  .object({
    // Human disposition is separate from the source event's official classification.
    scopeDisposition: z
      .enum(['InScope', 'OutOfScope', 'ReviewRequired'])
      .optional(),
    impactIfUnaddressed: impactSchema.nullable(),
    impactDuringAndAfterChange: impactSchema.nullable(),
    criticalWorkload: z.boolean(),
    alternativeApproved: z.boolean(),
    remainingCalendarDays: z.number().int().nonnegative().nullable(),
    retirementDate: dateSchema.nullable(),
    supportEndDate: dateSchema.nullable(),
    creationStopDate: dateSchema.nullable(),
    deprecationDate: dateSchema.nullable(),
    applicableKind: lifecycleKindSchema.nullable(),
    reason: z.string().min(1).max(2000),
    workItemUpdates: z.array(
      z
        .object({
          id: z.string(),
          title: z.string().min(1).max(160).optional(),
          description: z.string().min(1).max(2000).optional(),
          completionCriteria: z
            .array(z.string().min(1).max(500))
            .min(1)
            .max(10)
            .optional(),
          ownerTeam: z.string().nullable(),
          plannedStartDate: dateSchema.nullable(),
          dueDate: dateSchema.nullable(),
        })
        .strict(),
    ),
    workItemAdditions: z
      .array(
        z
          .object({
            clientId: z.uuid(),
            category: categorySchema,
            title: z.string().min(1).max(160),
            description: z.string().min(1).max(2000),
            completionCriteria: z
              .array(z.string().min(1).max(500))
              .min(1)
              .max(10),
            ownerTeam: z.string().max(100).nullable(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export const approvalSchema = z
  .object({
    id: z.string(),
    assessmentId: z.string(),
    packageHash: z.string(),
    approvedItemIds: z.array(z.string()),
    reviewerId: z.string(),
    reviewedAt: z.iso.datetime(),
    reason: z.string().min(1),
    result: z.enum(['Approved', 'Partial', 'Returned', 'Held', 'NoAction']),
  })
  .strict()
export const assessmentReviewSchema = approvalSchema
  .omit({ id: true, reviewerId: true })
  .strict()
export const assessmentSchema = z
  .object({
    id: z.string(),
    reviewDisposition: z.enum(['Active', 'NoAction']).optional(),
    latestReview: assessmentReviewSchema.nullable().optional(),
    sourceInputHash: z.string().optional(),
    documentGroundingHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    reevaluation: z
      .object({
        runId: z.uuid(),
        sourceAssessmentId: z.string().min(1),
        requestedBy: z.string().min(1),
        requestedAt: z.iso.datetime(),
        reason: z.string().min(1).max(500),
      })
      .strict()
      .optional(),
    workflowPolicyVersion: z.string().optional(),
    workflowPolicyHash: z.string().optional(),
    impactNarrativeVersion: z.string().optional(),
    eventVersionId: z.string(),
    workloadId: z.string(),
    createdAt: z.iso.datetime(),
    asOf: dateSchema,
    event: eventSchema,
    resources: z.array(resourceSchema),
    scopeComplete: z.boolean(),
    modelInvocations: z.array(modelInvocationSchema).optional(),
    impactDiscoveryOutcome: impactDiscoveryOutcomeSchema.optional(),
    discoveryScope: z
      .object({
        subscriptionIds: z.array(z.uuid()),
        resourceTypes: z.array(z.string()),
        profileIds: z.array(z.string()),
        profileRegistryVersion: z.string(),
        resourceCount: z.number().int().nonnegative(),
        scopeComplete: z.boolean(),
        failureDetails: z.array(discoveryFailureSchema).optional(),
      })
      .strict()
      .optional(),
    humanReviewRequired: z.boolean().optional(),
    criticalWorkload: z.boolean(),
    missingInformation: z.array(z.string()),
    decision: decisionSchema,
    humanContext: correctionSchema
      .extend({
        reviewerId: z.string(),
        reviewedAt: z.iso.datetime(),
        reviewEvidenceIds: z.array(z.string()).optional(),
      })
      .optional(),
    effectivePriority: prioritySchema.nullable(),
    reviewReasons: z.array(z.string()),
    explanation: explanationSchema,
    workItems: z.array(workItemSchema),
    validationErrors: z.array(z.string()),
    packageHash: z.string(),
  })
  .strict()
export const decisionReevaluationRunSchema = z
  .object({
    runId: z.uuid(),
    assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['Pending', 'Queued', 'Processing', 'Completed', 'Failed']),
    requestedBy: z.string().min(1),
    requestedAt: z.iso.datetime(),
    reason: z.string().min(1).max(500),
    resultAssessmentId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    error: z
      .enum([
        'StaleAssessment',
        'MissingSnapshot',
        'ModelUnavailable',
        'DailyLimit',
        'ProcessingFailed',
      ])
      .nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
export type LifecycleEvent = z.infer<typeof eventSchema>
export type ResourceImpact = z.infer<typeof resourceSchema>
export type Evidence = z.infer<typeof evidenceSchema>
export type BusinessContext = z.infer<typeof businessContextSchema>
export type DocumentSource = z.infer<typeof documentSourceSchema>
export type SharePointSnapshot = z.infer<typeof sharePointSnapshotSchema>
export type SharePointSyncRun = z.infer<typeof sharePointSyncRunSchema>
export type DocumentRevision = z.infer<typeof documentRevisionSchema>
export type DocumentTextBlock = z.infer<typeof documentTextBlockSchema>
export type DocumentText = z.infer<typeof documentTextSchema>
export type DocumentFact = z.infer<typeof documentFactSchema>
export type DocumentFactProposal = z.infer<typeof documentFactProposalSchema>
export type DocumentGrounding = z.infer<typeof documentGroundingSchema>
export type SampleDocumentImpactEvaluation = z.infer<
  typeof sampleDocumentImpactEvaluationSchema
>
export type DiscoveryFailure = z.infer<typeof discoveryFailureSchema>
export type DiscoveryFailureSource = DiscoveryFailure['source']
export type ModelInvocation = z.infer<typeof modelInvocationSchema>
export type Decision = z.infer<typeof decisionSchema>
export type Explanation = z.infer<typeof explanationSchema>
export type WorkItem = z.infer<typeof workItemSchema>
export type Assessment = z.infer<typeof assessmentSchema>
export type DecisionReevaluationRun = z.infer<
  typeof decisionReevaluationRunSchema
>
export type Approval = z.infer<typeof approvalSchema>
export type Impact = z.infer<typeof impactSchema>
export type Priority = z.infer<typeof prioritySchema>
export type Correction = z.infer<typeof correctionSchema>

const microsoftEvidenceHosts = ['aka.ms', 'azure.com', 'microsoft.com']
function isTrustedMicrosoftEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      microsoftEvidenceHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

/**
 * Validates that translation is limited to persisted Microsoft evidence.
 * Service Health has no page-specific URL, so bind it to the normalized event
 * and evidence lineage instead of inventing a URL.
 */
export function isTranslatableOfficialEvidence(
  event: LifecycleEvent,
  evidence: Evidence,
): boolean {
  const stored = event.evidence.find((item) => item.id === evidence.id)
  if (
    !stored ||
    stored.sourceType !== 'Microsoft' ||
    evidence.sourceType !== stored.sourceType ||
    evidence.fact !== stored.fact ||
    evidence.sourceVersion !== stored.sourceVersion ||
    evidence.officialUrl !== stored.officialUrl ||
    evidence.observedAt !== stored.observedAt ||
    JSON.stringify(evidence.subjectIds) !== JSON.stringify(stored.subjectIds)
  )
    return false

  if (stored.officialUrl !== null)
    return isTrustedMicrosoftEvidenceUrl(stored.officialUrl)

  return (
    event.source === 'ServiceHealth' &&
    stored.sourceVersion === event.contentHash &&
    stored.subjectIds.length === 1 &&
    stored.subjectIds[0] === event.id
  )
}

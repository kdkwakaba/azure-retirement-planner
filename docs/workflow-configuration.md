# Organization-specific workflow configuration

The application loads `config/workflow-policy.json` at runtime and validates it against a schema. The policy version and canonical hash are included in assessments. Changes require validation and a new assessment; previous approvals are not silently transferred.

## Supported configuration

- Team and department roles and candidate assignment rules for work categories, resource types, environment, and impact.
- Coordination roles and approval-stage descriptions.
- Task categories, required/recommended status, completion criteria, and dependency ordering.
- Explicit workload business-context records with source, record ID, update time, and confirmation metadata.

Rules return candidate teams; they do not assert that a team is the confirmed owner. Multiple candidates are retained. Missing or conflicting assignments, missing prerequisites, and dependency cycles require human attention. A configured approval path is descriptive: it does not create or enforce additional API roles.

## Current configuration

The checked-in policy contains generic infrastructure, application, and information-systems role labels and category-based assignment rules. It has no workload-specific business profiles, task templates, confirmed owners, approval durations, blackout windows, or criticality records. These labels are routing suggestions, not verified organization structure or identity assignments.

The API also supports Governance-managed business-context records. Records are versioned and tied to a workload and source reference. This is a controlled manual data-entry API; it is not an automatic CMDB or ServiceNow connector. The current review interface does not provide a general business-context authoring console.

## Change process

1. Propose changes to the JSON policy in a pull request.
2. Run schema, role-reference, matching-rule, duplicate, and dependency-cycle validation.
3. Have the policy owner and affected workload owner review assignments and approval descriptions.
4. Record the approved policy version and hash, then re-evaluate affected assessments.
5. Confirm that the new version does not inherit approvals from an older assessment.

Do not put credentials, personal data, or unverified business facts in the policy. Use role identifiers rather than individual names. Do not add arbitrary code or model-generated teams to the configuration.

## Task and coordination behavior

The policy can propose customer communication, cross-team coordination, vendor assessment, cost assessment, budget approval, contract review, documentation, and CMDB update work when an explicitly confirmed condition applies. It does not infer vendor use, cost, a contract obligation, or a required migration without evidence. `Required` is reserved for a supported, adopted response; uncertain checks remain `Recommended`.

The interface may display the information-systems department as an initial coordination route, the workload owner as the business decision role, and governance as the policy/exception role. These are recommended responsibilities and do not establish a real assigned user or change API authorization.

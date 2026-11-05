# User guide

The review interface is hosted by the assessment API and requires Entra authentication and an assigned application role. The API enforces the same role checks as the interface.

## Roles

| Role | Typical access |
|---|---|
| Reader | Read assessments, evidence, status, and configured sources |
| Reviewer | Correct assessment details and review or approve work |
| Operator | Start synchronization and view processing status |
| Governance | Manage SharePoint sources and facts, start synchronization, correct and review assessments |
| NotificationSender | Application-only access to the configured notice endpoint |

Role assignments are configured by the deploying organization. A role name shown in a policy does not assign an identity or grant API access.

## Open the application and synchronize

1. Open the application URL supplied by your administrator and sign in with your organization account.
2. Confirm that the displayed role grants the operation you need.
3. Use **Azure情報を取得・評価** to retrieve notices and Azure configuration and create assessments. This reads the configured Azure scopes; it does not modify assessed resources.
4. When processing is asynchronous, wait for the queue to finish and use **評価結果を更新** to reload the list.
5. A partially failed source is shown with its retrieval status. An empty list is not proof that no applicable resource exists.

## Read an assessment

Select a notice to view its event/version, workload, assessment date, official deadlines, candidate resources, two impact axes, priority, model invocation status, evidence, missing information, and proposed work.

Resource classification answers whether an Azure resource may match the notice. Impact answers what could happen to the business. The two are separate. `Unknown` means the available evidence cannot establish a result; it does not mean unaffected. `Verification Required` should provide a concrete missing fact and confirmation task.

Decision score distributions are model-provided ordinal outputs, not calibrated probabilities or accuracy. When highest categories tie, the interface can display all tied categories. Read the explanation, rule constraints, evidence, and uncertainty together.

Microsoft official evidence shows its source URL when one is available and validated. Some Service Health notices have no separate public page URL; the application does not invent one. Translations are reference translations and do not replace official text.

## Correct assessment facts

Reviewer or Governance can open **業務影響・公式期限・計画を確認／訂正する** and create a new assessment version. Record the source and reason for each correction. Keep deprecation start, creation stop, end-of-support, retirement, and migration deadlines separate. If a date, workload owner, impact, or task duration cannot be supported, leave it unresolved and record what information is required.

The previous assessment and its evidence remain in history. A material correction invalidates approvals that no longer apply.

## Review work and mark no action

In **作業案・部分承認**, check each item's purpose, category, required/recommended status, resource scope, team candidates, schedule status, dependencies, and completion criteria. `Required` does not mean that an uncertain migration is mandatory; confirmation work and migration work are distinct.

To approve work:

1. Select only the work that can proceed.
2. Enter the decision reason and evidence.
3. Choose **選択した作業を承認**.

The approval is bound to the displayed assessment version and hash. It is not authorization to change Azure.

To defer work, enter a reason and choose **保留**. To return a decision for correction, enter the reason and choose **差し戻し**. To hide an assessment because no work is required, enter the scope and evidence and choose **対応不要として一覧から外す**. The original notice and review history remain stored; the action does not delete an Azure resource or close a GitHub issue.

## SharePoint sources

The SharePoint administration panel is collapsed near the bottom of the page. Governance users can register a folder source, start document extraction, and review fact proposals. Operators or Governance users can synchronize sources, depending on the deployment role policy.

Synchronization stores document snapshots but does not by itself make extracted statements trusted. A Governance user must verify the source location, edit or exclude inaccurate proposals, confirm facts, and explicitly link resource dependencies. Confirmed live-source facts can then inform a later assessment for the same workload.

For site, drive, and folder IDs, Graph access, and deployment settings, see the [SharePoint connection guide](sharepoint-connection-guide.md).

## GitHub export

The maintained deployment enables work-item export. Export still requires a current approved assessment, valid GitHub configuration, and a usable credential. Issue creation and Project item updates are distinct stages; a partial result must be reconciled before retrying. Project progress synchronization is disabled in the maintained deployment.

The exporter creates or updates only the approved work items represented by the current version. It does not change Azure. A GitHub issue being closed does not by itself mark the Planner assessment complete.

## Troubleshooting

| Situation | Check |
|---|---|
| Application asks you to sign in again | Sign in through the supplied application URL, then return to the assessment page. |
| Assessment list is empty | Check sign-in and role, whether Azure synchronization has completed, selected date/scope, and source retrieval status. |
| Results are missing after synchronization | Wait for queue processing and refresh the list. Ask an Operator or Governance user to inspect the run status. |
| `Unknown` or `Abstained` | Read the classification reason, missing attribute, evidence, model invocation status, and confirmation task. Do not force a value without evidence. |
| `No resources found` | Check scope, profile coverage, and discovery completeness. The result is not a business-impact or no-action decision. |
| Explanation is unavailable | Read the model invocation state. The system does not fill a failed explanation with a fixed template; the separate general lifecycle narrative may still be present. |
| Correction or approval is rejected | Confirm the role, required reason/evidence, current assessment version, selected work IDs, and validation errors. Refresh if the assessment has changed. |
| GitHub export is partial or fails | Check the recorded export stage and safe failure category. Reconcile an issue created before a Project update failed before retrying. |
| A SharePoint file is not available | Check the selected site/drive/folder, Graph permission and site grant, allowed extension, file limits, and synchronization status. |

Record operational issues with time, operation, assessment or correlation ID, safe error category, and outcome. Do not include credentials, tokens, full resource IDs, or source documents in public issues.

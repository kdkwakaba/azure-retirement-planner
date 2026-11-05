# SharePoint documents and workload impact

The application can read configured SharePoint folders, extract structured fact proposals from DOCX/XLSX files, and use human-confirmed facts as workload-scoped evidence. This is an application-managed Microsoft Graph integration; SharePoint is not connected as a Foundry data source.

## Current flow

1. A Governance user registers a source with tenant, site, drive, folder item, workload, allowed file extensions, source class, and configuration version.
2. An Operator or Governance user starts synchronization when the SharePoint sync setting is enabled.
3. The API enumerates the configured folder and descendants, downloads allowed documents, and stores immutable source versions and snapshots.
4. A Governance user requests extraction for a selected document. Extracted statements include source location and content hashes.
5. The reviewer edits, confirms, or excludes each proposal. Reviewer identity and time are stored with a new immutable grounding version.
6. The reviewer explicitly links related facts and links resource-dependency facts to Azure resources present in the selected assessment. The API validates workload, evidence, resource, and dependency graph constraints.
7. Confirmed live-source facts can be included in later assessments for the same workload. A change in source, confirmed facts, or dependency links creates a new assessment input version. Synthetic-source facts remain isolated.

## Files and limits

- Supported extensions: `.docx` and `.xlsx`.
- Folder traversal depth: up to 8 levels; listing: up to 2,000 items.
- Snapshot limit: up to 100 documents, 10 MiB per document, and 50 MiB total.
- Extracted text: up to 200,000 characters per document; spreadsheets: up to 20,000 cells.
- Fact extraction is divided into batches of at most 1,500 input characters, at most 60 blocks and 134 batches. Each model call uses the shared daily call limit and is bounded to 1,000 completion tokens and 5 proposals per batch.
- A 429 response is retried once with the provider's `Retry-After` value. If limits are exceeded or extraction fails, the document is not treated as fully assessed.

The UI presents SharePoint administration at the bottom of the page inside a collapsed panel. Source setup and fact review are limited to Governance; synchronization is limited to Operator or Governance. The interface can register one source per source class (live or synthetic). Each source refers to one folder and may include descendants.

## Access boundary

The API Managed Identity needs Microsoft Graph application permission `Sites.Selected` and a separate `read` grant on the target site. The permission assignment can be managed through the dedicated Graph Bicep bootstrap template. The site-level grant is a separate administrative step; it is not Azure RBAC and is not part of routine application deployment.

A site-level grant covers the whole site even though the application source points to one folder. Do not use a site containing documents the application should not read. Use a dedicated site or separately verify a narrower Graph permission model. The application does not follow arbitrary links found in documents.

## Assessment trust rules

- An extracted statement is a proposal, not a confirmed fact.
- A document's claim of a resource name or usage does not prove that the resource currently exists or is used.
- Only Governance-confirmed facts and explicitly reviewed dependency paths can become assessment evidence.
- Each claim retains a source, document revision, content hash, location, reviewer, and confirmation time.
- Ambiguous names are not automatically resolved. Resource links must refer to resources in the selected assessment.
- A source mode is explicit. Synthetic-source data cannot be used by ordinary live assessments; live-source data is accepted only when test mode is disabled and the live-source feature is enabled.
- Turning test mode off hides isolated records from ordinary assessment lists; it does not delete stored records.

## Current limitations

- Site, drive, and folder identifiers must be obtained and entered by an administrator; the application does not resolve a URL to those identifiers.
- Source configuration is folder-based and limited to one source per data class. Multi-folder discovery and cross-source precedence/conflict resolution are not implemented.
- DOCX/XLSX extraction records paragraph, sheet, and cell provenance within the extractor's supported structures; it does not guarantee perfect layout or table interpretation.
- Extraction quality, fact correctness, and business-impact accuracy depend on source document quality and human review. Schema validity is not semantic correctness.
- The integration reads documents; it does not write back to SharePoint or synchronize a CMDB/ServiceNow system.

See the [SharePoint connection guide](sharepoint-connection-guide.md) for ID discovery, access setup, and operation.

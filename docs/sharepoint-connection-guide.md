# SharePoint Folder接続ガイド

このガイドでは、SharePoint文書FolderをSourceとして設定する手順を説明します。Source RecordにはTenant、Site、Drive、Folder Item、Workload、許可拡張子、設定版を保存します。実IDやURLをRepositoryへコミットしないでください。

Azure構築からSharePoint Live Source、評価確認までの全体順は[構築・SharePoint評価ガイド](deployment-and-sharepoint-evaluation.md)を参照してください。

## 前提条件

- 対象Siteの読み取りをAPI Managed Identityに許可できるSharePoint管理者またはSite Owner。
- Siteを閲覧でき、ID取得に必要な委任Permissionへ同意できるMicrosoft Graph Explorer利用者。
- API Function AppのSystem-assigned Managed IdentityとClient ID／App ID。
- Applicationが読んでよい文書だけを含むFolder。Graph許可はFolder設定時もSite範囲。
- DOCXまたはXLSX文書。File／文章上限は[SharePoint連携](sharepoint-document-impact-plan.md)を参照。

## 1. Site IDを取得

Graph Explorerで対象Siteを閲覧できるアカウントにサインインする。SiteのHostnameとServer-relative Pathで照会する。

~~~http
GET https://graph.microsoft.com/v1.0/sites/{hostname}:/{server-relative-path}?$select=id,displayName,webUrl
~~~

例：https://contoso.sharepoint.com/sites/Architectureなら、Hostnameはcontoso.sharepoint.com、Pathはsites/Architectureです。応答のid全体を保存します。Site IDはhostname,guid,guid形式の場合があります。

## 2. Drive IDを取得

Site内のDocument Libraryを列挙します。

~~~http
GET https://graph.microsoft.com/v1.0/sites/{Site ID}/drives?$select=id,name,webUrl,driveType
~~~

対象Folderを含むLibraryをnameとwebUrlで選び、id全体を保存します。List IDをDrive IDの代わりにしないでください。/sites/{Site ID}/driveは既定Libraryだけを返します。

## 3. Folder Item IDと内容を確認

選択したLibrary Rootからの相対Pathを使います。

~~~http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/root:/{folder-path}?$select=id,name,folder,webUrl
~~~

id全体を保存し、応答にfolderが含まれることを確認します。続いて配下を照会します。

~~~http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/items/{Folder Item ID}/children?$select=id,name,folder,file,size,webUrl
~~~

応答にSource対象の想定File／Folderが表示されることを確認します。list IDはdrive IDやfolder item IDとは別のIDです。

## 4. ID取得エラーの切り分け

| 結果 | 確認事項 |
|---|---|
| 403 | Graph Explorerの委任Permissionと利用者のSite閲覧権限を確認。Global Administrator RoleだけではSite本文を閲覧できない |
| itemNotFound／“The specified list was not found” | 完全なDrive IDを/sites/{Site ID}/drivesから取得したか確認。SharePoint List IDを渡さない |
| /drivesが200でvalueが空 | Site IDとサインイン利用者のSite権限を確認。既定DriveとList Metadataを調べてもList IDをDrive IDとして使わない |
| Folder照会が404 | PathがLibrary Rootからの相対Pathか、選択DriveのwebUrlと合っているか確認 |

診断共有に含める情報はHTTP Status、Tokenを除いたRequest URL、error.code、error.messageだけにします。Bearer Tokenや文書本文は共有しないでください。

## 5. Applicationアクセス許可

Graph Explorerにサインインした利用者はApplicationの同期Identityではありません。同期はAPI Function AppのSystem-assigned Managed Identityで実行します。

### Graph Application Permission

専用のinfra/bootstrap/sharepoint/permissions.bicepが、API Managed IdentityへGraph Sites.Selected Application Permissionを割り当てます。通常Releaseと分離して権限付きBootstrapを実行します。Microsoft Graph Application Role割当に必要な権限を持つ担当者が操作してください。Runtime Identityや通常GitHub配置Identityにこの権限を与えないでください。

Deployment出力からAPI Principal IDを取得し、Client IDを解決してTemplateをPlanner Resource Groupへ適用します。

~~~powershell
$resourceGroup = '<PLANNER_RESOURCE_GROUP>'
$apiPrincipalId = az deployment group show --resource-group $resourceGroup --name arp-release --query properties.outputs.apiPrincipalId.value --output tsv
$apiClientId = az ad sp show --id $apiPrincipalId --query appId --output tsv

az deployment group what-if --resource-group $resourceGroup --template-file infra/bootstrap/sharepoint/permissions.bicep --parameters apiPrincipalId=$apiPrincipalId

# What-If確認後、同じTemplateとParameterで適用する
az deployment group create --resource-group $resourceGroup --template-file infra/bootstrap/sharepoint/permissions.bicep --parameters apiPrincipalId=$apiPrincipalId
~~~

apiPrincipalIdはManaged IdentityのObject／Principal ID、apiClientIdはApplication／Client IDです。Site許可にはClient IDを使います。

### Site単位のread許可

RepositoryのGraph Bicep拡張はApp Role Assignmentを管理しますが、選択Siteへのread許可は別の管理作業です。操作する利用者に適切なMicrosoft Graph PermissionとSite管理権限が必要です。

1. 現在の許可を確認します。

~~~http
GET https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions
~~~

2. API Managed Identityにreadがない場合、次の許可を作成します。

~~~http
POST https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions
Content-Type: application/json
~~~

~~~json
{
  "roles": ["read"],
  "grantedToIdentities": [
    {
      "application": {
        "id": "<API Managed Identity Client ID>",
        "displayName": "<API Function App name>"
      }
    }
  ]
}
~~~

3. 応答が201 Createdでroles: ["read"]であることを確認します。API Managed IdentityにSites.FullControl.Allを付与しないでください。Site許可の作成に必要な強いPermissionは、この一度の作業を行う管理者だけが使います。

## 6. Sourceを有効化・設定

SharePoint Featureは配置VariableとBicepで設定します。未設定値の既定はfalseです。

| Repository Variable | Live文書利用時の値 |
|---|---|
| ARP_TEST_MODE_ENABLED | false |
| ARP_SHAREPOINT_SYNC_ENABLED | true |
| ARP_SHAREPOINT_LIVE_SOURCES_ENABLED | true |
| ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED | Fact候補抽出時はtrue。同期だけならfalse |

Repositoryのレビュー済みDeployment WorkflowでVariableを反映します。deploy.ymlをphase=planで実行してWhat-Ifを確認し、同じ成功済みmain CI Runと確認済みPlan Hashでphase=applyを実行します。Azure PortalからFunction App設定を直接変更しないでください。次の配置で上書きされる場合があります。

認証済み画面でGovernance利用者が折り畳まれたSharePoint Sectionを開き、完全なSite ID、Drive ID、Folder Item ID、Workload ID、重複しないSource ID、新しい設定版を登録します。Live ModeではSource区分がLive（sampleOnly: false）である必要があります。OperatorまたはGovernanceが同期を開始します。Source一覧と同期状態で成功と取得文書を確認できます。

同期は読み取りとDocument Snapshot保存だけです。抽出文を自動で確認済みEvidenceにはしません。Governance利用者がFact候補を抽出し、内容を確認します。確認済みLive Source Factは同一Workloadの後続Assessmentに利用できます。

## Data区分と有効条件

1つのInstallationではLiveまたはSyntheticのSourceをそれぞれ登録できますが、同時処理できません。Synthetic Sourceの処理にはTest Modeが必要です。Live SourceはTest Mode無効とLive Source Setting有効が必要です。Fact抽出にはFact Extraction Settingも必要です。Test Modeを無効にすると合成Recordは通常一覧から隠れますが、保存Recordは削除されません。

## Microsoft公式資料

- [PathによるSharePoint Site取得](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0)
- [Site内Driveの一覧](https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0)
- [Drive Itemの配下一覧](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)
- [Selected Permission概要](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [Microsoft Graph Bicep Template](https://learn.microsoft.com/en-us/graph/templates/bicep/overview-bicep-templates-for-graph)
- [Site Permission作成](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0)

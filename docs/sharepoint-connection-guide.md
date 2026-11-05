# SharePointサンプルフォルダ接続手順

SharePoint上の専用サンプルフォルダをAzure Retirement Plannerへ登録し、読み取り同期を確認する手順。ここで取得したIDは利用者のGraph Explorerで調べる値であり、アプリのManaged Identityへ付与する権限とは別に扱う。

## 先に確認すること

- テストには専用のサンプルフォルダを使う。現行アプリはSourceを`sampleOnly: true`として登録し、サンプルの事実を通常の実環境評価へ流さない。
- `.docx`／`.xlsx`が同期対象。制限は1ファイル10 MiB、合計50 MiB、1 Snapshotあたり100ファイル。
- Source登録画面にはサイトURLを入れる欄はない。Site ID、Drive ID、Folder Item IDを事前に取得する。
- グローバル管理者であってもSharePointサイトの本文を自動的に読めるとは限らない。Graph Explorerの要求権限と、サインインした利用者のサイト権限を別々に確認する。
- SharePointサイトのSite ID等はテナント固有情報であるため、Gitに記録せず、承認済みの管理場所へ保管する。

## 1. Graph ExplorerでIDを取得

Graph Explorerへ、テストフォルダを閲覧できる職場アカウントでサインインする。要求を実行して403になる場合は、Graph Explorerの「Modify permissions」でその要求に必要な委任アクセス許可を確認し、`Sites.Read.All`への同意を行ってから再実行する。テナントが利用者の同意を制限している場合は管理者に同意を依頼する。Microsoft Graphのサイト取得・Drive一覧は、職場アカウントの委任アクセスでは`Sites.Read.All`等が必要になる。

### 1.1 Site ID

サイトURLのホスト名とサイト相対パスを使い、次を実行する。

```http
GET https://graph.microsoft.com/v1.0/sites/{hostname}:/{server-relative-path}?$select=id,displayName,webUrl
```

例：`https://contoso.sharepoint.com/sites/RetirementTest`の場合、`{hostname}`は`contoso.sharepoint.com`、`{server-relative-path}`は`sites/RetirementTest`。

応答の`id`全体をSite IDとして保存する。通常、`hostname,guid,guid`の形式で返る。末尾GUIDだけを切り出さない。

### 1.2 Drive ID（ドキュメントライブラリ）

取得したSite IDを使い、サイト配下のDriveを列挙する。

```http
GET https://graph.microsoft.com/v1.0/sites/{Site ID}/drives?$select=id,name,webUrl,driveType
```

応答の`value`から、テストフォルダを含むライブラリを`name`と`webUrl`で特定し、その項目の`id`全体をDrive IDとして保存する。サイトには複数のドキュメントライブラリがある場合があるため、名前だけで決めず`webUrl`も確認する。

`/sites/{Site ID}/drive`はサイトの既定ライブラリだけを返す。独自ライブラリの場合も含め、まず`/drives`の一覧を使う。`/lists`で返るリストIDはDrive IDではない。`/lists/{list-id}/drive`へ置き換えて取得しない。

### 1.3 Folder Item ID

Drive IDと、ライブラリのルートからテストフォルダまでのパスを指定する。

```http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/root:/{folder-path}?$select=id,name,folder,webUrl
```

例：ライブラリ直下の`RetirementTest`なら`{folder-path}`は`RetirementTest`。`General/RetirementTest`配下なら`General/RetirementTest`。空白などの文字はURLエンコードする。応答の`id`全体がFolder Item ID。`folder`が応答に含まれることも確認する。

### 1.4 IDの照合

Folder Item IDを取得したDriveと同じDrive IDを使い、直下の項目を確認する。

```http
GET https://graph.microsoft.com/v1.0/drives/{Drive ID}/items/{Folder Item ID}/children?$select=id,name,folder,file,size,webUrl
```

テストフォルダ内の想定ファイル／サブフォルダが表示されれば、Site／Drive／Folderの組合せを確認できた。Graphの`driveItem`はファイルまたはフォルダを表す。

## 2. ID取得時のエラーを切り分け

| 結果 | 確認すること |
|---|---|
| 403 | Graph Explorerに必要な委任アクセス許可が付与・同意済みか確認。さらに、サインイン利用者が対象サイトを閲覧できるか確認する。Global Administratorロールだけではサイト本文への自動アクセスにならない。 |
| `itemNotFound`／「The specified list was not found」 | 要求にリストIDをDrive IDとして渡していないか確認。`/sites/{Site ID}/drives`から得たDrive IDを使い、`/lists/{list-id}/drive`形式は使わない。 |
| `/drives`が`200`で`value: []` | Graph Explorerの要求URL・HTTPステータス・完全な応答を確認。`/sites/{Site ID}/drive`で既定ライブラリを照会し、併せて`/sites/{Site ID}/lists?$select=id,name,displayName,webUrl,list`で`list.template`が`documentLibrary`のライブラリを確認する。リストIDをDrive IDへ流用しない。 |
| Folder lookupが404 | パスがライブラリのルート相対か確認。選んだDriveの`webUrl`と実際のライブラリ・フォルダ階層を照合する。 |

診断を共有するときはHTTPステータス、要求URL、`error.code`、`error.message`だけを含め、アクセストークンやファイル本文は含めない。

## 3. API FunctionのManaged Identityにサイト読取を許可

ID検索に使ったGraph Explorerの利用者権限は、アプリの権限には引き継がれない。同期時の接続主体はAPI Function Appの**システム割り当てManaged Identity**。

### 3.1 Graphアプリケーション権限はBicepで管理

Microsoft Graph Bicep拡張の`infra/bootstrap/sharepoint/permissions.bicep`が、API Managed IdentityへGraphの**Application permission** `Sites.Selected`を割り当てる。デプロイ担当者はMicrosoft Graph上のアプリロール割当てを管理できる権限が必要。この特権はAPI実行Identityや通常のGitHub CDへ付けない。

PowerShellでARP本体のResource Group名を設定し、APIのPrincipal/Object IDを出力から取得する。続けて、既存Resource Groupをスコープに専用Bootstrap Bicepを実行する。

```powershell
$resourceGroup = '<ARP_RESOURCE_GROUP>'
$apiPrincipalId = az deployment group show `
  --resource-group $resourceGroup `
  --name arp-release `
  --query properties.outputs.apiPrincipalId.value `
  --output tsv

if (-not $apiPrincipalId) {
  throw 'API Managed IdentityのPrincipal IDを取得できません。'
}

$apiClientId = az ad sp show `
  --id $apiPrincipalId `
  --query appId `
  --output tsv

if (-not $apiClientId) {
  throw 'API Managed IdentityのClient IDを取得できません。'
}

az deployment group create `
  --resource-group $resourceGroup `
  --name arp-sharepoint-graph-permissions `
  --template-file infra/bootstrap/sharepoint/permissions.bicep `
  --parameters apiPrincipalId=$apiPrincipalId
```

このGraph拡張の実行には、Microsoft Graphの`AppRoleAssignment.ReadWrite.All`と`Application.Read.All`が必要。Microsoft GraphなどMicrosoftファーストパーティへの権限付与には`Privileged Role Administrator`が必要とされる。Microsoft Graphのアプリ権限割当ては強い権限操作なので、特権管理者がこの専用Bootstrapとして実行する。Microsoft Graph Bicep拡張はGraphリソースを宣言管理する仕組みで、通常のAzure RBACとは別に認証・認可される。

### 3.2 対象サイトの`read`許可は管理者が一度設定

現行Microsoft Graph Bicep拡張のリソース一覧にはSharePointサイト権限がないため、この許可はGraph Explorerで一度だけ設定する。サイト許可作成APIではGraphの`Sites.FullControl.All`が必要。委任アクセスでは実行ユーザーが管理者ロールを持ち、対象サイトのメンバーである必要がある。API実行Identityにはこの権限を付与しない。

1. 上のコマンドで得た`$apiClientId`を控える。これはサイト許可の`application.id`に使うClient ID/App ID。Bicepへ渡した`$apiPrincipalId`はObject IDなので取り違えない。
2. Graph Explorerに、対象サイトのメンバーであるSharePoint／Global Administratorでサインインする。
3. 先に`GET https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions`を実行して、API Managed Identityへの許可が既にあるか確認する。既に`read`があれば再作成しない。
4. Graph Explorerの「Modify permissions」で委任アクセス許可`Sites.FullControl.All`を確認し、管理者同意する。テナントの同意ポリシーで自分で同意できない場合は、管理者手続きでGraph Explorerへ同意する。
5. 次を`POST`し、Bodyに示すJSONを設定する。`application.id`にはAPI Managed Identityの**Client ID/App ID**を指定する。

   ```http
   POST https://graph.microsoft.com/v1.0/sites/{Site ID}/permissions
   Content-Type: application/json
   ```

   ```json
   {
     "roles": ["read"],
     "grantedToIdentities": [
       {
         "application": {
           "id": "<API Managed IdentityのClient ID/App ID>",
           "displayName": "<API Function App名>"
         }
       }
     ]
   }
   ```

6. 応答が`201 Created`で`roles: ["read"]`となることを確認する。

`Sites.Selected`のBicep同意だけでは対象サイトを読めない。Bicepのアプリ権限割当てと、このサイト個別許可の両方が必要。サイト単位で`read`を付与するとGraph上の認可範囲はサイトであり、アプリが同期するフォルダを指定してもGraph権限自体はフォルダ単位には狭まらない。テストフォルダの同じサイトに他の機密文書がある場合は、専用サイトを使うか、フォルダ／ライブラリ単位権限のサポートを別途確認する。

## 4. 同期機能を有効化

Bicepパラメーターは次のとおり。

| Bicepパラメーター | アプリ設定 | 接続確認での値 |
|---|---|---|
| `sharePointSyncEnabled` | `SHAREPOINT_SYNC_ENABLED` | `true` |
| `sharePointFactExtractionEnabled` | `SHAREPOINT_FACT_EXTRACTION_ENABLED` | `false` |
| `sharePointLiveSourcesEnabled` | `SHAREPOINT_LIVE_SOURCES_ENABLED` | `false` |

接続確認ではフォルダ同期だけを有効にし、モデルを使う事実抽出は無効のままにする。`infra/environments/poc.bicepparam`は次のRepository VariablesをBicepパラメーターへ変換し、手動CDのWhat-IfとApplyの両方で同じ設定を使う。値が未設定の場合は安全側の`false`となる。

GitHub Repository Variablesへ次を設定し、Manual PoC deploymentを`plan`→What-If確認→`apply`の順に実行する。`apply`では計画と同じ成功済みmain CI runを指定し、`infrastructure_only=true`にする。これでBicep app settingsだけを反映し、Functionパッケージは再配置しない。

| Repository Variable | 接続確認値 |
|---|---|
| `ARP_SHAREPOINT_SYNC_ENABLED` | `true` |
| `ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED` | `false` |
| `ARP_SHAREPOINT_LIVE_SOURCES_ENABLED` | `false` |

両Variableが未設定なら`false`として扱う。したがって接続確認時は同期のみを明示的に有効化する。

GraphのApplication permission／SharePointサイト個別許可はAzure RBACとは別。`Sites.Selected`は専用Bicep Bootstrapで管理し、サイト個別許可だけを通常CDから分離した管理者手順で設定する。

## 5. アプリでSourceを登録して同期

1. Governance権限で「SharePointフォルダ」を開く。
2. 次を入力して「Source設定を保存」する。
   - Source ID：登録済みSourceと重複しない識別子
   - 表示名：利用者が見て分かる名前
   - Site ID、Drive ID、Folder Item ID：上記Graph応答の各`id`全体
   - Workload ID：アプリに登録済みの対象Workload ID
   - 設定版：この設定の版識別子
3. OperatorまたはGovernance権限で「SharePointから同期」を実行する。
4. 同期Runが`Succeeded`となり、Snapshotに想定文書が入ることを確認する。

同期対象は`.docx`／`.xlsx`で、指定フォルダ配下のサブフォルダも含みます。同期成功は文書取得の確認であり、事実抽出や業務影響評価の品質確認とは別です。

### テスト用サンプルと実業務文書の切替

Sourceのデータ区分はアプリ設定から決まり、Source登録時に画面で変更できません。

- **サンプル検証**：`ARP_TEST_MODE_ENABLED=true`、`ARP_SHAREPOINT_SYNC_ENABLED=true`。抽出する場合は`ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED=true`。この間は`sampleOnly=true`だけが登録・同期・抽出・レビューでき、サンプル事実は通常の実通知評価に入りません。
- **実業務文書**：`ARP_TEST_MODE_ENABLED=false`、`ARP_SHAREPOINT_LIVE_SOURCES_ENABLED=true`、`ARP_SHAREPOINT_SYNC_ENABLED=true`。事実抽出には`ARP_SHAREPOINT_FACT_EXTRACTION_ENABLED=true`も必要です。この設定では`sampleOnly=false`のSourceだけを処理できます。Governanceが候補Factを内容と出典位置で確認して「確認済み」にした後、その事実が同一Workloadの通常Assessment入力に使われます。

テストモードと実業務モードは排他的です。実業務モードへ切り替えるとサンプルSourceの処理は停止します。切替はRepository Variablesを変更し、Manual PoC deploymentの`plan`でWhat-Ifを確認してから`apply`します。データ区分が混ざらないことを画面の表示とSource区分で確認してください。実業務フォルダを使う前に、API Managed Identityへ対象SharePoint Siteの`read`許可があることを確認してください。文書抽出は最大3バッチ、1バッチ12,000文字までです。超過文書は部分評価せず失敗として表示します。各バッチのモデル呼出は日次上限に計上されます。

## 参考

- [Microsoft GraphでSharePointサイトを扱う](https://learn.microsoft.com/en-us/graph/api/resources/sharepoint?view=graph-rest-1.0)
- [サイトをパスから取得](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0)
- [サイト配下のDriveを列挙](https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0)
- [サイト既定Driveを取得](https://learn.microsoft.com/en-us/graph/api/drive-get?view=graph-rest-1.0)
- [フォルダの子項目を一覧](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)
- [Selected権限の概要](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)
- [Microsoft Graph Bicep拡張](https://learn.microsoft.com/en-us/graph/templates/bicep/overview-bicep-templates-for-graph)
- [Graphアプリロール割当てのBicepリソース](https://learn.microsoft.com/en-us/graph/templates/bicep/reference/approleassignedto?view=graph-bicep-1.0)
- [サイト権限の作成APIと必要権限](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0)

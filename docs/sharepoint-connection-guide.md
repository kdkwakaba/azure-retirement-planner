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

1. `infra/main.bicep`のデプロイ出力`apiPrincipalId`、またはAPI Function AppのIdentity設定からAPI Managed IdentityのPrincipal/Object IDを確認する。
2. Entra管理者がMicrosoft Graphの**Application permission** `Sites.Selected`を当該Managed Identityへ付与し、管理者同意する。
3. 管理者の別の権限付き実行コンテキストから、対象サイトへ当該Managed Identityの**Client ID/App ID**を指定し、`read`ロールを付与する。権限付与に必要な強いGraph権限をアプリの実行Identityへ与えない。
4. 権限が伝播した後、アプリの同期を検証する。

`Sites.Selected`の同意だけでは対象サイトを読めない。選択したサイトへの個別許可も必要。サイト単位で`read`を付与するとGraph上の認可範囲はサイトであり、アプリが同期するフォルダを指定してもGraph権限自体はフォルダ単位には狭まらない。テストフォルダの同じサイトに他の機密文書がある場合は、専用サイトを使うか、フォルダ／ライブラリ単位権限のサポートを別途確認する。

## 4. 同期機能を有効化

Bicepパラメーターは次のとおり。

| Bicepパラメーター | アプリ設定 | 接続確認での値 |
|---|---|---|
| `sharePointSyncEnabled` | `SHAREPOINT_SYNC_ENABLED` | `true` |
| `sharePointFactExtractionEnabled` | `SHAREPOINT_FACT_EXTRACTION_ENABLED` | `false` |

接続確認ではフォルダ同期だけを有効にし、モデルを使う事実抽出は無効のままにする。**現行の`infra/environments/poc.bicepparam`と手動デプロイWorkflowではこの2つを指定できない。** そのままではBicep既定値`false`となり同期できない。Bicepの環境パラメーターと手動CD経路で同期フラグを渡せる変更をPRで行い、マージ後にレビュー済みの手動CDでデプロイする。Portal上の一時的な設定変更だけを恒久設定として扱わない。

GraphのApplication permission／SharePointサイト個別許可はAzure RBACとは別であり、現行Bicep Bootstrap／通常CDでは作成されない。管理者の手順で分離して管理する。

## 5. アプリでSourceを登録して同期

1. Governance権限で「SharePointサンプル設計書」を開く。
2. 次を入力して「Source設定を保存」する。
   - Source ID：登録済みSourceと重複しない識別子
   - 表示名：利用者が見て分かる名前
   - Site ID、Drive ID、Folder Item ID：上記Graph応答の各`id`全体
   - Workload ID：アプリに登録済みの対象Workload ID
   - 設定版：この設定の版識別子
3. OperatorまたはGovernance権限で「SharePointから同期」を実行する。
4. 同期Runが`Succeeded`となり、Snapshotに想定文書が入ることを確認する。

現行APIは対象をサンプルSourceに固定し、`.docx`／`.xlsx`のみを対象にする。Source作成APIはサブフォルダーを含む設定で登録する。同期成功は文書取得の確認であり、事実抽出や業務影響評価の品質確認とは別。

## 参考

- [Microsoft GraphでSharePointサイトを扱う](https://learn.microsoft.com/en-us/graph/api/resources/sharepoint?view=graph-rest-1.0)
- [サイトをパスから取得](https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0)
- [サイト配下のDriveを列挙](https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0)
- [サイト既定Driveを取得](https://learn.microsoft.com/en-us/graph/api/drive-get?view=graph-rest-1.0)
- [フォルダの子項目を一覧](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)
- [Selected権限の概要](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)

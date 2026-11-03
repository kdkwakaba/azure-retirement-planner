import type { ResourceImpact } from '@arp/contracts'

export function resourceVerificationReason(
  resource: Pick<
    ResourceImpact,
    | 'type'
    | 'classification'
    | 'classificationReason'
    | 'missingAttributes'
    | 'verificationRequired'
  >,
): string | null {
  const uncertainClassifications = [
    'Unknown',
    'Possible',
    'Verification Required',
  ]
  if (
    !resource.verificationRequired &&
    !uncertainClassifications.includes(resource.classification)
  )
    return null
  if (resource.missingAttributes.length)
    return `判定に必要なAzure属性「${resource.missingAttributes.join('、')}」を取得できていません。属性の実値を読み取り専用で確認してください。`

  switch (resource.classificationReason) {
    case 'RequiredAttributeMissing':
      return '判定に必要なAzure属性の不足が記録されていますが、属性名が評価結果にありません。対象リソースの構成を読み取り専用で確認してください。'
    case 'UsageRequiresVerification':
      return 'Azureの管理プレーン構成情報だけでは利用実態を判断できません。この評価では接続元アプリの設定、コード参照、実行状況の情報を取得していないため、対象Workloadでの利用有無を確認してください。'
    case 'NoApplicableProfile':
      return `この通知に対する「${resource.type}」の判定プロファイルがありません。公式通知の適用対象とリソース種別の対応を確認してください。`
    case 'NoMatchingProfileCondition':
      return '既知の判定プロファイル条件に一致した根拠がなく、影響対象か対象外か判断できません。未知の属性値だけで対象外にせず、公式条件と実構成を確認してください。'
    case 'DependencyEvidence':
      return '依存関係の根拠はありますが、このリソースが通知対象の機能を利用しているかは確定していません。依存元・依存先と利用機能を確認してください。'
    case 'ConflictingEvidence':
      return '影響対象を示す根拠と対象外を示す根拠が矛盾しています。根拠の適用範囲と対象リソースを照合してください。'
    case 'AssessmentPending':
      return 'このリソースの通知別評価が完了していません。対象範囲と判定プロファイルを確認してください。'
    case 'LegacyUnrecorded':
      return '旧評価記録のため分類理由が保存されていません。最新の構成情報と通知の適用条件を確認してください。'
    case 'ExplicitMicrosoftImpact':
      return 'Microsoft通知には対象として記載されていますが、この評価ではWorkloadでの実利用を示す情報を確認できていません。関連アプリの設定・コード・実行状況を確認してください。'
    case 'ProfileConditionMatched':
      return '既知のプロファイル条件には一致していますが、追加確認フラグが付いているため確定扱いできません。対象範囲と利用条件を確認してください。'
    case 'ExplicitExclusion':
      return '除外条件に一致していますが、追加確認フラグが付いている理由はこの評価結果に記録されていません。除外根拠と適用範囲を確認してください。'
  }
}

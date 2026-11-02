import type {
  Explanation,
  LifecycleEvent,
  ResourceImpact,
} from '@arp/contracts'

export const IMPACT_NARRATIVE_VERSION = '2026-11-02.1'

type ImpactNarrative = Explanation['impact'][number]

export function generalImpactNarratives(
  event: LifecycleEvent,
  resources: ResourceImpact[],
): ImpactNarrative[] {
  const evidenceIds = [
    ...new Set([
      ...event.evidence
        .filter((evidence) => evidence.sourceType === 'Microsoft')
        .map((evidence) => evidence.id),
      ...resources.flatMap((resource) => resource.evidenceIds),
    ]),
  ].filter((id) => event.evidence.some((evidence) => evidence.id === id))
  if (!evidenceIds.length) return []

  const lifecycleKind = event.kinds.includes('Retirement')
    ? 'Retirement'
    : event.kinds.includes('SupportEnded')
      ? 'SupportEnded'
      : event.kinds.includes('NewCreationBlocked')
        ? 'NewCreationBlocked'
        : event.kinds.includes('Deprecation')
          ? 'Deprecation'
          : 'Unknown'
  const unaddressedText = {
    Retirement:
      '通知の適用条件に該当するリソースが業務で利用されている場合、退役後はそのリソースが提供する機能を継続利用できなくなる可能性があります。その機能に依存する処理では、停止や代替手段への切替が必要になることがあります。個別の業務処理との対応情報がないため、処理名や影響範囲は特定していません。',
    SupportEnded:
      '通知の対象となるサービスやバージョンを利用し続ける場合、サポート終了後も直ちに停止するとは限りませんが、サポートや修正を受けられず、障害復旧やセキュリティ対応に影響する可能性があります。個別の業務処理との対応情報がないため、処理名や影響範囲は特定していません。',
    NewCreationBlocked:
      '通知の対象となる構成では、新規作成ができなくなり、拡張・再作成・災害復旧時に同じ構成を用意できない可能性があります。この通知だけでは既存リソースが直ちに停止するとは判断できません。個別の業務処理との対応情報がないため、影響する処理名は特定していません。',
    Deprecation:
      '通知の対象となる機能が非推奨になっても、直ちに停止するとは限りません。後続の退役やサポート終了までに対応できない場合、依存する処理の継続利用や保守に影響する可能性があります。通知に示されていない退役日や個別の業務処理は特定していません。',
    Unknown:
      '通知の適用条件に該当するリソースがある場合、通知に記載された変更がそのリソースの機能や利用条件に影響する可能性があります。通知内容と構成情報だけでは、利用停止や個別の業務処理への影響を特定できません。',
  }[lifecycleKind]

  return [
    {
      id: 'general-impact-unaddressed',
      text: unaddressedText,
      kind: 'General Impact',
      evidenceIds,
      decisionRefs: ['impactIfUnaddressed'],
    },
    {
      id: 'general-impact-during-and-after',
      text: '対応として更新・移行・切替を行う場合、構成変更や互換性確認、切替後の動作確認が必要になることがあります。データ移行が必要か、作業中に停止するかは方式と対象構成によって異なります。作業方式と個別の業務処理との対応情報がないため、停止時間や影響する処理名は断定していません。',
      kind: 'General Impact',
      evidenceIds,
      decisionRefs: ['impactDuringAndAfterChange'],
    },
  ]
}

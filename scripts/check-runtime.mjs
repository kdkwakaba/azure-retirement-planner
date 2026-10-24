import { readFileSync } from 'node:fs'
const policy = JSON.parse(readFileSync('config/runtime-policy.json', 'utf8'))
const parts = process.versions.node.split('.').map(Number)
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
if (
  parts[0] !== policy.nodeMajor ||
  compare(parts, policy.minimumNode.split('.').map(Number)) < 0
)
  throw new Error('Unsupported or below-security-baseline Node version')
if (Date.now() >= Date.parse(policy.nodeEol))
  throw new Error('Node runtime is EOL')
if (process.argv.includes('--online')) {
  const fetchJson = async (url) => {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
    if (!r.ok) throw new Error('Runtime source unavailable')
    return r.json()
  }
  const schedule = await fetchJson(
    'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json',
  )
  const release = schedule['v' + policy.nodeMajor]
  if (!release || Date.now() >= Date.parse(release.end))
    throw new Error('Runtime not supported')
  const index = await fetchJson('https://nodejs.org/dist/index.json')
  const latest = index.find((r) =>
    r.version.startsWith(`v${policy.nodeMajor}.`),
  )
  if (
    !latest ||
    compare(parts, latest.version.slice(1).split('.').map(Number)) < 0
  )
    throw new Error(
      'Newer supported Node patch available; review and update pinned baseline',
    )
}
console.log(
  `Node ${process.versions.node} supported by pinned policy; online=${process.argv.includes('--online')}`,
)

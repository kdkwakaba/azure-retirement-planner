import { spawnSync } from 'node:child_process'
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run through npm run verify')
for (const script of [
  'check:runtime',
  'format:check',
  'lint',
  'typecheck',
  'test',
  'build',
  'check:artifacts',
  'check:docs',
  'security',
]) {
  const result = spawnSync(process.execPath, [npm, 'run', script], {
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

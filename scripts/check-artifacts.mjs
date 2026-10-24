import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
for (const name of ['api', 'exporter']) {
  const root = join('.artifacts', name)
  for (const file of [
    'host.json',
    'package.json',
    'dist/index.cjs',
    'node_modules/@azure/functions/package.json',
  ])
    if (!existsSync(join(root, file)))
      throw new Error(`Artifact missing: ${name}/${file}`)
  const manifest = JSON.parse(
    readFileSync(join(root, 'build-manifest.json'), 'utf8'),
  )
  if (
    manifest.entryHash !==
    createHash('sha256')
      .update(readFileSync(join(root, 'dist/index.cjs')))
      .digest('hex')
  )
    throw new Error('Artifact hash mismatch')
  const inspect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) inspect(path)
      else if (
        /^(\.env|local\.settings\.json)|\.(pem|pfx|key)$/i.test(entry.name)
      )
        throw new Error(`Forbidden artifact: ${path}`)
    }
  }
  inspect(root)
}
if (!existsSync('.artifacts/api/public/index.html'))
  throw new Error('Web artifact missing')
console.log(
  'Function runtime closure, web assets, hashes and forbidden-file checks passed',
)

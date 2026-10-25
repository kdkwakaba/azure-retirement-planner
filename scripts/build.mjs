import { build } from 'esbuild'
import { build as buildWeb } from 'vite'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

await buildWeb({
  root: 'apps/review-web',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
})
const require = createRequire(import.meta.url)
function copyRuntime(
  name,
  destination,
  from = process.cwd(),
  seen = new Set(),
) {
  if (seen.has(name)) return
  seen.add(name)
  let dir = dirname(require.resolve(name, { paths: [from] }))
  while (
    !existsSync(join(dir, 'package.json')) ||
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name
  ) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Cannot resolve ${name}`)
    dir = parent
  }
  cpSync(dir, join(destination, 'node_modules', name), { recursive: true })
  for (const child of Object.keys(
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies ??
      {},
  ))
    copyRuntime(child, destination, dir, seen)
}
for (const [name, app] of [
  ['api', 'assessment-api'],
  ['exporter', 'work-item-exporter'],
]) {
  const destination = resolve('.artifacts', name)
  mkdirSync(destination, { recursive: true })
  await build({
    entryPoints: [`apps/${app}/src/index.ts`],
    outfile: join(destination, 'dist/index.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    external: ['@azure/functions'],
    sourcemap: false,
  })
  cpSync(`apps/${app}/host.json`, join(destination, 'host.json'))
  const functionVersion = JSON.parse(
    readFileSync('node_modules/@azure/functions/package.json', 'utf8'),
  ).version
  writeFileSync(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: `arp-${name}`,
        version: '0.1.0',
        private: true,
        type: 'commonjs',
        main: 'dist/index.cjs',
        dependencies: { '@azure/functions': functionVersion },
      },
      null,
      2,
    ) + '\n',
  )
  copyRuntime('@azure/functions', destination)
  if (name === 'api')
    cpSync('apps/review-web/dist', join(destination, 'public'), {
      recursive: true,
    })
  writeFileSync(
    join(destination, 'build-manifest.json'),
    JSON.stringify(
      {
        node: process.version,
        commit: process.env.GITHUB_SHA ?? 'local-uncommitted',
        entryHash: createHash('sha256')
          .update(readFileSync(join(destination, 'dist/index.cjs')))
          .digest('hex'),
        functionVersion,
      },
      null,
      2,
    ) + '\n',
  )
}

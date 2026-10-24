import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
const paths = ['README.md', 'AGENTS.md']
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (path.endsWith('.md')) paths.push(path)
  }
}
walk('docs')
walk('.agents')
for (const path of paths) {
  const text = readFileSync(path, 'utf8')
  if (text.includes('\ufffd')) throw new Error(`Encoding: ${path}`)
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const url = match[1]
    if (
      !/^(https?:|#)/.test(url) &&
      !existsSync(join(dirname(path), url.split('#')[0]))
    )
      throw new Error(`Broken link: ${path}: ${url}`)
  }
}
console.log(`Documentation links checked: ${paths.length}`)

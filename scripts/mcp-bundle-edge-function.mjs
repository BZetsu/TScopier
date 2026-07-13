#!/usr/bin/env node
/**
 * Bundle supabase/functions for MCP deploy_edge_function.
 * Usage: node scripts/mcp-bundle-edge-function.mjs <function-name>
 */
import fs from 'node:fs'
import path from 'node:path'

const fn = process.argv[2]
if (!fn) {
  console.error('usage: node scripts/mcp-bundle-edge-function.mjs <function-name>')
  process.exit(1)
}

const root = path.join(process.cwd(), 'supabase/functions')
const fnDir = path.join(root, fn)
if (!fs.existsSync(path.join(fnDir, 'index.ts'))) {
  console.error(`missing supabase/functions/${fn}/index.ts`)
  process.exit(1)
}

function walk(dir, prefix) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...walk(full, rel))
    } else if (!/\.test\.(ts|js)$/.test(entry.name)) {
      out.push({
        name: `supabase/functions/${rel.replace(/\\/g, '/')}`,
        content: fs.readFileSync(full, 'utf8'),
      })
    }
  }
  return out
}

const files = walk(root, '')
const configToml = fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8')
const fnConfigMatch = configToml.match(new RegExp(`\\[functions\\.${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][\\s\\S]*?verify_jwt\\s*=\\s*(true|false)`, 'm'))
const fnLocalConfig = fs.existsSync(path.join(fnDir, 'config.toml'))
  ? fs.readFileSync(path.join(fnDir, 'config.toml'), 'utf8')
  : ''
const localMatch = fnLocalConfig.match(/verify_jwt\s*=\s*(true|false)/)
const verify_jwt = localMatch
  ? localMatch[1] === 'true'
  : fnConfigMatch
    ? fnConfigMatch[1] === 'true'
    : true

const payload = {
  name: fn,
  entrypoint_path: `supabase/functions/${fn}/index.ts`,
  verify_jwt,
  files,
}

const outDir = path.join(process.cwd(), 'scripts/.deploy-bundles')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `${fn}.json`)
fs.writeFileSync(outPath, JSON.stringify(payload))
console.log(outPath)

#!/usr/bin/env node
/**
 * Ensures mobile shared-code shim packages link to src/lib and src/i18n.
 * Git symlinks can be lost on some checkouts; EAS/Linux needs these paths.
 */
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../../..')

function ensureSymlink(linkPath, targetPath) {
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath)
    if (stat.isSymbolicLink()) return
    throw new Error(`Expected symlink at ${linkPath}, found a regular file or directory`)
  }
  fs.symlinkSync(targetPath, linkPath, 'dir')
  console.log(`[link-web-lib-packages] linked ${linkPath} -> ${targetPath}`)
}

const packages = [
  {
    link: path.join(repoRoot, 'packages/web-lib/lib'),
    target: path.relative(path.join(repoRoot, 'packages/web-lib'), path.join(repoRoot, 'src/lib')),
  },
  {
    link: path.join(repoRoot, 'packages/web-i18n/lib'),
    target: path.relative(path.join(repoRoot, 'packages/web-i18n'), path.join(repoRoot, 'src/i18n')),
  },
]

for (const { link, target } of packages) {
  ensureSymlink(link, target)
}

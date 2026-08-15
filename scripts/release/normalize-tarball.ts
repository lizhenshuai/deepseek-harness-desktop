/** Canonicalize already-packed npm archives that live outside a release family. */

import { resolve } from 'node:path'
import { normalizeTarball } from './pack.ts'

const tarballs = process.argv.slice(2)
if (tarballs.length === 0) throw new Error('usage: normalize-tarball.ts <tarball> [...]')

for (const tarball of tarballs) normalizeTarball(resolve(tarball))

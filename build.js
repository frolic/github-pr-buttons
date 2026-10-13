// Writes the unpacked extension to dist/extension and a zip of it to
// dist/github-pr-buttons.zip. Only content.js is bundled; the other
// files are copied as they are.
import { execFileSync } from 'node:child_process'
import { cp, rm } from 'node:fs/promises'
import { build } from 'esbuild'

await rm('dist', { recursive: true, force: true })
await cp('src', 'dist/extension', {
	recursive: true,
	filter: (path) => !path.endsWith('content.js'),
})
await build({
	entryPoints: ['src/content.js'],
	bundle: true,
	format: 'iife',
	target: 'chrome120',
	outfile: 'dist/extension/content.js',
})
execFileSync('zip', ['-qr', '../github-pr-buttons.zip', '.'], { cwd: 'dist/extension' })

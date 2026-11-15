import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

const uiRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDir = fileURLToPath(new URL('../../../dist/bookmark/', import.meta.url))
const bundlePath = new URL('../../../dist/bookmark/recorder.js', import.meta.url)
const bookmarkPath = new URL('../../../dist/bookmark/bookmarklet.txt', import.meta.url)
const args = process.argv.slice(2)
if (args.some((arg) => arg !== '--no-copy')) {
  throw new Error('Usage: pnpm build:bookmark [--no-copy]')
}

// Build directly from source, including core and React. The regular UI library
// leaves core external; a bookmark has no package resolver or other app bundles.
await build({
  configFile: false,
  root: uiRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@ui-recorder/core': fileURLToPath(new URL('../../core/src/index.ts', import.meta.url)),
    },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: outputDir,
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: fileURLToPath(new URL('../src/index.tsx', import.meta.url)),
      name: 'UIRecorder',
      formats: ['iife'],
      fileName: () => 'recorder.js',
    },
  },
})

const bundle = await readFile(bundlePath, 'utf8')
// Guard BEFORE evaluating the bundle: even initializing core a second time can
// change persisted state. The host also guards clicks before React has rendered.
// Keep the library variable scoped here, away from the visited page's globals.
const source = `void(()=>{
if(document.querySelector('[data-recorder-root],[data-recorder-bookmark]'))return;
if(!document.body){alert('UI Recorder needs an HTML page.');return;}
${bundle}
const host=document.createElement('div');
host.setAttribute('data-recorder-bookmark','');
document.body.append(host);
try{UIRecorder.mountRecorder(host);}catch(error){host.remove();throw error;}
})();`
// Encode reserved characters (especially %, # and newlines) so the URL round-trips
// through the browser's bookmark editor without changing the JavaScript.
const bookmark = `javascript:${encodeURIComponent(source)}`
await writeFile(bundlePath, source)
await writeFile(bookmarkPath, bookmark)
console.log(`\nBookmark URL saved to ${fileURLToPath(bookmarkPath)} (${Math.ceil(Buffer.byteLength(bookmark) / 1024)} KB).`)

if (!args.includes('--no-copy')) {
  const commands = process.platform === 'darwin'
    ? [['pbcopy']]
    : process.platform === 'win32'
      ? [['clip.exe']]
      : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
  let copied = false
  for (const [command, ...commandArgs] of commands) {
    const result = spawnSync(command, commandArgs, {
      input: bookmark,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    if (!result.error && result.status === 0) {
      copied = true
      break
    }
  }
  if (copied) {
    console.log('Copied to clipboard. Create a browser bookmark named UI Recorder and paste into its URL field.')
  } else {
    console.warn('Build succeeded, but clipboard copying failed. Copy the contents of bookmarklet.txt manually (Linux needs wl-copy, xclip, or xsel).')
  }
}

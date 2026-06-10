const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const BUILD = path.join(ROOT, 'build')
const APP_NAME = 'Alizeh Foam'
const SIZE = 1024
const RADIUS = 224
const PADDING = 72

const SOURCE_CANDIDATES = [
  path.join(BUILD, 'source-icon.png'),
  path.join(BUILD, 'icon.png'),
  path.join(ROOT, 'src/renderer/public/app-icon.png')
]

function resolveSource() {
  return SOURCE_CANDIDATES.find((p) => fs.existsSync(p))
}

async function makeRoundedIcon(sourcePath, outPng) {
  const inner = SIZE - PADDING * 2
  const roundedBg = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}">
      <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="#ffffff"/>
    </svg>`
  )

  const artwork = await sharp(sourcePath)
    .resize(inner, inner, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer()

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      { input: roundedBg },
      { input: artwork, gravity: 'center' }
    ])
    .png()
    .toFile(outPng)
}

function makeIcns(pngPath, icnsPath) {
  const iconset = path.join(BUILD, 'icon.iconset')
  fs.rmSync(iconset, { recursive: true, force: true })
  fs.mkdirSync(iconset, { recursive: true })

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]

  for (const [size, name] of sizes) {
    execSync(`sips -z ${size} ${size} "${pngPath}" --out "${path.join(iconset, name)}"`, {
      stdio: 'pipe'
    })
  }

  execSync(`iconutil -c icns "${iconset}" -o "${icnsPath}"`, { stdio: 'pipe' })
  fs.rmSync(iconset, { recursive: true, force: true })
}

function patchPlist(plistPath) {
  let xml = fs.readFileSync(plistPath, 'utf8')
  xml = xml.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${APP_NAME}$2`
  )
  xml = xml.replace(
    /(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${APP_NAME}$2`
  )
  fs.writeFileSync(plistPath, xml)
}

function rebrandElectronDev(icnsPath) {
  if (process.platform !== 'darwin') return

  const contents = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents')
  const plistPath = path.join(contents, 'Info.plist')
  const icnsDest = path.join(contents, 'Resources/electron.icns')

  if (!fs.existsSync(plistPath)) {
    console.warn('[branding] Electron.app not found — skip dev rebrand')
    return
  }

  patchPlist(plistPath)
  fs.copyFileSync(icnsPath, icnsDest)
  console.log(`[branding] Dev app renamed to "${APP_NAME}"`)
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true })

  const source = resolveSource()
  if (!source) {
    console.warn('[branding] No source icon found — skip')
    return
  }

  const iconPng = path.join(BUILD, 'icon.png')
  const iconIcns = path.join(BUILD, 'icon.icns')
  const publicPng = path.join(ROOT, 'src/renderer/public/app-icon.png')

  await makeRoundedIcon(source, iconPng)
  fs.mkdirSync(path.dirname(publicPng), { recursive: true })
  fs.copyFileSync(iconPng, publicPng)

  if (process.platform === 'darwin') {
    makeIcns(iconPng, iconIcns)
    rebrandElectronDev(iconIcns)
  }

  console.log('[branding] Icon ready:', iconPng)
}

main().catch((err) => {
  console.error('[branding] failed:', err)
  process.exit(1)
})

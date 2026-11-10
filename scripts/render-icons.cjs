// Renders the PNGs the app and the installer use: icon.png from the artwork in icon-source.png (its white
// surroundings made transparent), the tray and badge icons from resources/*.svg. Run with `npm run icons`
// after changing a source; the PNGs are committed, so a build needs no extra tools.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = join(__dirname, '..', 'resources')
const APP_ICON_SIZE = 1024
const outputs = [
  ['tray.svg', 'tray.png', 16],
  ['tray.svg', 'tray@2x.png', 32],
  ['tray-badge.svg', 'tray-badge.png', 16],
  ['tray-badge.svg', 'tray-badge@2x.png', 32],
  ['overlay.svg', 'overlay.png', 16],
  ['overlay.svg', 'overlay@2x.png', 32]
]

/**
 * Runs in the page: the background is flood-filled from the corners and made transparent; the few pixels
 * along the edge, where the artwork blends into white, get an alpha that undoes the blend.
 */
function cutOut(source, size) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const image = ctx.getImageData(0, 0, w, h)
      const px = image.data
      const isBackground = (i) => Math.min(px[i], px[i + 1], px[i + 2]) >= 235
      // Distance in steps from the background: 0 = background, 1..EDGE = the blended edge.
      const EDGE = 3
      const dist = new Int8Array(w * h).fill(-1)
      let frontier = []
      for (const start of [0, w - 1, (h - 1) * w, h * w - 1]) {
        if (isBackground(start * 4) && dist[start] < 0) {
          dist[start] = 0
          frontier.push(start)
        }
      }
      // Flood the background first, then grow EDGE rings into the artwork.
      for (let ring = 0; ring <= EDGE && frontier.length; ring++) {
        const next = []
        while (frontier.length) {
          const p = frontier.pop()
          const x = p % w
          const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
          for (const n of neighbours) {
            if (n < 0 || n >= w * h || dist[n] >= 0) continue
            if (ring === 0 && isBackground(n * 4)) {
              dist[n] = 0
              frontier.push(n)
            } else {
              dist[n] = ring + 1
              next.push(n)
            }
          }
        }
        frontier = next.filter((p) => dist[p] <= EDGE)
      }
      const DARK = 20
      for (let p = 0; p < w * h; p++) {
        const i = p * 4
        if (dist[p] === 0) px[i + 3] = 0
        else if (dist[p] > 0) {
          const v = (px[i] + px[i + 1] + px[i + 2]) / 3
          const a = Math.max(0, Math.min(1, (255 - v) / (255 - DARK)))
          if (a < 1) {
            for (let c = 0; c < 3; c++) px[i + c] = a > 0 ? Math.max(0, (px[i + c] - 255 * (1 - a)) / a) : 0
            px[i + 3] = Math.round(a * 255)
          }
        }
      }
      ctx.putImageData(image, 0, 0)
      const out = document.createElement('canvas')
      out.width = out.height = size
      const outCtx = out.getContext('2d')
      outCtx.imageSmoothingQuality = 'high'
      outCtx.drawImage(canvas, 0, 0, size, size)
      resolve(out.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('cannot read icon-source.png'))
    img.src = source
  })
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const source = `data:image/png;base64,${readFileSync(join(dir, 'icon-source.png')).toString('base64')}`
  const icon = await win.webContents.executeJavaScript(`(${cutOut})(${JSON.stringify(source)}, ${APP_ICON_SIZE})`)
  writeFileSync(join(dir, 'icon.png'), Buffer.from(icon.split(',')[1], 'base64'))
  console.log(`icon.png (${APP_ICON_SIZE}px)`)
  for (const [svg, png, size] of outputs) {
    // An explicit size, or the image is drawn at the SVG default of 300 × 150.
    const source = readFileSync(join(dir, svg), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `)
    const url = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = ${size}
        canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('cannot render ${svg}'))
      img.src = ${JSON.stringify(url)}
    })`)
    writeFileSync(join(dir, png), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log(`${png} (${size}px)`)
  }
  app.quit()
})

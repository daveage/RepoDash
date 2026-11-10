// Renders resources/*.svg into the PNGs the app and the installer use. Run with `npm run icons`
// after changing an SVG; the PNGs are committed, so a build needs no extra tools.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = join(__dirname, '..', 'resources')
const outputs = [
  ['icon.svg', 'icon.png', 1024],
  ['tray.svg', 'tray.png', 16],
  ['tray.svg', 'tray@2x.png', 32],
  ['tray-badge.svg', 'tray-badge.png', 16],
  ['tray-badge.svg', 'tray-badge@2x.png', 32],
  ['overlay.svg', 'overlay.png', 16],
  ['overlay.svg', 'overlay@2x.png', 32]
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
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

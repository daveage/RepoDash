import { app, BrowserWindow, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import type { Summary, UiCommand } from '../shared/types'
import overlay1x from '../../resources/overlay.png?asset'
import overlay2x from '../../resources/overlay@2x.png?asset'
import badge1x from '../../resources/tray-badge.png?asset'
import badge2x from '../../resources/tray-badge@2x.png?asset'
import tray1x from '../../resources/tray.png?asset'
import tray2x from '../../resources/tray@2x.png?asset'

/** One image with a 1x and a 2x version, so the icon is sharp on high-DPI screens. */
function image(path1x: string, path2x: string): NativeImage {
  const result = nativeImage.createEmpty()
  result.addRepresentation({ scaleFactor: 1, buffer: readFileSync(path1x) })
  result.addRepresentation({ scaleFactor: 2, buffer: readFileSync(path2x) })
  return result
}

function repositories(count: number): string {
  return `${count} ${count === 1 ? 'repository' : 'repositories'}`
}

/**
 * The tray icon (with an amber dot while any repository has uncommitted changes) and the badge on the
 * taskbar button (Windows) or the dock icon (macOS, Linux launchers that support it).
 */
export class StatusTray {
  private tray: Tray
  private icons = { plain: image(tray1x, tray2x), badge: image(badge1x, badge2x) }
  private overlay = image(overlay1x, overlay2x)
  private summary: Summary = { dirty: 0, outOfSync: 0, pullable: 0 }

  constructor(
    private show: () => void,
    private command: (command: UiCommand) => void
  ) {
    this.tray = new Tray(this.icons.plain)
    this.tray.on('click', show)
    this.render()
  }

  update(summary: Summary): void {
    const { dirty, outOfSync, pullable } = this.summary
    if (summary.dirty === dirty && summary.outOfSync === outOfSync && summary.pullable === pullable) return
    this.summary = summary
    this.render()
  }

  destroy(): void {
    this.tray.destroy()
  }

  private render(): void {
    const { dirty, outOfSync, pullable } = this.summary
    const parts = [dirty && `${repositories(dirty)} with changes`, outOfSync && `${outOfSync} out of sync`]
    const description = parts.filter(Boolean).join(' · ') || 'All clean'
    this.tray.setImage(dirty > 0 ? this.icons.badge : this.icons.plain)
    this.tray.setToolTip(`RepoDash · ${description}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show RepoDash', click: this.show },
        { label: description, enabled: false },
        { type: 'separator' },
        { label: 'Fetch all', click: () => this.command({ kind: 'fetch-all' }) },
        {
          label: pullable > 0 ? `Pull clean (${pullable})` : 'Pull clean',
          enabled: pullable > 0,
          click: () => this.command({ kind: 'pull-clean' })
        },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
      ])
    )

    if (process.platform === 'win32') {
      for (const win of BrowserWindow.getAllWindows()) {
        win.setOverlayIcon(dirty > 0 ? this.overlay : null, dirty > 0 ? `${repositories(dirty)} with changes` : '')
      }
    } else {
      // The dock shows the number; on Linux it works where the launcher supports Unity badges.
      app.setBadgeCount(dirty)
    }
  }
}

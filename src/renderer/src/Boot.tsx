import { useEffect, useState } from 'react'
import { pad2 } from './format'

const BOOT_MS = 1500
const FADE_MS = 350

interface Props {
  repoCount: number
  scanning: boolean
  onDone(): void
}

/** The short start-up sequence; any key or click skips it. */
export function Boot({ repoCount, scanning, onDone }: Props) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      setLeaving(true)
      setTimeout(onDone, FADE_MS)
    }
    const timer = setTimeout(finish, BOOT_MS)
    window.addEventListener('keydown', finish)
    window.addEventListener('pointerdown', finish)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', finish)
      window.removeEventListener('pointerdown', finish)
    }
  }, [onDone])

  return (
    <div className={`boot${leaving ? ' leaving' : ''}`} aria-hidden="true">
      <div className="boot-reticle">
        <span className="boot-sweep" />
        <span className="boot-ring" />
      </div>
      <div className="boot-title">RepoDash</div>
      <div className="boot-lines">
        <div>Telemetry online</div>
        <div>{scanning ? 'Scanning sources' : 'Sources linked'}</div>
        <div>{pad2(repoCount)} repositories tracked</div>
      </div>
    </div>
  )
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

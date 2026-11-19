import { useEffect, useState, type CSSProperties } from 'react'
import type { RepoMeta, Section } from '../../shared/types'
import { ACCENTS, baseName, defaultAccent } from './format'

interface Props {
  path: string
  meta: RepoMeta | undefined
  /** True when the repository came from a folder scan, so removing it only hides it. */
  scanned: boolean
  sections: Section[]
  /** The section the repository is in, and its default one. */
  section: string
  home: string
  onSave(meta: RepoMeta, section: string): void
  onRemove(): void
  onClose(): void
}

export function CardConfig({ path, meta, scanned, sections, section, home, onSave, onRemove, onClose }: Props) {
  const [alias, setAlias] = useState(meta?.alias ?? '')
  const [color, setColor] = useState(meta?.color)
  const [target, setTarget] = useState(section)
  // Empty default sections are not on the board, but the repository's own one is always a choice.
  const choices = sections.filter((s) => s.custom || s.repos.length > 0 || s.id === home)
  const auto = defaultAccent(baseName(path))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = () => {
    onSave({ alias, color }, target)
    onClose()
  }

  return (
    <div className="card-config">
      <div className="config-title">Configure</div>

      <label className="field">
        <span className="field-label">Alias</span>
        <input
          className="hud-input"
          value={alias}
          placeholder={baseName(path)}
          maxLength={80}
          autoFocus
          onChange={(event) => setAlias(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && save()}
        />
      </label>

      <div className="field">
        <span className="field-label">Colour</span>
        <div className="swatches">
          <button
            className={`swatch swatch-auto${color ? '' : ' selected'}`}
            style={{ '--swatch': auto } as CSSProperties}
            onClick={() => setColor(undefined)}
            title="Automatic"
          >
            A
          </button>
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              className={`swatch${color === accent ? ' selected' : ''}`}
              style={{ '--swatch': accent } as CSSProperties}
              onClick={() => setColor(accent)}
              title={accent}
            />
          ))}
          <label
            className={`swatch swatch-custom${color && !ACCENTS.includes(color) ? ' selected' : ''}`}
            style={{ '--swatch': color && !ACCENTS.includes(color) ? color : 'transparent' } as CSSProperties}
            title="Custom colour"
          >
            +
            <input type="color" value={color ?? auto} onChange={(event) => setColor(event.target.value)} />
          </label>
        </div>
      </div>

      <label className="field">
        <span className="field-label">Section</span>
        <select className="hud-select" value={target} onChange={(event) => setTarget(event.target.value)}>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
              {choice.id === home ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="config-actions">
        <button className="hud-btn danger" onClick={onRemove} title={scanned ? 'Restore it in Sources' : undefined}>
          {scanned ? 'Hide' : 'Remove'}
        </button>
        <span className="spacer" />
        <button className="hud-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="hud-btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

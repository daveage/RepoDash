import { ConfirmDialog } from './ConfirmDialog'
import { SHORTCUTS } from './keys'

export function Shortcuts({ onClose }: { onClose(): void }) {
  return (
    <ConfirmDialog title="Keyboard" choices={[]} cancelLabel="Close" onCancel={onClose}>
      <dl className="shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="shortcut">
            <dt>{shortcut.keys}</dt>
            <dd>{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </ConfirmDialog>
  )
}

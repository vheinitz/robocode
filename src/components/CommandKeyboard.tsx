import { EditorContext } from '../editor/BlockEditor'
import { BlockKind } from '../model/project'
import { getSuggestions, Suggestion } from '../keyboard/context'

export interface KeyboardApi {
  insertText: (s: string) => void
  newline: () => void
  backspace: () => void
}

interface Props {
  context: EditorContext | null
  blockKind: BlockKind
  knownNames: string[]
  api: KeyboardApi
  nativeMode: boolean
  onToggleNative: () => void
}

const kindColor: Record<Suggestion['kind'], string> = {
  cmd: 'bg-accent/15 text-accent border-accent/30',
  ctrl: 'bg-accent2/15 text-accent2 border-accent2/30',
  dir: 'bg-ok/15 text-ok border-ok/30',
  op: 'bg-warn/15 text-warn border-warn/30',
  val: 'bg-panel2 text-gray-200 border-edge',
}

export default function CommandKeyboard({ context, blockKind, knownNames, api, nativeMode, onToggleNative }: Props) {
  const suggestions = context ? getSuggestions(context, blockKind, knownNames) : []
  const numbers = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '-', '.']

  return (
    <div className="shrink-0 border-t border-edge bg-panel p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Befehlstastatur</span>
        <button
          onClick={onToggleNative}
          className={`touch-key rounded-md border px-3 py-1 text-xs font-medium ${
            nativeMode ? 'border-accent/40 bg-accent/20 text-accent' : 'border-edge bg-panel2 text-gray-300'
          }`}
        >
          {nativeMode ? '⌨ Text-Modus' : '⌨ Text-Tastatur'}
        </button>
      </div>

      {/* Kontextuelle Vorschlaege. Endet ein Baustein mit ':', direkt eine Ebene
          tiefer einruecken (newline nutzt die Einrueckungslogik des Editors). */}
      <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => {
              api.insertText(s.insert)
              if (s.insert.replace(/\s+$/, '').endsWith(':')) api.newline()
            }}
            className={`touch-key truncate rounded-md border px-2 py-2 text-left text-sm font-medium active:scale-[0.97] ${kindColor[s.kind]}`}
          >
            {s.label}
          </button>
        ))}
        {suggestions.length === 0 && (
          <span className="col-span-full py-2 text-center text-xs text-gray-600">
            Tippe in den Editor — die Vorschläge richten sich nach der Cursor-Position.
          </span>
        )}
      </div>

      {/* Geräte-Namen als feste Tasten (immer verfügbar, aus SETUP). */}
      {knownNames.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <span className="self-center text-[11px] uppercase tracking-wide text-gray-600">Geräte</span>
          {knownNames.map((n) => (
            <button
              key={n}
              onClick={() => api.insertText(n)}
              className="touch-key rounded-md border border-ok/30 bg-ok/10 px-2 py-1 font-mono text-xs text-ok active:scale-[0.97]"
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {/* Zahlenreihe + Bearbeitung */}
      <div className="flex gap-1.5">
        <div className="grid flex-1 grid-cols-6 gap-1.5">
          {numbers.map((n) => (
            <button
              key={n}
              onClick={() => api.insertText(n)}
              className="touch-key rounded-md border border-edge bg-panel2 py-2 font-mono text-sm text-gray-200 active:scale-[0.97]"
            >
              {n}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5" style={{ width: '33%' }}>
          <button onClick={() => api.insertText(' ')} className="touch-key rounded-md border border-edge bg-panel2 py-2 text-sm text-gray-300 active:scale-[0.97]">␣</button>
          <button onClick={() => api.insertText(':')} className="touch-key rounded-md border border-edge bg-panel2 py-2 font-mono text-sm text-gray-300 active:scale-[0.97]">:</button>
          <button onClick={() => api.backspace()} className="touch-key rounded-md border border-edge bg-panel2 py-2 text-sm text-gray-300 active:scale-[0.97]">⌫</button>
          <button onClick={() => api.newline()} className="touch-key rounded-md border border-accent/30 bg-accent/15 py-2 text-sm text-accent active:scale-[0.97]">↵</button>
        </div>
      </div>
    </div>
  )
}

import { Block } from '../model/project'

interface Props {
  blocks: Block[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onToggleEnable: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
}

export default function BlockTabs({
  blocks,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onDelete,
  onToggleEnable,
  onMove,
}: Props) {
  const active = blocks.find((b) => b.id === activeId)
  const canEdit = active && active.kind === 'function'

  return (
    <div className="shrink-0 border-b border-edge bg-panel2">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
        {blocks.map((b) => {
          const isActive = b.id === activeId
          return (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium ${
                isActive ? 'border-accent bg-accent/15 text-accent' : 'border-edge bg-panel text-gray-400'
              } ${b.enabled ? '' : 'opacity-40 line-through'}`}
              title={b.kind}
            >
              {b.kind === 'setup' ? '⚙ ' : b.kind === 'main' ? '▶ ' : '🧩 '}
              {b.name}
            </button>
          )
        })}
        <button
          onClick={onAdd}
          className="shrink-0 rounded-md border border-dashed border-edge px-2 py-1 text-xs text-gray-400 hover:text-white"
          title="Funktionsblock hinzufügen"
        >
          +
        </button>
      </div>

      {active && (
        <div className="flex items-center gap-1 border-t border-edge/60 px-2 py-1 text-[11px] text-gray-500">
          <span className="mr-1">Block:</span>
          <button onClick={() => onToggleEnable(active.id)} className="rounded px-1.5 py-0.5 hover:bg-panel hover:text-gray-200">
            {active.enabled ? '☑ aktiv' : '☐ inaktiv'}
          </button>
          <button onClick={() => onMove(active.id, -1)} className="rounded px-1.5 py-0.5 hover:bg-panel hover:text-gray-200">◀</button>
          <button onClick={() => onMove(active.id, 1)} className="rounded px-1.5 py-0.5 hover:bg-panel hover:text-gray-200">▶</button>
          {canEdit && (
            <>
              <button onClick={() => onRename(active.id)} className="rounded px-1.5 py-0.5 hover:bg-panel hover:text-gray-200">Umbenennen</button>
              <button onClick={() => onDuplicate(active.id)} className="rounded px-1.5 py-0.5 hover:bg-panel hover:text-gray-200">Duplizieren</button>
              <button onClick={() => onDelete(active.id)} className="rounded px-1.5 py-0.5 text-danger/80 hover:bg-panel hover:text-danger">Löschen</button>
            </>
          )}
          {!canEdit && <span className="text-gray-600">SETUP/MAIN sind fest</span>}
        </div>
      )}
    </div>
  )
}

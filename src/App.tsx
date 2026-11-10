import { useMemo, useRef, useState } from 'react'
import {
  Project,
  Block,
  BlockKind,
  createPlaygroundProject,
  saveProject,
  loadProject,
  exportProjectJson,
} from './model/project'
import { assembleSketch } from './hw/assemble'
import { BOARDS, getBoard } from './hw/boards'
import BlockEditor, { BlockEditorHandle } from './editor/BlockEditor'

// Drei feste Code-Tabs (wie in der Android-App).
const TAB_ORDER: BlockKind[] = ['setup', 'main', 'lib']
const TAB_LABEL: Record<string, string> = { setup: '⚙ SETUP', main: '▶ MAIN', lib: '🧩 LIB' }

// Token-Palette je Tab — identisch zur Android-App (MainActivity.buildPalette).
function paletteTokens(kind: BlockKind, names: string[]): { label: string; insert: string }[] {
  if (kind === 'setup') {
    return [
      { label: '📥 DI', insert: 'eingang = DI(4)' },
      { label: '📤 DO', insert: 'ausgang = DO(5)' },
      { label: '🎚️ AI', insert: 'poti = AI(0)' },
      { label: '🔆 AO', insert: 'dimmer = AO(5)' },
      { label: '💡 LED', insert: 'led = LED(13)' },
      { label: '🌈 RGB', insert: 'rgb = RGB(2)' },
      { label: '🔘 Taster', insert: 'taster = TASTER(2)' },
      { label: '⚙️ Motor', insert: 'motor = MOTOR(6, 7)' },
    ]
  }
  const base = [
    { label: '🔁 while', insert: 'while True:' },
    { label: '❓ if', insert: 'if :' },
    { label: '❓! elif', insert: 'elif :' },
    { label: 'sonst', insert: 'else:' },
    ...(kind === 'lib' ? [{ label: '🧩 def', insert: 'def name():' }] : []),
    { label: '⏱ sleep', insert: 'sleep_ms(100)' },
    { label: 'Takt', insert: 'takt = Every(300)' },
    { label: '= 1', insert: '.v = 1' },
    { label: '= 0', insert: '.v = 0' },
    { label: 'umsch.', insert: '.toggle()' },
    { label: '>', insert: ' > ' },
  ]
  return [...base, ...names.map((n) => ({ label: n, insert: n }))]
}

function ensurePlayground(p: Project): Project {
  const fresh = createPlaygroundProject()
  const blocks = TAB_ORDER.map(
    (kind) => p.blocks.find((b) => b.kind === kind) ?? fresh.blocks.find((b) => b.kind === kind)!,
  )
  return { ...p, blocks }
}

// Zugewiesene Namen (z. B. `led = LED(13)`) aus allen Tabs, für die Palette.
function knownNamesOf(project: Project): string[] {
  const names = new Set<string>()
  const re = /^\s*([A-Za-z_]\w*)\s*=(?!=)/gm
  for (const b of project.blocks) {
    let m: RegExpExecArray | null
    while ((m = re.exec(b.code))) names.add(m[1])
  }
  return [...names]
}

export default function App() {
  const [project, setProject] = useState<Project>(
    () => ensurePlayground(loadProject() ?? createPlaygroundProject()),
  )
  const blocks = TAB_ORDER.map((k) => project.blocks.find((b) => b.kind === k)!).filter(Boolean)
  const [activeKind, setActiveKind] = useState<BlockKind>('setup')
  const [view, setView] = useState<'code' | 'main'>('code')
  const [boardId, setBoardId] = useState<string>(BOARDS[0].id)

  const editorRef = useRef<BlockEditorHandle | null>(null)

  const activeBlock = blocks.find((b) => b.kind === activeKind) ?? blocks[0]
  const knownNames = useMemo(() => knownNamesOf(project), [project])

  const assembled = useMemo(() => {
    const by = (k: BlockKind) => project.blocks.find((b) => b.kind === k)?.code ?? ''
    return assembleSketch({ setup: by('setup'), lib: by('lib'), main: by('main') }, getBoard(boardId))
  }, [project, boardId])

  function updateBlock(id: string, patch: Partial<Block>) {
    setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }

  // Token einfügen; nach ':' automatisch einrücken (wie Android).
  function insertToken(insert: string) {
    editorRef.current?.insertText(insert)
    if (insert.replace(/\s+$/, '').endsWith(':')) editorRef.current?.newline()
  }

  function handleExport() {
    const blob = new Blob([exportProjectJson(project)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.name.replace(/\s+/g, '_')}.robocode.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadMain() {
    const blob = new Blob([assembled.mainPy], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'main.py'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Kompakte Titelzeile (wie Android, ohne Verbindungsstatus) */}
      <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-panel px-3 py-1.5">
        <span className="text-[15px] font-bold tracking-wide text-gray-100">RoboCode</span>
        <span className="hidden text-[11px] text-gray-500 sm:inline">Playground</span>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            title="Board — bestimmt die vordefinierten Pins D.. / A.."
            className="rounded border border-edge bg-panel2 px-1.5 py-0.5 text-xs text-gray-100"
          >
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button title="Speichern" onClick={() => saveProject(project)}
            className="rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-300 hover:text-white">💾</button>
          <button title="Laden" onClick={() => { const p = loadProject(); if (p) setProject(ensurePlayground(p)) }}
            className="rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-300 hover:text-white">📂</button>
          <button title="Export (JSON)" onClick={handleExport}
            className="rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-300 hover:text-white">⤓</button>
        </div>
      </div>

      {/* Nav-Tabs: Code | main.py (wie Android) */}
      <div className="flex shrink-0 bg-[#1a1f27]">
        {([['code', 'Code'], ['main', 'main.py']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-2 text-xs font-medium ${view === v ? 'text-accent' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Panel: CODE */}
      {view === 'code' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Sub-Tabs SETUP/MAIN/LIB */}
          <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-panel2 px-2 py-1.5">
            {blocks.map((b) => (
              <button
                key={b.kind}
                onClick={() => setActiveKind(b.kind)}
                className={`flex-1 rounded-md border px-3 py-1 text-xs font-medium ${
                  b.kind === activeKind
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-edge bg-panel text-gray-400 hover:text-gray-200'
                }`}
              >
                {TAB_LABEL[b.kind]}
              </button>
            ))}
          </div>

          {/* Token-Palette (horizontal) */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-edge bg-panel2 px-2 py-1.5">
            {paletteTokens(activeKind, knownNames).map((t, i) => (
              <button
                key={i}
                onClick={() => insertToken(t.insert)}
                className="shrink-0 rounded bg-panel px-2 py-1 font-mono text-[11px] text-gray-300 hover:bg-accent/15 hover:text-accent"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="min-h-0 flex-1">
            {activeBlock && (
              <BlockEditor
                key={activeBlock.id}
                ref={editorRef}
                value={activeBlock.code}
                onChange={(v) => updateBlock(activeBlock.id, { code: v })}
                suppressNativeKeyboard={false}
              />
            )}
          </div>
        </div>
      )}

      {/* Panel: main.py */}
      {view === 'main' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-edge bg-panel2 px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              main.py — DSL (versteckt) + SETUP + LIB + MAIN
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => navigator.clipboard?.writeText(assembled.mainPy)}
                className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white">Kopieren</button>
              <button onClick={downloadMain}
                className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white">⤓ main.py</button>
            </div>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-[#12151b] p-3 font-mono text-[11px] leading-relaxed text-gray-200">
            {assembled.mainPy}
          </pre>
        </div>
      )}
    </div>
  )
}

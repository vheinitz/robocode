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
import BlockEditor, { BlockEditorHandle, EditorContext } from './editor/BlockEditor'
import Header from './components/Header'
import CommandKeyboard from './components/CommandKeyboard'

// Reihenfolge der drei festen Tabs.
const TAB_ORDER: BlockKind[] = ['setup', 'main', 'lib']
const TAB_LABEL: Record<string, string> = { setup: '⚙ SETUP', main: '▶ MAIN', lib: '🧩 LIB' }
const TAB_HINT: Record<string, string> = {
  setup: 'Geräte an Pins (läuft einmal)',
  main: 'Dein Programm',
  lib: 'Eigene Funktionen (def ...)',
}

// Alte gespeicherte Projekte auf die drei Playground-Tabs normalisieren.
function ensurePlayground(p: Project): Project {
  const fresh = createPlaygroundProject()
  const blocks = TAB_ORDER.map(
    (kind) => p.blocks.find((b) => b.kind === kind) ?? fresh.blocks.find((b) => b.kind === kind)!,
  )
  return { ...p, blocks }
}

// Zugewiesene Namen (z. B. `led = LED(13)`) aus allen Tabs sammeln — damit die
// Tastatur hinter einem Gerätenamen passende Aktionen anbietet.
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
  const [context, setContext] = useState<EditorContext | null>(null)
  const [nativeMode, setNativeMode] = useState(false)
  const [view, setView] = useState<'code' | 'main'>('code')

  const editorRef = useRef<BlockEditorHandle | null>(null)

  const activeBlock = blocks.find((b) => b.kind === activeKind) ?? blocks[0]
  const knownNames = useMemo(() => knownNamesOf(project), [project])

  const assembled = useMemo(() => {
    const by = (k: BlockKind) => project.blocks.find((b) => b.kind === k)?.code ?? ''
    return assembleSketch({ setup: by('setup'), lib: by('lib'), main: by('main') }, project.target)
  }, [project])

  function updateBlock(id: string, patch: Partial<Block>) {
    setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }

  const kbApi = {
    insertText: (s: string) => editorRef.current?.insertText(s),
    newline: () => editorRef.current?.newline(),
    backspace: () => editorRef.current?.backspace(),
  }

  function handleExport() {
    const json = exportProjectJson(project)
    const blob = new Blob([json], { type: 'application/json' })
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
      <Header
        project={project}
        onRename={(name) => setProject((p) => ({ ...p, name }))}
        onSave={() => saveProject(project)}
        onLoad={() => {
          const p = loadProject()
          if (p) setProject(ensurePlayground(p))
        }}
        onExport={handleExport}
        onShowMain={() => setView('main')}
      />

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* Editor-Spalte */}
        <div className={`flex min-h-0 flex-col ${view === 'main' ? 'hidden lg:flex' : 'flex'} border-r border-edge`}>
          {/* 3 feste Tabs */}
          <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-panel2 px-2 py-1.5">
            {blocks.map((b) => (
              <button
                key={b.kind}
                onClick={() => setActiveKind(b.kind)}
                title={TAB_HINT[b.kind]}
                className={`rounded-md border px-3 py-1 text-xs font-medium ${
                  b.kind === activeKind
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-edge bg-panel text-gray-400 hover:text-gray-200'
                }`}
              >
                {TAB_LABEL[b.kind]}
              </button>
            ))}
            <span className="ml-2 hidden text-[11px] text-gray-500 sm:inline">
              {activeBlock && TAB_HINT[activeBlock.kind]}
            </span>
          </div>

          <div className="min-h-0 flex-1">
            {activeBlock && (
              <BlockEditor
                key={activeBlock.id}
                ref={editorRef}
                value={activeBlock.code}
                onChange={(v) => updateBlock(activeBlock.id, { code: v })}
                onContext={setContext}
                suppressNativeKeyboard={!nativeMode}
              />
            )}
          </div>

          <CommandKeyboard
            context={context}
            blockKind={activeBlock?.kind ?? 'main'}
            knownNames={knownNames}
            api={kbApi}
            nativeMode={nativeMode}
            onToggleNative={() => setNativeMode((v) => !v)}
          />
        </div>

        {/* main.py-Spalte */}
        <div className={`flex min-h-0 flex-col ${view === 'code' ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-edge bg-panel2 px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              main.py — DSL (versteckt) + SETUP + LIB + MAIN
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => navigator.clipboard?.writeText(assembled.mainPy)}
                className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
              >
                Kopieren
              </button>
              <button
                onClick={downloadMain}
                className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
              >
                ⤓ main.py
              </button>
            </div>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-[#12151b] p-3 font-mono text-[11px] leading-relaxed text-gray-200">
            {assembled.mainPy}
          </pre>
        </div>
      </div>

      {/* Mobile-Umschalter */}
      <nav className="flex shrink-0 border-t border-edge bg-panel lg:hidden">
        <button
          onClick={() => setView('code')}
          className={`flex-1 py-2 text-xs font-medium ${view === 'code' ? 'text-accent' : 'text-gray-500'}`}
        >
          ⌨ Editor
        </button>
        <button
          onClick={() => setView('main')}
          className={`flex-1 py-2 text-xs font-medium ${view === 'main' ? 'text-accent' : 'text-gray-500'}`}
        >
          📄 main.py
        </button>
      </nav>
    </div>
  )
}

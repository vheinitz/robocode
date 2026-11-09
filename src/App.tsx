import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Project,
  Block,
  createLineFollowerProject,
  newId,
  saveProject,
  loadProject,
  exportProjectJson,
} from './model/project'
import { generate } from './lang/codegen'
import { Simulator } from './sim/simulator'
import BlockEditor, { BlockEditorHandle, EditorContext } from './editor/BlockEditor'
import Header from './components/Header'
import BlockTabs from './components/BlockTabs'
import CommandKeyboard from './components/CommandKeyboard'
import OutputPanel from './components/OutputPanel'
import HardwarePanel from './components/HardwarePanel'
import { Device } from './hw/devices'
import { BOARDS } from './hw/boards'
import { RoboModule, newModule } from './lang/modules'

type AppMode = 'lang' | 'hw'

// Beispiel-Hardware für den ESP32-C3, damit das Panel nicht leer startet.
function seedDevices(): Device[] {
  return [
    { id: newId('dev'), type: 'button', name: 'TASTER1', pins: { pin: 3 } },
    { id: newId('dev'), type: 'led', name: 'LED1', pins: { pin: 5 } },
    { id: newId('dev'), type: 'poti', name: 'POTI1', pins: { pin: 0 } },
    { id: newId('dev'), type: 'light', name: 'LICHT1', pins: { pin: 1 } },
    { id: newId('dev'), type: 'motor', name: 'MOTOR1', pins: { a: 6, b: 7 } },
  ]
}

function seedModules(): RoboModule[] {
  // Zwei robo-Skripte: ein Funktionsmodul BLINK (🧩 blink) und das Hauptmodul
  // MAIN, das blink aufruft. So ist der Mehrmodul-Zusammenbau gleich sichtbar:
  // Funktionsmodule landen beim Transpilieren VOR dem Hauptmodul.
  const blink = newModule(
    'BLINK',
    'module',
    ['🧩blink [n]:', '  🔁i n:', '    💡LED1.toggle', '    ⏱️ 100'].join('\n'),
  )
  // robolang (neue Syntax): 🔲 Taster (bare = gedrückt), 🎚️ Poti, 👁️ Lichtsensor,
  // ❓/❓!/❓!: = if/elif/else, ⚙️ Motor-Richtung, blink = Aufruf aus Modul BLINK.
  const main = newModule(
    'MAIN',
    'main',
    [
      '🔁:',
      '  ❓ 🔲TASTER1:',
      '    💡LED1.on',
      '  ❓! 👁️LICHT1 > 70:',
      '    💡LED1.off',
      '  ❓!:',
      '    blink 2',
      '  speed = 🎚️POTI1',
      '  ⚙️MOTOR1.r = speed',
      '  ⏱️ 50',
    ].join('\n'),
  )
  return [main, blink]
}

export default function App() {
  const [project, setProject] = useState<Project>(() => loadProject() ?? createLineFollowerProject())
  const [activeId, setActiveId] = useState<string>(() => project.blocks[0]?.id ?? '')
  const [context, setContext] = useState<EditorContext | null>(null)
  const [nativeMode, setNativeMode] = useState(false)
  const [view, setView] = useState<'code' | 'output'>('code')

  const [sim, setSim] = useState<Simulator | null>(null)
  const [simTick, setSimTick] = useState(0)
  const [running, setRunning] = useState(false)

  const [appMode, setAppMode] = useState<AppMode>('hw')
  const [boardId, setBoardId] = useState<string>(BOARDS[0].id)
  const [devices, setDevices] = useState<Device[]>(seedDevices)
  const [modules, setModules] = useState<RoboModule[]>(seedModules)

  const editorRef = useRef<BlockEditorHandle | null>(null)
  const intervalRef = useRef<number | null>(null)
  const simRef = useRef<Simulator | null>(null)

  const activeBlock = project.blocks.find((b) => b.id === activeId) ?? project.blocks[0]
  const codegen = useMemo(() => generate(project), [project])

  // --- Block-Mutationen ---
  function updateBlock(id: string, patch: Partial<Block>) {
    setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }

  function addFunctionBlock() {
    const name = window.prompt('Name des Funktionsblocks (z. B. TURN_LEFT):', 'TURN_LEFT')
    if (!name) return
    const safe = name.trim().replace(/\s+/g, '_')
    const block: Block = { id: newId(), name: safe, kind: 'function', enabled: true, code: '# ' + safe + '\n' }
    setProject((p) => ({ ...p, blocks: [...p.blocks, block] }))
    setActiveId(block.id)
  }

  function renameBlock(id: string) {
    const b = project.blocks.find((x) => x.id === id)
    if (!b) return
    const name = window.prompt('Block umbenennen:', b.name)
    if (!name) return
    updateBlock(id, { name: name.trim().replace(/\s+/g, '_') })
  }

  function duplicateBlock(id: string) {
    const b = project.blocks.find((x) => x.id === id)
    if (!b) return
    const copy: Block = { ...b, id: newId(), name: b.name + '_KOPIE' }
    setProject((p) => {
      const idx = p.blocks.findIndex((x) => x.id === id)
      const blocks = [...p.blocks]
      blocks.splice(idx + 1, 0, copy)
      return { ...p, blocks }
    })
    setActiveId(copy.id)
  }

  function deleteBlock(id: string) {
    const b = project.blocks.find((x) => x.id === id)
    if (!b || b.kind !== 'function') return
    if (!window.confirm(`Block „${b.name}" löschen?`)) return
    setProject((p) => ({ ...p, blocks: p.blocks.filter((x) => x.id !== id) }))
    if (activeId === id) setActiveId(project.blocks[0]?.id ?? '')
  }

  function moveBlock(id: string, dir: -1 | 1) {
    setProject((p) => {
      const idx = p.blocks.findIndex((x) => x.id === id)
      const j = idx + dir
      if (idx < 0 || j < 0 || j >= p.blocks.length) return p
      const blocks = [...p.blocks]
      ;[blocks[idx], blocks[j]] = [blocks[j], blocks[idx]]
      return { ...p, blocks }
    })
  }

  // --- Simulation ---
  function stopSim() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    simRef.current?.stop()
    setRunning(false)
  }

  function startSim() {
    stopSim()
    const s = new Simulator(project)
    s.start()
    simRef.current = s
    setSim(s)
    setSimTick(0)
    setRunning(true)
    setView('output')
    intervalRef.current = window.setInterval(() => {
      // Mehrere Schritte pro Frame = fluessigere, schnellere Fahrt.
      for (let i = 0; i < 2; i++) s.step()
      setSimTick((t) => t + 1)
      if (!s.running) stopSim()
    }, 45)
  }

  useEffect(() => () => stopSim(), [])

  // --- Tastatur-API ---
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

  return (
    <div className="flex h-full flex-col">
      <Header
        project={project}
        onRename={(name) => setProject((p) => ({ ...p, name }))}
        onSave={() => {
          saveProject(project)
        }}
        onLoad={() => {
          const p = loadProject()
          if (p) {
            setProject(p)
            setActiveId(p.blocks[0]?.id ?? '')
          }
        }}
        onExport={handleExport}
        onRun={() => (running ? stopSim() : startSim())}
        running={running}
      />

      {/* Modus-Umschalter: robolang-Playground ⇄ Hardware-Konfiguration */}
      <div className="flex shrink-0 gap-1 border-b border-edge bg-panel2 px-2 py-1">
        <button
          onClick={() => setAppMode('hw')}
          className={`rounded-md px-3 py-1 text-xs font-medium ${appMode === 'hw' ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200'}`}
        >
          🔌 Hardware
        </button>
        <button
          onClick={() => setAppMode('lang')}
          className={`rounded-md px-3 py-1 text-xs font-medium ${appMode === 'lang' ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200'}`}
        >
          🧩 robolang (Playground)
        </button>
      </div>

      {appMode === 'hw' && (
        <HardwarePanel
          boardId={boardId}
          devices={devices}
          modules={modules}
          onBoardChange={setBoardId}
          onDevicesChange={setDevices}
          onModulesChange={setModules}
        />
      )}

      {appMode === 'lang' && (
      <>
      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* Code-Spalte */}
        <div className={`flex min-h-0 flex-col ${view === 'output' ? 'hidden lg:flex' : 'flex'} border-r border-edge`}>
          <BlockTabs
            blocks={project.blocks}
            activeId={activeBlock?.id ?? ''}
            onSelect={setActiveId}
            onAdd={addFunctionBlock}
            onRename={renameBlock}
            onDuplicate={duplicateBlock}
            onDelete={deleteBlock}
            onToggleEnable={(id) => {
              const b = project.blocks.find((x) => x.id === id)
              if (b) updateBlock(id, { enabled: !b.enabled })
            }}
            onMove={moveBlock}
          />
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
            symbols={codegen.symbols}
            api={kbApi}
            nativeMode={nativeMode}
            onToggleNative={() => setNativeMode((v) => !v)}
          />
        </div>

        {/* Ausgabe-/Simulations-Spalte */}
        <div className={`min-h-0 ${view === 'code' ? 'hidden lg:block' : 'block'}`}>
          <OutputPanel result={codegen} sim={sim} simTick={simTick} running={running} />
        </div>
      </div>

      {/* Mobile-Umschalter */}
      <nav className="flex shrink-0 border-t border-edge bg-panel lg:hidden">
        <button
          onClick={() => setView('code')}
          className={`flex-1 py-2 text-xs font-medium ${view === 'code' ? 'text-accent' : 'text-gray-500'}`}
        >
          ⌨ Code
        </button>
        <button
          onClick={() => setView('output')}
          className={`flex-1 py-2 text-xs font-medium ${view === 'output' ? 'text-accent' : 'text-gray-500'}`}
        >
          🤖 Ausgabe
        </button>
      </nav>
      </>
      )}
    </div>
  )
}

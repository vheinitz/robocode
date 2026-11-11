import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Project,
  Block,
  BlockKind,
  ProjectInfo,
  newId,
  createPlaygroundProject,
  loadOrCreateCurrent,
  saveProjectRecord,
  setCurrentProjectId,
  listProjects,
  loadProjectById,
  deleteProjectRecord,
  exportProjectJson,
} from './model/project'
import { assembleSketch } from './hw/assemble'
import { BOARDS, getBoard, defaultPins, isValidName, ROLE_LABEL, PinDesc, PinRole } from './hw/boards'
import BlockEditor, { BlockEditorHandle } from './editor/BlockEditor'
import { Icon } from './editor/icons'

// Feste Code-Container; sichtbar ist (wie in der Android-App) nur MAIN.
const TAB_ORDER: BlockKind[] = ['setup', 'main', 'lib']

interface IconTok {
  icon: string
  insert: string
  help: string
}
function toolTokens(kind: BlockKind): IconTok[] {
  return [
    { icon: 'while', insert: 'while True:', help: 'Schleife – wiederholt den eingerückten Block' },
    { icon: 'for', insert: 'for i in range(10):', help: 'Zähl-Schleife – i läuft von 0 bis 9' },
    { icon: 'if', insert: 'if :', help: 'Wenn … dann' },
    { icon: 'elif', insert: 'elif :', help: 'Sonst wenn …' },
    { icon: 'else', insert: 'else:', help: 'Sonst' },
    ...(kind === 'lib' ? [{ icon: 'def', insert: 'def name():', help: 'Eigene Funktion' }] : []),
    { icon: 'wait', insert: 'wait(500)', help: 'Warten (Millisekunden)' },
    { icon: 'every', insert: 'takt = Every(300)', help: 'Takt – alle n ms, ohne zu blockieren' },
    { icon: 'log', insert: 'log("Hallo")', help: 'Seriell senden – erscheint im Terminal der App' },
    { icon: 'toggle', insert: '.toggle()', help: 'Ausgang umschalten' },
    { icon: 'color', insert: '.color("rot")', help: 'RGB-Farbe setzen' },
    { icon: 'gt', insert: ' > ', help: 'größer als' },
  ]
}

// Aufklappbare Palette (wie Android): oben die Gruppen, Klick klappt die
// passende Unterzeile auf. Board = 3 Ebenen (do/di/a → Zahl); Warte = feste
// Zeiten + Schieberegler; die übrigen Gruppen haben feste Einträge (LEAVES).
type Grp = 'board' | 'kontrolle' | 'operator' | 'warte' | 'seriell' | 'mehr'
const GROUPS: { key: Grp; icon: string; title: string }[] = [
  { key: 'board', icon: 'chip', title: 'Board – Ausgänge/Eingänge (do/di/a) + eigene Pins' },
  { key: 'kontrolle', icon: 'while', title: 'Kontrolle – Schleifen & Verzweigungen' },
  { key: 'operator', icon: 'gt', title: 'Operatoren – vergleichen & rechnen' },
  { key: 'warte', icon: 'wait', title: 'Warten – feste Zeit oder Schieberegler' },
  { key: 'seriell', icon: 'log', title: 'Seriell – Text zum Terminal senden' },
  { key: 'mehr', icon: 'every', title: 'Mehr – Takt, Umschalten, Farbe' },
]
interface Leaf {
  icon?: string
  label?: string
  insert: string
  help: string
}
const LEAVES: Record<Exclude<Grp, 'board' | 'warte'>, Leaf[]> = {
  kontrolle: [
    { icon: 'while', insert: 'while True:', help: 'Schleife – wiederholt den eingerückten Block' },
    { icon: 'for', insert: 'for i in range(10):', help: 'Zähl-Schleife – i läuft von 0 bis 9' },
    { icon: 'if', insert: 'if :', help: 'Wenn … dann' },
    { icon: 'elif', insert: 'elif :', help: 'Sonst wenn …' },
    { icon: 'else', insert: 'else:', help: 'Sonst' },
    { icon: 'def', insert: 'def name():', help: 'Eigene Funktion' },
  ],
  operator: [
    { label: '>', insert: ' > ', help: 'größer als' },
    { label: '<', insert: ' < ', help: 'kleiner als' },
    { label: '>=', insert: ' >= ', help: 'größer oder gleich' },
    { label: '<=', insert: ' <= ', help: 'kleiner oder gleich' },
    { label: '==', insert: ' == ', help: 'gleich (Vergleich)' },
    { label: '=', insert: ' = ', help: 'zuweisen' },
    { label: '+', insert: ' + ', help: 'plus' },
    { label: '-', insert: ' - ', help: 'minus' },
    { label: 'und', insert: ' and ', help: 'und (beide wahr)' },
    { label: 'oder', insert: ' or ', help: 'oder (eins wahr)' },
    { label: 'nicht', insert: 'not ', help: 'nicht (umkehren)' },
  ],
  seriell: [
    { icon: 'log', insert: 'log("Hallo")', help: 'Text senden – erscheint im Terminal der App' },
    { label: 'log x', insert: 'log("Wert:", )', help: 'Text und einen Wert senden' },
  ],
  mehr: [
    { icon: 'every', insert: 'takt = Every(300)', help: 'Takt – alle n ms, ohne zu blockieren' },
    { icon: 'toggle', insert: '.toggle()', help: 'Ausgang umschalten' },
    { icon: 'color', insert: '.color("rot")', help: 'RGB-Farbe setzen' },
  ],
}
const WAIT_PRESETS = [100, 250, 500, 1000, 2000]

const PORT_HELP: { icon: string; title: string; help: string }[] = [
  { icon: 'chip', title: 'Board b', help: 'Das Board ist schon da. Tippe es an, dann do/di/a wählen.' },
  { icon: 'do', title: 'b.doN = 1', help: 'Ausgang setzen. 0/1 = aus/an, jede andere Zahl = PWM 0..255.' },
  { icon: 'di', title: 'b.diN', help: 'Digital-Eingang lesen (z. B. Taster): if b.di0:' },
  { icon: 'a', title: 'b.aN', help: 'Analog lesen (0..255): t = b.a1' },
]

const ALL_ROLES: PinRole[] = ['A', 'DI', 'DO', 'SDA', 'SCL', 'SPI', 'INT', 'none']

function ensurePlayground(p: Project): Project {
  const fresh = createPlaygroundProject()
  const blocks = TAB_ORDER.map(
    (kind) => p.blocks.find((b) => b.kind === kind) ?? fresh.blocks.find((b) => b.kind === kind)!,
  )
  return { ...p, blocks }
}

function knownNamesOf(project: Project): string[] {
  const names = new Set<string>()
  const re = /^\s*([A-Za-z_]\w*)\s*=(?!=)/gm
  for (const b of project.blocks) {
    let m: RegExpExecArray | null
    while ((m = re.exec(b.code))) names.add(m[1])
  }
  return [...names]
}

function uniqueName(base: string): string {
  const names = new Set(listProjects().map((p) => p.name))
  if (!names.has(base)) return base
  let i = 2
  while (names.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

export default function App() {
  const [project, setProject] = useState<Project>(() => ensurePlayground(loadOrCreateCurrent()))
  const [projects, setProjects] = useState<ProjectInfo[]>(() => listProjects())
  const blocks = TAB_ORDER.map((k) => project.blocks.find((b) => b.kind === k)!).filter(Boolean)
  const activeKind: BlockKind = 'main'
  const [view, setView] = useState<'code' | 'board' | 'main'>('code')
  const [menuOpen, setMenuOpen] = useState(false)
  const [grp, setGrp] = useState<null | Grp>(null)
  const [grpPort, setGrpPort] = useState<null | 'do' | 'di' | 'a'>(null)
  const [waitMs, setWaitMs] = useState(500)
  const [showHelp, setShowHelp] = useState(false)

  const editorRef = useRef<BlockEditorHandle | null>(null)

  const board = getBoard(project.boardId)
  const banks = board.banks
  const cloned = !!project.pins
  const effectivePins: PinDesc[] = project.pins ?? defaultPins(board)

  // Eigene (umbenannte) Pins mit nutzbarer Rolle → als Chips in der Palette.
  const namedPins = effectivePins.filter(
    (p) => isValidName(p.name) && p.role !== 'none' && !/^(A|DI|DO|GPIO)\d+$/.test(p.name),
  )

  const activeBlock = blocks.find((b) => b.kind === activeKind) ?? blocks[0]
  const knownNames = useMemo(() => knownNamesOf(project), [project])

  // Autosave: jede Änderung (Code, Board, Pins, Name) wird lokal gespeichert.
  useEffect(() => {
    saveProjectRecord(project)
    setCurrentProjectId(project.id)
    setProjects(listProjects())
  }, [project])

  const assembled = useMemo(() => {
    const by = (k: BlockKind) => project.blocks.find((b) => b.kind === k)?.code ?? ''
    return assembleSketch({ setup: by('setup'), lib: by('lib'), main: by('main') }, board, project.pins)
  }, [project, board])

  function updateBlock(id: string, patch: Partial<Block>) {
    setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }

  function insertToken(insert: string) {
    editorRef.current?.insertText(insert)
    if (insert.replace(/\s+$/, '').endsWith(':')) editorRef.current?.newline()
  }

  function portSize(k: 'do' | 'di' | 'a'): number {
    return k === 'do' ? banks.do.length : k === 'di' ? banks.di.length : banks.a.length
  }
  function pickPortNumber(n: number) {
    const insert = grpPort === 'do' ? `b.do${n} = 1` : grpPort === 'di' ? `b.di${n}` : `b.a${n}`
    insertToken(insert)
    setGrpPort(null)
    setGrp(null)
  }

  // --- Projektverwaltung (0.1) ---
  function switchProject(p: Project) {
    setProject(ensurePlayground(p))
    setGrp(null)
    setGrpPort(null)
    setMenuOpen(false)
  }
  function openProject(id: string) {
    const p = loadProjectById(id)
    if (p) switchProject(p)
  }
  function newProject() {
    const p = createPlaygroundProject(uniqueName('Programm'), project.boardId)
    saveProjectRecord(p)
    switchProject(p)
  }
  function duplicateProject() {
    const copy: Project = {
      ...project,
      id: newId('prj'),
      name: uniqueName(`${project.name} Kopie`),
      blocks: project.blocks.map((b) => ({ ...b, id: newId() })),
    }
    saveProjectRecord(copy)
    switchProject(copy)
  }
  function removeProject(id: string) {
    deleteProjectRecord(id)
    const rest = listProjects()
    setProjects(rest)
    if (id === project.id) {
      const next = rest.length ? loadProjectById(rest[0].id) : null
      switchProject(next ?? createPlaygroundProject())
    }
  }

  // --- Board/Pins (0.2) ---
  function setBoard(id: string) {
    // Board wechseln → eigene Pin-Belegung verwirft sich (gehörte zum alten Board).
    setProject((p) => ({ ...p, boardId: id, pins: undefined }))
  }
  function clonePins() {
    setProject((p) => ({ ...p, pins: defaultPins(getBoard(p.boardId)) }))
  }
  function resetPins() {
    setProject((p) => ({ ...p, pins: undefined }))
  }
  function updatePin(gpio: number, patch: Partial<PinDesc>) {
    setProject((p) => {
      const base = p.pins ?? defaultPins(getBoard(p.boardId))
      return { ...p, pins: base.map((pin) => (pin.gpio === gpio ? { ...pin, ...patch } : pin)) }
    })
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

  const iconBtn =
    'inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:border-teal-400'

  const half = Math.ceil(effectivePins.length / 2)
  const leftPins = effectivePins.slice(0, half)
  const rightPins = effectivePins.slice(half)
  const imgSrc = board.image ? `${import.meta.env.BASE_URL}${board.image}` : ''

  // Als Render-Funktion (KEINE innere Komponente) — sonst remountet React die
  // Eingabe bei jedem Tastendruck und der Fokus geht verloren.
  const renderPin = (p: PinDesc) => (
      <div key={p.gpio} className="flex items-center gap-1 py-0.5">
        <span className="w-9 shrink-0 text-right font-mono text-[10px] text-gray-400">G{p.gpio}</span>
        <input
          value={p.name}
          disabled={!cloned}
          onChange={(e) => updatePin(p.gpio, { name: e.target.value })}
          className={`w-20 rounded border px-1 py-0.5 font-mono text-[11px] ${
            cloned ? 'border-gray-300 bg-white text-gray-800' : 'border-transparent bg-gray-50 text-gray-500'
          } ${isValidName(p.name) ? '' : 'border-red-400 text-red-600'}`}
        />
        <select
          value={p.role}
          disabled={!cloned}
          onChange={(e) => updatePin(p.gpio, { role: e.target.value as PinRole })}
          className={`rounded border px-0.5 py-0.5 text-[11px] ${
            cloned ? 'border-gray-300 bg-white text-gray-700' : 'border-transparent bg-gray-50 text-gray-500'
          }`}
          title={p.adc ? 'ADC-fähig' : 'nur digital'}
        >
          {ALL_ROLES.filter((r) => r !== 'A' || p.adc).map((r) => (
            <option key={r} value={r}>{r === 'none' ? '—' : r}</option>
          ))}
        </select>
      </div>
  )

  return (
    <div className="relative flex h-full flex-col bg-gray-100">
      {/* Kompakte Titelzeile mit Projekt-Menü */}
      <div className="relative flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
        <span className="text-[15px] font-bold tracking-wide text-gray-900">RoboCode</span>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Projekte"
          className="flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs text-gray-700 hover:border-teal-400"
        >
          <Icon name="open" size={13} />
          <span className="max-w-[9rem] truncate">{project.name}</span>
          <span className="text-gray-400">▾</span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button title="Export (JSON)" onClick={handleExport} className={iconBtn}><Icon name="download" size={16} /></button>
        </div>

        {/* Projekt-Dropdown */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-24 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Aktuelles Projekt</div>
              <input
                value={project.name}
                onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
                className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <div className="mb-2 flex gap-1">
                <button onClick={newProject} className="flex-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-xs text-teal-700 hover:bg-teal-100">+ Neu</button>
                <button onClick={duplicateProject} className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">Duplizieren</button>
              </div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Gespeicherte Projekte</div>
              <div className="max-h-48 overflow-auto">
                {projects.map((pi) => (
                  <div key={pi.id} className={`flex items-center gap-1 rounded px-1 py-0.5 ${pi.id === project.id ? 'bg-teal-50' : 'hover:bg-gray-50'}`}>
                    <button onClick={() => openProject(pi.id)} className="flex-1 truncate text-left text-xs text-gray-800">
                      {pi.name}
                    </button>
                    <button
                      onClick={() => removeProject(pi.id)}
                      title="Löschen"
                      className="shrink-0 rounded px-1 text-xs text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Nav-Tabs: Code | Board | main.py */}
      <div className="flex shrink-0 bg-[#1a1f27]">
        {([['code', 'Code'], ['board', 'Board'], ['main', 'main.py']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-2 text-xs font-medium ${view === v ? 'text-teal-300' : 'text-gray-400 hover:text-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Panel: CODE */}
      {view === 'code' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Palette – Gruppen */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-gray-100 px-1.5 py-1">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {GROUPS.map((g) => {
                const active = grp === g.key
                return (
                  <button
                    key={g.key}
                    title={g.title}
                    onClick={() => { setGrp(active ? null : g.key); setGrpPort(null) }}
                    className={`inline-flex shrink-0 items-center justify-center rounded border px-2 py-0.5 ${
                      active ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-300 bg-white text-gray-700 hover:border-teal-400'
                    }`}
                  >
                    <Icon name={g.icon} />
                  </button>
                )
              })}
            </div>
            <button
              title="Rückgängig"
              onClick={() => editorRef.current?.undo()}
              className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 hover:border-teal-400 hover:text-teal-700"
            >
              <Icon name="undo" />
            </button>
            <button
              title="Was bedeuten die Symbole?"
              onClick={() => setShowHelp(true)}
              className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 hover:border-teal-400 hover:text-teal-700"
            >
              <Icon name="help" />
            </button>
          </div>

          {/* Palette – aufgeklappte Unterzeile */}
          {grp && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 overflow-x-auto border-b border-gray-200 bg-white px-1.5 py-1">
              {grp === 'board' && !grpPort && (
                <>
                  {(['do', 'di', 'a'] as const).map((k) => (
                    <button
                      key={k}
                      title={k === 'do' ? 'Ausgang  b.doN = 1' : k === 'di' ? 'Eingang  b.diN' : 'Analog  b.aN'}
                      onClick={() => setGrpPort(k)}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
                    >
                      <Icon name={k} />
                    </button>
                  ))}
                  {/* Eigene Pin-Namen (aus der Board-Ansicht) */}
                  {namedPins.length > 0 && <span className="px-1 text-gray-300">|</span>}
                  {namedPins.map((p) => (
                    <button
                      key={p.gpio}
                      title={`${ROLE_LABEL[p.role]} (GPIO${p.gpio})`}
                      onClick={() => insertToken(p.name)}
                      className="shrink-0 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[12px] text-indigo-700 hover:bg-indigo-100"
                    >
                      {p.name}
                    </button>
                  ))}
                </>
              )}
              {grp === 'board' && grpPort && (
                <>
                  <button
                    title="zurück"
                    onClick={() => setGrpPort(null)}
                    className="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-500 hover:text-gray-900"
                  >
                    ‹
                  </button>
                  {Array.from({ length: portSize(grpPort) }, (_, n) => (
                    <button
                      key={n}
                      onClick={() => pickPortNumber(n)}
                      className="shrink-0 rounded border border-teal-300 bg-teal-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-teal-700 hover:bg-teal-100"
                    >
                      {n}
                    </button>
                  ))}
                </>
              )}

              {grp === 'warte' && (
                <>
                  {WAIT_PRESETS.map((ms) => (
                    <button
                      key={ms}
                      onClick={() => insertToken(`wait(${ms})`)}
                      className="shrink-0 rounded border border-teal-300 bg-teal-50 px-2 py-0.5 font-mono text-[12px] font-semibold text-teal-700 hover:bg-teal-100"
                    >
                      {ms}
                    </button>
                  ))}
                  <span className="px-1 text-gray-300">|</span>
                  <input
                    type="range"
                    min={0}
                    max={2000}
                    step={50}
                    value={waitMs}
                    onChange={(e) => setWaitMs(Number(e.target.value))}
                    className="h-1 w-28 shrink-0 accent-teal-600"
                  />
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-gray-600">wait({waitMs})</span>
                  <button
                    onClick={() => insertToken(`wait(${waitMs})`)}
                    className="shrink-0 rounded border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-[12px] text-teal-700 hover:bg-teal-100"
                  >
                    einfügen
                  </button>
                </>
              )}

              {grp !== 'board' && grp !== 'warte' &&
                LEAVES[grp].map((lf, i) =>
                  lf.icon ? (
                    <button
                      key={i}
                      title={lf.help}
                      onClick={() => insertToken(lf.insert)}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-gray-200 bg-white px-1.5 py-0.5 text-gray-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
                    >
                      <Icon name={lf.icon} />
                    </button>
                  ) : (
                    <button
                      key={i}
                      title={lf.help}
                      onClick={() => insertToken(lf.insert)}
                      className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[12px] text-gray-700 hover:bg-teal-50 hover:text-teal-700"
                    >
                      {lf.label}
                    </button>
                  ),
                )}

              {grp === 'mehr' &&
                knownNames.map((n) => (
                  <button
                    key={n}
                    onClick={() => insertToken(n)}
                    className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[11px] text-gray-500 hover:bg-teal-50 hover:text-teal-700"
                  >
                    {n}
                  </button>
                ))}
            </div>
          )}

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

      {/* Panel: BOARD (0.2) */}
      {view === 'board' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-white">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
            <select
              value={project.boardId}
              onChange={(e) => setBoard(e.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800"
            >
              {BOARDS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {!cloned ? (
              <button onClick={clonePins} className="rounded border border-teal-300 bg-teal-50 px-2 py-1 text-xs text-teal-700 hover:bg-teal-100">
                Fürs Projekt klonen &amp; Pins benennen
              </button>
            ) : (
              <button onClick={resetPins} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                Standard wiederherstellen
              </button>
            )}
            <span className="text-[11px] text-gray-500">
              {cloned ? 'Eigene Belegung — Namen & Bedeutung editierbar.' : 'Standard-Belegung. Zum Umbenennen klonen.'}
            </span>
          </div>

          {/* Board-Bild mittig, Pin-Controls links/rechts drumherum */}
          <div className="flex items-start justify-center gap-2 p-3">
            <div className="flex flex-col">{leftPins.map(renderPin)}</div>
            <div className="flex shrink-0 flex-col items-center">
              {imgSrc ? (
                <img src={imgSrc} alt={board.name} className="max-h-[60vh] w-auto max-w-[220px] rounded border border-gray-200" />
              ) : (
                <div className="flex h-40 w-32 items-center justify-center rounded border border-dashed border-gray-300 text-gray-400"><Icon name="chip" size={40} /></div>
              )}
              <span className="mt-1 text-center text-[11px] font-medium text-gray-600">{board.name}</span>
            </div>
            <div className="flex flex-col">{rightPins.map(renderPin)}</div>
          </div>

          <div className="px-3 pb-4 text-[11px] text-gray-500">
            Default-Namen: <span className="font-mono">A0..</span> (Analog), <span className="font-mono">DI0..</span> (Digital-Eingang),
            <span className="font-mono"> DO0..</span> (Digital-Ausgang). Eigene Namen stehen danach im Code als Symbole bereit
            (in der Palette unter „Board").
          </div>
        </div>
      )}

      {/* Panel: main.py */}
      {view === 'main' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-100 px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              main.py — DSL (versteckt) + Pins + SETUP + LIB + MAIN
            </span>
            <div className="flex gap-1.5">
              <button onClick={() => navigator.clipboard?.writeText(assembled.mainPy)} className={iconBtn}>Kopieren</button>
              <button onClick={downloadMain} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:text-gray-900"><Icon name="download" size={14} />main.py</button>
            </div>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-[#12151b] p-3 font-mono text-[11px] leading-relaxed text-gray-200">
            {assembled.mainPy}
          </pre>
        </div>
      )}

      {/* Hilfe-Legende */}
      {showHelp && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center bg-black/40 p-3 sm:items-center"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="max-h-[80%] w-full max-w-md overflow-auto rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">Was bedeuten die Symbole?</h2>
              <button onClick={() => setShowHelp(false)} className={iconBtn}>✕</button>
            </div>
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ports</div>
              {PORT_HELP.map((h) => (
                <div key={h.icon} className="flex items-start gap-2 py-1">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-700">
                    <Icon name={h.icon} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-teal-700">{h.title}</div>
                    <div className="text-[12px] text-gray-600">{h.help}</div>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Befehle</div>
              {toolTokens('lib').map((t) => (
                <div key={t.icon} className="flex items-start gap-2 py-1">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-200 text-gray-700">
                    <Icon name={t.icon} />
                  </span>
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-gray-800">{t.insert.trim() || '…'}</div>
                    <div className="text-[12px] text-gray-600">{t.help}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

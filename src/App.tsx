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
import { Icon } from './editor/icons'

// Drei feste Code-Tabs (wie in der Android-App).
const TAB_ORDER: BlockKind[] = ['setup', 'main', 'lib']
const TAB_LABEL: Record<string, string> = { setup: 'SETUP', main: 'MAIN', lib: 'LIB' }

// Icon-Tokens für MAIN/LIB (keine Emojis, keine Wörter — Bedeutung in der Hilfe).
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

// SETUP: eigene Geräte benennen (selten nötig, da Board b vordefiniert ist).
// Kurze Code-Kürzel statt Emojis.
const SETUP_TOKENS: { label: string; insert: string }[] = [
  { label: 'DI', insert: 'eingang = DI(4)' },
  { label: 'DO', insert: 'ausgang = DO(5)' },
  { label: 'AI', insert: 'poti = AI(0)' },
  { label: 'AO', insert: 'dimmer = AO(5)' },
  { label: 'LED', insert: 'led = LED(13)' },
  { label: 'RGB', insert: 'rgb = RGB(2)' },
  { label: 'Taster', insert: 'taster = TASTER(2)' },
  { label: 'Motor', insert: 'motor = MOTOR(6, 7)' },
]

// Legende für die Hilfe: Icon → Bedeutung (Werkzeuge + Ports + Board).
const PORT_HELP: { icon: string; title: string; help: string }[] = [
  { icon: 'chip', title: 'Board b', help: 'Das Board ist schon da. Tippe es an, dann do/di/a wählen.' },
  { icon: 'do', title: 'b.doN = 1', help: 'Ausgang setzen. 0/1 = aus/an, jede andere Zahl = PWM 0..255.' },
  { icon: 'di', title: 'b.diN', help: 'Digital-Eingang lesen (z. B. Taster): if b.di0:' },
  { icon: 'a', title: 'b.aN', help: 'Analog lesen (0..255): t = b.a1' },
]

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

export default function App() {
  const [project, setProject] = useState<Project>(
    () => ensurePlayground(loadProject() ?? createPlaygroundProject()),
  )
  const blocks = TAB_ORDER.map((k) => project.blocks.find((b) => b.kind === k)!).filter(Boolean)
  const [activeKind, setActiveKind] = useState<BlockKind>('setup')
  const [view, setView] = useState<'code' | 'main'>('code')
  const [boardId, setBoardId] = useState<string>(BOARDS[0].id)
  const [portKind, setPortKind] = useState<null | 'do' | 'di' | 'a'>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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

  function insertToken(insert: string) {
    editorRef.current?.insertText(insert)
    if (insert.replace(/\s+$/, '').endsWith(':')) editorRef.current?.newline()
  }

  // Board-Ports: Chip → do/di/a → Zahl. Schreiben klammerlos über die Property:
  // b.doN = 1 (0/1 digital, sonst PWM); Lesen: b.aN / b.diN (Getter liefert Wert).
  const banks = getBoard(boardId).banks
  function portSize(k: 'do' | 'di' | 'a'): number {
    return k === 'do' ? banks.do.length : k === 'di' ? banks.di.length : banks.a.length
  }
  function pickPortNumber(n: number) {
    const insert = portKind === 'do' ? `b.do${n} = 1` : portKind === 'di' ? `b.di${n}` : `b.a${n}`
    insertToken(insert)
    setPortKind(null)
    setPickerOpen(false)
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

  return (
    <div className="relative flex h-full flex-col bg-gray-100">
      {/* Kompakte Titelzeile (wie Android, ohne Verbindungsstatus) */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
        <span className="text-[15px] font-bold tracking-wide text-gray-900">RoboCode</span>
        <span className="hidden text-[11px] text-gray-400 sm:inline">Playground</span>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            title="Board — bestimmt die vordefinierten Pins D.. / A.."
            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-800"
          >
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button title="Speichern" onClick={() => saveProject(project)} className={iconBtn}><Icon name="save" size={16} /></button>
          <button title="Laden" onClick={() => { const p = loadProject(); if (p) setProject(ensurePlayground(p)) }} className={iconBtn}><Icon name="open" size={16} /></button>
          <button title="Export (JSON)" onClick={handleExport} className={iconBtn}><Icon name="download" size={16} /></button>
        </div>
      </div>

      {/* Nav-Tabs: Code | main.py (dunkle Leiste wie Android) */}
      <div className="flex shrink-0 bg-[#1a1f27]">
        {([['code', 'Code'], ['main', 'main.py']] as const).map(([v, label]) => (
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
          {/* Sub-Tabs SETUP/MAIN/LIB */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-gray-100 px-2 py-1.5">
            {blocks.map((b) => (
              <button
                key={b.kind}
                onClick={() => setActiveKind(b.kind)}
                className={`flex-1 rounded-md border px-3 py-1 text-xs font-medium ${
                  b.kind === activeKind
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:text-gray-900'
                }`}
              >
                {TAB_LABEL[b.kind]}
              </button>
            ))}
          </div>

          {/* Board-Ports: Chip → do/di/a → Zahl (nur ausserhalb SETUP). */}
          {activeKind !== 'setup' && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-2 py-1.5">
              <button
                title="Board-Ports einfügen"
                onClick={() => { setPickerOpen((o) => !o); setPortKind(null) }}
                className={`inline-flex items-center justify-center rounded border px-2 py-1 ${
                  pickerOpen ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-300 bg-white text-gray-700 hover:border-teal-400'
                }`}
              >
                <Icon name="chip" />
              </button>
              {pickerOpen && <span className="text-gray-300">›</span>}
              {pickerOpen &&
                (['do', 'di', 'a'] as const).map((k) => (
                  <button
                    key={k}
                    title={k === 'do' ? 'Ausgang  b.doN = 1' : k === 'di' ? 'Eingang  b.diN' : 'Analog  b.aN'}
                    onClick={() => setPortKind((p) => (p === k ? null : k))}
                    className={`inline-flex items-center justify-center rounded border px-2 py-1 ${
                      portKind === k ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-300 bg-white text-gray-700 hover:border-teal-400'
                    }`}
                  >
                    <Icon name={k} />
                  </button>
                ))}
              {pickerOpen && portKind && <span className="text-gray-300">›</span>}
              {pickerOpen && portKind &&
                Array.from({ length: portSize(portKind) }, (_, n) => (
                  <button
                    key={n}
                    onClick={() => pickPortNumber(n)}
                    className="rounded border border-teal-300 bg-teal-50 px-2.5 py-1 font-mono text-[12px] font-semibold text-teal-700 hover:bg-teal-100"
                  >
                    {n}
                  </button>
                ))}
            </div>
          )}

          {/* Token-Palette (Icons für MAIN/LIB, Textkürzel für SETUP) + Undo & Hilfe */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 bg-gray-100 px-2 py-1.5">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {activeKind === 'setup'
                ? SETUP_TOKENS.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => insertToken(t.insert)}
                      className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-700 hover:bg-teal-50 hover:text-teal-700"
                    >
                      {t.label}
                    </button>
                  ))
                : toolTokens(activeKind).map((t, i) => (
                    <button
                      key={i}
                      title={t.help}
                      onClick={() => insertToken(t.insert)}
                      className="inline-flex shrink-0 items-center justify-center rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
                    >
                      <Icon name={t.icon} />
                    </button>
                  ))}
              {/* Vom Kind benannte Variablen als Text-Chips */}
              {knownNames.map((n) => (
                <button
                  key={n}
                  onClick={() => insertToken(n)}
                  className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-500 hover:bg-teal-50 hover:text-teal-700"
                >
                  {n}
                </button>
              ))}
            </div>
            {/* Feste Werkzeuge rechts: Rückgängig & Hilfe */}
            <button
              title="Rückgängig"
              onClick={() => editorRef.current?.undo()}
              className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:border-teal-400 hover:text-teal-700"
            >
              <Icon name="undo" />
            </button>
            <button
              title="Was bedeuten die Symbole?"
              onClick={() => setShowHelp(true)}
              className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:border-teal-400 hover:text-teal-700"
            >
              <Icon name="help" />
            </button>
          </div>

          {/* Editor (dunkel, wie Android) */}
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
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-100 px-2 py-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              main.py — DSL (versteckt) + SETUP + LIB + MAIN
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

      {/* Hilfe-Legende: Icon → Bedeutung */}
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

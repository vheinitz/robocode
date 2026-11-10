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

// Feste Code-Container; sichtbar ist (wie in der Android-App) nur MAIN.
// SETUP/LIB bleiben als Seed erhalten und werden mitassembliert.
const TAB_ORDER: BlockKind[] = ['setup', 'main', 'lib']

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

// Aufklappbare Palette (wie Android): oben die Gruppen, Klick klappt die
// passende Unterzeile auf. Board = 3 Ebenen (do/di/a → Zahl); Warte = feste
// Zeiten + Schieberegler; die übrigen Gruppen haben feste Einträge (LEAVES).
type Grp = 'board' | 'kontrolle' | 'operator' | 'warte' | 'seriell' | 'mehr'
const GROUPS: { key: Grp; icon: string; title: string }[] = [
  { key: 'board', icon: 'chip', title: 'Board – Ausgänge/Eingänge (do/di/a)' },
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
  // Nur MAIN sichtbar (wie Android). SETUP/LIB bleiben als Seed im Projekt.
  const activeKind: BlockKind = 'main'
  const [view, setView] = useState<'code' | 'main'>('code')
  const [boardId, setBoardId] = useState<string>(BOARDS[0].id)
  // Aufklappbare Palette: aktive Gruppe, (bei Board) do/di/a-Ebene, Warte-Wert.
  const [grp, setGrp] = useState<null | Grp>(null)
  const [grpPort, setGrpPort] = useState<null | 'do' | 'di' | 'a'>(null)
  const [waitMs, setWaitMs] = useState(500)
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
    const insert = grpPort === 'do' ? `b.do${n} = 1` : grpPort === 'di' ? `b.di${n}` : `b.a${n}`
    insertToken(insert)
    setGrpPort(null)
    setGrp(null)
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
          {/* Palette – Gruppen (Klick klappt die passende Unterzeile auf) */}
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
            {/* Feste Werkzeuge rechts: Rückgängig & Hilfe */}
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

          {/* Palette – aufgeklappte Unterzeile zur gewählten Gruppe */}
          {grp && (
            <div className="flex shrink-0 flex-wrap items-center gap-1 overflow-x-auto border-b border-gray-200 bg-white px-1.5 py-1">
              {/* Board: do/di/a → Zahl */}
              {grp === 'board' && !grpPort &&
                (['do', 'di', 'a'] as const).map((k) => (
                  <button
                    key={k}
                    title={k === 'do' ? 'Ausgang  b.doN = 1' : k === 'di' ? 'Eingang  b.diN' : 'Analog  b.aN'}
                    onClick={() => setGrpPort(k)}
                    className="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
                  >
                    <Icon name={k} />
                  </button>
                ))}
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

              {/* Warte: feste Zeiten + Schieberegler */}
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

              {/* Kontrolle / Operator / Seriell / Mehr: feste Einträge */}
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

              {/* In „Mehr": vom Kind benannte Variablen als Text-Chips */}
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

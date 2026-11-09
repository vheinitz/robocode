import { useState } from 'react'
import { CodegenResult } from '../lang/codegen'
import { Simulator } from '../sim/simulator'
import SimCanvas from './SimCanvas'

type Tab = 'robot' | 'serial' | 'gen'

interface Props {
  result: CodegenResult
  sim: Simulator | null
  simTick: number
  running: boolean
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/x-python' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function OutputPanel({ result, sim, simTick, running }: Props) {
  const [tab, setTab] = useState<Tab>('robot')
  const [genFile, setGenFile] = useState(0)

  const serial = sim ? sim.log : []

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1.5">
        {(
          [
            ['robot', '🤖 Roboter'],
            ['serial', '🖳 Serial'],
            ['gen', '📄 MicroPython'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              tab === k ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
        {result.errors.length > 0 && (
          <span className="ml-auto rounded-full bg-danger/15 px-2 py-0.5 text-[11px] text-danger">
            {result.errors.length} Fehler
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'robot' && (
          <div>
            {sim ? (
              <>
                <SimCanvas sim={sim} tick={simTick} />
                <p className="mt-3 text-center text-[11px] text-gray-600">
                  Vereinfachte Browser-Simulation der Programmlogik — kein echtes
                  MicroPython / Wokwi.
                </p>
                {sim.error && <p className="mt-2 text-center text-xs text-danger">{sim.error}</p>}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-600">
                <span>▶ „Simulieren" starten, um den Roboter fahren zu sehen.</span>
              </div>
            )}
          </div>
        )}

        {tab === 'serial' && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-300">
            {serial.length ? serial.join('\n') : '— noch keine Ausgabe —'}
            {running && <span className="animate-pulse">▌</span>}
          </pre>
        )}

        {tab === 'gen' && (
          <div>
            {result.errors.length > 0 && (
              <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
                {result.errors.map((e, i) => (
                  <div key={i}>
                    {e.blockName}:{e.line} — {e.message}
                  </div>
                ))}
              </div>
            )}
            <div className="mb-2 flex items-center gap-1">
              {result.files.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => setGenFile(i)}
                  className={`rounded-md px-2 py-1 font-mono text-[11px] ${
                    genFile === i ? 'bg-panel2 text-accent' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {f.path}
                </button>
              ))}
              <button
                onClick={() => result.files.forEach((f) => download(f.path, f.content))}
                className="ml-auto rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
              >
                ⤓ Alle .py laden
              </button>
            </div>
            <pre className="overflow-auto rounded-md border border-edge bg-[#12151b] p-3 font-mono text-xs leading-relaxed text-gray-200">
              {result.files[genFile]?.content}
            </pre>
            <p className="mt-2 text-[11px] text-gray-600">
              Wokwi-Integration (Spec §10) ist Phase 3: Die drei Dateien lassen sich
              in ein MicroPython-Projekt auf wokwi.com einfügen. Eine automatische
              API-Anbindung wird bewusst erst nach Prüfung umgesetzt.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

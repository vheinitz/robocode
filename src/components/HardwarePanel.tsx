import { useMemo, useState } from 'react'
import { BOARDS, getBoard, PinDef } from '../hw/boards'
import { transpileRobolang } from '../lang/robolang'
import {
  Device,
  DeviceType,
  DEVICE_TYPES,
  instanceNames,
  pinAllowed,
  validate,
  PinSlot,
} from '../hw/devices'
import { assembleMainPy } from '../hw/assemble'
import { RoboModule, newModule, combineModules, locateLine } from '../lang/modules'
import { newId } from '../model/project'

interface Props {
  boardId: string
  devices: Device[]
  modules: RoboModule[]
  onBoardChange: (id: string) => void
  onDevicesChange: (devices: Device[]) => void
  onModulesChange: (modules: RoboModule[]) => void
}

export default function HardwarePanel({
  boardId,
  devices,
  modules,
  onBoardChange,
  onDevicesChange,
  onModulesChange,
}: Props) {
  const [codeView, setCodeView] = useState<'main' | 'py'>('main')
  const [activeModId, setActiveModId] = useState<string>(() => modules[0]?.id ?? '')
  const board = getBoard(boardId)
  const instances = useMemo(() => instanceNames(devices), [devices])
  const issues = useMemo(() => validate(board, devices), [board, devices])
  const knownInstances = useMemo(() => new Set(instances.values()), [instances])

  // Alle Module zu einem Quelltext fügen (Funktionsmodule zuerst) und EINMAL
  // transpilieren — so sehen 🧩-Aufrufe die Definitionen aus anderen Modulen.
  const combined = useMemo(() => combineModules(modules), [modules])
  const robo = useMemo(
    () => transpileRobolang(combined.source, knownInstances),
    [combined.source, knownInstances],
  )
  const assembled = useMemo(() => assembleMainPy(board, devices, robo.python), [board, devices, robo.python])

  // Transpiler-Meldungen tragen Zeilen des Gesamtquelltexts — zurück auf
  // Modul + lokale Zeile abbilden, damit die Meldung auffindbar bleibt.
  const roboIssues = useMemo(
    () => robo.issues.map((i) => ({ ...i, at: locateLine(combined.spans, i.line) })),
    [robo.issues, combined.spans],
  )
  const roboErrors = roboIssues.filter((i) => i.level === 'error')
  const roboWarns = roboIssues.filter((i) => i.level === 'warn')

  const activeMod = modules.find((m) => m.id === activeModId) ?? modules[0]

  function updateModuleCode(code: string) {
    if (!activeMod) return
    onModulesChange(modules.map((m) => (m.id === activeMod.id ? { ...m, code } : m)))
  }
  function addModule() {
    const base = 'MODUL'
    let n = modules.filter((m) => m.kind === 'module').length + 1
    const taken = new Set(modules.map((m) => m.name.toUpperCase()))
    while (taken.has(`${base}${n}`)) n++
    const mod = newModule(`${base}${n}`, 'module', '🧩neu [n]:\n  ⏱️ n\n')
    onModulesChange([...modules, mod])
    setActiveModId(mod.id)
  }
  function renameModule(id: string) {
    const m = modules.find((x) => x.id === id)
    if (!m) return
    const name = window.prompt('Modul umbenennen:', m.name)
    if (!name) return
    onModulesChange(modules.map((x) => (x.id === id ? { ...x, name: name.trim() } : x)))
  }
  function removeModule(id: string) {
    const m = modules.find((x) => x.id === id)
    if (!m || m.kind === 'main') return // Hauptmodul bleibt
    if (!window.confirm(`Modul „${m.name}" löschen?`)) return
    const rest = modules.filter((x) => x.id !== id)
    onModulesChange(rest)
    if (activeModId === id) setActiveModId(rest[0]?.id ?? '')
  }

  function addDevice(type: DeviceType) {
    const count = devices.filter((d) => d.type === type).length + 1
    const base: Record<DeviceType, string> = {
      button: 'TASTER', led: 'LED', din: 'DIN', dout: 'DOUT',
      light: 'LICHT', ain: 'AIN', poti: 'POTI', motor: 'MOTOR',
    }
    const dev: Device = { id: newId('dev'), type, name: `${base[type]}${count}`, pins: {} }
    onDevicesChange([...devices, dev])
  }
  function updateDevice(id: string, patch: Partial<Device>) {
    onDevicesChange(devices.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }
  function removeDevice(id: string) {
    onDevicesChange(devices.filter((d) => d.id !== id))
  }

  function download() {
    const blob = new Blob([assembled.mainPy], { type: 'text/x-python' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'main.py'
    a.click()
    URL.revokeObjectURL(url)
  }

  const errors = issues.filter((i) => i.level === 'error')
  const warns = issues.filter((i) => i.level === 'warn')

  return (
    <div className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-2">
      {/* Konfiguration */}
      <div className="min-h-0 overflow-auto border-r border-edge p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-400">Board</label>
          <select
            value={boardId}
            onChange={(e) => onBoardChange(e.target.value)}
            className="rounded-md border border-edge bg-panel2 px-2 py-1 text-sm text-gray-100"
          >
            {BOARDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="rounded-full border border-edge bg-panel2 px-2 py-0.5 text-[11px] text-gray-400">
            Flash-Offset 0x{board.flashOffset.toString(16)}
          </span>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {(Object.keys(DEVICE_TYPES) as DeviceType[]).map((t) => (
            <button
              key={t}
              onClick={() => addDevice(t)}
              className="rounded-md border border-dashed border-edge px-2.5 py-1 text-xs text-gray-300 hover:border-accent hover:text-accent"
            >
              + {DEVICE_TYPES[t].emoji} {DEVICE_TYPES[t].label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              instance={instances.get(d.id) ?? '?'}
              board={board}
              onChange={(patch) => updateDevice(d.id, patch)}
              onRemove={() => removeDevice(d.id)}
            />
          ))}
          {devices.length === 0 && (
            <p className="py-6 text-center text-xs text-gray-600">
              Noch keine Geräte. Oben einen Typ hinzufügen und Pins vergeben.
            </p>
          )}
        </div>

        {(errors.length > 0 || warns.length > 0) && (
          <div className="mt-3 space-y-1">
            {errors.map((i, k) => (
              <div key={`e${k}`} className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                ✖ {i.message}
              </div>
            ))}
            {warns.map((i, k) => (
              <div key={`w${k}`} className="rounded-md border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                ⚠ {i.message}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-xs text-gray-400">
            robolang-Programm (nutzt die Geräte oben über 💡⚙️👁️🔲 + Name).
            Mehrere Module werden beim Übersetzen zusammengefügt — Funktionsmodule
            (🧩) zuerst, das Hauptmodul zuletzt.
          </label>

          {/* Modul-Reiter */}
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModId(m.id)}
                onDoubleClick={() => renameModule(m.id)}
                title={m.kind === 'main' ? 'Hauptmodul (Programmablauf)' : 'Funktionsmodul (umbenennen: Doppelklick)'}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                  activeMod?.id === m.id
                    ? 'bg-accent/15 text-accent'
                    : 'bg-panel2 text-gray-400 hover:text-gray-200'
                }`}
              >
                <span>{m.kind === 'main' ? '▶' : '🧩'}</span>
                {m.name}
                {m.kind !== 'main' && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      removeModule(m.id)
                    }}
                    className="ml-0.5 text-danger/60 hover:text-danger"
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={addModule}
              className="rounded-md border border-dashed border-edge px-2 py-1 text-[11px] text-gray-400 hover:border-accent hover:text-accent"
            >
              + Modul
            </button>
          </div>

          <textarea
            value={activeMod?.code ?? ''}
            onChange={(e) => updateModuleCode(e.target.value)}
            spellCheck={false}
            className="h-44 w-full resize-y rounded-md border border-edge bg-[#12151b] p-2 font-mono text-xs text-gray-200 focus:border-accent focus:outline-none"
          />
          {(roboErrors.length > 0 || roboWarns.length > 0) && (
            <div className="mt-2 space-y-1">
              {roboErrors.map((i, k) => (
                <div key={`re${k}`} className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger">
                  ✖ {i.at ? `${i.at.name} Z. ${i.at.localLine}` : `Z. ${i.line}`}: {i.message}
                </div>
              ))}
              {roboWarns.map((i, k) => (
                <div key={`rw${k}`} className="rounded-md border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                  ⚠ {i.at ? `${i.at.name} Z. ${i.at.localLine}` : `Z. ${i.line}`}: {i.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Assembliertes main.py / robolang-Übersetzung */}
      <div className="flex min-h-0 flex-col p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => setCodeView('main')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${codeView === 'main' ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200'}`}
            >
              main.py
            </button>
            <button
              onClick={() => setCodeView('py')}
              className={`rounded-md px-2 py-1 text-[11px] font-medium ${codeView === 'py' ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-gray-200'}`}
            >
              robolang → Python
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => navigator.clipboard?.writeText(codeView === 'main' ? assembled.mainPy : robo.python)}
              className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
            >
              Kopieren
            </button>
            <button
              onClick={download}
              className="rounded-md border border-edge bg-panel2 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
            >
              ⤓ main.py
            </button>
          </div>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-edge bg-[#12151b] p-3 font-mono text-[11px] leading-relaxed text-gray-200">
          {codeView === 'main' ? assembled.mainPy : robo.python || '# (leeres Programm)'}
        </pre>
        <p className="mt-2 text-[11px] text-gray-600">
          Diese Datei überträgt die Android-App später per raw-REPL über USB-CDC
          (kein .bin). Die MicroPython-Firmware selbst wird getrennt geflasht
          (vgl. ../espflasher).
        </p>
      </div>
    </div>
  )
}

function DeviceRow({
  device,
  instance,
  board,
  onChange,
  onRemove,
}: {
  device: Device
  instance: string
  board: ReturnType<typeof getBoard>
  onChange: (patch: Partial<Device>) => void
  onRemove: () => void
}) {
  const info = DEVICE_TYPES[device.type]
  return (
    <div className="rounded-md border border-edge bg-panel2 p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">{info.emoji} {info.cls}</span>
        <input
          value={device.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-gray-100 hover:border-edge focus:border-accent focus:outline-none"
        />
        <span className="font-mono text-[11px] text-gray-500">→ {instance}</span>
        <button onClick={onRemove} className="ml-auto text-xs text-danger/70 hover:text-danger">
          entfernen
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {info.slots.map((slot) => (
          <PinSelect
            key={slot.key}
            slot={slot}
            board={board}
            value={device.pins[slot.key]}
            onChange={(gpio) => onChange({ pins: { ...device.pins, [slot.key]: gpio } })}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {info.methods.map((m) => (
          <span
            key={m.name}
            title={m.desc}
            className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
          >
            {instance}.{m.name}()
          </span>
        ))}
      </div>
    </div>
  )
}

function PinSelect({
  slot,
  board,
  value,
  onChange,
}: {
  slot: PinSlot
  board: ReturnType<typeof getBoard>
  value: number | undefined
  onChange: (gpio: number | undefined) => void
}) {
  const options = board.pins.filter((p: PinDef) => pinAllowed(slot.cap, p))
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-400">
      {slot.label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="rounded border border-edge bg-panel px-1.5 py-1 font-mono text-xs text-gray-100"
      >
        <option value="">—</option>
        {options.map((p) => (
          <option key={p.gpio} value={p.gpio}>
            GPIO {p.gpio}
            {p.strapping ? ' ⚠' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

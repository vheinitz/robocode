// Vereinfachte Browser-Simulation (KEIN echtes MicroPython, KEIN Wokwi!).
//
// Was hier passiert: die RobotCode-Bloecke werden direkt interpretiert (ein
// kleiner Tree-Walking-Interpreter) und steuern einen virtuellen
// Differenzialantrieb-Roboter auf einer 2D-Linie. Zweck: die LOGIK des
// Programms sicht- und pruefbar machen (Spec §12, Punkt 5). Die echte
// Ausfuehrung auf einem virtuellen ESP32 ist Phase 3 (Wokwi) und wird hier
// bewusst NICHT nachgebaut (Spec §10: "Do not build an ESP32 simulator from
// scratch").

import { Project } from '../model/project'
import { collectSymbols, transformConditionForSim, SymbolTable } from './condition'

export const WORLD = { w: 320, h: 320 }
const TRACK_HALF_WIDTH = 12 // bis hierher (px vom Linien-Mittelpunkt) gilt "schwarz"
const SENSOR_AHEAD = 14 // Sensorzeile vor dem Roboterzentrum
// Wichtig: Sensorabstand > Linien-Halbbreite, damit die beiden Sensoren die
// Linie mittig STRADDELN (zentriert beide weiss -> geradeaus; Drift -> ein
// Sensor wird schwarz -> Korrektur). Das ist das Funktionsprinzip des Beispiels.
const SENSOR_SIDE = 16 // seitlicher Abstand der beiden Sensoren
const DT = 0.09 // Sekunden pro Tick (nur fuer ⏱️-Wartezeiten)
const V_STEP = 0.04 // px Vorschub pro Tick je Motorprozent
const OMEGA_STEP = 0.0015 // rad Drehung pro Tick je Prozent Motordifferenz

export interface RobotState {
  x: number
  y: number
  theta: number
  speedL: number
  speedR: number
  leftBlack: boolean
  rightBlack: boolean
}

interface Node {
  text: string
  line: number
  indent: number
  children: Node[]
}

// --- Strecke: abgerundetes Rechteck als geschlossene Schleife ---
function buildTrack(): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const cx = WORLD.w / 2
  const cy = WORLD.h / 2
  const rx = 110
  const ry = 92
  const steps = 240
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    // leicht "eckiges" Oval, damit Kurven den Regler fordern
    const x = cx + rx * Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.85)
    const y = cy + ry * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.85)
    pts.push([x, y])
  }
  return pts
}

export class Simulator {
  track = buildTrack()
  state: RobotState
  log: string[] = []
  running = false
  finished = false
  error: string | null = null

  private sym: SymbolTable
  private sensors = new Map<string, { read: () => number; is_black: () => boolean; is_white: () => boolean }>()
  private distances = new Map<string, { distance: () => number }>()
  private vars: Record<string, number> = {}
  private gen: Generator<void> | null = null
  private ticks = 0
  private readonly maxTicks = 100000

  constructor(private project: Project) {
    this.sym = collectSymbols(project.blocks.filter((b) => b.enabled))
    this.state = this.initialPose()
    this.setupSensors()
  }

  private initialPose(): RobotState {
    // Start auf der Strecke, in Fahrtrichtung der Schleife.
    const p0 = this.track[0]
    const p1 = this.track[2]
    return {
      x: p0[0],
      y: p0[1],
      theta: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]),
      speedL: 0,
      speedR: 0,
      leftBlack: false,
      rightBlack: false,
    }
  }

  private setupSensors() {
    for (const s of this.sym.byName.values()) {
      if (s.kind === 'sensor') {
        // Linker/rechter Sensor anhand der Namenskonvention (LEFT/RIGHT),
        // sonst mittig. Rein fuer die Simulation.
        const side = /left|links|l$/i.test(s.name) ? -1 : /right|rechts|r$/i.test(s.name) ? 1 : 0
        const reader = () => this.sensorValueAt(side)
        this.sensors.set(s.instance, {
          read: reader,
          is_black: () => reader() < 1800,
          is_white: () => reader() >= 1800,
        })
      } else if (s.kind === 'distance') {
        this.distances.set(s.instance, { distance: () => this.distanceAhead() })
      }
    }
  }

  private sensorPoint(side: number): [number, number] {
    const { x, y, theta } = this.state
    const fx = x + Math.cos(theta) * SENSOR_AHEAD
    const fy = y + Math.sin(theta) * SENSOR_AHEAD
    const px = Math.cos(theta + Math.PI / 2) * SENSOR_SIDE * side
    const py = Math.sin(theta + Math.PI / 2) * SENSOR_SIDE * side
    return [fx + px, fy + py]
  }

  private distToTrack(x: number, y: number): number {
    let best = Infinity
    for (const [tx, ty] of this.track) {
      const d = (tx - x) * (tx - x) + (ty - y) * (ty - y)
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }

  // 0 = tiefschwarz (auf Linie), 4095 = weiss (daneben).
  private sensorValueAt(side: number): number {
    const [px, py] = this.sensorPoint(side)
    const d = this.distToTrack(px, py)
    return d < TRACK_HALF_WIDTH ? 300 : 3600
  }

  private distanceAhead(): number {
    // Simpler Platzhalter: konstant "frei".
    return 200
  }

  // --- Parsing: Einrueckungsbaum ---
  private parse(code: string): Node[] {
    const root: Node = { text: '', line: 0, indent: -1, children: [] }
    const stack: Node[] = [root]
    const lines = code.split('\n')
    lines.forEach((raw, i) => {
      const codePart = raw.replace(/#.*$/, '')
      if (codePart.trim() === '') return
      const indent = codePart.length - codePart.trimStart().length
      const node: Node = { text: codePart.trim(), line: i + 1, indent, children: [] }
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
      stack[stack.length - 1].children.push(node)
      stack.push(node)
    })
    return root.children
  }

  private blockTree(kind: 'setup' | 'main'): Node[] {
    const b = this.project.blocks.find((x) => x.enabled && x.kind === kind)
    return b ? this.parse(b.code) : []
  }

  private funcTree(name: string): Node[] | null {
    const b = this.project.blocks.find(
      (x) => x.enabled && x.kind === 'function' && x.name.toLowerCase() === name.toLowerCase(),
    )
    return b ? this.parse(b.code) : null
  }

  // --- Ausfuehrung (Generator, yield = ein Tick) ---
  start() {
    this.runSetup()
    this.gen = this.execNodes(this.blockTree('main'))
    this.running = true
  }

  private runSetup() {
    // Deklarationen sind bereits in der Symboltabelle; hier nur evtl.
    // Variablen-Initialisierungen aus SETUP uebernehmen.
    for (const n of this.blockTree('setup')) this.tryPlainAssign(n.text)
  }

  private *execNodes(nodes: Node[]): Generator<void> {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const t = n.text

      // if / else-Kette
      const mIf = t.match(/^(?:❓|if)\s*(.*?):$/)
      if (mIf) {
        const cond = this.evalCondition(mIf[1])
        if (cond) {
          yield* this.execNodes(n.children)
        } else {
          // folgendes ELSE?
          const next = nodes[i + 1]
          if (next && /^(?:ELSE|else)\s*:$/.test(next.text)) {
            i++
            yield* this.execNodes(next.children)
          }
        }
        continue
      }
      if (/^(?:ELSE|else)\s*:$/.test(t)) continue // allein stehend: ignorieren

      const mFor = t.match(/^(?:🔄|for)\s*(\d+)\s*:?$/)
      if (mFor) {
        const n2 = Number(mFor[1])
        for (let k = 0; k < n2; k++) {
          yield* this.execNodes(n.children)
          yield // Fortschritt garantieren
        }
        continue
      }

      if (/^(?:🔁|while)\s*(?:True)?\s*:?$/.test(t)) {
        let guard = 0
        while (this.running && guard++ < this.maxTicks) {
          yield* this.execNodes(n.children)
          yield
        }
        continue
      }

      yield* this.execLeaf(n)
    }
  }

  private *execLeaf(n: Node): Generator<void> {
    const t = n.text
    let m: RegExpMatchArray | null

    if ((m = t.match(/^🤖⬆️\s*=\s*(-?\d+)$/))) return void this.drive(+m[1], +m[1])
    if ((m = t.match(/^🤖⬇️\s*=\s*(-?\d+)$/))) return void this.drive(-+m[1], -+m[1])
    if ((m = t.match(/^🤖⬅️\s*=\s*(-?\d+)$/))) return void this.drive(-+m[1], +m[1])
    if ((m = t.match(/^🤖➡️\s*=\s*(-?\d+)$/))) return void this.drive(+m[1], -+m[1])
    if (/^🤖⏹️$/.test(t)) return void this.drive(0, 0)
    if ((m = t.match(/^⚙️\s*L\s*=\s*(-?\d+)$/))) return void this.drive(+m[1], this.state.speedR)
    if ((m = t.match(/^⚙️\s*R\s*=\s*(-?\d+)$/))) return void this.drive(this.state.speedL, +m[1])

    if ((m = t.match(/^💡\s*([A-Za-z_]\w*)\s*=\s*(ON|OFF|\d+)$/))) {
      const v = m[2] === 'ON' ? 1 : m[2] === 'OFF' ? 0 : Number(m[2])
      this.emit(`[LED ${m[1]}] = ${v ? 'AN' : 'AUS'}`)
      return
    }

    if ((m = t.match(/^⏱️\s*(\d+)$/))) {
      const ticks = Math.max(1, Math.round(Number(m[1]) / 1000 / DT))
      for (let k = 0; k < ticks; k++) yield
      return
    }

    // Funktionsaufruf?
    if ((m = t.match(/^([A-Za-z_]\w*)$/))) {
      const tree = this.funcTree(m[1])
      if (tree) {
        yield* this.execNodes(tree)
        return
      }
    }

    // print(...)
    if ((m = t.match(/^print\s*\((.*)\)$/))) {
      this.emit(this.evalPrint(m[1]))
      return
    }

    // einfache Zuweisung x = ... / x += ...
    if (this.tryPlainAssign(t)) return

    // Unbekannt: ehrlich protokollieren statt so zu tun, als liefe es.
    this.emit(`[uebersprungen] ${t}`)
  }

  private tryPlainAssign(t: string): boolean {
    const m = t.match(/^([A-Za-z_]\w*)\s*(\+=|-=|=)\s*(.+)$/)
    if (!m) return false
    // Deklarationen (SENSOR/MOTOR/LED/ULTRASONIC) nicht als Zuweisung werten.
    if (/\b(SENSOR|MOTOR|LED|ULTRASONIC)\b/.test(t) || /^[⚙️👁️💡📏]/.test(t)) return false
    try {
      const val = this.evalExpr(m[3])
      if (typeof val !== 'number') return false
      if (m[2] === '+=') this.vars[m[1]] = (this.vars[m[1]] || 0) + val
      else if (m[2] === '-=') this.vars[m[1]] = (this.vars[m[1]] || 0) - val
      else this.vars[m[1]] = val
      return true
    } catch {
      return false
    }
  }

  private scope(): Record<string, unknown> {
    const s: Record<string, unknown> = { ...this.vars }
    for (const [k, v] of this.sensors) s[k] = v
    for (const [k, v] of this.distances) s[k] = v
    return s
  }

  private evalExpr(expr: string): unknown {
    const js = transformConditionForSim(expr, this.sym)
    const scope = this.scope()
    const names = Object.keys(scope)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...names, `"use strict"; return (${js});`)
    return fn(...names.map((n) => scope[n]))
  }

  private evalCondition(expr: string): boolean {
    try {
      return !!this.evalExpr(expr)
    } catch (e) {
      this.error = `Bedingung nicht auswertbar: "${expr}" (${e})`
      this.running = false
      return false
    }
  }

  private evalPrint(args: string): string {
    try {
      const v = this.evalExpr(args)
      return `[print] ${typeof v === 'string' ? v : JSON.stringify(v)}`
    } catch {
      return `[print] ${args}`
    }
  }

  private drive(l: number, r: number) {
    this.state.speedL = Math.max(-100, Math.min(100, l))
    this.state.speedR = Math.max(-100, Math.min(100, r))
  }

  private emit(msg: string) {
    this.log.push(msg)
    if (this.log.length > 400) this.log.shift()
  }

  /** Einen Simulationsschritt ausfuehren: Interpreter + Physik. */
  step(): void {
    if (!this.running || !this.gen) return
    const res = this.gen.next()
    if (res.done) {
      this.running = false
      this.finished = true
    }
    this.ticks++
    if (this.ticks > this.maxTicks) this.running = false
    this.physics()
    // Sensorstatus fuer die Anzeige aktualisieren
    this.state.leftBlack = this.sensorValueAt(-1) < 1800
    this.state.rightBlack = this.sensorValueAt(1) < 1800
  }

  private physics() {
    const s = this.state
    // Differenzialantrieb: mittlere Geschwindigkeit -> Vorschub,
    // Drehzahldifferenz -> Drehung.
    const v = ((s.speedL + s.speedR) / 2) * V_STEP
    // y zeigt nach unten -> positives Drehmoment ist im Uhrzeigersinn. Damit
    // robot.left() auch visuell nach links dreht, linker minus rechter Motor.
    const omega = ((s.speedL - s.speedR) / 2) * OMEGA_STEP
    s.theta += omega
    s.x += Math.cos(s.theta) * v
    s.y += Math.sin(s.theta) * v
    // in der Welt halten
    s.x = Math.max(4, Math.min(WORLD.w - 4, s.x))
    s.y = Math.max(4, Math.min(WORLD.h - 4, s.y))
  }

  stop() {
    this.running = false
  }
}

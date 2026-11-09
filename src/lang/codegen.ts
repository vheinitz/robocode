// Codegen: aus den Bloecken ein vollstaendiges MicroPython-Projekt bauen
// (main.py + robot.py + hardware.py), Spec §9.
//
// SETUP laeuft einmal auf Modulebene (damit die dort erzeugten Instanzen wie
// left/right/motor_l globale Namen werden, die MAIN und Funktionen lesen
// koennen). Jeder Funktionsblock wird zu einer echten def-Funktion, MAIN zum
// Einstiegspunkt.

import { Block, Project } from '../model/project'
import { collectSymbols, transpileBlock, SourceMapEntry, TranspileError, SymbolTable } from './transpiler'

export interface GeneratedFile {
  path: string
  content: string
}

export interface CodegenResult {
  files: GeneratedFile[]
  mainPy: string
  errors: TranspileError[]
  map: SourceMapEntry[]
  symbols: SymbolTable
}

function indent(lines: string[], spaces: number): string[] {
  const pad = ' '.repeat(spaces)
  return lines.map((l) => (l.trim() === '' ? '' : pad + l))
}

function bodyOrPass(lines: string[]): string[] {
  return lines.some((l) => l.trim() !== '') ? lines : ['pass']
}

export function generate(project: Project): CodegenResult {
  const active = project.blocks.filter((b) => b.enabled)
  const sym = collectSymbols(active)
  const errors: TranspileError[] = []
  const map: SourceMapEntry[] = []

  const setup = active.find((b) => b.kind === 'setup')
  const main = active.find((b) => b.kind === 'main')
  const funcs = active.filter((b) => b.kind === 'function')

  const out: string[] = []
  const push = (...ls: string[]) => out.push(...ls)

  push(
    '# ----------------------------------------------------------------------',
    `# ${project.name} — generiert von RobotCode`,
    '# Zielplattform: ESP32 / MicroPython',
    '# ----------------------------------------------------------------------',
    'import time',
    'from hardware import Sensor, Ultrasonic, Led, Motor',
    'from robot import Robot',
    '',
  )

  const transpileInto = (block: Block | undefined): string[] => {
    if (!block) return []
    const r = transpileBlock(block, sym, out.length + 1)
    errors.push(...r.errors)
    map.push(...r.map)
    return r.lines
  }

  // SETUP auf Modulebene
  push('# === SETUP (laeuft einmal) ===')
  if (setup) push(...bodyOrPass(stripTrailingEmpty(transpileInto(setup))))
  if (sym.hasMotors) push('robot = Robot(motor_l, motor_r)')
  push('')

  // Funktionsbloecke
  for (const f of funcs) {
    push(`def ${f.name.toLowerCase()}():`)
    push(...indent(bodyOrPass(stripTrailingEmpty(transpileInto(f))), 4))
    push('')
  }

  // MAIN
  push('def main():')
  push(...indent(bodyOrPass(stripTrailingEmpty(transpileInto(main))), 4))
  push('')
  push('setup = main  # Einstiegspunkt')
  push('main()')
  push('')

  const mainPy = out.join('\n')

  const files: GeneratedFile[] = [
    { path: 'main.py', content: mainPy },
    { path: 'robot.py', content: ROBOT_PY },
    { path: 'hardware.py', content: HARDWARE_PY },
  ]

  return { files, mainPy, errors, map, symbols: sym }
}

function stripTrailingEmpty(lines: string[]): string[] {
  const copy = [...lines]
  while (copy.length && copy[copy.length - 1].trim() === '') copy.pop()
  return copy
}

// --- Minimale Hardware-Abstraktion (echte MicroPython-machine-API) ---

const HARDWARE_PY = `# Minimale Hardware-Abstraktion fuer ESP32 / MicroPython.
from machine import Pin, ADC, PWM
import time

# ADC-Schwelle, unter der ein Liniensensor "schwarz" meldet (anpassen!).
BLACK_THRESHOLD = 1800


class Sensor:
    """Analoger Liniensensor an einem ADC-faehigen Pin (0..4095)."""

    def __init__(self, pin):
        self.adc = ADC(Pin(pin))
        self.adc.atten(ADC.ATTN_11DB)  # voller Messbereich ~0..3.3 V

    def read(self):
        return self.adc.read()

    def is_black(self):
        return self.read() < BLACK_THRESHOLD

    def is_white(self):
        return not self.is_black()


class Ultrasonic:
    """HC-SR04 Ultraschall-Entfernungssensor."""

    def __init__(self, trig, echo):
        self.trig = Pin(trig, Pin.OUT)
        self.echo = Pin(echo, Pin.IN)

    def distance(self):
        self.trig.value(0)
        time.sleep_us(2)
        self.trig.value(1)
        time.sleep_us(10)
        self.trig.value(0)
        t0 = time.ticks_us()
        while self.echo.value() == 0:
            t0 = time.ticks_us()
        t1 = time.ticks_us()
        while self.echo.value() == 1:
            t1 = time.ticks_us()
        return time.ticks_diff(t1, t0) / 58.0  # cm


class Led:
    def __init__(self, pin):
        self.pin = Pin(pin, Pin.OUT)

    def value(self, v):
        self.pin.value(1 if v else 0)


class Motor:
    """DC-Motor ueber zwei PWM-Pins einer H-Bruecke (z. B. DRV8833/L298N)."""

    def __init__(self, pin_a, pin_b):
        self.a = PWM(Pin(pin_a), freq=1000)
        self.b = PWM(Pin(pin_b), freq=1000)
        self.speed(0)

    def speed(self, percent):
        # percent: -100..100 -> Richtung + Tastgrad (duty)
        percent = max(-100, min(100, percent))
        duty = int(abs(percent) / 100 * 65535)
        if percent >= 0:
            self.a.duty_u16(duty)
            self.b.duty_u16(0)
        else:
            self.a.duty_u16(0)
            self.b.duty_u16(duty)
`

const ROBOT_PY = `# Differenzialantrieb: bildet Fahrbefehle auf zwei Motoren ab (Spec §5).
# Motor-Zuordnung und Richtung sind hier zentral konfigurierbar.


class Robot:
    def __init__(self, left, right, invert_left=False, invert_right=False):
        self.ml = left   # linker Motor
        self.mr = right  # rechter Motor
        self.sl = -1 if invert_left else 1
        self.sr = -1 if invert_right else 1

    def _drive(self, l, r):
        self.ml.speed(self.sl * l)
        self.mr.speed(self.sr * r)

    def forward(self, v):
        self._drive(v, v)

    def backward(self, v):
        self._drive(-v, -v)

    def left(self, v):
        self._drive(-v, v)

    def right(self, v):
        self._drive(v, -v)

    def stop(self):
        self._drive(0, 0)
`

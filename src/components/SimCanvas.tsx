import { useEffect, useRef } from 'react'
import { Simulator, WORLD } from '../sim/simulator'

interface Props {
  sim: Simulator
  /** Aendert sich bei jedem Schritt und loest Neuzeichnen aus. */
  tick: number
}

export default function SimCanvas({ sim, tick }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const size = canvas.clientWidth
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr
      canvas.height = size * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const scale = size / WORLD.w
    ctx.save()
    ctx.scale(scale, scale)

    // Hintergrund
    ctx.fillStyle = '#e9edf3'
    ctx.fillRect(0, 0, WORLD.w, WORLD.h)

    // Strecke (schwarze Linie)
    ctx.strokeStyle = '#20242c'
    ctx.lineWidth = 20
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    sim.track.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
    ctx.stroke()

    // Roboter
    const s = sim.state
    ctx.save()
    ctx.translate(s.x, s.y)
    ctx.rotate(s.theta)
    // Koerper
    ctx.fillStyle = '#4da3ff'
    ctx.strokeStyle = '#0f1217'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.lineTo(-10, -9)
    ctx.lineTo(-10, 9)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Sensoren (links/rechts)
    const drawSensor = (side: number, black: boolean) => {
      ctx.beginPath()
      ctx.arc(16, side * 9, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = black ? '#3ddc84' : '#ffffff'
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = '#0f1217'
      ctx.stroke()
    }
    drawSensor(-1, s.leftBlack)
    drawSensor(1, s.rightBlack)
    ctx.restore()

    ctx.restore()
    void tick
  }, [sim, tick])

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={ref} className="aspect-square w-full max-w-[360px] rounded-lg border border-edge" />
      <div className="flex gap-4 text-[11px] text-gray-500">
        <span>🟢 Sensor auf Linie</span>
        <span>⚪ Sensor daneben</span>
      </div>
    </div>
  )
}

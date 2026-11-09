import { Project } from '../model/project'

interface Props {
  project: Project
  onRename: (name: string) => void
  onSave: () => void
  onLoad: () => void
  onExport: () => void
  onRun: () => void
  running: boolean
}

export default function Header({ project, onRename, onSave, onLoad, onExport, onRun, running }: Props) {
  return (
    <header className="shrink-0 border-b border-edge bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <input
            value={project.name}
            onChange={(e) => onRename(e.target.value)}
            className="w-40 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-gray-100 hover:border-edge focus:border-accent focus:outline-none"
            aria-label="Projektname"
          />
          <span className="hidden rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[11px] text-ok sm:inline">
            {project.target}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={onSave} className="rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white">Speichern</button>
          <button onClick={onLoad} className="rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white">Laden</button>
          <button onClick={onExport} className="rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white">Export</button>
          <button
            onClick={onRun}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              running ? 'bg-danger/20 text-danger' : 'bg-accent text-white'
            }`}
          >
            {running ? '■ Stopp' : '▶ Simulieren'}
          </button>
        </div>
      </div>
    </header>
  )
}

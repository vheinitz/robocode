import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'

export interface EditorContext {
  /** Zeilentext links vom Cursor (ohne fuehrende Einrueckung getrimmt? nein, roh). */
  lineBefore: string
  /** true, wenn links vom Cursor nur Whitespace steht. */
  atLineStart: boolean
  /** Einrueckung der aktuellen Zeile. */
  indent: string
}

export interface BlockEditorHandle {
  insertText: (s: string) => void
  newline: () => void
  backspace: () => void
  focus: () => void
}

interface Props {
  value: string
  onChange: (v: string) => void
  onContext?: (ctx: EditorContext) => void
  /** true: native (Android-)Tastatur unterdruecken (Befehls-Modus). */
  suppressNativeKeyboard: boolean
}

const darkTheme = EditorView.theme(
  {
    '&': { color: '#e6e9ef', backgroundColor: '#12151b' },
    '.cm-gutters': { backgroundColor: '#12151b', color: '#5b6372', border: 'none' },
    '.cm-activeLine': { backgroundColor: '#171c24' },
    '.cm-activeLineGutter': { backgroundColor: '#1a1f27' },
    '.cm-content': { caretColor: '#4da3ff' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#4da3ff' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#2a3a55' },
  },
  { dark: true },
)

function computeContext(view: EditorView): EditorContext {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.head)
  const lineBefore = view.state.doc.sliceString(line.from, sel.head)
  const indentMatch = line.text.match(/^(\s*)/)
  return {
    lineBefore,
    atLineStart: /^\s*$/.test(lineBefore),
    indent: indentMatch ? indentMatch[1] : '',
  }
}

const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditor(
  { value, onChange, onContext, suppressNativeKeyboard },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const inputModeComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const onContextRef = useRef(onContext)
  onChangeRef.current = onChange
  onContextRef.current = onContext

  useEffect(() => {
    if (!hostRef.current) return
    const inputAttr: Record<string, string> = suppressNativeKeyboard ? { inputmode: 'none' } : {}
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        python(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        darkTheme,
        inputModeComp.current.of(EditorView.contentAttributes.of(inputAttr)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          if ((u.docChanged || u.selectionSet) && onContextRef.current) {
            onContextRef.current(computeContext(u.view))
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    if (onContextRef.current) onContextRef.current(computeContext(view))
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Nur einmal pro Mount aufbauen; Wertwechsel wird unten synchronisiert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Externe Wertaenderung (z. B. Blockwechsel) in den Editor spiegeln.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Native Tastatur-Unterdrueckung umschalten.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const inputAttr: Record<string, string> = suppressNativeKeyboard ? { inputmode: 'none' } : {}
    view.dispatch({
      effects: inputModeComp.current.reconfigure(EditorView.contentAttributes.of(inputAttr)),
    })
  }, [suppressNativeKeyboard])

  useImperativeHandle(ref, (): BlockEditorHandle => ({
    insertText(s: string) {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: s },
        selection: { anchor: sel.from + s.length },
        scrollIntoView: true,
      })
      view.focus()
    },
    newline() {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      const line = view.state.doc.lineAt(sel.head)
      const base = (line.text.match(/^(\s*)/)?.[1]) ?? ''
      // Nach ':' eine Ebene tiefer einruecken.
      const deeper = /:\s*$/.test(line.text.replace(/#.*$/, '')) ? '  ' : ''
      const insert = '\n' + base + deeper
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        scrollIntoView: true,
      })
      view.focus()
    },
    backspace() {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      if (sel.from !== sel.to) {
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' }, selection: { anchor: sel.from } })
      } else if (sel.from > 0) {
        // Ein Codepoint (Emoji kann >1 UTF-16-Einheit sein) loeschen.
        const start = findCodepointStart(view.state.doc.sliceString(0, sel.from))
        view.dispatch({ changes: { from: start, to: sel.from, insert: '' }, selection: { anchor: start } })
      }
      view.focus()
    },
    focus() {
      viewRef.current?.focus()
    },
  }))

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
})

// Anfang des letzten Unicode-Codepoints in s finden (fuer Emoji-Backspace).
function findCodepointStart(s: string): number {
  if (s.length === 0) return 0
  const cp = Array.from(s)
  const last = cp[cp.length - 1]
  return s.length - last.length
}

export default BlockEditor

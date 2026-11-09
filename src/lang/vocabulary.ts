// Einzige Quelle der Wahrheit fuer die Emoji-Token der RobotCode-Sprache.
// Keyboard, Highlighter und (dokumentierend) der Transpiler beziehen sich
// hierauf, damit ein neues Symbol nur an EINER Stelle hinzugefuegt werden muss.

export const EMOJI = {
  IF: '❓',
  ELSE: 'ELSE',
  FOR: '🔄',
  WHILE: '🔁',
  FUNC: '🧩',
  WAIT: '⏱️',
  ROBOT: '🤖',
  FWD: '⬆️',
  BACK: '⬇️',
  LEFT: '⬅️',
  RIGHT: '➡️',
  STOP: '⏹️',
  MOTOR: '⚙️',
  SENSOR: '👁️',
  LED: '💡',
  DISTANCE: '📏',
} as const

// Zusammengesetzte Roboter-Kommandos (Emoji-Paare).
export const ROBOT_FWD = EMOJI.ROBOT + EMOJI.FWD // 🤖⬆️
export const ROBOT_BACK = EMOJI.ROBOT + EMOJI.BACK // 🤖⬇️
export const ROBOT_LEFT = EMOJI.ROBOT + EMOJI.LEFT // 🤖⬅️
export const ROBOT_RIGHT = EMOJI.ROBOT + EMOJI.RIGHT // 🤖➡️
export const ROBOT_STOP = EMOJI.ROBOT + EMOJI.STOP // 🤖⏹️

/** Alle bekannten Mehrzeichen-Token, laengste zuerst (fuer Highlighting). */
export const KNOWN_TOKENS: string[] = [
  ROBOT_FWD,
  ROBOT_BACK,
  ROBOT_LEFT,
  ROBOT_RIGHT,
  ROBOT_STOP,
  EMOJI.IF,
  EMOJI.FOR,
  EMOJI.WHILE,
  EMOJI.FUNC,
  EMOJI.WAIT,
  EMOJI.MOTOR,
  EMOJI.SENSOR,
  EMOJI.LED,
  EMOJI.DISTANCE,
].sort((a, b) => b.length - a.length)

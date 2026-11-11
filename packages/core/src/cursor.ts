// Channel for the player to move the fake cursor during a trip without going through
// React (one position is emitted per step, no need to re-render).

type Listener = (x: number, y: number, ms: number) => void

const listeners = new Set<Listener>()

/** How long the cursor takes to get from one element to the next */
export const MOVE_MS = 320

let last: { x: number; y: number } | null = null
let tip: { x: number; y: number } | null = null

/** Last position the cursor was sent to: a widget mounted later (after a reload) starts there */
export function getLastCursor() {
    return last
}

/** Moves the cursor to (x, y) in `ms` milliseconds (MOVE_MS by default) */
export function moveCursor(x: number, y: number, ms: number = MOVE_MS) {
    last = { x, y }
    // The destination counts as the cursor tip from the moment it is sent (it arrives in `ms`)
    tip = { x, y }
    listeners.forEach((listener) => listener(x, y, ms))
}

export function onCursorMove(listener: Listener) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

type PressListener = (x: number, y: number, speed: number) => void

const pressListeners = new Set<PressListener>()

/** The cursor "clicks" at (x, y): it sinks and a ring comes out, as in demo videos */
export function pressCursor(x: number, y: number, speed = 1) {
    pressListeners.forEach((listener) => listener(x, y, speed))
}

export function onCursorPress(listener: PressListener) {
    pressListeners.add(listener)
    return () => {
        pressListeners.delete(listener)
    }
}


/** Where the fake cursor tip is on screen right now (while being dragged or following an element) */
export function setCursorTip(x: number, y: number) {
    tip = { x, y }
}

export function getCursorTip() {
    return tip
}

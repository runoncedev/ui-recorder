// Canal para que el player mueva el cursor falso durante un viaje sin pasar por
// React (se emite una posición por paso, no hace falta re-renderizar).

type Listener = (x: number, y: number, ms: number) => void

const listeners = new Set<Listener>()

/** Lo que tarda el cursor en llegar de un elemento al siguiente */
export const MOVE_MS = 320

let last: { x: number; y: number } | null = null
let tip: { x: number; y: number } | null = null

/** Última posición a la que se mandó el cursor: el widget que se monta después (tras una recarga) arranca ahí */
export function getLastCursor() {
    return last
}

/** Mueve el cursor a (x, y) en `ms` milisegundos (por defecto MOVE_MS) */
export function moveCursor(x: number, y: number, ms: number = MOVE_MS) {
    last = { x, y }
    // El destino cuenta como la punta del cursor desde que se manda (llega en `ms`)
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

/** El cursor "hace click" en (x, y): se hunde y sale un anillo, como en los videos de demo */
export function pressCursor(x: number, y: number, speed = 1) {
    pressListeners.forEach((listener) => listener(x, y, speed))
}

export function onCursorPress(listener: PressListener) {
    pressListeners.add(listener)
    return () => {
        pressListeners.delete(listener)
    }
}


/** Dónde está ahora la punta del cursor falso en pantalla (mientras se arrastra o sigue a un elemento) */
export function setCursorTip(x: number, y: number) {
    tip = { x, y }
}

export function getCursorTip() {
    return tip
}

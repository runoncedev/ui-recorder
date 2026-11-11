// State of the Alt (Option) key while recording, and the last mouse position: the widget uses them
// to show the cursor ghost that indicates the next click is recorded as a "rest".

let alt = false
let pointer = { x: 0, y: 0 }
const listeners = new Set<() => void>()

export function getAlt() {
    return alt
}

export function setAlt(value: boolean) {
    if (alt === value) return
    alt = value
    listeners.forEach((listener) => listener())
}

export function subscribeAlt(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function getPointer() {
    return pointer
}

export function setPointer(x: number, y: number) {
    pointer = { x, y }
}

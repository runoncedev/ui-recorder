// Estado de la tecla Alt (Option) mientras se graba, y la última posición del mouse: el widget los usa
// para mostrar el fantasma del cursor que indica que el próximo click se graba como "mover".

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

import type { RecorderState, Script } from "./types"

// Estado en localStorage: sobrevive a las recargas completas, que es lo que
// hace falta para viajar a un paso (cargar startUrl de nuevo).

const KEY = "recorder:v1"

const EMPTY: RecorderState = {
    script: null,
    recording: false,
    selected: null,
    pending: null,
    gap: null,
    aim: null,
    reopenGap: null,
    waiting: null,
    dim: false,
    speed: 1,
    current: null,
    failed: null,
    failedNoticeClosed: false,
}

/**
 * Al cargar la página el DOM es nuevo, así que la posición que había quedado guardada ya no es cierta: sería
 * "después del paso 5" sobre una página limpia, y para que lo fuera habría que repetir todo hasta ahí. Una carga
 * normal (no la de un viaje, que se completa solo, ni una grabación en curso) vuelve entonces al inicio, y lo que
 * dependía de esa posición (línea abierta, modo apuntar, errores) se limpia. Lo que está guardado en el guion no cambia.
 */
function atPageLoad(saved: RecorderState): RecorderState {
    if (saved.pending !== null || saved.recording) return saved
    return {
        ...saved,
        selected: saved.script ? -1 : null,
        gap: null,
        aim: null,
        reopenGap: null,
        waiting: null,
        current: null,
        failed: null,
        failedNoticeClosed: false,
    }
}

/**
 * Migración: el paso en el que el cursor llega a un elemento y se queda, sin acción, antes se llamaba `move` y ahora
 * `rest` (todos los pasos mueven el cursor, ese es el que no hace otra cosa). Los guiones guardados con el nombre
 * viejo se convierten al cargar.
 */
function migrate(saved: RecorderState): RecorderState {
    const script = saved.script
    // `kind` ya no admite "move" en el tipo, pero un guion viejo guardado sí lo trae
    const old = (script?.steps ?? []) as { kind?: string }[]
    if (!script || !old.some((step) => step.kind === "move")) return saved
    const steps = old.map((step) => (step.kind === "move" ? { ...step, kind: "rest" } : step)) as Script["steps"]
    return { ...saved, script: { ...script, steps } }
}

function load(): RecorderState {
    try {
        const raw = localStorage.getItem(KEY)
        if (raw) {
            const parsed: RecorderState = { ...EMPTY, ...JSON.parse(raw) }
            const state = atPageLoad(migrate(parsed))
            // Se guarda ya normalizado, así lo que queda en localStorage coincide con lo que se ve
            if (state !== parsed) localStorage.setItem(KEY, JSON.stringify(state))
            return state
        }
    } catch {
        // sin localStorage el editor funciona solo hasta la próxima recarga
    }
    return EMPTY
}

let state: RecorderState = load()
const listeners = new Set<() => void>()

export function getState(): RecorderState {
    return state
}

export function setState(patch: Partial<RecorderState>) {
    state = { ...state, ...patch }
    try {
        localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
        // ver load()
    }
    listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

import { getState, setState } from "./store"
import type { Script, Step } from "./types"

/** Pausa corta que se hace después de cada click si la persona no puso otra */
export const DEFAULT_STEP_PAUSE_MS = 750

/**
 * Pausa de una línea del timeline. La línea `gap` es la que sigue a la posición
 * `gap`: -1 es la del inicio (antes del primer click) y N la que viene después
 * del click del paso N (la última, antes del final).
 */
export function getGapPause(script: Script | null, gap: number): number {
    if (!script) return 0
    if (gap < 0) return script.startPause ?? 0
    return script.steps[gap]?.pauseAfter ?? DEFAULT_STEP_PAUSE_MS
}

export function setGapPause(gap: number, ms: number) {
    const { script } = getState()
    if (!script) return
    if (gap < 0) {
        setState({ script: { ...script, startPause: ms } })
        return
    }
    if (!script.steps[gap]) return
    const steps = script.steps.map((step, i) => (i === gap ? { ...step, pauseAfter: ms } : step))
    setState({ script: { ...script, steps } })
}

/**
 * Borra un paso. Se asume que el estado de la app ya es el correcto para ese
 * lugar del guion (los pasos anteriores no cambian), así que la posición se
 * queda donde estaba: ahora apunta al paso siguiente, o al final.
 */
export function removeStep(index: number) {
    const { script, selected } = getState()
    if (!script || !script.steps[index]) return
    const steps = script.steps.filter((_, i) => i !== index)
    const next = selected === null ? null : selected > index ? selected - 1 : Math.min(selected, steps.length - 1)
    setState({ script: { ...script, steps }, selected: next })
}

/** Dónde queda el cursor parado en el inicio si la persona no lo movió */
export const DEFAULT_PARK = { x: 0.5, y: 0.5 }

/** Solo el inicio tiene un cursor propio: el final es el último paso (por ejemplo un reposo del cursor con Alt + click) */
export type ParkKind = "start"

export function parkFraction(script: Script | null, _kind: ParkKind) {
    return script?.startCursor ?? DEFAULT_PARK
}

/** El punto del inicio en píxeles de la ventana actual (se guarda como fracción: vale para cualquier tamaño) */
export function parkPoint(script: Script | null, kind: ParkKind) {
    const f = parkFraction(script, kind)
    return { x: f.x * window.innerWidth, y: f.y * window.innerHeight }
}

export function setParkCursor(_kind: ParkKind, point: { x: number; y: number }) {
    const { script } = getState()
    if (!script) return
    const clamped = { x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) }
    setState({ script: { ...script, startCursor: clamped } })
}

/** Cambia campos de un paso (por ejemplo, el punto del cursor al ajustarlo en el modo apuntar) */
export function patchStep(index: number, patch: Partial<Step>) {
    const { script } = getState()
    if (!script || !script.steps[index]) return
    const steps = script.steps.map((step, i) => (i === index ? { ...step, ...patch } : step))
    setState({ script: { ...script, steps } })
}

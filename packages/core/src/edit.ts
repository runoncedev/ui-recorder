import { getState, setState } from "./store"
import type { Script, Step } from "./types"

/** Short pause after each click if the person did not set another */
export const DEFAULT_STEP_PAUSE_MS = 750

/**
 * Pause of a timeline line. Line `gap` is the one that follows position
 * `gap`: -1 is the start one (before the first click) and N the one that comes after
 * the click of step N (the last one, before the end).
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
 * Deletes a step. It is assumed that the app state is already the right one for that
 * place in the script (the previous steps do not change), so the position
 * stays where it was: it now points to the next step, or to the end.
 */
export function removeStep(index: number) {
    const { script, selected } = getState()
    if (!script || !script.steps[index]) return
    const steps = script.steps.filter((_, i) => i !== index)
    const next = selected === null ? null : selected > index ? selected - 1 : Math.min(selected, steps.length - 1)
    setState({ script: { ...script, steps }, selected: next })
}

/** Where the cursor is parked at the start if the person did not move it */
export const DEFAULT_PARK = { x: 0.5, y: 0.5 }

/** Only the start has its own cursor: the end is the last step (for example a cursor rest with Alt + click) */
export type ParkKind = "start"

export function parkFraction(script: Script | null, _kind: ParkKind) {
    return script?.startCursor ?? DEFAULT_PARK
}

/** The start point in pixels of the current window (stored as a fraction: valid for any size) */
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

/** Changes fields of a step (for example, the cursor point when adjusting it in aim mode) */
export function patchStep(index: number, patch: Partial<Step>) {
    const { script } = getState()
    if (!script || !script.steps[index]) return
    const steps = script.steps.map((step, i) => (i === index ? { ...step, ...patch } : step))
    setState({ script: { ...script, steps } })
}

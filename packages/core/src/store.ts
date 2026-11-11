import type { RecorderState, Script } from "./types"

// State in localStorage: it survives full reloads, which is what is needed
// to travel to a step (loading startUrl again).

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
 * When the page loads the DOM is new, so the saved position is no longer true: it would be
 * "after step 5" on a clean page, and for that to be true everything up to there would have to be repeated. A normal
 * load (not a trip's, which completes by itself, nor a recording in progress) goes back to the start, and whatever
 * depended on that position (open line, aim mode, errors) is cleared. What is saved in the script does not change.
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
 * Migration: the step where the cursor arrives at an element and stays, with no action, used to be called `move` and is now
 * `rest` (every step moves the cursor, that one is the one that does nothing else). Scripts saved with the old
 * name are converted on load.
 */
function migrate(saved: RecorderState): RecorderState {
    const script = saved.script
    // `kind` no longer allows "move" in the type, but an old saved script does carry it
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
            // Saved already normalized, so what is in localStorage matches what is shown
            if (state !== parsed) localStorage.setItem(KEY, JSON.stringify(state))
            return state
        }
    } catch {
        // without localStorage the editor only works until the next reload
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
        // see load()
    }
    listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

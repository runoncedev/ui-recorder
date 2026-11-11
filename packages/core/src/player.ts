import { getCursorTip, getLastCursor, MOVE_MS, moveCursor, pressCursor } from "./cursor"
import { hoverAt } from "./hover"
import { DEFAULT_STEP_PAUSE_MS, parkPoint, patchStep } from "./edit"
import { pageScroller, readValue, visibleBox } from "./recorder"
import { queryAll } from "./selector"
import { getState, setState } from "./store"
import type { Script, Step } from "./types"

/** When traveling to a step everything runs as in fast-forward: the cursor and the clicks are visible, but faster */
const TRAVEL_SPEED = 3
const FIND_TIMEOUT_MS = 5000
/** Short pause between steps when traveling in fast-forward (before dividing it by the speed): it does not follow the default playback pause */
const TRAVEL_STEP_GAP_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nextFrames = (n: number) =>
    new Promise<void>((resolve) => {
        const tick = (left: number) =>
            left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))
        tick(n)
    })

/** Waits for the element to stop moving (same position in two consecutive frames): a drawer that is still sliding is not a good target */
async function waitStable(el: Element) {
    let last = ""
    let same = 0
    for (let i = 0; i < 40 && same < 2; i++) {
        await nextFrames(1)
        const r = el.getBoundingClientRect()
        const key = `${r.left},${r.top},${r.width},${r.height}`
        same = key === last ? same + 1 : 0
        last = key
    }
}

export function findElement(selector: string): Element | null {
    return queryAll(selector)[0] ?? null
}

/** Waits for the element to exist (not to be visible): the app may still be rendering */
export function waitFor(selector: string): Promise<Element | null> {
    return new Promise((resolve) => {
        const found = findElement(selector)
        if (found) return resolve(found)
        const observer = new MutationObserver(() => {
            const el = findElement(selector)
            if (!el) return
            cleanup()
            resolve(el)
        })
        const timer = setTimeout(() => {
            cleanup()
            resolve(null)
        }, FIND_TIMEOUT_MS)
        function cleanup() {
            observer.disconnect()
            clearTimeout(timer)
        }
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
        })
    })
}

/** Synthetic click with the full sequence of events (many components listen to pointerdown) */
export function clickAt(el: Element, offset: Step["offset"]) {
    const rect = el.getBoundingClientRect()
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        // The visible cursor may be outside the element (it is adjusted freely), but what the page receives
        // is always a click inside it
        clientX: Math.min(rect.right, Math.max(rect.left, rect.left + rect.width * offset.x)),
        clientY: Math.min(rect.bottom, Math.max(rect.top, rect.top + rect.height * offset.y)),
    }
    const pointer = { ...init, pointerType: "mouse", isPrimary: true }
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }))
    el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }))
    if (el instanceof HTMLElement) el.focus({ preventScroll: true })
    el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }))
    el.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }))
    el.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }))
}

/** Screen (viewport) point a step aims at over its element */
export function pointOf(el: Element, offset: Step["offset"]) {
    // `html` is measured against the visible window, not against its rectangle (which is the whole height of the page)
    if (el === document.documentElement) {
        const b = visibleBox(pageScroller())
        return { x: b.left + (b.right - b.left) * offset.x, y: b.top + (b.bottom - b.top) * offset.y }
    }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width * offset.x, y: rect.top + rect.height * offset.y }
}

/** The element a `scroll` step scrolls: the whole page (`html`) or a container */
export function scrollTarget(step: Step): Element | null {
    return step.selector === "html" ? pageScroller() : findElement(step.selector)
}

/**
 * Where the cursor ends up in a step: over the click or rest point, or where the mouse was inside the
 * visible part of the area that was scrolled (the center if it was not saved).
 */
export function cursorPoint(step: Step, el: Element) {
    if (step.kind !== "scroll") return pointOf(el, step.offset)
    const b = visibleBox(el)
    // Where the mouse was when recording, inside the area; with no data, the center
    const at = step.at ?? { x: 0.5, y: 0.5 }
    return { x: b.left + (b.right - b.left) * at.x, y: b.top + (b.bottom - b.top) * at.y }
}

const TYPE_CHAR_MS = 55

/** Writes the value as the browser would: with the native setter, so React and other frameworks find out */
function writeValue(el: HTMLElement, value: string) {
    if (el instanceof HTMLInputElement) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value)
    } else if (el instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value)
    } else {
        el.textContent = value
    }
}

function fireInput(el: HTMLElement, data: string | null, inputType: string) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, data, inputType }))
}

/**
 * Writes the text into the field: focuses it and types it letter by letter (all at once in fast-forward). If the
 * field already starts with part of the text, it types only what is missing; otherwise it empties it first.
 */
async function typeInto(el: HTMLElement, text: string, speed: number, signal: AbortSignal) {
    el.focus({ preventScroll: true })
    const current = readValue(el)
    let value = text.startsWith(current) ? current : ""
    if (value !== current) {
        writeValue(el, "")
        fireInput(el, null, "deleteContentBackward")
    }
    const rest = text.slice(value.length)
    if (speed > 1) {
        if (rest) {
            writeValue(el, text)
            fireInput(el, rest, "insertText")
        }
    } else {
        for (const char of rest) {
            if (signal.aborted) return
            el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }))
            value += char
            writeValue(el, value)
            fireInput(el, char, "insertText")
            el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }))
            await sleep(TYPE_CHAR_MS)
        }
    }
    // What the browser fires when a field's editing ends
    el.dispatchEvent(new Event("change", { bubbles: true }))
}

/**
 * What must be saved in a step when the cursor is dropped at screen (x, y): the point relative to its
 * target. Unbounded: it may end up outside the element (fractions below 0 or above 1).
 */
export function aimPatch(step: Step, x: number, y: number): Partial<Step> | null {
    // An old step with no selector is a free point of the window
    if (step.selector === "") return { offset: { x: x / window.innerWidth, y: y / window.innerHeight } }
    const el = step.kind === "scroll" ? scrollTarget(step) : findElement(step.selector)
    if (!el) return null
    if (step.kind === "scroll") {
        const b = visibleBox(el)
        return { at: { x: (x - b.left) / (b.right - b.left || 1), y: (y - b.top) / (b.bottom - b.top || 1) } }
    }
    const r = el === document.documentElement ? visibleBox(pageScroller()) : el.getBoundingClientRect()
    const w = "width" in r ? r.width : r.right - r.left
    const h = "height" in r ? r.height : r.bottom - r.top
    return { offset: { x: (x - r.left) / (w || 1), y: (y - r.top) / (h || 1) } }
}

/** Saves the point where the cursor was dropped in aim mode */
export function aimDrop(stepIndex: number, x: number, y: number) {
    const step = getState().script?.steps[stepIndex]
    if (!step) return
    const patch = aimPatch(step, x, y)
    if (patch) patchStep(stepIndex, patch)
}

/**
 * Scrolls the element to the recorded position (a fraction of the range). At normal speed it is smooth and
 * waits for it to finish; in fast-forward it jumps directly.
 */
async function scrollToStep(el: Element, offset: Step["offset"], speed: number, signal: AbortSignal) {
    const left = offset.x * Math.max(0, el.scrollWidth - el.clientWidth)
    const top = offset.y * Math.max(0, el.scrollHeight - el.clientHeight)
    if (speed > 1) {
        el.scrollTo({ left, top, behavior: "instant" })
        await sleep(40)
        return
    }
    el.scrollTo({ left, top, behavior: "smooth" })
    // A smooth scroll does not reliably say when it ends: wait until the position stops changing
    let last = ""
    let still = 0
    for (let frame = 0; frame < 120 && still < 6 && !signal.aborted; frame++) {
        await nextFrames(1)
        const now = `${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`
        still = now === last ? still + 1 : 0
        last = now
    }
}

/** Takes the cursor to the element (animated path) and waits for it to arrive */
async function glideTo(el: Element, offset: Step["offset"], speed: number) {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
    const { x, y } = pointOf(el, offset)
    // If the cursor is already there (for example after adjusting it in aim mode) there is nothing to travel or wait for
    const tip = getCursorTip()
    if (tip && Math.hypot(tip.x - x, tip.y - y) < 1.5) return hoverAt(x, y)
    const ms = MOVE_MS / speed
    moveCursor(x, y, ms)
    await sleep(ms)
    hoverAt(x, y)
}

/** Takes the cursor to a free point of the window (a `rest` step over an area with no elements) */
async function glidePoint(point: { x: number; y: number }, speed: number) {
    const ms = MOVE_MS / speed
    moveCursor(point.x, point.y, ms)
    await sleep(ms)
    hoverAt(point.x, point.y)
}

/** The screen point of a step with no selector: its offset is a fraction of the window */
export function freePoint(step: Step) {
    return { x: step.offset.x * window.innerWidth, y: step.offset.y * window.innerHeight }
}

let waitId = 0

/**
 * Elapses a pause showing its progress: line `gap` fills during `ms`. Only used at normal speed
 * (in fast-forward there are no pauses to show).
 */
async function wait(gap: number, ms: number) {
    const id = ++waitId
    setState({ waiting: { gap, ms, id } })
    await sleep(ms)
    // If in the meantime it was stopped and another run started, that new pause is left alone
    if (getState().waiting?.id === id) setState({ waiting: null })
}

/** Runs the steps from `from` up to `count` (not including it). Returns the index of the one that failed, or null if all went well */
async function runSteps(
    steps: Step[],
    from: number,
    count: number,
    signal: AbortSignal,
    speed: number,
    startPause: number,
    onDone: (index: number) => void = () => {},
    lead?: { index: number; ms: number }
): Promise<number | null | "aborted"> {
    // When playing from a step, its pause is elapsed first: it is the line about to be crossed and that step had
    // already been executed, so its wait did not happen in this run
    if (lead && lead.ms > 0) {
        setState({ current: lead.index })
        await wait(lead.index, lead.ms)
        if (signal.aborted) return "aborted"
    }
    for (let i = from; i < count; i++) {
        // The freshly loaded page stays a while before the first click (only at normal speed)
        if (i === 0 && speed === 1 && startPause > 0) {
            await wait(-1, startPause)
            if (signal.aborted) return "aborted"
        }
        setState({ current: i })
        const step = steps[i]
        if (step.selector === "") {
            // Move to a free point: there is no element to look for nor click to make
            await glidePoint(freePoint(step), speed)
            if (signal.aborted) return "aborted"
        } else if (step.kind === "type") {
            const el = await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!(el instanceof HTMLElement)) {
                console.warn(`[recorder] Step ${i + 1}: field not found ${step.selector}`)
                return i
            }
            await waitStable(el)
            el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
            // The previous click already left the cursor over the field: it only moves if it is not there
            const last = getLastCursor()
            const box = el.getBoundingClientRect()
            const onField = !!last && last.x >= box.left && last.x <= box.right && last.y >= box.top && last.y <= box.bottom
            if (!onField) await glidePoint(cursorPoint(step, el), speed)
            if (signal.aborted) return "aborted"
            await typeInto(el, step.text ?? "", speed, signal)
            if (signal.aborted) return "aborted"
        } else if (step.kind === "scroll") {
            const el = step.selector === "html" ? pageScroller() : await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!el) {
                console.warn(`[recorder] Step ${i + 1}: element not found ${step.selector}`)
                return i
            }
            // The hand goes to the area being scrolled (so it stays in view) and scrolls from there
            if (el !== pageScroller()) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
            await glidePoint(cursorPoint(step, el), speed)
            if (signal.aborted) return "aborted"
            await scrollToStep(el, step.offset, speed, signal)
            if (signal.aborted) return "aborted"
        } else {
            const el = await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!el) {
                console.warn(`[recorder] Step ${i + 1}: element not found ${step.selector}`)
                return i
            }
            await waitStable(el)
            await glideTo(el, step.offset, speed)
            if (signal.aborted) return "aborted"
            // A `rest` step only takes the cursor there and leaves it: no sinking, no ring and no click
            if (step.kind !== "rest") {
                const { x, y } = pointOf(el, step.offset)
                pressCursor(x, y, speed)
                clickAt(el, step.offset)
            }
        }
        onDone(i)
        // The pause the person set is for presentation: it only applies at normal speed.
        // In fast-forward (traveling to a step) it is skipped and the short accelerated pause remains.
        // After the last step there is no pause: the action is done and the script ends
        if (i === steps.length - 1) break
        if (speed > 1) await sleep(TRAVEL_STEP_GAP_MS / speed)
        else await wait(i, steps[i].pauseAfter ?? DEFAULT_STEP_PAUSE_MS)
    }
    return null
}

let resuming = false
let abort: AbortController | null = null
/** First step not yet executed in the current run (to know where it stopped when halted) */
let nextStep = 0

/**
 * Runs steps [from, to] (both included) on the page as it is.
 * It is assumed that the current app state is the right one for `from - 1`: nothing
 * earlier is reloaded or repeated. When done, the cursor stays where the
 * last click was made: the position is "after step `to`".
 * `to = -1` is the initial state (nothing to run) and `to = number of steps`
 * is the final node. In those two the cursor goes to its place on screen: the center, or where the person left it.
 */
async function advance(
    script: Script,
    from: number,
    to: number,
    speed: number,
    lead?: { index: number; ms: number },
    dim: boolean = speed > 1,
    // Coming from a freshly reloaded page (a trip with reload): the cursor is not anywhere yet
    fresh = false
) {
    resuming = true
    abort = new AbortController()
    const { signal } = abort
    nextStep = from
    // From the freshly reloaded page the cursor starts from its start place and from there travels to step 1. In place (with no
    // reload) the cursor is already where it is (parked at the start, or resting on the step's target): it is not moved
    if (from === 0 && fresh) {
        const start = parkPoint(script, "start")
        moveCursor(start.x, start.y, 0)
    }
    setState({ pending: to, speed, dim, gap: null, recording: false, selected: null, current: null, waiting: null, failed: null })

    // `to = -1` is the start (nothing to run): the cursor goes to its place (the center, or where the person left it)
    const failed = await runSteps(
        script.steps,
        from,
        to + 1,
        signal,
        speed,
        script.startPause ?? 0,
        (i) => {
            nextStep = i + 1
        },
        lead
    )
    if (failed === "aborted") {
        resuming = false
        setScrollRestoration("auto")
        return
    }
    if (failed === null && to < 0) {
        const ms = MOVE_MS / speed
        const park = parkPoint(script, "start")
        moveCursor(park.x, park.y, ms)
        await sleep(ms)
    }
    setScrollRestoration("auto")
    resuming = false
    if (signal.aborted) return
    // If a step failed, the position is the one before that step
    setState({
        pending: null,
        current: null,
        waiting: null,
        failed,
        // If the trip was made to open a line, it is reopened on arrival (with aim mode on)
        gap: getState().reopenGap !== null && failed === null ? getState().reopenGap : null,
        reopenGap: null,
        // A new failure shows its notice again
        failedNoticeClosed: false,
        selected: failed === null ? to : failed - 1,
    })
}

/**
 * Go to "after step `index`" (-1 = the start, with no click). Forward
 * from the current position only the missing steps are run, on
 * the page as it is. Backward, or with no position, startUrl is loaded from scratch
 * and, when the widget mounts again, resume() runs all the previous ones.
 */
export function travelTo(index: number) {
    setState({ aim: null, reopenGap: null })
    travel(index)
}

function travel(index: number) {
    const { script, selected } = getState()
    if (!script || resuming) return
    // After a failure the position is the step before the one that failed: the page is in that state, so
    // it is also possible to advance (retry) from there without reloading
    if (selected !== null && index >= selected) {
        // A single step in place is instant: the page is not dimmed, which would look like a flicker
        if (index > selected) void advance(script, selected + 1, index, TRAVEL_SPEED, undefined, index !== selected + 1)
        return
    }
    reloadAndRun(script, index, TRAVEL_SPEED)
}

/** On reload, the browser returns the page to the scroll it had: to start from a clean page it is turned off for the duration of the trip */
function setScrollRestoration(mode: "auto" | "manual") {
    try {
        history.scrollRestoration = mode
    } catch {
        // some environments do not allow it
    }
}

function reloadAndRun(script: Script, index: number, speed: number) {
    setScrollRestoration("manual")
    setState({ pending: index, speed, dim: speed > 1, gap: null, recording: false, selected: null, current: null, waiting: null, failed: null })
    if (location.href === script.startUrl) location.reload()
    else location.assign(script.startUrl)
}

/**
 * Opens line `p`: goes to the state it represents, the one before the step that follows it, and leaves the cursor
 * resting on its target (aim mode). In place if you are already there or before; otherwise, reloads and rebuilds in
 * fast-forward. The line and the mode are saved in the state before traveling, so they survive the reload.
 */
export function openLine(p: number) {
    const { script, selected } = getState()
    if (!script || resuming) return
    // Every line has a step to its right: the script ends at the last step, with no line after it
    setState({ gap: p, aim: p + 1, reopenGap: p })
    // Rest steps do not change the app (they only move the cursor): if all that separates the current position from the line is
    // rests, the page is already in the line's state and selecting it is enough, with nothing to rebuild
    const onlyRests = selected !== null && selected > p && script.steps.slice(p + 1, selected + 1).every((step) => step.kind === "rest")
    if (onlyRests) setState({ selected: p, reopenGap: null })
    else if (selected !== p) travel(p)
    else setState({ reopenGap: null })
}

/**
 * Cuts the trip or playback in progress. The page stays as it was and the
 * position is the last step that got executed, so it can continue from there.
 */
export function stop() {
    abort?.abort()
    const { script } = getState()
    setState({
        pending: null,
        selected: script ? nextStep - 1 : null,
        current: null,
        waiting: null,
        aim: null,
        reopenGap: null,
        failed: null,
    })
    resuming = false
}

/** Called when the widget mounts: if there was a trip in progress, it finishes it */
export async function resume() {
    const { script, pending, speed } = getState()
    if (!script || pending === null || resuming) return
    await advance(script, 0, pending, speed, undefined, getState().dim, true)
}

/**
 * Play: continues from the current position to the end; if there is no position
 * or you are already at the end, it starts from scratch. After a failure the position is the step before
 * the one that failed, so it retries that step from there. From a step it waits for its pause first.
 */
export function play() {
    const { script, selected, failed, aim } = getState()
    if (!script || resuming) return
    // In aim mode the cursor already rests on the target of the next step: Play does that action right away,
    // without elapsing the line's pause first (you already "crossed" that line to get there)
    const aimed = aim !== null && selected !== null && aim === selected + 1
    setState({ aim: null, reopenGap: null })
    // Standing on the last step (or with no position) there is nothing left to continue: it starts from scratch
    const last = script.steps.length - 1
    // Nor if what remains is only rests: the cursor would move and nothing else, which is no use as a playback
    const onlyRestsLeft = selected !== null && selected >= 0 && script.steps.slice(selected + 1).every((step) => step.kind === "rest")
    if (selected === null || selected >= last || onlyRestsLeft) {
        reloadAndRun(script, last, 1)
    } else {
        // Standing on a step, Play elapses the pause of the line it is about to cross first (the start one is already
        // elapsed by the first step). When retrying after a failure it is not repeated: you want to try again right away.
        const lead =
            selected >= 0 && failed === null && !aimed
                ? { index: selected, ms: script.steps[selected].pauseAfter ?? DEFAULT_STEP_PAUSE_MS }
                : undefined
        void advance(script, selected + 1, last, 1, lead)
    }
}

import { getState, setState } from "./store"
import { getSelector, targetElement } from "./selector"
import { ROOT_ATTR, type Step } from "./types"

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** Mouse events the page must not see when the click is a "rest" (Alt + click) */
const BLOCKED = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick"]

const inWidget = (event: Event) =>
    event.composedPath().some((node) => node instanceof Element && node.hasAttribute(ROOT_ATTR))

/**
 * The rest step recorded by an Alt + click at (x, y): the cursor arrives there and stays, with no action. A rest does not act on
 * any element, so it always points to `html`, measured against the visible window: the offset is the fraction of the window.
 */
function restStepAt(x: number, y: number): Step {
    return {
        kind: "rest",
        selector: "html",
        offset: { x: x / (window.innerWidth || 1), y: y / (window.innerHeight || 1) },
    }
}

/**
 * When recording ends a last step is added automatically (unless the last one the person recorded is already a rest): as if the person had done Alt + click in the middle of
 * the screen (a cursor rest, with no click). It is one more step (adjusted like any other); the last step of the script, if it is
 * a rest (this one or one the person recorded), is shown with a flag;
 * the script ends there, with no final wait.
 */
export function appendFinalStep() {
    const { script } = getState()
    if (!script || script.steps.length === 0) return
    // If the person already ended with a cursor rest (an Alt + click), that is the end they wanted: no other is added
    if (script.steps[script.steps.length - 1].kind === "rest") return
    const x = window.innerWidth / 2
    const y = window.innerHeight / 2
    setState({ script: { ...script, steps: [...script.steps, restStepAt(x, y)] } })
}

/** How long after a wheel, a touch or a scroll key a scroll is considered to have been made by the person */
const USER_SCROLL_MS = 700
/** A scroll closes (and becomes a step) when that many ms pass without it continuing to scroll */
const SCROLL_SETTLE_MS = 250
const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

/** The element that scrolls the whole page (`html`, or `body` in quirks mode) */
export const pageScroller = () => document.scrollingElement ?? document.documentElement

/** The visible part of a scrolling element: the whole window if it is the page, or its box clipped to the window */
export function visibleBox(el: Element) {
    if (el === pageScroller()) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const r = el.getBoundingClientRect()
    return {
        left: Math.max(0, r.left),
        top: Math.max(0, r.top),
        right: Math.min(window.innerWidth, r.right),
        bottom: Math.min(window.innerHeight, r.bottom),
    }
}

/** The fields where typing is recorded. Not passwords: the script stays in localStorage and can be exported */
const TYPABLE_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "number"])

export function isTypable(t: EventTarget | null): t is HTMLElement {
    if (t instanceof HTMLTextAreaElement) return true
    if (t instanceof HTMLInputElement) return TYPABLE_INPUT_TYPES.has(t.type)
    return t instanceof HTMLElement && t.isContentEditable
}

/** The current value of a text field (or an editable element) */
export function readValue(el: HTMLElement) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "")
}

/** How much was scrolled, as a fraction of the possible range (an axis with no range counts as 0) */
function scrollFraction(position: number, range: number) {
    return range > 0 ? clamp(position / range) : 0
}

// To close the pending scroll before the state changes for another reason (for example, when recording stops)
let flushPending: (() => void) | null = null

/** Closes the scroll left half-done and records it as a step */
export function flushRecording() {
    flushPending?.()
}

/**
 * Listens to the user's real clicks (in capture, before the app
 * processes them, to read the DOM as it was). Ignores the widget's own and
 * synthetic ones, so playing a script does not re-record it.
 *
 * With Alt (Option) held, the click is recorded as a `rest` step: the cursor stays there, with no action. It is cut
 * in capture (all the events of the gesture, not only the click) so the page does not find out: it does not
 * open anything, does not download the link, does not change focus.
 */
export function startRecording(onStep: (step: Step) => void) {
    const block = (event: MouseEvent) => {
        if (!event.isTrusted || !event.altKey || inWidget(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
    }

    const click = (event: MouseEvent) => {
        if (!event.isTrusted || inWidget(event)) return
        const move = event.altKey
        if (move) block(event)

        if (move) {
            onStep(restStepAt(event.clientX, event.clientY))
            return
        }

        const el = targetElement(event.target)
        if (!el) return
        const rect = el.getBoundingClientRect()
        onStep({
            selector: getSelector(el),
            offset: {
                x: clamp((event.clientX - rect.left) / (rect.width || 1)),
                y: clamp((event.clientY - rect.top) / (rect.height || 1)),
            },
        })
    }

    // --- Scroll ---------------------------------------------------------------------------------
    // A scroll event does not say who caused it (the app and the browser itself also fire them), so
    // only the ones that come right after a gesture of the person are recorded.
    let userScrollUntil = 0
    let draggingScrollbar = false
    let pressingWidget = false
    const markUserScroll = () => {
        userScrollUntil = performance.now() + USER_SCROLL_MS
    }
    const isEditable = (t: EventTarget | null) =>
        t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    const onKey = (e: KeyboardEvent) => {
        if (SCROLL_KEYS.has(e.key) && !isEditable(e.target)) markUserScroll()
    }
    // Dragging the scroll bar: the click lands on the edge of the element, outside its content
    const onPointerDown = (e: PointerEvent) => {
        const t = e.target
        // Pressing something in the widget (for example "stop") takes focus away from the field being typed in, but
        // that must not close the typing there: adding a step makes the bar bigger and moves the button between press and
        // release, and the click would be lost. The button itself closes it on click.
        if (inWidget(e)) pressingWidget = true
        if (!(t instanceof Element) || inWidget(e)) return
        const onBar =
            t === document.documentElement
                ? e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight
                : e.offsetX >= t.clientWidth || e.offsetY >= t.clientHeight
        if (onBar) {
            draggingScrollbar = true
            markUserScroll()
        }
    }
    const onPointerMove = () => {
        if (draggingScrollbar) markUserScroll()
    }
    const onPointerUp = () => {
        draggingScrollbar = false
        // The blur arrives between press and release; the mark is lowered only afterwards
        setTimeout(() => {
            pressingWidget = false
        }, 0)
    }

    // Where the mouse is (the wheel and movements carry their position): it is saved with each scroll
    let lastPointer: { x: number; y: number } | null = null
    const track = (e: MouseEvent) => {
        lastPointer = { x: e.clientX, y: e.clientY }
    }

    let pending: Element | null = null
    let pendingPointer: { x: number; y: number } | null = null
    let settleTimer = 0
    const flush = () => {
        clearTimeout(settleTimer)
        const el = pending
        pending = null
        if (!el) return
        const isPage = el === pageScroller()
        // The mouse as a fraction of the visible part of the area; if it was outside it (keyboard scroll)
        // it is not saved and on playback the cursor goes to the center
        const box = visibleBox(el)
        const mouse = pendingPointer
        const inside =
            mouse && mouse.x >= box.left && mouse.x <= box.right && mouse.y >= box.top && mouse.y <= box.bottom
        onStep({
            kind: "scroll",
            selector: isPage ? "html" : getSelector(el),
            offset: {
                x: scrollFraction(el.scrollLeft, el.scrollWidth - el.clientWidth),
                y: scrollFraction(el.scrollTop, el.scrollHeight - el.clientHeight),
            },
            ...(inside
                ? {
                      at: {
                          x: clamp((mouse.x - box.left) / (box.right - box.left || 1)),
                          y: clamp((mouse.y - box.top) / (box.bottom - box.top || 1)),
                      },
                  }
                : {}),
        })
    }
    flushPending = () => {
        flushTyping()
        flush()
    }
    const onScroll = (e: Event) => {
        if (performance.now() > userScrollUntil || inWidget(e)) return
        const t = e.target
        const el = t === document ? pageScroller() : t instanceof Element ? t : null
        if (!el) return
        flushTyping()
        // If it moved on to scrolling something else, the previous one is closed in place
        if (pending && pending !== el) flush()
        pending = el
        pendingPointer = lastPointer
        clearTimeout(settleTimer)
        settleTimer = window.setTimeout(flush, SCROLL_SETTLE_MS)
    }

    // --- Typing -------------------------------------------------------------------------------
    // Typing into a field is a single step (not one per key): it closes when leaving the field, on another
    // click, on scrolling or when recording stops, and saves how the text ended up.
    let typing: HTMLElement | null = null
    const flushTyping = () => {
        const el = typing
        typing = null
        if (!el) return
        onStep({ kind: "type", selector: getSelector(el), offset: { x: 0.5, y: 0.5 }, text: readValue(el) })
    }
    const onInput = (e: Event) => {
        const t = e.target
        if (!e.isTrusted || inWidget(e) || !isTypable(t)) return
        // If there was a scroll half-done, it goes before the typing; if it moved to another field, the previous one is closed
        flush()
        if (typing && typing !== t) flushTyping()
        typing = t
    }
    const onFocusOut = (e: FocusEvent) => {
        if (pressingWidget) return
        if (typing && e.target === typing) flushTyping()
    }

    // A click with a scroll half-done: the scroll is closed first, so the steps stay in the order they happened
    const clickInOrder = (event: MouseEvent) => {
        flushTyping()
        flush()
        click(event)
    }

    const passive = { capture: true, passive: true } as const
    window.addEventListener("wheel", markUserScroll, passive)
    window.addEventListener("wheel", track, passive)
    window.addEventListener("pointermove", track, passive)
    window.addEventListener("touchmove", markUserScroll, passive)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("pointermove", onPointerMove, true)
    window.addEventListener("pointerup", onPointerUp, true)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("input", onInput, true)
    window.addEventListener("focusout", onFocusOut, true)

    for (const type of BLOCKED) {
        if (type !== "click") window.addEventListener(type, block as EventListener, true)
    }
    window.addEventListener("click", clickInOrder, true)
    return () => {
        flushTyping()
        flush()
        flushPending = null
        window.removeEventListener("input", onInput, true)
        window.removeEventListener("focusout", onFocusOut, true)
        window.removeEventListener("wheel", markUserScroll, true)
        window.removeEventListener("wheel", track, true)
        window.removeEventListener("pointermove", track, true)
        window.removeEventListener("touchmove", markUserScroll, true)
        window.removeEventListener("keydown", onKey, true)
        window.removeEventListener("pointerdown", onPointerDown, true)
        window.removeEventListener("pointermove", onPointerMove, true)
        window.removeEventListener("pointerup", onPointerUp, true)
        window.removeEventListener("scroll", onScroll, true)
        for (const type of BLOCKED) {
            if (type !== "click") window.removeEventListener(type, block as EventListener, true)
        }
        window.removeEventListener("click", clickInOrder, true)
    }
}

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { getGapPause, setGapPause } from "@ui-recorder/core"
import { getState, subscribe } from "@ui-recorder/core"
import { ROOT_ATTR } from "@ui-recorder/core"

/** Marks each timeline line to locate it and so that its clicks do not close the bar */
export const GAP_ATTR = "data-recorder-gap"
export const GAP_UI_ATTR = "data-recorder-gap-ui"
/** Marks the scrollable steps area: if the line ends up outside its visible area, the bar is hidden */
export const SCROLL_ATTR = "data-recorder-scroll"

/** Duration of the enter and the exit; the parent uses it to keep it mounted while it fades out */
export const POPOVER_MS = 200
/**
 * Safety net, not the main effect: what hides the bar is its exit animation, which starts
 * when the line gets within EXIT_DISTANCE_PX of the edge of the scroll area. If in a very fast scroll that
 * animation has not finished yet and the bar is left far away, the mask clips it: its gradients are
 * CLIP_MARGIN_PX outside the area, so with the line inside the area they are not visible.
 */
const CLIP_MARGIN_PX = 160
const EDGE_FADE_PX = 60
const EXIT_DISTANCE_PX = 45
const WIDTH = 176
const EDGE = 8
const PAUSE_STEP_MS = 250
const MAX_PAUSE_MS = 60_000

/** Mask: the gradients of both edges (opaque inwards, transparent outwards) */
const EDGE_MASK = `linear-gradient(to right, transparent 0, #000 ${EDGE_FADE_PX}px, #000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%)`
/** Height of the masked zone: enough for the bar, its shadow and the enter movement */
const CLIP_HEIGHT = 160
const GAP_ABOVE_BAR = 12

const popover: React.CSSProperties = {
    position: "absolute",
    width: WIDTH,
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: 999,
    background: "#18181b",
    color: "#fafafa",
    font: "13px system-ui, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
}

const small: React.CSSProperties = {
    width: 24,
    height: 24,
    border: 0,
    borderRadius: "50%",
    background: "#3f3f46",
    color: "#fafafa",
    font: "600 14px system-ui, sans-serif",
    lineHeight: 1,
    padding: 0,
    cursor: "pointer",
}

const seconds = (ms: number) => Number((ms / 1000).toFixed(2))

/**
 * Pause bar of the selected line: floats above the main bar
 * with an arrow pointing at the line. − / + adjust in steps of 0.25 s; a click on the
 * value lets you type it.
 */
export function GapOptions({ gap, open }: { gap: number; open: boolean }) {
    const script = useSyncExternalStore(subscribe, () => getState().script)
    const [pos, setPos] = useState<{
        left: number
        bottom: number
        arrow: number
        clipLeft: number
        clipWidth: number
        interactive: boolean
    } | null>(null)
    const [text, setText] = useState<string | null>(null)
    const editing = useRef(false)
    editing.current = text !== null

    // Enter: it is born transparent and slightly lower, and only two frames later moves to its place so the transition runs
    const [shown, setShown] = useState(false)
    const placed = pos !== null
    useEffect(() => {
        if (!open) return setShown(false)
        if (!placed) return
        let second = 0
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setShown(true))
        })
        return () => {
            cancelAnimationFrame(first)
            cancelAnimationFrame(second)
        }
    }, [open, placed])

    useLayoutEffect(() => {
        const anchor = () => document.querySelector(`[${GAP_ATTR}="${gap}"]`)
        const place = () => {
            const line = anchor()
            const bar = line?.closest(`[${ROOT_ATTR}]`)
            if (!line || !bar) return setPos(null)
            const l = line.getBoundingClientRect()
            const b = bar.getBoundingClientRect()
            const center = l.left + l.width / 2
            // The bar is clipped to the scroll area (with gradients at the edges): as the line gets close
            // to the edge it fades away, and outside the area it is not visible (it stays mounted, following the line)
            const scroller = line.closest(`[${SCROLL_ATTR}]`)
            const area = scroller?.getBoundingClientRect()
            const areaLeft = area?.left ?? 0
            // An edge only counts on the side where there is still content to scroll: the start line (or the last one)
            // stays stuck to the edge and is not going anywhere, so its bar has to be visible
            const moreLeft = !!scroller && scroller.scrollLeft > 1
            const moreRight = !!scroller && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
            const distance = area
                ? Math.min(moreLeft ? center - area.left : Infinity, moreRight ? area.right - center : Infinity)
                : Infinity
            // The box stays inside the window; the arrow keeps pointing at the line
            const left = Math.min(
                Math.max(center - WIDTH / 2, EDGE),
                window.innerWidth - WIDTH - EDGE
            )
            setPos({
                // Relative to the clip, which starts CLIP_MARGIN_PX before the area
                left: left - (areaLeft - CLIP_MARGIN_PX),
                bottom: window.innerHeight - b.top,
                arrow: center - left,
                clipLeft: areaLeft - CLIP_MARGIN_PX,
                clipWidth: (area?.width ?? window.innerWidth) + 2 * CLIP_MARGIN_PX,
                // With the line closer than EXIT_DISTANCE_PX to the edge the bar leaves (or enters) with its animation
                interactive: distance > EXIT_DISTANCE_PX,
            })
        }
        place()
        window.addEventListener("resize", place)
        // The bar changes width when steps are added, and the line shifts with it
        const observer = new ResizeObserver(place)
        const bar = anchor()?.closest(`[${ROOT_ATTR}]`)
        if (bar) observer.observe(bar)
        // It follows the line while scrolling
        const scroller = anchor()?.closest(`[${SCROLL_ATTR}]`)
        scroller?.addEventListener("scroll", place, { passive: true })

        // The line stays selected until something else is selected or the page is reloaded: neither Esc nor a click
        // outside closes it
        // While the bar is open, the keyboard's + and - change the time (= counts as + on keyboards where
        // + takes Shift). Not while typing in the value, nor with Ctrl or Cmd (that is the browser zoom)
        const nudge = (delta: number) => {
            const next = getGapPause(getState().script, gap) + delta
            setGapPause(gap, Math.min(MAX_PAUSE_MS, Math.max(0, Math.round(next / 10) * 10)))
        }
        const onKey = (e: KeyboardEvent) => {
            if (!editing.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
                if (!typing && (e.key === "+" || e.key === "=")) {
                    e.preventDefault()
                    nudge(PAUSE_STEP_MS)
                    return
                }
                if (!typing && (e.key === "-" || e.key === "_")) {
                    e.preventDefault()
                    nudge(-PAUSE_STEP_MS)
                    return
                }
            }
        }
        window.addEventListener("keydown", onKey)
        return () => {
            window.removeEventListener("resize", place)
            scroller?.removeEventListener("scroll", place)
            window.removeEventListener("keydown", onKey)
            observer.disconnect()
        }
    }, [gap])

    if (!pos) return null
    /** The button of the line that opened this bar (to give focus back when navigating with the keyboard) */
    const anchor = () => document.querySelector<HTMLElement>(`[${GAP_ATTR}="${gap}"]`)
    // Open and with its line inside the scroll area
    const visible = shown && pos.interactive

    const pause = getGapPause(script, gap)
    const set = (ms: number) =>
        setGapPause(gap, Math.min(MAX_PAUSE_MS, Math.max(0, Math.round(ms / 10) * 10)))

    function commit() {
        if (text === null) return
        // Accepts "1,5" and "1.5"
        const value = Number(text.trim().replace(",", "."))
        if (text.trim() !== "" && Number.isFinite(value)) set(value * 1000)
        setText(null)
    }

    return (
        <div
            style={{
                position: "fixed",
                zIndex: 2147483647,
                left: pos.clipLeft,
                width: pos.clipWidth,
                bottom: pos.bottom,
                height: CLIP_HEIGHT,
                overflow: "hidden",
                // The mask does not affect clicks: the bar's pointerEvents takes care of that
                pointerEvents: "none",
                maskImage: EDGE_MASK,
                WebkitMaskImage: EDGE_MASK,
            }}
        >
            <div
                {...{ [ROOT_ATTR]: "", [GAP_UI_ATTR]: "" }}
                // With the keyboard the bar is traversed by itself: the line leads to its first button (the cursor adjust one), and
                // from the last one it continues to the step that comes after the line; with Shift+Tab it goes back to the line
                onKeyDown={(e) => {
                    if (e.key !== "Tab") return
                    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button, input")]
                    const line = anchor()
                    if (e.shiftKey && document.activeElement === items[0]) {
                        e.preventDefault()
                        line?.focus()
                    } else if (!e.shiftKey && document.activeElement === items[items.length - 1] && line) {
                        const bar = line.closest(`[${ROOT_ATTR}]`)
                        const all = [...(bar?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])]
                        const next = all[all.indexOf(line as HTMLElement) + 1]
                        if (next) {
                            e.preventDefault()
                            next.focus()
                        }
                    }
                }}
                style={{
                    ...popover,
                    left: pos.left,
                    bottom: GAP_ABOVE_BAR,
                    // On open and close it animates opacity and movement; when leaving the scroll area (the line near
                    // the edge) or coming back in, only the opacity
                    opacity: visible ? 1 : 0,
                    transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.88)",
                    // It grows from the arrow, which is what points at the line
                    transformOrigin: `${pos.arrow}px 100%`,
                    transition: `opacity ${POPOVER_MS}ms ease-out, transform ${POPOVER_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.2)`,
                    pointerEvents: visible ? "auto" : "none",
                }}
            >
                {/* The arrow that points at the line */}
                <div
                    aria-hidden
                    style={{
                        position: "absolute",
                        bottom: -5,
                        left: pos.arrow - 5,
                        width: 10,
                        height: 10,
                        background: "#18181b",
                        transform: "rotate(45deg)",
                    }}
                />
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <button
                        type="button"
                        aria-label="Less pause"
                        title="Less pause"
                        onClick={() => set(pause - PAUSE_STEP_MS)}
                        style={small}
                    >
                        −
                    </button>
                    {text === null ? (
                        <button
                            type="button"
                            title="Click to type the seconds"
                            data-recorder-value=""
                            onClick={() => setText(String(seconds(pause)))}
                            style={{
                                minWidth: 60,
                                border: 0,
                                background: "transparent",
                                color: "inherit",
                                font: "inherit",
                                cursor: "text",
                                borderRadius: 8,
                                padding: "2px 6px",
                            }}
                        >
                            {seconds(pause)} s
                        </button>
                    ) : (
                        <input
                            // eslint-disable-next-line jsx-a11y/no-autofocus
                            autoFocus
                            value={text}
                            inputMode="decimal"
                            aria-label="Pause seconds"
                            onChange={(e) => setText(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onBlur={commit}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commit()
                                if (e.key === "Escape") {
                                    e.stopPropagation()
                                    setText(null)
                                }
                            }}
                            style={{
                                width: 60,
                                boxSizing: "border-box",
                                border: 0,
                                borderRadius: 8,
                                background: "#27272a",
                                color: "inherit",
                                font: "inherit",
                                textAlign: "center",
                                padding: "3px 4px",
                                outline: "none",
                            }}
                        />
                    )}
                    <button
                        type="button"
                        aria-label="More pause"
                        title="More pause"
                        onClick={() => set(pause + PAUSE_STEP_MS)}
                        style={small}
                    >
                        +
                    </button>
                </div>
            </div>
        </div>
    )
}

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { getCursorTip, getLastCursor, MOVE_MS, onCursorMove, onCursorPress, setCursorTip } from "@ui-recorder/core"
import { parkFraction, setParkCursor, type ParkKind } from "@ui-recorder/core"
import { aimDrop, cursorPoint, findElement, freePoint, openLine, play, resume, scrollTarget, stop, travelTo } from "@ui-recorder/core"
import { getAlt, getPointer, setAlt, setPointer, subscribeAlt } from "@ui-recorder/core"
import { appendFinalStep, flushRecording, startRecording, visibleBox } from "@ui-recorder/core"
import { getState, setState, subscribe } from "@ui-recorder/core"
import { ROOT_ATTR, UI_ATTR, type Step } from "@ui-recorder/core"
import { CONFIRM_TRIGGER_ATTR, ConfirmPopover } from "./Confirm"
import { GAP_ATTR, GAP_UI_ATTR, GapOptions, POPOVER_MS, SCROLL_ATTR } from "./GapOptions"

const TOP = 2147483647

// Same cursor as record-demo.mjs: the active point is the tip (5,3) of the 32px SVG
const ARROW_PATH = "M5 3 L5 25 L10.5 20 L14.2 28.5 L18.2 26.8 L14.6 18.4 L21.5 18.4 Z"
const ARROW_TIP = { x: 5, y: 3 }
const ARROW_OFFSET = `translate(${-ARROW_TIP.x}px, ${-ARROW_TIP.y}px)`

/** Marks each timeline node (start, steps and end) to bring it into view */
const NODE_ATTR = "data-recorder-node"
const BAR_BACKGROUND = "#18181b"

/**
  * Hover and click of all the widget's buttons, and `margin: 0` so a page-global `button { margin }` does not deform them. It is a stylesheet because inline styles cannot
  * express :hover; the !important rules override the border and background that already come inline.
 */
const HOVER_CSS = `
[${UI_ATTR}] button { margin: 0; transition: filter 120ms ease, transform 120ms ease, border-color 120ms ease, background-color 120ms ease; }
[${UI_ATTR}] button:not(:disabled):hover { filter: brightness(1.3); }
[${UI_ATTR}] button:not(:disabled):active { transform: scale(0.94); }
[${NODE_ATTR}]:not(:disabled):hover { transform: scale(1.1); border-color: #a1a1aa !important; }
[data-recorder-value]:not(:disabled):hover { background: rgba(255, 255, 255, 0.12) !important; }
[${GAP_ATTR}]:not(:disabled):hover, [${GAP_ATTR}]:not(:disabled):active { filter: none; transform: none; }
/* Only the red background blinks (the icon stays fixed); an animation overrides the background that comes inline */
@keyframes recorder-blink {
  0%, 100% { background-color: rgb(220, 38, 38); }
  50% { background-color: rgba(220, 38, 38, 0.2); }
}
/* Dotted border of the move frame: an SVG rectangle with stroke-dasharray; shifting the dashes (one period of 18) makes them
      run clockwise. There are two identical rectangles with the same animation: a black one and, below it, a white one shifted
      1px down and to the right, which looks like a light edge. The value is written literally: with var()/calc() the browser does not
      interpolate and the animation jumps. */
@keyframes recorder-dash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -18; } }
/* While recording; it starts 1 s after beginning (animation-delay only counts the first time) */
[data-recorder-recording] { animation: recorder-blink 1.2s ease-in-out 1s infinite; }
@keyframes recorder-fill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes recorder-pop-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes recorder-toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@media (prefers-reduced-motion: reduce) { [data-recorder-recording] { animation: none; } }
`
const FADE_WIDTH = 28

const barStyle: React.CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: 16,
    // With left: 50% the available width is half the window and the buttons split into two lines
    width: "max-content",
    // Maximum width of the widget: steps that do not fit are scrolled
    maxWidth: "min(720px, calc(100vw - 32px))",
    boxSizing: "border-box",
    transform: "translateX(-50%)",
    zIndex: TOP,
    display: "flex",
    alignItems: "center",
    gap: 8,
    // Same padding on all four sides: the buttons at the ends are concentric with the bar's curve,
    // and with a single button the bar is an exact circle
    padding: 8,
    borderRadius: 999,
    background: "#18181b",
    color: "#fafafa",
    font: "13px system-ui, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
}

/** Icon-only button: circle larger than the step ones (the icon has air around it), and always the same size even if the icon changes */
function pill(background: string): React.CSSProperties {
    return {
        border: 0,
        borderRadius: 999,
        width: 36,
        height: 36,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background,
        color: "#fafafa",
        cursor: "pointer",
    }
}

const ICON = { width: 14, height: 14, viewBox: "0 0 24 24" } as const

const RecordIcon = () => (
    <svg {...ICON} fill="currentColor">
        <circle cx="12" cy="12" r="8" />
    </svg>
)
const PlayIcon = () => (
    <svg {...ICON} fill="currentColor">
        <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5Z" />
    </svg>
)
const StopIcon = () => (
    <svg {...ICON} fill="currentColor">
        <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
)
const TrashIcon = () => (
    <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
)

function circle(
    selected: boolean,
    failed: boolean,
    current: boolean,
    done: boolean,
    move = false,
    scroll = false,
    type = false
): React.CSSProperties {
    const border = failed
        ? "#ef4444"
        : current
          ? "#3b82f6"
          : done
            ? "#16a34a"
            : selected
              ? "#fafafa"
              : "#52525b"
    return {
        width: 28,
        height: 28,
        // A scroll step is a rounded square and a typing one a bubble (circle with one
        // straight corner); the rest, circles
        borderRadius: scroll ? 8 : type ? "50% 50% 50% 6px" : "50%",
        // A "rest" step (it only carries the cursor, with no click) has a dotted border
        border: `2px ${move ? "dashed" : "solid"} ${border}`,
        boxShadow: current ? "0 0 0 4px rgba(59, 130, 246, 0.35)" : undefined,
        background: failed ? "#7f1d1d" : selected ? "#fafafa" : "#27272a",
        color: selected && !failed ? "#18181b" : "#fafafa",
        font: "600 12px system-ui, sans-serif",
        cursor: "pointer",
        padding: 0,
    }
}

/**
  * Fake cursor. During a trip the player moves it (with an animated path);
  * standing on a step it is computed from the selector on every frame, it is not saved.
 */
function Cursor({
    step,
    park,
    onPark,
    onAim,
}: {
    step: Step | undefined
    /** At the start or at the end: where it is parked (fraction of the window); null if it is over a step */
    park: { x: number; y: number } | null
    /** It can be dragged only when parked at the start or at the end... */
    onPark: ((point: { x: number; y: number }) => void) | null
    /** ...or in aim mode, over a step's target: receives the screen point where it was dropped */
    onAim: ((x: number, y: number) => void) | null
}) {
    const ref = useRef<HTMLDivElement>(null)
    const arrowRef = useRef<HTMLDivElement>(null)
    const placed = useRef(false)
    // While being dragged the move frame is hidden
    const [dragging, setDragging] = useState(false)
    const movable = !!(onPark || onAim)

    // The frame appears only once the cursor stops: not while it travels to its place (the path is a CSS transition
    // of `transform`, so it is known when it starts and when it ends)
    const [moving, setMoving] = useState(false)
    useEffect(() => {
        const node = ref.current
        if (!node) return
        const start = (e: TransitionEvent) => e.target === node && setMoving(true)
        const end = (e: TransitionEvent) => e.target === node && setMoving(false)
        node.addEventListener("transitionrun", start)
        node.addEventListener("transitionend", end)
        node.addEventListener("transitioncancel", end)
        return () => {
            node.removeEventListener("transitionrun", start)
            node.removeEventListener("transitionend", end)
            node.removeEventListener("transitioncancel", end)
        }
    }, [])
    // And not before the path has started: after every change of place or step a couple of frames are waited. The "key" is
    // renewed in the same render in which the step changes, so the frame is never seen even for one frame with the previous state
    const parkKey = park ? `${park.x},${park.y}` : ""
    const frameKey = useMemo(() => ({}), [movable, step, parkKey])
    const [armedKey, setArmedKey] = useState<object | null>(null)
    const armed = armedKey === frameKey
    useEffect(() => {
        let second = 0
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setArmedKey(frameKey))
        })
        return () => {
            cancelAnimationFrame(first)
            cancelAnimationFrame(second)
        }
    }, [frameKey])

    // Click: the arrow sinks and an expanding ring comes out (same as in record-demo.mjs)
    useEffect(
        () =>
            onCursorPress((x, y, speed) => {
                arrowRef.current?.animate(
                    [
                        { transform: `${ARROW_OFFSET} scale(1)` },
                        { transform: `${ARROW_OFFSET} scale(0.82)` },
                        { transform: `${ARROW_OFFSET} scale(1)` },
                    ],
                    { duration: 320 / speed, easing: "ease-out" }
                )
                const size = 56
                const ring = document.createElement("div")
                ring.setAttribute(UI_ATTR, "")
                ring.style.cssText = `position:fixed;z-index:${TOP - 3};pointer-events:none;left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;border:3px solid #000;box-shadow:0 0 0 2px #fff,inset 0 0 0 2px #fff;`
                document.body.appendChild(ring)
                ring
                    .animate(
                        [
                            { transform: "scale(0.25)", opacity: 0.9 },
                            { transform: "scale(1.15)", opacity: 0 },
                        ],
                        { duration: 650 / speed, easing: "cubic-bezier(.2,.7,.3,1)" }
                    )
                    .finished.then(() => ring.remove())
            }),
        []
    )

    useEffect(() => {
        const move = (x: number, y: number, ms: number) => {
            const node = ref.current
            if (!node) return
            // The first position appears directly; the following ones travel
            node.style.transition = placed.current ? `transform ${ms}ms ease-in-out` : "none"
            node.style.transform = `translate(${x}px, ${y}px)`
            node.style.display = "block"
            placed.current = true
        }
        // After a reload the widget mounts after the player already sent the cursor to the center
        const last = getLastCursor()
        if (last) move(last.x, last.y, 0)
        return onCursorMove(move)
    }, [])

    // Parked at the start or at the end of the script: in its place (the center, or where the person left it)
    const parkX = park?.x
    const parkY = park?.y
    useEffect(() => {
        if (parkX === undefined || parkY === undefined) return
        const place = () => {
            const node = ref.current
            if (!node) return
            node.style.transition = "none"
            node.style.transform = `translate(${parkX * window.innerWidth}px, ${parkY * window.innerHeight}px)`
            node.style.display = "block"
            placed.current = true
            setCursorTip(parkX * window.innerWidth, parkY * window.innerHeight)
        }
        place()
        window.addEventListener("resize", place)
        return () => window.removeEventListener("resize", place)
    }, [parkX, parkY])

    // Drag: the arrow tip follows the pointer keeping where it was grabbed
    const drag = useRef<{ dx: number; dy: number } | null>(null)
    // While dragging (and until the saved step changes) the element tracking must not return the cursor
    const hold = useRef(false)
    /** The arrow tip (its active point) on screen: the arrow is shifted ARROW_TIP from its box origin */
    function pointerTip() {
        const r = arrowRef.current?.getBoundingClientRect()
        return r ? { x: r.left + ARROW_TIP.x, y: r.top + ARROW_TIP.y } : { x: 0, y: 0 }
    }
    function dragTo(e: React.PointerEvent) {
        const g = drag.current
        const node = ref.current
        if (!g || !node) return null
        const x = Math.min(window.innerWidth, Math.max(0, e.clientX - g.dx))
        const y = Math.min(window.innerHeight, Math.max(0, e.clientY - g.dy))
        node.style.transition = "none"
        node.style.transform = `translate(${x}px, ${y}px)`
        setCursorTip(x, y)
        return { x, y }
    }

    useEffect(() => {
        if (!step) return
        hold.current = false
        let raf = 0
        let release = 0

        /** Where the cursor goes for this step right now (null if its element is not there) */
        const target = () => {
            if (step.selector === "") return freePoint(step)
            const el = step.kind === "scroll" ? scrollTarget(step) : findElement(step.selector)
            return el ? cursorPoint(step, el) : null
        }

        // If the cursor was already somewhere else (for example, when opening a line standing right at the state
        // before the step, or when leaving aim mode), it travels to this step's point instead of jumping
        const first = target()
        const from = getCursorTip()
        const node = ref.current
        if (node && first && from && placed.current && Math.hypot(from.x - first.x, from.y - first.y) > 3) {
            hold.current = true
            // The frame must not be visible during this path: it is marked now, without waiting for the browser to report the transition
            setMoving(true)
            node.style.transition = `transform ${MOVE_MS}ms ease-in-out`
            node.style.transform = `translate(${first.x}px, ${first.y}px)`
            node.style.display = "block"
            setCursorTip(first.x, first.y)
            // While it travels the per-frame tracking must not return it; on arrival it follows the element
            release = window.setTimeout(() => {
                hold.current = false
                setMoving(false)
            }, MOVE_MS)
        }

        const tick = () => {
            if (hold.current) {
                raf = requestAnimationFrame(tick)
                return
            }
            const node = ref.current
            const point = target()
            if (node && point) {
                node.style.transition = "none"
                node.style.transform = `translate(${point.x}px, ${point.y}px)`
                node.style.display = "block"
                placed.current = true
                setCursorTip(point.x, point.y)
            }
            // If the click made the element disappear, the cursor stays where it was
            raf = requestAnimationFrame(tick)
        }
        tick()
        return () => {
            cancelAnimationFrame(raf)
            clearTimeout(release)
        }
    }, [step])

    // It is grabbed by the little move box (not by the arrow), parked at the start or at the end, or aiming
    const dragHandlers: React.HTMLAttributes<HTMLDivElement> = {
        onPointerDown: (e) => {
            if (!onPark && !onAim) return
            hold.current = true
            setDragging(true)
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            const tip = pointerTip()
            drag.current = { dx: e.clientX - tip.x, dy: e.clientY - tip.y }
        },
        onPointerMove: (e) => {
            dragTo(e)
        },
        onPointerUp: (e) => {
            const point = dragTo(e)
            drag.current = null
            setDragging(false)
            if (point && onPark) {
                onPark({ x: point.x / window.innerWidth, y: point.y / window.innerHeight })
            }
            if (point && onAim) onAim(point.x, point.y)
        },
        onPointerCancel: () => {
            drag.current = null
            setDragging(false)
        },
    }

    return (
        <div
            ref={ref}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                // Below the trip overlay and the bar
                zIndex: TOP - 2,
                pointerEvents: "none",
                display: "none",
            }}
        >
            {movable && <MoveFrame hidden={dragging || moving || !armed} dragging={dragging} handle={dragHandlers} />}
            <div
                ref={arrowRef}
                style={{
                    width: 32,
                    height: 32,
                    transform: ARROW_OFFSET,
                    filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))",
                    // The arrow receives no events: it is dragged from the little move box
                    pointerEvents: "none",
                }}
            >
                {/* Classic bold arrow: black fill, white border and outer black border */}
                <svg width="32" height="32" viewBox="0 0 32 32" strokeLinejoin="round">
                    <path d={ARROW_PATH} fill="#000" stroke="#000" strokeWidth="5.5" />
                    <path d={ARROW_PATH} fill="#000" stroke="#fff" strokeWidth="3" />
                    <path d={ARROW_PATH} fill="#000" />
                </svg>
            </div>
        </div>
    )
}

/** Seconds one lap of the dashes takes */
const MARCH_SECONDS = 1.7
const MARCH_SIZE = 84
/** Stroke thickness (the white one has the same) */
const MARCH_THICK = 2
const MARCH_DASH = 10
const MARCH_GAP = 8
/** Corner radius of the frame (px); 0 is square corners */
const MARCH_RADIUS = 14
/** Opacity of the whole frame (both strokes together): so it does not cover the content below */
const MARCH_OPACITY = 0.7
/** The two strokes: a very dark gray and, below it, a very light gray */
const MARCH_DARK = "#27272a"
const MARCH_LIGHT = "#e4e4e7"
/** On hover the frame turns blue (the #3b82f6 the widget already uses on the line in progress) with a light blue below it */
const MARCH_HOVER_DARK = "#3b82f6"
const MARCH_HOVER_LIGHT = "#dbeafe"
/** How far the light stroke is shifted down and to the right relative to the black one (px) */
const WHITE_OFFSET = 1
// `pathLength` normalizes the perimeter to a whole number of periods: the dashes go exactly around, with no cut point
const MARCH_PERIOD = MARCH_DASH + MARCH_GAP
const MARCH_SIDE = MARCH_SIZE - MARCH_THICK
const PATH_LENGTH = Math.round((4 * MARCH_SIDE - 8 * MARCH_RADIUS + 2 * Math.PI * MARCH_RADIUS) / MARCH_PERIOD) * MARCH_PERIOD

/**
  * Dotted frame around the whole arrow: it indicates this cursor can be dragged. It is an SVG with two identical
  * synchronized rectangles, a dark gray one and a light gray one below it, shifted 1px down and to the right.
  * The whole frame is the drag area; it is hidden while dragging.
 */
function MoveFrame({ hidden, dragging, handle }: { hidden: boolean; dragging: boolean; handle: React.HTMLAttributes<HTMLDivElement> }) {
    const [hover, setHover] = useState(false)
    const rect = (color: string, offset: number) => (
        <rect
            x={MARCH_THICK / 2 + offset}
            y={MARCH_THICK / 2 + offset}
            width={MARCH_SIDE}
            height={MARCH_SIDE}
            rx={MARCH_RADIUS}
            fill="none"
            strokeWidth={MARCH_THICK}
            strokeLinecap="round"
            pathLength={PATH_LENGTH}
            strokeDasharray={`${MARCH_DASH} ${MARCH_GAP}`}
            style={{ stroke: color, transition: "stroke .2s ease", animation: `recorder-dash ${MARCH_SECONDS}s linear infinite` }}
        />
    )
    return (
        <div
            {...handle}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            title="Drag to choose where the cursor ends up"
            style={{
                position: "absolute",
                // It surrounds the arrow (which extends ~17px to the right and ~26px down from the tip), with ~28px of air around it
                left: -34,
                top: -29,
                width: MARCH_SIZE,
                height: MARCH_SIZE,
                borderRadius: MARCH_RADIUS,
                // The whole frame is the area grabbed to drag
                pointerEvents: "auto",
                // While dragging the real pointer is hidden: only the fake cursor remains. With the pointer captured, this element's cursor rules
                cursor: dragging ? "none" : "grab",
                touchAction: "none",
                // While dragging it is hidden (with opacity, not display, so the pointer capture is not lost)
                opacity: hidden ? 0 : MARCH_OPACITY,
                transition: "opacity .12s",
            }}
        >
            <svg width={MARCH_SIZE} height={MARCH_SIZE} style={{ display: "block", overflow: "visible", pointerEvents: "none" }}>
                {rect(hover ? MARCH_HOVER_LIGHT : MARCH_LIGHT, WHITE_OFFSET)}
                {rect(hover ? MARCH_HOVER_DARK : MARCH_DARK, 0)}
            </svg>
        </div>
    )
}

/**
  * Aim mode: warns, with an orange outline on the element, when the cursor ended up outside its area. It is only
  * a warning (the cursor can be dropped anywhere, and the click still reaches the element); inside the area it is not visible.
 */
function AimWarning({ step }: { step: Step }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        let raf = 0
        const tick = () => {
            const node = ref.current
            if (node) {
                const el = step.selector === "" ? null : step.kind === "scroll" ? scrollTarget(step) : findElement(step.selector)
                const tip = getCursorTip()
                if (el && tip) {
                    const b = visibleBox(el)
                    const outside = tip.x < b.left || tip.x > b.right || tip.y < b.top || tip.y > b.bottom
                    node.style.display = outside ? "block" : "none"
                    node.style.transform = `translate(${b.left}px, ${b.top}px)`
                    node.style.width = `${b.right - b.left}px`
                    node.style.height = `${b.bottom - b.top}px`
                } else {
                    node.style.display = "none"
                }
            }
            raf = requestAnimationFrame(tick)
        }
        tick()
        return () => cancelAnimationFrame(raf)
    }, [step.selector, step.kind])
    return (
        <div
            ref={ref}
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                display: "none",
                zIndex: TOP - 3,
                pointerEvents: "none",
                boxSizing: "border-box",
                border: "2px dashed #f59e0b",
                borderRadius: 4,
                background: "rgba(245, 158, 11, 0.1)",
            }}
        />
    )
}

/**
  * With Alt held while recording: the fake cursor arrow (what will be played back) stuck to the
  * pointer, with a dotted ring, and the real cursor becomes a cross (with priority over the
  * cursors of each element). It indicates the next click is recorded as a cursor rest, with no click.
 */
function RestGhost() {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const place = (x: number, y: number) => {
            if (ref.current) ref.current.style.transform = `translate(${x}px, ${y}px)`
        }
        const p = getPointer()
        place(p.x, p.y)
        const move = (e: MouseEvent) => place(e.clientX, e.clientY)
        window.addEventListener("mousemove", move, true)
        return () => window.removeEventListener("mousemove", move, true)
    }, [])
    return (
        <>
            <style>{"html, html * { cursor: crosshair !important }"}</style>
            <div
                ref={ref}
                style={{ position: "fixed", top: 0, left: 0, zIndex: TOP - 2, pointerEvents: "none" }}
            >
                <div
                    style={{
                        position: "absolute",
                        left: -20,
                        top: -20,
                        width: 40,
                        height: 40,
                        boxSizing: "border-box",
                        borderRadius: "50%",
                        border: "2px dashed #000",
                        boxShadow: "0 0 0 2px #fff, inset 0 0 0 2px #fff",
                        opacity: 0.85,
                    }}
                />
                <div style={{ transform: ARROW_OFFSET, width: 32, height: 32, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.35))" }}>
                    <svg width="32" height="32" viewBox="0 0 32 32" strokeLinejoin="round">
                        <path d={ARROW_PATH} fill="#000" stroke="#000" strokeWidth="5.5" />
                        <path d={ARROW_PATH} fill="#000" stroke="#fff" strokeWidth="3" />
                        <path d={ARROW_PATH} fill="#000" />
                    </svg>
                </div>
            </div>
        </>
    )
}

/**
  * `width` is what is left to scroll on that side (up to FADE_WIDTH). It is always opaque at the
  * edge, which is what covers the cut of a half-visible node; on reaching the end it measures 0 and disappears.
 */
function Fade({ side, width }: { side: "left" | "right"; width: number }) {
    return (
        <div
            style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                [side]: 0,
                width,
                pointerEvents: "none",
                background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${BAR_BACKGROUND}, rgba(24, 24, 27, 0))`,
            }}
        />
    )
}

/** Horizontally scrolling steps area with a gradient on each side where there is more content */
function Scroller({ children }: { children: React.ReactNode }) {
    const scroller = useRef<HTMLDivElement>(null)
    const content = useRef<HTMLDivElement>(null)
    const [more, setMore] = useState({ left: 0, right: 0 })

    useEffect(() => {
        const el = scroller.current
        const inner = content.current
        if (!el || !inner) return
        const update = () => {
            const clamp = (n: number) => Math.round(Math.min(FADE_WIDTH, Math.max(0, n)))
            const left = clamp(el.scrollLeft)
            const right = clamp(el.scrollWidth - el.clientWidth - el.scrollLeft)
            setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
        }
        update()
        el.addEventListener("scroll", update, { passive: true })
        // The content grows when steps are added and the area changes with the window
        const observer = new ResizeObserver(update)
        observer.observe(el)
        observer.observe(inner)
        return () => {
            el.removeEventListener("scroll", update)
            observer.disconnect()
        }
    }, [])

    return (
        <div style={{ position: "relative", display: "flex", minWidth: 0 }}>
            {/* No visible scroll bar */}
            <style>{`[${SCROLL_ATTR}]::-webkit-scrollbar { display: none }`}</style>
            <div
                ref={scroller}
                {...{ [SCROLL_ATTR]: "" }}
                style={{ overflowX: "auto", overflowY: "hidden", minWidth: 0, scrollbarWidth: "none" }}
            >
                <div
                    ref={content}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "max-content",
                        // Room for the current step's halo, which the scroll would otherwise clip
                        padding: "4px 6px",
                    }}
                >
                    {children}
                </div>
            </div>
            <Fade side="left" width={more.left} />
            <Fade side="right" width={more.right} />
        </div>
    )
}

/** Notice of a step whose element was not found: says which one it was and which selector it looked for */
function ErrorToast({ index, step, onClose }: { index: number; step: Step; onClose: () => void }) {
    return (
        <div
            {...{ [ROOT_ATTR]: "" }}
            role="alert"
            style={{
                position: "fixed",
                left: "50%",
                // Right above the bar (52 px tall + 16 margin + 12 of air)
                bottom: 80,
                zIndex: TOP,
                width: "max-content",
                maxWidth: "min(480px, calc(100vw - 32px))",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 16,
                background: "#2a1215",
                border: "1px solid rgba(239, 68, 68, 0.55)",
                color: "#fecaca",
                font: "13px system-ui, sans-serif",
                boxShadow: "0 8px 30px rgba(0,0,0,.3)",
                animation: "recorder-toast-in 180ms ease-out both",
            }}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
            </svg>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>The element of step {index + 1} was not found</div>
                <div style={{ marginTop: 2, color: "#fca5a5", opacity: 0.85 }}>The page may have changed since you recorded it.</div>
                <div
                    title={step.selector}
                    style={{
                        marginTop: 6,
                        color: "#f87171",
                        font: "11px ui-monospace, monospace",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {step.selector}
                </div>
            </div>
            <button
                type="button"
                aria-label="Close notice"
                title="Close"
                onClick={onClose}
                style={{ flexShrink: 0, width: 20, height: 20, border: 0, borderRadius: "50%", padding: 0, background: "transparent", color: "#fca5a5", font: "600 14px system-ui, sans-serif", lineHeight: 1, cursor: "pointer" }}
            >
                ×
            </button>
        </div>
    )
}

/**
  * Line between two nodes: it is the pause that follows position `p` (-1 = start).
  * The whole gap is clickable, not just the stroke; all of them look the same.
 */
/** Length of the line between two nodes */
const LINE_WIDTH = 24
const LINE_TRACK = "#52525b"
const LINE_RUNNING = "#3b82f6"
const LINE_DONE = "#16a34a"

type GapFill = { kind: "none" } | { kind: "done" } | { kind: "running"; ms: number; id: number }

function Gap({
    p,
    selected,
    disabled,
    fill,
}: {
    p: number
    selected: boolean
    disabled: boolean
    fill: GapFill
}) {
    const [hover, setHover] = useState(false)
    return (
        <button
            type="button"
            disabled={disabled}
            aria-label="Pause"
            title="Pause"
            {...{ [GAP_ATTR]: p, [GAP_UI_ATTR]: "" }}
            // Opening a line always goes to the state before the step that follows it (with the cursor resting on its
            // target, adjustable). It stays selected until something else is chosen or the page is reloaded
            onClick={() => {
                if (!selected) openLine(p)
            }}
            // With this line's bar open, the next Tab goes to its first button (the bar is somewhere else in the
            // DOM, so the natural order would not go through it)
            onKeyDown={(e) => {
                if (e.key !== "Tab" || e.shiftKey || !selected) return
                const first = document.querySelector<HTMLElement>(`div[${GAP_UI_ATTR}] button, div[${GAP_UI_ATTR}] input`)
                if (first) {
                    e.preventDefault()
                    first.focus()
                }
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                // The click area is the whole gap, not just the line
                width: LINE_WIDTH + 16,
                // Cancels the bar's gap: the net gap is the length of the line
                margin: "0 -8px",
                height: 28,
                padding: 0,
                border: 0,
                background: "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                cursor: disabled ? "default" : "pointer",
            }}
        >
            {/* Solid rounded rail; it lightens on hover and when its pause opens */}
            <span
                style={{
                    position: "relative",
                    width: LINE_WIDTH,
                    height: 4,
                    borderRadius: 2,
                    overflow: "hidden",
                    background: selected ? "#fafafa" : hover && !disabled ? "#a1a1aa" : LINE_TRACK,
                    transition: "background-color 120ms ease",
                }}
            >
                {/* Pause progress: it fills over the time it lasts; the ones already done stay full */}
                {fill.kind !== "none" && (
                    <span
                        key={fill.kind === "running" ? fill.id : "done"}
                        style={{
                            position: "absolute",
                            inset: 0,
                            background: fill.kind === "running" ? LINE_RUNNING : LINE_DONE,
                            transformOrigin: "left",
                            animation:
                                fill.kind === "running"
                                    ? `recorder-fill ${fill.ms}ms linear forwards`
                                    : undefined,
                        }}
                    />
                )}
            </span>
        </button>
    )
}

const BAR_RESIZE_MS = 250

/**
  * Animates the width of the bar when the content changes (a step is added, or the start and the
  * end appear when recording finishes). CSS cannot transition an auto width, so the
  * change is measured and animated by hand from one width to the other. A window change is not animated.
 */
function useAnimatedWidth(ref: React.RefObject<HTMLDivElement | null>, ready: boolean) {
    useEffect(() => {
        const el = ref.current
        if (!el || !ready) return
        let last = el.getBoundingClientRect().width
        let lastWindow = window.innerWidth
        let busy = false

        const run = (from: number, to: number) => {
            busy = true
            // While it grows, the content (already wider) must not overflow the bar
            el.style.overflow = "hidden"
            el.style.transition = "none"
            el.style.width = `${from}px`
            void el.offsetWidth
            el.style.transition = `width ${BAR_RESIZE_MS}ms ease`
            el.style.width = `${to}px`
            let finished = false
            const done = () => {
                if (finished) return
                finished = true
                el.removeEventListener("transitionend", onEnd)
                clearTimeout(timer)
                el.style.transition = ""
                el.style.overflow = ""
                el.style.width = "max-content"
                busy = false
                const natural = el.getBoundingClientRect().width
                // If the content changed again while animating, it continues from where it was
                if (Math.abs(natural - to) > 1) run(to, natural)
                else last = natural
            }
            const onEnd = (e: TransitionEvent) => {
                if (e.target === el && e.propertyName === "width") done()
            }
            el.addEventListener("transitionend", onEnd)
            const timer = setTimeout(done, BAR_RESIZE_MS + 80)
        }

        const observer = new ResizeObserver(() => {
            if (busy) return
            const now = el.getBoundingClientRect().width
            const windowChanged = window.innerWidth !== lastWindow
            lastWindow = window.innerWidth
            if (windowChanged || Math.abs(now - last) < 1) {
                last = now
                return
            }
            const from = last
            last = now
            run(from, now)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref, ready])
}

export function Recorder() {
    const state = useSyncExternalStore(subscribe, getState, getState)
    // It mounts on document.body and only on the client (Next renders on the server)
    const [mounted, setMounted] = useState(false)
    // Open confirmation: record again (if there was already something) or delete the script
    const [confirm, setConfirm] = useState<"record" | "delete" | null>(null)
    useEffect(() => {
        setMounted(true)
        void resume()
    }, [])

    const bar = useRef<HTMLDivElement>(null)
    useAnimatedWidth(bar, mounted)

    // The pause bar fades out when closed: it stays mounted POPOVER_MS longer with the last line
    const openGap = state.gap !== null && state.pending === null && !state.recording ? state.gap : null
    const [lastGap, setLastGap] = useState<number | null>(null)
    useEffect(() => {
        if (openGap !== null) return setLastGap(openGap)
        const timer = setTimeout(() => setLastGap(null), POPOVER_MS)
        return () => clearTimeout(timer)
    }, [openGap])
    const shownGap = openGap ?? lastGap

    // An aim mode that no longer applies (its line was closed or the position changed) turns itself off, as long as
    // no trip is in progress: during the trip the line is reopened on arrival
    useEffect(() => {
        if (state.aim === null || state.pending !== null) return
        const valid = state.gap === state.aim - 1 && state.selected === state.aim - 1 && !state.recording
        if (!valid) setState({ aim: null })
    }, [state.aim, state.gap, state.selected, state.pending, state.recording])

    // The running step (or the one you stopped at) is kept in view; when recording, the scroll follows the last step added
    const lastStep = (state.script?.steps.length ?? 0) - 1
    const focusNode = state.current ?? (state.recording ? (lastStep >= 0 ? lastStep : null) : state.selected)
    useEffect(() => {
        if (!mounted || focusNode === null) return
        document
            .querySelector(`[${NODE_ATTR}="${focusNode}"]`)
            ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
    }, [mounted, focusNode])

    // While recording, the Alt (Option) key and the pointer are tracked to show the "rest" ghost
    const alt = useSyncExternalStore(subscribeAlt, getAlt, getAlt)
    useEffect(() => {
        if (!state.recording) return
        const key = (e: KeyboardEvent) => {
            // Esc ends the recording (same as the stop button) and the page does not receive it: otherwise an
            // Esc meant to stop would also close a modal or a menu of the app
            if (e.key === "Escape" && e.type === "keydown") {
                e.preventDefault()
                e.stopPropagation()
                flushRecording()
                appendFinalStep()
                const count = getState().script?.steps.length ?? 0
                setState({ recording: false, selected: count > 0 ? count - 1 : null })
                return
            }
            if (e.key !== "Alt") return
            setAlt(e.type === "keydown")
            // On Windows releasing Alt focuses the browser menu
            e.preventDefault()
        }
        // The browser does not report if Alt was released outside the window: it is resynchronized on every movement
        const move = (e: MouseEvent) => {
            setPointer(e.clientX, e.clientY)
            setAlt(e.altKey)
        }
        const off = () => setAlt(false)
        window.addEventListener("keydown", key, true)
        window.addEventListener("keyup", key, true)
        window.addEventListener("mousemove", move, true)
        window.addEventListener("blur", off)
        return () => {
            window.removeEventListener("keydown", key, true)
            window.removeEventListener("keyup", key, true)
            window.removeEventListener("mousemove", move, true)
            window.removeEventListener("blur", off)
            setAlt(false)
        }
    }, [state.recording])

    useEffect(() => {
        if (!state.recording) return
        return startRecording((step) => {
            const { script } = getState()
            if (!script) return
            setState({ script: { ...script, steps: [...script.steps, step] } })
        })
    }, [state.recording])

    if (!mounted) return null

    const steps = state.script?.steps ?? []
    // Fill of the lines: the ones left behind the position (or the running step) are done, the
    // one being waited on fills over the time of its pause, and the ones ahead are empty. When going back to an
    // earlier position the ones ahead are left empty: they fill again when playing again from there.
    const gapCursor = state.waiting
        ? state.waiting.gap
        : state.pending !== null
          ? state.current
          : state.selected
    const gapFill = (p: number): GapFill => {
        if (state.waiting && p === state.waiting.gap) {
            return { kind: "running", ms: state.waiting.ms, id: state.waiting.id }
        }
        return gapCursor !== null && p < gapCursor ? { kind: "done" } : { kind: "none" }
    }

    // Aim mode: that step's line is open, the position is the state before it and nothing is running
    const aimActive =
        state.aim !== null &&
        state.gap === state.aim - 1 &&
        state.selected === state.aim - 1 &&
        state.pending === null &&
        !state.recording
    // The resting cursor is the one of the step being aimed at (before doing it), not the one of the previous step
    const selectedStep = aimActive
        ? steps[state.aim!]
        : state.selected !== null && state.selected >= 0
          ? steps[state.selected]
          : undefined

    // The last step, if it is a rest (the one added automatically when recording ends or one the person recorded), is the
    // end of the script and is shown with a flag
    const isFinalRest = (i: number) => i === steps.length - 1 && steps[i].kind === "rest"

    // Standing at the start or at the end (and with nothing running): the cursor can be dragged elsewhere
    const parkedKind: ParkKind | null = state.pending !== null || aimActive ? null : state.selected === -1 ? "start" : null

    function toggleRecording() {
        if (state.recording) {
            // If a scroll was left half-done, it is closed before counting the steps
            flushRecording()
            // When it ends a final step is added automatically (a cursor rest in the middle of the screen, with a flag)
            appendFinalStep()
            const count = getState().script?.steps.length ?? 0
            // You just made those clicks: everything is already done, so you end up on the last step
            setState({ recording: false, selected: count > 0 ? count - 1 : null })
        } else {
            setState({
                recording: true,
                gap: null,
                selected: null,
                failed: null,
                script: { startUrl: location.href, steps: [] },
            })
        }
    }

    return createPortal(
        // display: contents: it only marks everything of the widget, without affecting the layout
        <div {...{ [UI_ATTR]: "" }} style={{ display: "contents" }}>
            <style>{HOVER_CSS}</style>
            <div ref={bar} {...{ [ROOT_ATTR]: "" }} style={barStyle}>
                <button
                    type="button"
                    // With an already recorded script, recording again replaces it: confirmation is asked first
                    {...{ [CONFIRM_TRIGGER_ATTR]: "record" }}
                    onClick={() => {
                        if (state.recording || steps.length === 0) toggleRecording()
                        else setConfirm((c) => (c === "record" ? null : "record"))
                    }}
                    // While recording, the button's background blinks
                    {...(state.recording ? { "data-recorder-recording": "" } : {})}
                    title={state.recording ? "Stop recording" : "Record"}
                    aria-label={state.recording ? "Stop recording" : "Record"}
                    style={pill(state.recording ? "#dc2626" : "#3f3f46")}
                >
                    {state.recording ? <StopIcon /> : <RecordIcon />}
                </button>
                {steps.length > 0 && !state.recording && (
                    <button
                        type="button"
                        onClick={state.pending !== null ? stop : play}
                        title={state.pending !== null ? "Stop" : "Play"}
                        aria-label={state.pending !== null ? "Stop" : "Play"}
                        style={pill(state.pending !== null ? "#dc2626" : "#16a34a")}
                    >
                        {state.pending !== null ? <StopIcon /> : <PlayIcon />}
                    </button>
                )}
                {steps.length > 0 && (
                    <Scroller>
                {steps.length > 0 && !state.recording && (
                        <>
                            <button
                                type="button"
                                title="Start"
                                {...{ [NODE_ATTR]: -1 }}
                                aria-label="Start"
                                onClick={() => {
                                    setState({ gap: null })
                                    travelTo(-1)
                                }}
                                style={circle(
                                    state.selected === -1 && openGap === null,
                                    false,
                                    false,
                                    state.current !== null
                                )}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                    <circle cx="12" cy="12" r="6" />
                                </svg>
                            </button>
                            <Gap p={-1} selected={state.gap === -1} disabled={state.pending !== null} fill={gapFill(-1)} />
                        </>
                    )}
                    {steps.map((_, i) => (
                        <Fragment key={i}>
                            {i > 0 && (
                                <Gap
                                    p={i - 1}
                                    selected={state.gap === i - 1}
                                    disabled={state.recording || state.pending !== null}
                                    fill={gapFill(i - 1)}
                                />
                            )}
                            <button
                                type="button"
                                title={
                                    state.failed === i
                                        ? `Element not found: ${steps[i].selector}`
                                        : isFinalRest(i)
                                          ? "End: the cursor finishes there"
                                          : steps[i].kind === "rest"
                                          ? `Cursor at rest (no click)${steps[i].selector ? `: ${steps[i].selector}` : ""}`
                                          : steps[i].kind === "scroll"
                                            ? `Scroll: ${steps[i].selector}`
                                            : steps[i].kind === "type"
                                              ? `Type "${(steps[i].text ?? "").slice(0, 40)}${(steps[i].text ?? "").length > 40 ? "…" : ""}" in ${steps[i].selector}`
                                            : steps[i].selector
                                }
                                {...{ [NODE_ATTR]: i }}
                                onClick={() => {
                                    setState({ gap: null })
                                    travelTo(i)
                                }}
                                style={circle(
                                    state.selected === i && openGap === null,
                                    state.failed === i,
                                    state.current === i,
                                    state.current !== null && i < state.current,
                                    steps[i].kind === "rest",
                                    steps[i].kind === "scroll",
                                    steps[i].kind === "type"
                                )}
                            >
                                {/* The final step added when recording ends is shown with a flag */}
                                {isFinalRest(i) ? "⚑" : i + 1}
                            </button>
                        </Fragment>
                    ))}
                    </Scroller>
                )}
                {steps.length > 0 && !state.recording && (
                    <button
                        type="button"
                        {...{ [CONFIRM_TRIGGER_ATTR]: "delete" }}
                        onClick={() => setConfirm((c) => (c === "delete" ? null : "delete"))}
                        title="Delete script"
                        aria-label="Delete script"
                        style={pill("#3f3f46")}
                    >
                        <TrashIcon />
                    </button>
                )}
            </div>
            {shownGap !== null && <GapOptions key={shownGap} gap={shownGap} open={openGap !== null} />}
            {aimActive && selectedStep && <AimWarning step={selectedStep} />}
            {state.recording && alt && <RestGhost />}
            {confirm !== null && steps.length > 0 && !state.recording && state.pending === null && (
                <ConfirmPopover
                    key={confirm}
                    kind={confirm}
                    title={confirm === "delete" ? "Delete the script?" : "Record again?"}
                    body={
                        confirm === "delete"
                            ? steps.length === 1
                                ? "The recorded step is lost."
                                : `The ${steps.length} recorded steps are lost.`
                            : `There is already a script with ${steps.length === 1 ? "1 step" : `${steps.length} steps`}: recording replaces it.`
                    }
                    confirmLabel={confirm === "delete" ? "Delete" : "Record"}
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => {
                        setConfirm(null)
                        if (confirm === "delete") {
                            setState({ script: null, selected: null, failed: null, gap: null })
                        } else {
                            toggleRecording()
                        }
                    }}
                />
            )}
            {state.failed !== null &&
                !state.failedNoticeClosed &&
                state.pending === null &&
                shownGap === null &&
                confirm === null &&
                steps[state.failed] && (
                    <ErrorToast
                        key={state.failed}
                        index={state.failed}
                        step={steps[state.failed]}
                        // Closing the notice does not clear the error: the step stays red until the next action
                        onClose={() => setState({ failedNoticeClosed: true })}
                    />
                )}
            {state.pending !== null && (
                // It covers the page while the steps are repeated: the cursor is seen below it
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: TOP - 1,
                        // When playing (normal speed) it only blocks, without darkening
                        background: state.dim ? "rgba(9, 9, 11, 0.35)" : "transparent",
                    }}
                />
            )}
            {(state.pending !== null ||
                (state.selected !== null && state.failed === null)) && (
                <Cursor
                    step={state.pending === null ? selectedStep : undefined}
                    park={parkedKind ? parkFraction(state.script, parkedKind) : null}
                    onPark={parkedKind ? (point) => setParkCursor(parkedKind, point) : null}
                    onAim={aimActive ? (x, y) => aimDrop(state.aim!, x, y) : null}
                />
            )}
        </div>,
        document.body
    )
}

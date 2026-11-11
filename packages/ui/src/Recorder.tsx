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

// Mismo cursor que record-demo.mjs: el punto activo es la punta (5,3) del SVG de 32px
const ARROW_PATH = "M5 3 L5 25 L10.5 20 L14.2 28.5 L18.2 26.8 L14.6 18.4 L21.5 18.4 Z"
const ARROW_TIP = { x: 5, y: 3 }
const ARROW_OFFSET = `translate(${-ARROW_TIP.x}px, ${-ARROW_TIP.y}px)`

/** Marca cada nodo del timeline (inicio, pasos y final) para llevarlo a la vista */
const NODE_ATTR = "data-recorder-node"
const BAR_BACKGROUND = "#18181b"

/**
 * Hover y click de todos los botones del widget, y `margin: 0` para que un `button { margin }` global de la página no los deforme. Va como hoja de estilos porque los estilos en línea no
 * pueden expresar :hover; los !important pisan el borde y el fondo que ya vienen en línea.
 */
const HOVER_CSS = `
[${UI_ATTR}] button { margin: 0; transition: filter 120ms ease, transform 120ms ease, border-color 120ms ease, background-color 120ms ease; }
[${UI_ATTR}] button:not(:disabled):hover { filter: brightness(1.3); }
[${UI_ATTR}] button:not(:disabled):active { transform: scale(0.94); }
[${NODE_ATTR}]:not(:disabled):hover { transform: scale(1.1); border-color: #a1a1aa !important; }
[data-recorder-value]:not(:disabled):hover { background: rgba(255, 255, 255, 0.12) !important; }
[${GAP_ATTR}]:not(:disabled):hover, [${GAP_ATTR}]:not(:disabled):active { filter: none; transform: none; }
/* Parpadea solo el fondo rojo (el ícono queda fijo); una animación pisa el background que viene en línea */
@keyframes recorder-blink {
  0%, 100% { background-color: rgb(220, 38, 38); }
  50% { background-color: rgba(220, 38, 38, 0.2); }
}
/* Borde punteado del marco de mover: un rectángulo SVG con stroke-dasharray; el desplazamiento de las rayas (un período de 18) las
   hace correr en sentido horario. Hay dos rectángulos iguales y con la misma animación: uno negro y, debajo, uno blanco corrido
   1px hacia abajo y a la derecha, que se ve como un filo claro. El valor va escrito literal: con var()/calc() el navegador no
   interpola y la animación salta. */
@keyframes recorder-dash { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -18; } }
/* Mientras graba; arranca 1 s después de empezar (animation-delay solo cuenta la primera vez) */
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
    // Con left: 50% el ancho disponible es la mitad de la ventana y los botones se partían en dos líneas
    width: "max-content",
    // Ancho máximo del widget: los pasos que no entran se scrollean
    maxWidth: "min(720px, calc(100vw - 32px))",
    boxSizing: "border-box",
    transform: "translateX(-50%)",
    zIndex: TOP,
    display: "flex",
    alignItems: "center",
    gap: 8,
    // Mismo padding en los cuatro lados: los botones de las puntas quedan concentricos con la curva de la barra,
    // y con un solo botón la barra es un círculo exacto
    padding: 8,
    borderRadius: 999,
    background: "#18181b",
    color: "#fafafa",
    font: "13px system-ui, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.3)",
}

/** Botón de solo ícono: círculo más grande que los de los pasos (el ícono queda con aire alrededor), y siempre del mismo tamaño aunque cambie el ícono */
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
        // Un paso de scroll es un cuadrado redondeado y uno de escritura un globo (círculo con una esquina
        // recta); el resto, círculos
        borderRadius: scroll ? 8 : type ? "50% 50% 50% 6px" : "50%",
        // Un paso "mover" (solo lleva el cursor, sin click) tiene el borde punteado
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
 * Cursor falso. Durante un viaje lo mueve el player (con trayecto animado);
 * parado en un paso se calcula del selector en cada frame, no se guarda.
 */
function Cursor({
    step,
    park,
    onPark,
    onAim,
}: {
    step: Step | undefined
    /** En el inicio o en el final: dónde está parado (fracción de la ventana); null si está sobre un paso */
    park: { x: number; y: number } | null
    /** Se puede arrastrar solo cuando está parado en el inicio o en el final... */
    onPark: ((point: { x: number; y: number }) => void) | null
    /** ...o en el modo apuntar, sobre el objetivo de un paso: recibe el punto de la pantalla donde se soltó */
    onAim: ((x: number, y: number) => void) | null
}) {
    const ref = useRef<HTMLDivElement>(null)
    const arrowRef = useRef<HTMLDivElement>(null)
    const placed = useRef(false)
    // Mientras se arrastra el marco de mover se esconde
    const [dragging, setDragging] = useState(false)
    const movable = !!(onPark || onAim)

    // El marco aparece recién cuando el cursor se queda quieto: no mientras viaja a su lugar (el trayecto es una transición CSS
    // de `transform`, así que se sabe cuándo empieza y cuándo termina)
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
    // Y no antes de que el trayecto haya arrancado: tras cada cambio de lugar o de paso se espera un par de cuadros. La "clave" se
    // renueva en el mismo render en que cambia el paso, así que el marco no llega a verse ni un cuadro con el estado anterior
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

    // Click: la flecha se hunde y sale un anillo que se expande (igual que en record-demo.mjs)
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
            // La primera posición aparece directo; las siguientes viajan
            node.style.transition = placed.current ? `transform ${ms}ms ease-in-out` : "none"
            node.style.transform = `translate(${x}px, ${y}px)`
            node.style.display = "block"
            placed.current = true
        }
        // Tras una recarga el widget se monta después de que el player ya mandó el cursor al centro
        const last = getLastCursor()
        if (last) move(last.x, last.y, 0)
        return onCursorMove(move)
    }, [])

    // Parado en el inicio o en el final del guion: en su lugar (el centro, o donde lo dejó la persona)
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

    // Arrastre: la punta de la flecha sigue al puntero conservando dónde la agarraron
    const drag = useRef<{ dx: number; dy: number } | null>(null)
    // Mientras se arrastra (y hasta que el paso guardado cambie) el seguimiento del elemento no debe devolver el cursor
    const hold = useRef(false)
    /** La punta de la flecha (su punto activo) en pantalla: la flecha está corrida ARROW_TIP del origen de su caja */
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

        /** Dónde va el cursor para este paso ahora mismo (null si su elemento no está) */
        const target = () => {
            if (step.selector === "") return freePoint(step)
            const el = step.kind === "scroll" ? scrollTarget(step) : findElement(step.selector)
            return el ? cursorPoint(step, el) : null
        }

        // Si el cursor ya estaba en otro lugar (por ejemplo, al abrir una línea parado justo en el estado
        // anterior al paso, o al salir del modo apuntar), viaja hasta el punto de este paso en vez de saltar
        const first = target()
        const from = getCursorTip()
        const node = ref.current
        if (node && first && from && placed.current && Math.hypot(from.x - first.x, from.y - first.y) > 3) {
            hold.current = true
            // El marco no debe verse durante este trayecto: se marca ya, sin esperar a que el navegador avise de la transición
            setMoving(true)
            node.style.transition = `transform ${MOVE_MS}ms ease-in-out`
            node.style.transform = `translate(${first.x}px, ${first.y}px)`
            node.style.display = "block"
            setCursorTip(first.x, first.y)
            // Mientras viaja el seguimiento de cada frame no debe devolverlo; al llegar sigue al elemento
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
            // Si el click hizo desaparecer el elemento, el cursor se queda donde estaba
            raf = requestAnimationFrame(tick)
        }
        tick()
        return () => {
            cancelAnimationFrame(raf)
            clearTimeout(release)
        }
    }, [step])

    // Se agarra de la cajita de mover (no de la flecha), parado en el inicio o en el final, o apuntando
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
                // Por debajo del overlay del viaje y de la barra
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
                    // La flecha no recibe eventos: se arrastra desde la cajita de mover
                    pointerEvents: "none",
                }}
            >
                {/* Flecha clásica, bold: relleno negro, borde blanco y borde negro exterior */}
                <svg width="32" height="32" viewBox="0 0 32 32" strokeLinejoin="round">
                    <path d={ARROW_PATH} fill="#000" stroke="#000" strokeWidth="5.5" />
                    <path d={ARROW_PATH} fill="#000" stroke="#fff" strokeWidth="3" />
                    <path d={ARROW_PATH} fill="#000" />
                </svg>
            </div>
        </div>
    )
}

/** Segundos que tarda una vuelta de rayas */
const MARCH_SECONDS = 1.7
const MARCH_SIZE = 84
/** Grosor del trazo (el blanco tiene el mismo) */
const MARCH_THICK = 2
const MARCH_DASH = 10
const MARCH_GAP = 8
/** Radio de las esquinas del marco (px); 0 son esquinas rectas */
const MARCH_RADIUS = 14
/** Opacidad del marco entero (los dos trazos juntos): que no tape el contenido que hay debajo */
const MARCH_OPACITY = 0.7
/** Los dos trazos: un gris bien oscuro y, debajo, un gris bien clarito */
const MARCH_DARK = "#27272a"
const MARCH_LIGHT = "#e4e4e7"
/** En hover el marco se pone azul (el #3b82f6 que ya usa el widget en la línea en curso) con un azul clarito debajo */
const MARCH_HOVER_DARK = "#3b82f6"
const MARCH_HOVER_LIGHT = "#dbeafe"
/** Cuánto se corre el trazo claro hacia abajo y a la derecha respecto del negro (px) */
const WHITE_OFFSET = 1
// `pathLength` normaliza el perímetro a un número entero de períodos: las rayas dan la vuelta justa, sin un punto de corte
const MARCH_PERIOD = MARCH_DASH + MARCH_GAP
const MARCH_SIDE = MARCH_SIZE - MARCH_THICK
const PATH_LENGTH = Math.round((4 * MARCH_SIDE - 8 * MARCH_RADIUS + 2 * Math.PI * MARCH_RADIUS) / MARCH_PERIOD) * MARCH_PERIOD

/**
 * Marco punteado alrededor de la flecha entera: indica que este cursor se puede arrastrar. Es un SVG con dos rectángulos
 * iguales y sincronizados, uno gris oscuro y uno gris clarito debajo, corrido 1px hacia abajo y a la derecha.
 * Todo el marco es el área de arrastre; se esconde mientras se arrastra.
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
            title="Arrastrá para elegir dónde queda el cursor"
            style={{
                position: "absolute",
                // Rodea la flecha (que se extiende ~17px a la derecha y ~26px hacia abajo de la punta), con ~28px de aire alrededor
                left: -34,
                top: -29,
                width: MARCH_SIZE,
                height: MARCH_SIZE,
                borderRadius: MARCH_RADIUS,
                // Todo el marco es el área que se agarra para arrastrar
                pointerEvents: "auto",
                // Mientras se arrastra el puntero real se oculta: queda solo el cursor falso. Con el puntero capturado, manda el cursor de este elemento
                cursor: dragging ? "none" : "grab",
                touchAction: "none",
                // Mientras se arrastra se esconde (con opacidad, no con display, para no perder la captura del puntero)
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
 * Modo apuntar: avisa, con un contorno naranja sobre el elemento, cuando el cursor quedó fuera de su área. Es solo
 * un aviso (el cursor se puede soltar donde sea, y el click le llega igual al elemento); dentro del área no se ve.
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
 * Con Alt apretado mientras se graba: la flecha del cursor falso (lo que se va a reproducir) pegada al
 * puntero, con un anillo punteado, y el cursor real pasa a ser una cruz (con prioridad sobre los
 * cursores propios de cada elemento). Indica que el próximo click se graba como un reposo del cursor, sin click.
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
 * `width` es lo que queda por scrollear de ese lado (hasta FADE_WIDTH). Siempre es opaco en el
 * borde, que es lo que tapa el corte de un nodo a medio ver; al llegar al final mide 0 y desaparece.
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

/** Zona de pasos con scroll horizontal y un degradé en cada lado donde hay más contenido */
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
        // El contenido crece al sumar pasos y el área cambia con la ventana
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
            {/* Sin barra de scroll visible */}
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
                        // Lugar para el halo del paso actual, que si no el scroll lo recortaría
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

/** Aviso de un paso cuyo elemento no se encontró: dice cuál fue y qué selector buscaba */
function ErrorToast({ index, step, onClose }: { index: number; step: Step; onClose: () => void }) {
    return (
        <div
            {...{ [ROOT_ATTR]: "" }}
            role="alert"
            style={{
                position: "fixed",
                left: "50%",
                // Justo arriba de la barra (52 px de alto + 16 de margen + 12 de aire)
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
                <div style={{ fontWeight: 600 }}>No se encontró el elemento del paso {index + 1}</div>
                <div style={{ marginTop: 2, color: "#fca5a5", opacity: 0.85 }}>La página puede haber cambiado desde que lo grabaste.</div>
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
                aria-label="Cerrar aviso"
                title="Cerrar"
                onClick={onClose}
                style={{ flexShrink: 0, width: 20, height: 20, border: 0, borderRadius: "50%", padding: 0, background: "transparent", color: "#fca5a5", font: "600 14px system-ui, sans-serif", lineHeight: 1, cursor: "pointer" }}
            >
                ×
            </button>
        </div>
    )
}

/**
 * Línea entre dos nodos: es la pausa que sigue a la posición `p` (-1 = inicio).
 * Todo el hueco es clickeable, no solo el trazo; todas se ven iguales.
 */
/** Largo de la línea entre dos nodos */
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
            aria-label="Pausa"
            title="Pausa"
            {...{ [GAP_ATTR]: p, [GAP_UI_ATTR]: "" }}
            // Abrir una línea siempre lleva al estado previo al paso que le sigue (con el cursor posado sobre su
            // objetivo, ajustable). Queda seleccionada hasta que se elija otra cosa o se recargue la página
            onClick={() => {
                if (!selected) openLine(p)
            }}
            // Con la barra de esta línea abierta, el siguiente Tab va a su primer botón (la barra está en otro lugar
            // del DOM, así que el orden natural no pasaría por ella)
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
                // El área de click es todo el hueco, no solo la línea
                width: LINE_WIDTH + 16,
                // Cancela el gap de la barra: el hueco neto es el largo de la línea
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
            {/* Riel sólido y redondeado; se aclara con el hover y al abrir su pausa */}
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
                {/* Progreso de la pausa: se llena en el tiempo que dura; las ya cumplidas quedan llenas */}
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
 * Anima el ancho de la barra cuando el contenido cambia (se suma un paso, o aparecen el inicio y el
 * final al terminar de grabar). CSS no puede transicionar un ancho automático, así que se mide el
 * cambio y se anima a mano de un ancho al otro. Un cambio de ventana no se anima.
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
            // Mientras crece, el contenido (ya más ancho) no debe salirse de la barra
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
                // Si el contenido volvió a cambiar mientras animaba, sigue desde donde quedó
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
    // Se monta en document.body y solo en el cliente (Next renderiza en el servidor)
    const [mounted, setMounted] = useState(false)
    // Confirmación abierta: grabar de nuevo (si ya había algo) o borrar el guion
    const [confirm, setConfirm] = useState<"record" | "delete" | null>(null)
    useEffect(() => {
        setMounted(true)
        void resume()
    }, [])

    const bar = useRef<HTMLDivElement>(null)
    useAnimatedWidth(bar, mounted)

    // La barra de pausa se desvanece al cerrarse: se mantiene montada POPOVER_MS más con la última línea
    const openGap = state.gap !== null && state.pending === null && !state.recording ? state.gap : null
    const [lastGap, setLastGap] = useState<number | null>(null)
    useEffect(() => {
        if (openGap !== null) return setLastGap(openGap)
        const timer = setTimeout(() => setLastGap(null), POPOVER_MS)
        return () => clearTimeout(timer)
    }, [openGap])
    const shownGap = openGap ?? lastGap

    // Un modo apuntar que ya no corresponde (se cerró su línea o se cambió de posición) se apaga solo, siempre que no
    // se esté viajando: durante el viaje la línea se vuelve a abrir al llegar
    useEffect(() => {
        if (state.aim === null || state.pending !== null) return
        const valid = state.gap === state.aim - 1 && state.selected === state.aim - 1 && !state.recording
        if (!valid) setState({ aim: null })
    }, [state.aim, state.gap, state.selected, state.pending, state.recording])

    // El paso que corre (o en el que quedaste) se mantiene a la vista; al grabar, el scroll sigue al último paso que se suma
    const lastStep = (state.script?.steps.length ?? 0) - 1
    const focusNode = state.current ?? (state.recording ? (lastStep >= 0 ? lastStep : null) : state.selected)
    useEffect(() => {
        if (!mounted || focusNode === null) return
        document
            .querySelector(`[${NODE_ATTR}="${focusNode}"]`)
            ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
    }, [mounted, focusNode])

    // Mientras se graba se sigue la tecla Alt (Option) y el puntero para mostrar el fantasma de "mover"
    const alt = useSyncExternalStore(subscribeAlt, getAlt, getAlt)
    useEffect(() => {
        if (!state.recording) return
        const key = (e: KeyboardEvent) => {
            // Esc termina la grabación (igual que el botón de detener) y la página no lo recibe: si no, un
            // Esc pensado para parar también cerraría un modal o un menú de la app
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
            // En Windows soltar Alt enfoca el menú del navegador
            e.preventDefault()
        }
        // El navegador no avisa si Alt se soltó fuera de la ventana: se resincroniza con cada movimiento
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
    // Relleno de las líneas: las que quedaron atrás de la posición (o del paso que corre) están cumplidas, la
    // que se está esperando se llena en el tiempo de su pausa, y las de adelante están vacías. Al volver a una
    // posición anterior las de adelante quedan vacías: se vuelven a llenar al reproducir de nuevo desde ahí.
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

    // Modo apuntar: la línea de ese paso está abierta, la posición es el estado anterior a él y no se está corriendo nada
    const aimActive =
        state.aim !== null &&
        state.gap === state.aim - 1 &&
        state.selected === state.aim - 1 &&
        state.pending === null &&
        !state.recording
    // El cursor posado es el del paso que se apunta (antes de hacerlo), no el del paso anterior
    const selectedStep = aimActive
        ? steps[state.aim!]
        : state.selected !== null && state.selected >= 0
          ? steps[state.selected]
          : undefined

    // El último paso, si es un reposo (el que se agrega solo al terminar de grabar o uno que grabó la persona), es el
    // final del guion y se muestra con una bandera
    const isFinalRest = (i: number) => i === steps.length - 1 && steps[i].kind === "rest"

    // Parado en el inicio o en el final (y sin correr nada): el cursor se puede arrastrar a otro lugar
    const parkedKind: ParkKind | null = state.pending !== null || aimActive ? null : state.selected === -1 ? "start" : null

    function toggleRecording() {
        if (state.recording) {
            // Si quedó un scroll a medias, se cierra antes de contar los pasos
            flushRecording()
            // Al terminar se agrega solo un paso final (un reposo del cursor al medio de la pantalla, con bandera)
            appendFinalStep()
            const count = getState().script?.steps.length ?? 0
            // Recién hiciste esos clicks: ya está todo hecho, así que quedás en el último paso
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
        // display: contents: solo marca todo lo del widget, sin afectar el layout
        <div {...{ [UI_ATTR]: "" }} style={{ display: "contents" }}>
            <style>{HOVER_CSS}</style>
            <div ref={bar} {...{ [ROOT_ATTR]: "" }} style={barStyle}>
                <button
                    type="button"
                    // Con un guion ya grabado, grabar de nuevo lo reemplaza: antes se pide confirmación
                    {...{ [CONFIRM_TRIGGER_ATTR]: "record" }}
                    onClick={() => {
                        if (state.recording || steps.length === 0) toggleRecording()
                        else setConfirm((c) => (c === "record" ? null : "record"))
                    }}
                    // Mientras graba, el fondo del botón parpadea
                    {...(state.recording ? { "data-recorder-recording": "" } : {})}
                    title={state.recording ? "Detener grabación" : "Grabar"}
                    aria-label={state.recording ? "Detener grabación" : "Grabar"}
                    style={pill(state.recording ? "#dc2626" : "#3f3f46")}
                >
                    {state.recording ? <StopIcon /> : <RecordIcon />}
                </button>
                {steps.length > 0 && !state.recording && (
                    <button
                        type="button"
                        onClick={state.pending !== null ? stop : play}
                        title={state.pending !== null ? "Detener" : "Reproducir"}
                        aria-label={state.pending !== null ? "Detener" : "Reproducir"}
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
                                title="Inicio"
                                {...{ [NODE_ATTR]: -1 }}
                                aria-label="Inicio"
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
                                        ? `No se encontró el elemento: ${steps[i].selector}`
                                        : isFinalRest(i)
                                          ? "Final: el cursor termina ahí"
                                          : steps[i].kind === "rest"
                                          ? `Cursor en reposo (sin click)${steps[i].selector ? `: ${steps[i].selector}` : ""}`
                                          : steps[i].kind === "scroll"
                                            ? `Scroll: ${steps[i].selector}`
                                            : steps[i].kind === "type"
                                              ? `Escribir "${(steps[i].text ?? "").slice(0, 40)}${(steps[i].text ?? "").length > 40 ? "…" : ""}" en ${steps[i].selector}`
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
                                {/* El paso final que se agrega al terminar de grabar se muestra con una bandera */}
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
                        title="Borrar guion"
                        aria-label="Borrar guion"
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
                    title={confirm === "delete" ? "¿Borrar el guion?" : "¿Grabar de nuevo?"}
                    body={
                        confirm === "delete"
                            ? steps.length === 1
                                ? "Se pierde el paso grabado."
                                : `Se pierden los ${steps.length} pasos grabados.`
                            : `Ya hay un guion con ${steps.length === 1 ? "1 paso" : `${steps.length} pasos`}: grabar lo reemplaza.`
                    }
                    confirmLabel={confirm === "delete" ? "Borrar" : "Grabar"}
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
                        // Cerrar el aviso no borra el error: el paso sigue en rojo hasta la próxima acción
                        onClose={() => setState({ failedNoticeClosed: true })}
                    />
                )}
            {state.pending !== null && (
                // Cubre la página mientras se repiten los pasos: el cursor se ve por debajo
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: TOP - 1,
                        // Al reproducir (velocidad normal) solo bloquea, sin oscurecer
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

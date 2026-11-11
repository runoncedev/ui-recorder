import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { getGapPause, setGapPause } from "@ui-recorder/core"
import { getState, subscribe } from "@ui-recorder/core"
import { ROOT_ATTR } from "@ui-recorder/core"

/** Marca cada línea del timeline para ubicarla y para que sus clicks no cierren la barra */
export const GAP_ATTR = "data-recorder-gap"
export const GAP_UI_ATTR = "data-recorder-gap-ui"
/** Marca la zona de pasos con scroll: si la línea queda fuera de su área visible, la barra se oculta */
export const SCROLL_ATTR = "data-recorder-scroll"

/** Duración de la entrada y de la salida; el padre lo usa para mantenerla montada mientras se desvanece */
export const POPOVER_MS = 200
/**
 * Red de seguridad, no el efecto principal: el que esconde la barra es su animación de salida, que arranca
 * cuando la línea llega a EXIT_DISTANCE_PX del borde del área de scroll. Si en un scroll muy rápido esa
 * animación todavía no terminó y la barra quedó lejos, la máscara la recorta: sus degradés están
 * CLIP_MARGIN_PX por fuera del área, así que con la línea dentro del área no se ven.
 */
const CLIP_MARGIN_PX = 160
const EDGE_FADE_PX = 60
const EXIT_DISTANCE_PX = 45
const WIDTH = 176
const EDGE = 8
const PAUSE_STEP_MS = 250
const MAX_PAUSE_MS = 60_000

/** Máscara: los degradés de los dos bordes (opaco hacia adentro, transparente hacia afuera) */
const EDGE_MASK = `linear-gradient(to right, transparent 0, #000 ${EDGE_FADE_PX}px, #000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%)`
/** Alto de la zona enmascarada: sobra para la barra, su sombra y el movimiento de entrada */
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
 * Barra de la pausa de la línea seleccionada: flota arriba de la barra principal
 * con una flecha que señala la línea. − / + ajustan de a 0,25 s; un click en el
 * valor permite escribirlo.
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

    // Entrada: nace transparente y un poco abajo, y recién dos frames después pasa a su lugar para que la transición corra
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
            // La barra queda recortada al área de scroll (con degradés en los bordes): al acercarse la línea
            // al borde se va desvaneciendo, y fuera del área no se ve (sigue montada, siguiendo a la línea)
            const scroller = line.closest(`[${SCROLL_ATTR}]`)
            const area = scroller?.getBoundingClientRect()
            const areaLeft = area?.left ?? 0
            // Un borde solo cuenta del lado donde todavía hay contenido para scrollear: la línea del inicio (o la última)
            // queda pegada al borde y no se va a ir a ningún lado, así que su barra tiene que verse
            const moreLeft = !!scroller && scroller.scrollLeft > 1
            const moreRight = !!scroller && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
            const distance = area
                ? Math.min(moreLeft ? center - area.left : Infinity, moreRight ? area.right - center : Infinity)
                : Infinity
            // La caja se mantiene dentro de la ventana; la flecha sigue apuntando a la línea
            const left = Math.min(
                Math.max(center - WIDTH / 2, EDGE),
                window.innerWidth - WIDTH - EDGE
            )
            setPos({
                // Relativa al recorte, que empieza CLIP_MARGIN_PX antes del área
                left: left - (areaLeft - CLIP_MARGIN_PX),
                bottom: window.innerHeight - b.top,
                arrow: center - left,
                clipLeft: areaLeft - CLIP_MARGIN_PX,
                clipWidth: (area?.width ?? window.innerWidth) + 2 * CLIP_MARGIN_PX,
                // Con la línea a menos de EXIT_DISTANCE_PX del borde la barra sale (o entra) con su animación
                interactive: distance > EXIT_DISTANCE_PX,
            })
        }
        place()
        window.addEventListener("resize", place)
        // La barra cambia de ancho al sumar pasos, y la línea se corre con ella
        const observer = new ResizeObserver(place)
        const bar = anchor()?.closest(`[${ROOT_ATTR}]`)
        if (bar) observer.observe(bar)
        // Sigue a la línea mientras se scrollea
        const scroller = anchor()?.closest(`[${SCROLL_ATTR}]`)
        scroller?.addEventListener("scroll", place, { passive: true })

        // La línea queda seleccionada hasta que se seleccione otra cosa o se recargue la página: ni Esc ni un click
        // afuera la cierran
        // Mientras la barra está abierta, + y - del teclado cambian el tiempo (= cuenta como + en los teclados donde
        // el + lleva Shift). No cuando se está escribiendo en el valor, ni con Ctrl o Cmd (eso es el zoom del navegador)
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
    /** El botón de la línea que abrió esta barra (para devolverle el foco al navegar con el teclado) */
    const anchor = () => document.querySelector<HTMLElement>(`[${GAP_ATTR}="${gap}"]`)
    // Abierta y con su línea dentro del área de scroll
    const visible = shown && pos.interactive

    const pause = getGapPause(script, gap)
    const set = (ms: number) =>
        setGapPause(gap, Math.min(MAX_PAUSE_MS, Math.max(0, Math.round(ms / 10) * 10)))

    function commit() {
        if (text === null) return
        // Acepta "1,5" y "1.5"
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
                // La máscara no afecta a los clicks: eso lo resuelve pointerEvents de la barra
                pointerEvents: "none",
                maskImage: EDGE_MASK,
                WebkitMaskImage: EDGE_MASK,
            }}
        >
            <div
                {...{ [ROOT_ATTR]: "", [GAP_UI_ATTR]: "" }}
                // Con el teclado la barra se recorre sola: la línea lleva a su primer botón (el de ajustar el cursor), y
                // desde el último se sigue al paso que viene después de la línea; con Shift+Tab se vuelve a la línea
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
                    // Al abrir y cerrar anima opacidad y movimiento; al salir del área de scroll (la línea cerca
                    // del borde) o volver a entrar, solo la opacidad
                    opacity: visible ? 1 : 0,
                    transform: shown ? "translateY(0) scale(1)" : "translateY(12px) scale(0.88)",
                    // Crece desde la flecha, que es lo que apunta a la línea
                    transformOrigin: `${pos.arrow}px 100%`,
                    transition: `opacity ${POPOVER_MS}ms ease-out, transform ${POPOVER_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1.2)`,
                    pointerEvents: visible ? "auto" : "none",
                }}
            >
                {/* La flecha que apunta a la línea */}
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
                        aria-label="Menos pausa"
                        title="Menos pausa"
                        onClick={() => set(pause - PAUSE_STEP_MS)}
                        style={small}
                    >
                        −
                    </button>
                    {text === null ? (
                        <button
                            type="button"
                            title="Click para escribir los segundos"
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
                            aria-label="Segundos de pausa"
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
                        aria-label="Más pausa"
                        title="Más pausa"
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

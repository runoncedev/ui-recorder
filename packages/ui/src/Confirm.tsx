import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ROOT_ATTR } from "@ui-recorder/core"

/** Marca el botón que abre la confirmación: sus propios clicks la abren y la cierran, no cuentan como "fuera" */
export const CONFIRM_TRIGGER_ATTR = "data-recorder-confirm-trigger"
const CONFIRM_ATTR = "data-recorder-confirm"

const WIDTH = 252
const EDGE = 8

const button: React.CSSProperties = {
    border: 0,
    borderRadius: 999,
    padding: "6px 14px",
    color: "#fafafa",
    font: "600 12px system-ui, sans-serif",
    cursor: "pointer",
}

/**
 * Confirmación chica que flota arriba de la barra, con una flecha que señala el botón que la abrió.
 * Se cancela con Esc, con "Cancelar" o con un click fuera; el foco arranca en "Cancelar" para que un
 * Enter distraído no confirme.
 */
export function ConfirmPopover({
    kind,
    title,
    body,
    confirmLabel,
    onConfirm,
    onCancel,
}: {
    kind: string
    title: string
    body: string
    confirmLabel: string
    onConfirm: () => void
    onCancel: () => void
}) {
    const [pos, setPos] = useState<{ left: number; bottom: number; arrow: number } | null>(null)
    const cancelButton = useRef<HTMLButtonElement>(null)
    // Los callbacks cambian en cada render del padre: los listeners usan siempre el último
    const cancel = useRef(onCancel)
    cancel.current = onCancel

    useLayoutEffect(() => {
        const trigger = () => document.querySelector(`[${CONFIRM_TRIGGER_ATTR}="${kind}"]`)
        const place = () => {
            const t = trigger()
            const bar = t?.closest(`[${ROOT_ATTR}]`)
            if (!t || !bar) return setPos(null)
            const tr = t.getBoundingClientRect()
            const b = bar.getBoundingClientRect()
            const center = tr.left + tr.width / 2
            const left = Math.min(
                Math.max(center - WIDTH / 2, EDGE),
                window.innerWidth - WIDTH - EDGE
            )
            setPos({ left, bottom: window.innerHeight - b.top + 12, arrow: center - left })
        }
        place()
        window.addEventListener("resize", place)
        // La barra cambia de ancho (animado) y el botón se corre con ella
        const observer = new ResizeObserver(place)
        const bar = trigger()?.closest(`[${ROOT_ATTR}]`)
        if (bar) observer.observe(bar)

        const onDown = (e: PointerEvent) => {
            if (
                e.target instanceof Element &&
                e.target.closest(`[${CONFIRM_ATTR}], [${CONFIRM_TRIGGER_ATTR}]`)
            ) {
                return
            }
            cancel.current()
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") cancel.current()
        }
        window.addEventListener("pointerdown", onDown, true)
        window.addEventListener("keydown", onKey)
        return () => {
            window.removeEventListener("resize", place)
            window.removeEventListener("pointerdown", onDown, true)
            window.removeEventListener("keydown", onKey)
            observer.disconnect()
        }
    }, [kind])

    const placed = pos !== null
    useEffect(() => {
        if (placed) cancelButton.current?.focus({ preventScroll: true })
    }, [placed])

    if (!pos) return null

    return (
        <div
            {...{ [ROOT_ATTR]: "", [CONFIRM_ATTR]: "" }}
            role="alertdialog"
            aria-label={title}
            style={{
                position: "fixed",
                zIndex: 2147483647,
                left: pos.left,
                bottom: pos.bottom,
                width: WIDTH,
                boxSizing: "border-box",
                padding: "12px 14px",
                borderRadius: 16,
                background: "#18181b",
                color: "#fafafa",
                font: "13px system-ui, sans-serif",
                boxShadow: "0 8px 30px rgba(0,0,0,.3)",
                animation: "recorder-pop-in 150ms ease-out both",
            }}
        >
            <div style={{ fontWeight: 600 }}>{title}</div>
            <div style={{ marginTop: 2, color: "#a1a1aa" }}>{body}</div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                    ref={cancelButton}
                    type="button"
                    onClick={onCancel}
                    style={{ ...button, background: "#3f3f46" }}
                >
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    style={{ ...button, background: "#dc2626" }}
                >
                    {confirmLabel}
                </button>
            </div>
            <div
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
        </div>
    )
}

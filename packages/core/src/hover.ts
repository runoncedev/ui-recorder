import { UI_ATTR } from "./types"

// Hover con JS: el navegador no activa `:hover` con eventos sintéticos, pero los listeners de la página
// (`onMouseEnter` de React, tooltips, menús) sí reaccionan a ellos. Al llegar el cursor a un punto se avisa
// a la página de que el mouse salió del elemento anterior y entró al nuevo.

let hovered: Element | null = null

/** El elemento de la página bajo el punto, sin contar lo que dibuja el propio widget */
function pageElementAt(x: number, y: number): Element | null {
    return document.elementsFromPoint(x, y).find((el) => !el.closest(`[${UI_ATTR}]`)) ?? null
}

/** Elementos desde `el` hacia arriba hasta la raíz */
function chain(el: Element | null): Element[] {
    const out: Element[] = []
    for (let node = el; node; node = node.parentElement) out.push(node)
    return out
}

function fire(el: Element, type: string, related: Element | null, x: number, y: number, bubbles: boolean) {
    const init = { bubbles, cancelable: bubbles, composed: true, view: window, clientX: x, clientY: y, relatedTarget: related }
    if (type.startsWith("pointer")) {
        el.dispatchEvent(new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true }))
    } else {
        el.dispatchEvent(new MouseEvent(type, init))
    }
}

/** Avisa a la página de que el mouse está ahora en (x, y): sale del elemento anterior y entra al de ese punto */
export function hoverAt(x: number, y: number) {
    const next = pageElementAt(x, y)
    const prev = hovered
    hovered = next
    if (next === prev) return
    const nextChain = chain(next)
    const prevChain = chain(prev)
    // `enter` y `leave` no burbujean: van a cada ancestro que se deja o se pisa, no a los que quedan en común
    const left = prevChain.filter((el) => !nextChain.includes(el))
    const entered = nextChain.filter((el) => !prevChain.includes(el))

    if (prev) {
        fire(prev, "pointerout", next, x, y, true)
        fire(prev, "mouseout", next, x, y, true)
        for (const el of left) {
            fire(el, "pointerleave", next, x, y, false)
            fire(el, "mouseleave", next, x, y, false)
        }
    }
    if (next) {
        fire(next, "pointerover", prev, x, y, true)
        fire(next, "mouseover", prev, x, y, true)
        // de afuera hacia adentro, como el navegador
        for (const el of entered.reverse()) {
            fire(el, "pointerenter", prev, x, y, false)
            fire(el, "mouseenter", prev, x, y, false)
        }
        fire(next, "pointermove", null, x, y, true)
        fire(next, "mousemove", null, x, y, true)
    }
}

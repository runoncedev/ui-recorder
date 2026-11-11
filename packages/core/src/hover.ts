import { UI_ATTR } from "./types"

// JS hover: the browser does not trigger `:hover` with synthetic events, but the page's listeners
// (React's `onMouseEnter`, tooltips, menus) do react to them. When the cursor reaches a point, the page is
// told that the mouse left the previous element and entered the new one.

let hovered: Element | null = null

/** The page element under the point, not counting what the widget itself draws */
function pageElementAt(x: number, y: number): Element | null {
    return document.elementsFromPoint(x, y).find((el) => !el.closest(`[${UI_ATTR}]`)) ?? null
}

/** Elements from `el` up to the root */
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

/** Tells the page the mouse is now at (x, y): it leaves the previous element and enters the one at that point */
export function hoverAt(x: number, y: number) {
    const next = pageElementAt(x, y)
    const prev = hovered
    hovered = next
    if (next === prev) return
    const nextChain = chain(next)
    const prevChain = chain(prev)
    // `enter` and `leave` do not bubble: they go to each ancestor that is left or entered, not to the ones in common
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
        // from the outside in, like the browser
        for (const el of entered.reverse()) {
            fire(el, "pointerenter", prev, x, y, false)
            fire(el, "mouseenter", prev, x, y, false)
        }
        fire(next, "pointermove", null, x, y, true)
        fire(next, "mousemove", null, x, y, true)
    }
}

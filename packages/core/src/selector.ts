import { UI_ATTR } from "./types"

// Selector de un elemento: lo más estable posible (atributos pensados para eso,
// id que no parezca generado) y, si no, un camino corto de tags con :nth-of-type.
// Siempre se verifica que apunte a un solo elemento.

const STABLE_ATTRS = ["data-testid", "data-demo", "aria-label", "name", "placeholder"]

const INTERACTIVE =
    "button, a, input, select, textarea, label, summary, [role=button], [role=option], [role=menuitem], [role=tab], [role=combobox], [data-testid]"

/**
 * Elementos de la página que coinciden con el selector, sin contar los del propio widget: un camino
 * genérico (`div > button:nth-of-type(2)`) puede coincidir con sus botones, y el cursor del paso
 * terminaría parado sobre el timeline.
 */
export function queryAll(selector: string): Element[] {
    try {
        return Array.from(document.querySelectorAll(selector)).filter(
            (el) => !el.closest(`[${UI_ATTR}]`)
        )
    } catch {
        return []
    }
}

function isUnique(selector: string) {
    return queryAll(selector).length === 1
}

/** Un click en un ícono o texto interno cuenta como click en el botón que lo contiene */
export function targetElement(raw: EventTarget | null): Element | null {
    if (!(raw instanceof Element)) return null
    return raw.closest(INTERACTIVE) ?? raw
}

function stableSelector(el: Element): string | null {
    const tag = el.tagName.toLowerCase()
    for (const attr of STABLE_ATTRS) {
        const value = el.getAttribute(attr)
        if (!value) continue
        const selector = `${tag}[${attr}=${JSON.stringify(value)}]`
        if (isUnique(selector)) return selector
    }
    // Los ids que genera React (":r1:") o las librerías (base-ui-...) cambian entre cargas
    const id = el.id
    if (
        id &&
        /^[a-zA-Z][\w-]*$/.test(id) &&
        !/\d{3,}/.test(id) &&
        !id.startsWith("base-ui")
    ) {
        const selector = `#${CSS.escape(id)}`
        if (isUnique(selector)) return selector
    }
    return null
}

function segment(el: Element): string {
    const tag = el.tagName.toLowerCase()
    const parent = el.parentElement
    if (!parent) return tag
    const sameTag = Array.from(parent.children).filter(
        (child) => child.tagName === el.tagName
    )
    if (sameTag.length === 1) return tag
    return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`
}

export function getSelector(el: Element): string {
    if (el === document.documentElement) return "html"
    const own = stableSelector(el)
    if (own) return own

    const parts: string[] = []
    for (
        let node: Element | null = el;
        node && node !== document.documentElement;
        node = node.parentElement
    ) {
        const anchor = node === el ? null : stableSelector(node)
        parts.unshift(anchor ?? segment(node))
        if (anchor || isUnique(parts.join(" > "))) break
    }
    return parts.join(" > ")
}

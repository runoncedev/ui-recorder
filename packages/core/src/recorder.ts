import { getState, setState } from "./store"
import { getSelector, targetElement } from "./selector"
import { ROOT_ATTR, type Step } from "./types"

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** Eventos de mouse que la página no debe ver cuando el click es un "mover" (Alt + click) */
const BLOCKED = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick"]

const inWidget = (event: Event) =>
    event.composedPath().some((node) => node instanceof Element && node.hasAttribute(ROOT_ATTR))

/**
 * El paso de reposo que graba un Alt + click en (x, y): el cursor llega ahí y se queda, sin acción. Un reposo no actúa sobre
 * ningún elemento, así que siempre apunta al `html`, medido contra la ventana visible: el offset es la fracción de la ventana.
 */
function restStepAt(x: number, y: number): Step {
    return {
        kind: "rest",
        selector: "html",
        offset: { x: x / (window.innerWidth || 1), y: y / (window.innerHeight || 1) },
    }
}

/**
 * Al terminar de grabar se agrega solo un último paso (salvo que el último que grabó la persona ya sea un reposo): como si la persona hubiera hecho Alt + click en el medio de
 * la pantalla (un reposo del cursor, sin click). Es un paso más (se ajusta como cualquier otro); el último paso del guion, si es
 * un reposo (este o uno que grabó la persona), se muestra con una bandera;
 * el guion termina ahí, sin una espera final.
 */
export function appendFinalStep() {
    const { script } = getState()
    if (!script || script.steps.length === 0) return
    // Si la persona ya terminó con un reposo del cursor (un Alt + click), ese es el final que quiso: no se agrega otro
    if (script.steps[script.steps.length - 1].kind === "rest") return
    const x = window.innerWidth / 2
    const y = window.innerHeight / 2
    setState({ script: { ...script, steps: [...script.steps, restStepAt(x, y)] } })
}

/** Cuánto tiempo después de una rueda, un touch o una tecla de scroll se considera que un scroll lo hizo la persona */
const USER_SCROLL_MS = 700
/** Un scroll se cierra (y pasa a ser un paso) cuando pasan tantos ms sin que siga scrolleando */
const SCROLL_SETTLE_MS = 250
const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

/** El elemento que scrollea la página entera (`html`, o `body` en modo quirks) */
export const pageScroller = () => document.scrollingElement ?? document.documentElement

/** La parte visible de un elemento que scrollea: toda la ventana si es la página, o su caja recortada a la ventana */
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

/** Los campos donde se graba el tipeo. Las contraseñas no: el guion queda en localStorage y se puede exportar */
const TYPABLE_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "number"])

export function isTypable(t: EventTarget | null): t is HTMLElement {
    if (t instanceof HTMLTextAreaElement) return true
    if (t instanceof HTMLInputElement) return TYPABLE_INPUT_TYPES.has(t.type)
    return t instanceof HTMLElement && t.isContentEditable
}

/** El valor actual de un campo de texto (o de un elemento editable) */
export function readValue(el: HTMLElement) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "")
}

/** Cuánto se scrolleó, como fracción del recorrido posible (un eje sin recorrido cuenta como 0) */
function scrollFraction(position: number, range: number) {
    return range > 0 ? clamp(position / range) : 0
}

// Para cerrar el scroll pendiente antes de que el estado cambie por otra razón (por ejemplo, al parar de grabar)
let flushPending: (() => void) | null = null

/** Cierra el scroll que haya quedado a medias y lo deja grabado como un paso */
export function flushRecording() {
    flushPending?.()
}

/**
 * Escucha los clicks reales del usuario (en captura, antes de que la app los
 * procese, para leer el DOM tal como estaba). Ignora los del propio widget y
 * los sintéticos, así que reproducir un guion no lo regraba.
 *
 * Con Alt (Option) apretado, el click se graba como un paso `rest`: el cursor se queda ahí, sin acción. Se corta
 * en captura (todos los eventos del gesto, no solo el click) para que la página no se entere: no
 * abre nada, no descarga el link, no cambia el foco.
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
    // Un evento de scroll no dice quién lo provocó (también lo disparan la app y el propio navegador), así
    // que solo se graban los que vienen justo después de un gesto de la persona.
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
    // Arrastrar la barra de scroll: el click cae sobre el borde del elemento, fuera de su contenido
    const onPointerDown = (e: PointerEvent) => {
        const t = e.target
        // Apretar algo del widget (por ejemplo "detener") le saca el foco al campo en el que se escribía, pero
        // eso no debe cerrar la escritura ahí: sumar un paso agranda la barra y mueve el botón entre apretar y
        // soltar, y el click se perdería. Lo cierra el propio botón al hacer click.
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
        // El blur llega entre apretar y soltar; se baja la marca recién después
        setTimeout(() => {
            pressingWidget = false
        }, 0)
    }

    // Dónde está el mouse (la rueda y los movimientos traen su posición): se guarda con cada scroll
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
        // El mouse como fracción de la parte visible del área; si estaba fuera de ella (scroll con el teclado)
        // no se guarda y al reproducir el cursor va al centro
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
        // Si pasó a scrollear otra cosa, lo anterior queda cerrado en su lugar
        if (pending && pending !== el) flush()
        pending = el
        pendingPointer = lastPointer
        clearTimeout(settleTimer)
        settleTimer = window.setTimeout(flush, SCROLL_SETTLE_MS)
    }

    // --- Tipeo -------------------------------------------------------------------------------
    // Escribir en un campo es un solo paso (no uno por tecla): se cierra al salir del campo, al hacer otro
    // click, al scrollear o al parar de grabar, y guarda cómo quedó el texto.
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
        // Si había un scroll a medias, queda antes que el tipeo; si se pasó a otro campo, el anterior se cierra
        flush()
        if (typing && typing !== t) flushTyping()
        typing = t
    }
    const onFocusOut = (e: FocusEvent) => {
        if (pressingWidget) return
        if (typing && e.target === typing) flushTyping()
    }

    // Un click con un scroll a medias: primero se cierra el scroll, así los pasos quedan en el orden en que pasaron
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

import { getCursorTip, getLastCursor, MOVE_MS, moveCursor, pressCursor } from "./cursor"
import { hoverAt } from "./hover"
import { DEFAULT_STEP_PAUSE_MS, parkPoint, patchStep } from "./edit"
import { pageScroller, readValue, visibleBox } from "./recorder"
import { queryAll } from "./selector"
import { getState, setState } from "./store"
import type { Script, Step } from "./types"

/** Al viajar a un paso todo corre como en cámara rápida: el cursor y los clicks se ven, pero más veloces */
const TRAVEL_SPEED = 3
const FIND_TIMEOUT_MS = 5000
/** Pausa corta entre pasos al viajar en cámara rápida (antes de dividirla por la velocidad): no sigue a la pausa por defecto de la reproducción */
const TRAVEL_STEP_GAP_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const nextFrames = (n: number) =>
    new Promise<void>((resolve) => {
        const tick = (left: number) =>
            left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))
        tick(n)
    })

/** Espera a que el elemento deje de moverse (misma posición en dos frames seguidos): un drawer que todavía se desliza no es un buen blanco */
async function waitStable(el: Element) {
    let last = ""
    let same = 0
    for (let i = 0; i < 40 && same < 2; i++) {
        await nextFrames(1)
        const r = el.getBoundingClientRect()
        const key = `${r.left},${r.top},${r.width},${r.height}`
        same = key === last ? same + 1 : 0
        last = key
    }
}

export function findElement(selector: string): Element | null {
    return queryAll(selector)[0] ?? null
}

/** Espera a que el elemento exista (no a que se vea): la app puede estar todavía renderizando */
export function waitFor(selector: string): Promise<Element | null> {
    return new Promise((resolve) => {
        const found = findElement(selector)
        if (found) return resolve(found)
        const observer = new MutationObserver(() => {
            const el = findElement(selector)
            if (!el) return
            cleanup()
            resolve(el)
        })
        const timer = setTimeout(() => {
            cleanup()
            resolve(null)
        }, FIND_TIMEOUT_MS)
        function cleanup() {
            observer.disconnect()
            clearTimeout(timer)
        }
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
        })
    })
}

/** Click sintético con la secuencia completa de eventos (muchos componentes escuchan pointerdown) */
export function clickAt(el: Element, offset: Step["offset"]) {
    const rect = el.getBoundingClientRect()
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        // El cursor que se ve puede estar fuera del elemento (se ajusta libremente), pero lo que recibe la página
        // es siempre un click dentro de él
        clientX: Math.min(rect.right, Math.max(rect.left, rect.left + rect.width * offset.x)),
        clientY: Math.min(rect.bottom, Math.max(rect.top, rect.top + rect.height * offset.y)),
    }
    const pointer = { ...init, pointerType: "mouse", isPrimary: true }
    el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }))
    el.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }))
    if (el instanceof HTMLElement) el.focus({ preventScroll: true })
    el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }))
    el.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }))
    el.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }))
}

/** Punto de la pantalla (viewport) al que apunta un paso sobre su elemento */
export function pointOf(el: Element, offset: Step["offset"]) {
    // El `html` se mide contra la ventana visible, no contra su rectángulo (que es todo el alto de la página)
    if (el === document.documentElement) {
        const b = visibleBox(pageScroller())
        return { x: b.left + (b.right - b.left) * offset.x, y: b.top + (b.bottom - b.top) * offset.y }
    }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width * offset.x, y: rect.top + rect.height * offset.y }
}

/** El elemento que scrollea un paso `scroll`: la página entera (`html`) o un contenedor */
export function scrollTarget(step: Step): Element | null {
    return step.selector === "html" ? pageScroller() : findElement(step.selector)
}

/**
 * Dónde queda el cursor en un paso: sobre el punto del click o del reposo, o donde estaba el mouse dentro de la
 * parte visible del área que se scrolleó (el centro si no se guardó).
 */
export function cursorPoint(step: Step, el: Element) {
    if (step.kind !== "scroll") return pointOf(el, step.offset)
    const b = visibleBox(el)
    // Donde estaba el mouse al grabar, dentro del área; sin dato, el centro
    const at = step.at ?? { x: 0.5, y: 0.5 }
    return { x: b.left + (b.right - b.left) * at.x, y: b.top + (b.bottom - b.top) * at.y }
}

const TYPE_CHAR_MS = 55

/** Escribe el valor como lo haría el navegador: con el setter nativo, para que React y otros frameworks se enteren */
function writeValue(el: HTMLElement, value: string) {
    if (el instanceof HTMLInputElement) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value)
    } else if (el instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value)
    } else {
        el.textContent = value
    }
}

function fireInput(el: HTMLElement, data: string | null, inputType: string) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false, data, inputType }))
}

/**
 * Escribe el texto en el campo: lo enfoca y lo tipea letra por letra (de golpe en cámara rápida). Si el
 * campo ya empieza con una parte del texto, solo tipea lo que falta; si no, lo vacía primero.
 */
async function typeInto(el: HTMLElement, text: string, speed: number, signal: AbortSignal) {
    el.focus({ preventScroll: true })
    const current = readValue(el)
    let value = text.startsWith(current) ? current : ""
    if (value !== current) {
        writeValue(el, "")
        fireInput(el, null, "deleteContentBackward")
    }
    const rest = text.slice(value.length)
    if (speed > 1) {
        if (rest) {
            writeValue(el, text)
            fireInput(el, rest, "insertText")
        }
    } else {
        for (const char of rest) {
            if (signal.aborted) return
            el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }))
            value += char
            writeValue(el, value)
            fireInput(el, char, "insertText")
            el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }))
            await sleep(TYPE_CHAR_MS)
        }
    }
    // Lo que el navegador dispara al terminar de editar un campo
    el.dispatchEvent(new Event("change", { bubbles: true }))
}

/**
 * Lo que hay que guardar en un paso cuando el cursor se suelta en (x, y) de la pantalla: el punto relativo a su
 * objetivo. Sin límite: puede quedar fuera del elemento (fracciones menores que 0 o mayores que 1).
 */
export function aimPatch(step: Step, x: number, y: number): Partial<Step> | null {
    // Un paso viejo sin selector es un punto libre de la ventana
    if (step.selector === "") return { offset: { x: x / window.innerWidth, y: y / window.innerHeight } }
    const el = step.kind === "scroll" ? scrollTarget(step) : findElement(step.selector)
    if (!el) return null
    if (step.kind === "scroll") {
        const b = visibleBox(el)
        return { at: { x: (x - b.left) / (b.right - b.left || 1), y: (y - b.top) / (b.bottom - b.top || 1) } }
    }
    const r = el === document.documentElement ? visibleBox(pageScroller()) : el.getBoundingClientRect()
    const w = "width" in r ? r.width : r.right - r.left
    const h = "height" in r ? r.height : r.bottom - r.top
    return { offset: { x: (x - r.left) / (w || 1), y: (y - r.top) / (h || 1) } }
}

/** Guarda el punto donde se soltó el cursor en el modo apuntar */
export function aimDrop(stepIndex: number, x: number, y: number) {
    const step = getState().script?.steps[stepIndex]
    if (!step) return
    const patch = aimPatch(step, x, y)
    if (patch) patchStep(stepIndex, patch)
}

/**
 * Scrollea el elemento hasta la posición grabada (fracción del recorrido). A velocidad normal es suave y
 * espera a que termine; en cámara rápida salta directo.
 */
async function scrollToStep(el: Element, offset: Step["offset"], speed: number, signal: AbortSignal) {
    const left = offset.x * Math.max(0, el.scrollWidth - el.clientWidth)
    const top = offset.y * Math.max(0, el.scrollHeight - el.clientHeight)
    if (speed > 1) {
        el.scrollTo({ left, top, behavior: "instant" })
        await sleep(40)
        return
    }
    el.scrollTo({ left, top, behavior: "smooth" })
    // Un scroll suave no avisa cuándo termina de forma confiable: se espera a que la posición deje de cambiar
    let last = ""
    let still = 0
    for (let frame = 0; frame < 120 && still < 6 && !signal.aborted; frame++) {
        await nextFrames(1)
        const now = `${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`
        still = now === last ? still + 1 : 0
        last = now
    }
}

/** Lleva el cursor al elemento (trayecto animado) y espera a que llegue */
async function glideTo(el: Element, offset: Step["offset"], speed: number) {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
    const { x, y } = pointOf(el, offset)
    // Si el cursor ya está ahí (por ejemplo tras ajustarlo en el modo apuntar) no hay nada que recorrer ni esperar
    const tip = getCursorTip()
    if (tip && Math.hypot(tip.x - x, tip.y - y) < 1.5) return hoverAt(x, y)
    const ms = MOVE_MS / speed
    moveCursor(x, y, ms)
    await sleep(ms)
    hoverAt(x, y)
}

/** Lleva el cursor a un punto libre de la ventana (un paso `rest` sobre una zona sin elementos) */
async function glidePoint(point: { x: number; y: number }, speed: number) {
    const ms = MOVE_MS / speed
    moveCursor(point.x, point.y, ms)
    await sleep(ms)
    hoverAt(point.x, point.y)
}

/** El punto de la pantalla de un paso sin selector: su offset es una fracción de la ventana */
export function freePoint(step: Step) {
    return { x: step.offset.x * window.innerWidth, y: step.offset.y * window.innerHeight }
}

let waitId = 0

/**
 * Cumple una pausa mostrando su progreso: la línea `gap` se llena durante `ms`. Solo se usa a velocidad normal
 * (en cámara rápida no hay pausas que mostrar).
 */
async function wait(gap: number, ms: number) {
    const id = ++waitId
    setState({ waiting: { gap, ms, id } })
    await sleep(ms)
    // Si mientras tanto se detuvo y arrancó otra corrida, esa pausa nueva no se toca
    if (getState().waiting?.id === id) setState({ waiting: null })
}

/** Ejecuta los pasos desde `from` hasta `count` (sin incluirlo). Devuelve el índice del que falló, o null si todos salieron bien */
async function runSteps(
    steps: Step[],
    from: number,
    count: number,
    signal: AbortSignal,
    speed: number,
    startPause: number,
    onDone: (index: number) => void = () => {},
    lead?: { index: number; ms: number }
): Promise<number | null | "aborted"> {
    // Al reproducir desde un paso, primero se cumple su pausa: es la línea que se va a cruzar y ese paso ya
    // se había ejecutado, así que su espera no ocurrió en esta corrida
    if (lead && lead.ms > 0) {
        setState({ current: lead.index })
        await wait(lead.index, lead.ms)
        if (signal.aborted) return "aborted"
    }
    for (let i = from; i < count; i++) {
        // La página recién cargada se queda un rato antes del primer click (solo a velocidad normal)
        if (i === 0 && speed === 1 && startPause > 0) {
            await wait(-1, startPause)
            if (signal.aborted) return "aborted"
        }
        setState({ current: i })
        const step = steps[i]
        if (step.selector === "") {
            // Movimiento a un punto libre: no hay elemento que buscar ni click que hacer
            await glidePoint(freePoint(step), speed)
            if (signal.aborted) return "aborted"
        } else if (step.kind === "type") {
            const el = await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!(el instanceof HTMLElement)) {
                console.warn(`[recorder] Paso ${i + 1}: no se encontró el campo ${step.selector}`)
                return i
            }
            await waitStable(el)
            el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
            // El click anterior ya dejó el cursor sobre el campo: solo se mueve si no está ahí
            const last = getLastCursor()
            const box = el.getBoundingClientRect()
            const onField = !!last && last.x >= box.left && last.x <= box.right && last.y >= box.top && last.y <= box.bottom
            if (!onField) await glidePoint(cursorPoint(step, el), speed)
            if (signal.aborted) return "aborted"
            await typeInto(el, step.text ?? "", speed, signal)
            if (signal.aborted) return "aborted"
        } else if (step.kind === "scroll") {
            const el = step.selector === "html" ? pageScroller() : await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!el) {
                console.warn(`[recorder] Paso ${i + 1}: no se encontró el elemento ${step.selector}`)
                return i
            }
            // La mano va al área que se scrollea (que quede a la vista) y desde ahí se scrollea
            if (el !== pageScroller()) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
            await glidePoint(cursorPoint(step, el), speed)
            if (signal.aborted) return "aborted"
            await scrollToStep(el, step.offset, speed, signal)
            if (signal.aborted) return "aborted"
        } else {
            const el = await waitFor(step.selector)
            if (signal.aborted) return "aborted"
            if (!el) {
                console.warn(`[recorder] Paso ${i + 1}: no se encontró el elemento ${step.selector}`)
                return i
            }
            await waitStable(el)
            await glideTo(el, step.offset, speed)
            if (signal.aborted) return "aborted"
            // Un paso `rest` solo lleva el cursor y lo deja ahí: sin hundido, sin anillo y sin click
            if (step.kind !== "rest") {
                const { x, y } = pointOf(el, step.offset)
                pressCursor(x, y, speed)
                clickAt(el, step.offset)
            }
        }
        onDone(i)
        // La pausa que puso la persona es de presentación: solo vale a velocidad normal.
        // En cámara rápida (viajar a un paso) se salta y queda la pausa corta acelerada.
        // Tras el último paso no hay pausa: se hace la acción y termina el guion
        if (i === steps.length - 1) break
        if (speed > 1) await sleep(TRAVEL_STEP_GAP_MS / speed)
        else await wait(i, steps[i].pauseAfter ?? DEFAULT_STEP_PAUSE_MS)
    }
    return null
}

let resuming = false
let abort: AbortController | null = null
/** Primer paso que todavía no se ejecutó en la corrida en curso (para saber dónde quedó al detener) */
let nextStep = 0

/**
 * Ejecuta los pasos [from, to] (ambos incluidos) sobre la página tal como está.
 * Se asume que el estado actual de la app es el correcto para `from - 1`: no se
 * recarga ni se repite nada anterior. Al terminar, el cursor queda donde hizo el
 * último click: la posición es "después del paso `to`".
 * `to = -1` es el estado inicial (nada que ejecutar) y `to = cantidad de pasos`
 * es el nodo final. En esos dos el cursor se va a su lugar de la pantalla: el centro, o donde lo dejó la persona.
 */
async function advance(
    script: Script,
    from: number,
    to: number,
    speed: number,
    lead?: { index: number; ms: number },
    dim: boolean = speed > 1,
    // Viene de una página recién recargada (un viaje con recarga): el cursor todavía no está en ningún lado
    fresh = false
) {
    resuming = true
    abort = new AbortController()
    const { signal } = abort
    nextStep = from
    // Desde la página recién recargada el cursor parte de su lugar del inicio y de ahí viaja al paso 1. En el sitio (sin
    // recarga) el cursor ya está donde está (parado en el inicio, o posado sobre el objetivo del paso): no se lo mueve
    if (from === 0 && fresh) {
        const start = parkPoint(script, "start")
        moveCursor(start.x, start.y, 0)
    }
    setState({ pending: to, speed, dim, gap: null, recording: false, selected: null, current: null, waiting: null, failed: null })

    // `to = -1` es el inicio (nada que ejecutar): el cursor se va a su lugar (el centro, o donde lo dejó la persona)
    const failed = await runSteps(
        script.steps,
        from,
        to + 1,
        signal,
        speed,
        script.startPause ?? 0,
        (i) => {
            nextStep = i + 1
        },
        lead
    )
    if (failed === "aborted") {
        resuming = false
        setScrollRestoration("auto")
        return
    }
    if (failed === null && to < 0) {
        const ms = MOVE_MS / speed
        const park = parkPoint(script, "start")
        moveCursor(park.x, park.y, ms)
        await sleep(ms)
    }
    setScrollRestoration("auto")
    resuming = false
    if (signal.aborted) return
    // Si un paso falló, la posición es la anterior a ese paso
    setState({
        pending: null,
        current: null,
        waiting: null,
        failed,
        // Si el viaje era para abrir una línea, se vuelve a abrir al llegar (con el modo apuntar activo)
        gap: getState().reopenGap !== null && failed === null ? getState().reopenGap : null,
        reopenGap: null,
        // Un fallo nuevo vuelve a mostrar su aviso
        failedNoticeClosed: false,
        selected: failed === null ? to : failed - 1,
    })
}

/**
 * Ir a "después del paso `index`" (-1 = el inicio, sin ningún click). Hacia
 * adelante desde la posición actual se ejecutan solo los pasos que faltan, sobre
 * la página como está. Hacia atrás, o sin posición, se carga startUrl desde cero
 * y, cuando el widget vuelve a montarse, resume() ejecuta todos los anteriores.
 */
export function travelTo(index: number) {
    setState({ aim: null, reopenGap: null })
    travel(index)
}

function travel(index: number) {
    const { script, selected } = getState()
    if (!script || resuming) return
    // Tras un fallo la posición es el paso anterior al que falló: la página está en ese estado, así que
    // también se puede avanzar (reintentar) desde ahí sin recargar
    if (selected !== null && index >= selected) {
        // Un único paso en el sitio es instantáneo: no se oscurece la página, que se vería como un parpadeo
        if (index > selected) void advance(script, selected + 1, index, TRAVEL_SPEED, undefined, index !== selected + 1)
        return
    }
    reloadAndRun(script, index, TRAVEL_SPEED)
}

/** Al recargar, el navegador devuelve la página al scroll que tenía: para partir de una página limpia se apaga mientras dura el viaje */
function setScrollRestoration(mode: "auto" | "manual") {
    try {
        history.scrollRestoration = mode
    } catch {
        // algunos entornos no lo permiten
    }
}

function reloadAndRun(script: Script, index: number, speed: number) {
    setScrollRestoration("manual")
    setState({ pending: index, speed, dim: speed > 1, gap: null, recording: false, selected: null, current: null, waiting: null, failed: null })
    if (location.href === script.startUrl) location.reload()
    else location.assign(script.startUrl)
}

/**
 * Abre la línea `p`: lleva al estado que ella representa, el anterior al paso que le sigue, y deja el cursor
 * posado sobre su objetivo (modo apuntar). En el sitio si ya estás ahí o antes; si no, recarga y reconstruye en
 * cámara rápida. La línea y el modo se guardan en el estado antes de viajar, para que sobrevivan a la recarga.
 */
export function openLine(p: number) {
    const { script, selected } = getState()
    if (!script || resuming) return
    // Toda línea tiene un paso a su derecha: el guion termina en el último paso, sin una línea después
    setState({ gap: p, aim: p + 1, reopenGap: p })
    // Los pasos de reposo no cambian la app (solo mueven el cursor): si lo que separa la posición actual de la línea son
    // solo reposos, la página ya está en el estado de la línea y alcanza con seleccionarla, sin reconstruir nada
    const onlyRests = selected !== null && selected > p && script.steps.slice(p + 1, selected + 1).every((step) => step.kind === "rest")
    if (onlyRests) setState({ selected: p, reopenGap: null })
    else if (selected !== p) travel(p)
    else setState({ reopenGap: null })
}

/**
 * Corta el viaje o la reproducción en curso. La página queda como estaba y la
 * posición es el último paso que llegó a ejecutarse, para poder continuar desde ahí.
 */
export function stop() {
    abort?.abort()
    const { script } = getState()
    setState({
        pending: null,
        selected: script ? nextStep - 1 : null,
        current: null,
        waiting: null,
        aim: null,
        reopenGap: null,
        failed: null,
    })
    resuming = false
}

/** Se llama al montar el widget: si había un viaje en curso, lo termina */
export async function resume() {
    const { script, pending, speed } = getState()
    if (!script || pending === null || resuming) return
    await advance(script, 0, pending, speed, undefined, getState().dim, true)
}

/**
 * Reproducir: sigue desde la posición actual hasta el final; si no hay posición
 * o ya estás en el final, arranca desde cero. Tras un fallo la posición es el paso anterior
 * al que falló, así que reintenta ese paso desde ahí. Desde un paso espera primero su pausa.
 */
export function play() {
    const { script, selected, failed, aim } = getState()
    if (!script || resuming) return
    // En el modo apuntar el cursor ya está posado sobre el objetivo del paso que sigue: Play hace esa acción de una,
    // sin cumplir antes la pausa de la línea (ya "cruzaste" esa línea para llegar ahí)
    const aimed = aim !== null && selected !== null && aim === selected + 1
    setState({ aim: null, reopenGap: null })
    // Parado en el último paso (o sin posición) no queda nada por continuar: arranca de cero
    const last = script.steps.length - 1
    // Tampoco si lo que falta son solo reposos: el cursor se movería y nada más, que no sirve de reproducción
    const onlyRestsLeft = selected !== null && selected >= 0 && script.steps.slice(selected + 1).every((step) => step.kind === "rest")
    if (selected === null || selected >= last || onlyRestsLeft) {
        reloadAndRun(script, last, 1)
    } else {
        // Parado en un paso, Play cumple primero la pausa de la línea que va a cruzar (la del inicio ya la
        // cumple el primer paso). Al reintentar tras un fallo no se repite: se quiere volver a probar enseguida.
        const lead =
            selected >= 0 && failed === null && !aimed
                ? { index: selected, ms: script.steps[selected].pauseAfter ?? DEFAULT_STEP_PAUSE_MS }
                : undefined
        void advance(script, selected + 1, last, 1, lead)
    }
}

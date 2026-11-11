/** Un click grabado: qué elemento y en qué punto de él (0..1), nunca coordenadas de página */
export type Step = {
    /**
     * Vacío = un punto libre de la ventana (un paso de reposo sobre una zona sin elementos): `offset` es entonces
     * una fracción de la ventana y no del elemento.
     */
    selector: string
    /**
     * `rest`: el cursor llega y se queda ahí, sin hacer nada más (se graba con Alt + click). Todos los pasos mueven
     * el cursor hasta su objetivo; este es el que no hace otra cosa. `scroll` scrollea el
     * elemento del selector (`html` es la página) hasta `offset`. `type` escribe `text` en el campo. Sin valor: click
     */
    kind?: "click" | "rest" | "scroll" | "type"
    /**
     * Click y move: el punto dentro del elemento (0..1). Scroll: hasta dónde se scrolleó, como fracción del
     * recorrido posible en cada eje (0 = arriba o a la izquierda, 1 = el final)
     */
    offset: { x: number; y: number }
    /**
     * Solo scroll: dónde estaba el mouse mientras se scrolleaba, como fracción de la parte visible del área (0..1).
     * Sin valor (por ejemplo si se scrolleó con el teclado): el centro
     */
    at?: { x: number; y: number }
    /** Solo `type`: el texto que quedó en el campo al terminar de escribir (se tipea letra por letra al reproducir) */
    text?: string
    /** Cuánto se queda la reproducción después de este paso (ms). Sin valor: una pausa corta por defecto */
    pauseAfter?: number
}

export type Script = {
    /** URL desde la que arranca el guion; ir al paso N = cargarla y repetir los pasos anteriores */
    startUrl: string
    /** Cuánto se queda la página recién cargada antes del primer click (ms). Sin valor: nada */
    startPause?: number
    /** Dónde está el cursor en el inicio, como fracción de la ventana (0..1). Sin valor: el centro */
    startCursor?: { x: number; y: number }
    steps: Step[]
}

export type RecorderState = {
    script: Script | null
    recording: boolean
    /** Posición: "después del paso N" (el click ya se hizo). -1 es el inicio, sin ningún click; null, sin posición conocida */
    selected: number | null
    /** Viaje en curso: tras recargar hay que ejecutar los pasos anteriores a este */
    pending: number | null
    /** Línea (pausa) seleccionada: -1 es la del inicio y N la que sigue al paso N. Abre la barra de pausa */
    gap: number | null
    /** Velocidad de la corrida en curso: 1 al reproducir, más al viajar a un paso (cámara rápida) */
    speed: number
    /** La capa de la corrida oscurece la página: solo en los viajes en cámara rápida que no son un único paso en el sitio (ese es instantáneo y la capa se vería como un parpadeo) */
    dim: boolean
    /** Pausa que se está cumpliendo ahora: qué línea y cuánto dura (la línea se llena en ese tiempo). `id` reinicia la animación */
    waiting: { gap: number; ms: number; id: number } | null
    /** Paso que se está ejecutando durante un viaje o una reproducción */
    current: number | null
    /** Paso cuyo elemento no se encontró al ejecutar */
    failed: number | null
    /**
     * Modo apuntar: índice del paso cuyo cursor se está ajustando. Abrir una línea siempre lo activa: la posición es
     * el estado anterior a ese paso y su cursor queda posado sobre el objetivo, sin haber hecho la acción.
     */
    aim: number | null
    /** Línea que hay que volver a abrir al terminar el viaje que se hizo para llegar a su estado (sobrevive a la recarga) */
    reopenGap: number | null
    /** El aviso del paso que falló ya se cerró: el paso sigue marcado en rojo hasta la próxima acción */
    failedNoticeClosed: boolean
}

/** Marca del contenedor del widget: sus clicks no se graban */
export const ROOT_ATTR = "data-recorder-root"

/** Marca todo lo que pone el widget en la página: los selectores de los pasos nunca deben apuntar ahí */
export const UI_ATTR = "data-recorder-ui"

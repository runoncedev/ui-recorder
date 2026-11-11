/** A recorded click: which element and at which point of it (0..1), never page coordinates */
export type Step = {
    /**
     * Empty = a free point of the window (a rest step over an area with no elements): `offset` is then
     * a fraction of the window, not of the element.
     */
    selector: string
    /**
     * `rest`: the cursor arrives and stays there, doing nothing else (recorded with Alt + click). Every step moves
     * the cursor to its target; this is the one that does nothing else. `scroll` scrolls the
     * element of the selector (`html` is the page) to `offset`. `type` types `text` into the field. No value: click
     */
    kind?: "click" | "rest" | "scroll" | "type"
    /**
     * Click and rest: the point inside the element (0..1). Scroll: how far it was scrolled, as a fraction of the
     * possible range on each axis (0 = top or left, 1 = the end)
     */
    offset: { x: number; y: number }
    /**
     * Scroll only: where the mouse was while scrolling, as a fraction of the visible part of the area (0..1).
     * No value (for example if it was scrolled with the keyboard): the center
     */
    at?: { x: number; y: number }
    /** `type` only: the text left in the field when typing ended (it is typed letter by letter on playback) */
    text?: string
    /** How long playback stays after this step (ms). No value: a short default pause */
    pauseAfter?: number
}

export type Script = {
    /** URL the script starts from; going to step N = loading it and repeating the previous steps */
    startUrl: string
    /** How long the freshly loaded page stays before the first click (ms). No value: none */
    startPause?: number
    /** Where the cursor is at the start, as a fraction of the window (0..1). No value: the center */
    startCursor?: { x: number; y: number }
    steps: Step[]
}

export type RecorderState = {
    script: Script | null
    recording: boolean
    /** Position: "after step N" (its click is already done). -1 is the start, with no click; null, no known position */
    selected: number | null
    /** Trip in progress: after reloading, the steps before this one must be run */
    pending: number | null
    /** Selected line (pause): -1 is the start one and N the one that follows step N. Opens the pause bar */
    gap: number | null
    /** Speed of the current run: 1 when playing, higher when traveling to a step (fast-forward) */
    speed: number
    /** The run overlay dims the page: only for fast-forward trips that are not a single in-place step (that one is instant and the overlay would look like a flicker) */
    dim: boolean
    /** Pause currently elapsing: which line and how long it lasts (the line fills over that time). `id` restarts the animation */
    waiting: { gap: number; ms: number; id: number } | null
    /** Step being executed during a trip or a playback */
    current: number | null
    /** Step whose element was not found when running */
    failed: number | null
    /**
     * Aim mode: index of the step whose cursor is being adjusted. Opening a line always turns it on: the position is
     * the state before that step and its cursor rests on the target, without having done the action.
     */
    aim: number | null
    /** Line to reopen when the trip made to reach its state ends (survives the reload) */
    reopenGap: number | null
    /** The notice of the failed step was already closed: the step stays marked in red until the next action */
    failedNoticeClosed: boolean
}

/** Mark of the widget container: its clicks are not recorded */
export const ROOT_ATTR = "data-recorder-root"

/** Marks everything the widget puts on the page: step selectors must never point there */
export const UI_ATTR = "data-recorder-ui"

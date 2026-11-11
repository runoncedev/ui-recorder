# ui-recorder

A script editor for **demos with a cursor**. You add it to any web app and it floats over it as a bar. With it you:

1. **Record** a real interaction with the app (clicks, scrolling, typing, and places where the cursor just rests).
2. The interaction becomes an **editable script**, shown as a timeline of nodes.
3. **Play it back** with a **fake cursor** that moves, clicks, scrolls and types by itself, with pauses you control.

It is meant for producing demos or product videos with a clean, repeatable cursor, not for testing. Everything runs inside the browser, on the page itself: no server, no extension, no remote browser.

> Not published to npm yet.

## Packages

It is a pnpm monorepo with three publishable packages and a playground:

```
packages/
  core/         @ui-recorder/core    the logic, no UI: selectors, recording, playback, state
  ui/           @ui-recorder/ui      the bar (built with React, bundled inside) → mountRecorder()
  react/        @ui-recorder/react   <Recorder />, the wrapper for React apps
  playground/   (private)            test page used for development
```

Dependencies go in one direction only:

```
playground → react → ui → core
```

- **`core`** uses only browser APIs: it knows nothing about React or any framework. It keeps its state in memory and in `localStorage`, and exposes `subscribe` so any UI can find out about changes.
- **`ui`** is the whole bar (nodes, lines, fake cursor, notices). It is written in React, but **React ships inside the bundle**: whoever uses it does not need React or any particular version of it. Its only public API is `mountRecorder()`.
- **`react`** is a wrapper of a few lines that calls `mountRecorder()` in a `useEffect`. A wrapper for another framework (Vue, for example) would be the same thing: mount on enter, unmount on leave.

`core` is a regular dependency of `ui` (it is not bundled inside), so an app ends up with **a single copy** of the state. With two copies of `core` there would be two states and nothing would work.

## Usage

### In a React app

```tsx
import { Recorder } from "@ui-recorder/react";

// at the root of the app, development only
{
  import.meta.env.DEV && <Recorder />;
}
```

`<Recorder />` takes no props. It mounts on `document.body` (client only) and keeps its state in `localStorage` (key `recorder:v1`), so it survives page reloads. That is required: traveling to an earlier step reloads the page.

### Without a framework

```ts
import { mountRecorder } from "@ui-recorder/ui";

const unmount = mountRecorder(); // returns the function that unmounts it
```

### The bar

```
[ ● ] [ ▶ ]  ( • ) ── ( 1 ) ── ( 2 ) ── ( ⚑ )  [ 🗑 ]
 record play  start  steps with their pauses   end   delete
```

- **●** records. While a recording is in progress it turns red and blinks; pressing it (or **Esc**) ends it.
- **▶** plays. **■** (while running) stops.
- **🗑** deletes the script. Recording again over an existing script, and deleting, ask for confirmation.
- **The steps** sit in a horizontally scrolling area. The running step is kept in view.

### What gets recorded

| Gesture                                                              | Step                                                                       | Node                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------- |
| Click                                                                | `click`                                                                    | circle               |
| **Alt (Option) + click**                                             | `rest`: the cursor arrives and stays, the page never sees the gesture      | dotted circle        |
| Scrolling (wheel, trackpad, touch, scroll keys or dragging the bar)  | `scroll`                                                                   | rounded square       |
| Typing in a field                                                    | `type` (one step per field, not one per key)                               | bubble               |

- **Password fields are never recorded**: the script is stored in `localStorage`.
- Only the **scrolling the person causes** is recorded; scrolling triggered by the app or the browser is ignored.
- **Esc** ends the recording and the page does not receive that Esc. When it ends, a last step with a flag (⚑) is added: a rest at the center of the screen. The script ends there, with no final wait.

### The timeline

Circle **N** means **"the page after step N"**. On the left is the **start** (•, the freshly loaded page).

- **Clicking a node** travels to that state. Forward, it runs only the missing steps. Backward (or with no known position), it **reloads the page and repeats everything from scratch** in fast-forward (3×, no pauses).
- **▶** continues from the current position at normal speed. Standing on the last step, it starts from scratch.
- If a step cannot find its element, the node turns **red** and a notice shows the selector it was looking for. **Play retries** from the step before.
- The fake cursor is always over the element where the step acts. At the start it is "parked" and **can be dragged**; the point is saved when you drop it.
- **Reloading the page by hand always puts the position back at the start** (the DOM is new, so "after step 5" would no longer be true). The script is left intact.

### Pauses

The lines between nodes are the **time it stays** at that point before the next step: start → 1 is how long the freshly loaded page stays before the first click, and N → N+1 how long it stays after click N (0.75 s by default). There is no line after the last step.

**Clicking a line** goes to the state just before the step that follows it, with the cursor resting on its target without having done the action, and opens a bar with **−** / **+** (in 0.25 s steps) and an editable value. There you can **drag the cursor** to adjust where it will point; it is saved on drop. The click the page receives always stays inside the element: only the visible cursor can leave it. The line stays selected until something else is chosen or the page is reloaded.

## How it works

### The script

```ts
type Script = {
  startUrl: string; // the URL everything starts from
  startPause?: number; // ms the clean page stays before the 1st step
  startCursor?: { x; y }; // where the cursor is at the start (fraction of the window)
  steps: Step[];
};

type Step = {
  selector: string; // the element it acts on ("html" = the whole page)
  kind?: "click" | "rest" | "scroll" | "type";
  offset: { x; y }; // click/rest/type: the point inside the element; scroll: where it was scrolled to
  at?: { x; y }; // scroll: where the mouse was inside the area
  text?: string; // type: the final text of the field
  pauseAfter?: number; // ms it stays after the step
};
```

- **There are never page coordinates.** Every point is a **fraction of its element** (it can go outside 0 to 1 if the cursor is dropped outside). Scrolling is a fraction of the possible range.
- **Every step has a target element.** A rest always points to `html`, measured against the visible window.
- **Selectors:** `data-testid`, `data-demo`, `aria-label`, `name` and `placeholder` are preferred; then an `id` that does not look generated; and failing that, a short path of tags with `:nth-of-type`. It is always verified that the selector points to a single element. Lookups ignore everything the widget adds (`data-recorder-ui`).
- **Playback** dispatches synthetic events: the full sequence of a click, `scrollTo` (smooth at normal speed, instant in fast-forward) and, for typing, the native value setter plus one `InputEvent` per letter, so React-controlled inputs find out. Before each step it waits (up to 5 s) for its element to exist and stop moving.
- **Traveling** to an earlier state means reloading `startUrl` and repeating the steps up to there; that is why the state lives in `localStorage`.

## Development

Requires pnpm 12. From the root:

```bash
pnpm install
pnpm build   # the first time: creates the dist/ folders the playground depends on
pnpm dev     # core, ui and react in watch mode, and the playground (Vite)
```

- `pnpm build` compiles in dependency order: `core → ui → react → playground`.
- `pnpm dev` leaves the three libraries rebuilding on save (`vite build --watch`). The playground consumes their `dist/`, so **every change reloads the whole page** (there is no HMR) and the timeline position goes back to the start; the script is not lost.
- In watch mode **types (`.d.ts`) are not regenerated**, only the JavaScript. To update them, run `pnpm build`.
- Relative imports inside each package go **without an extension** (`./store`, not `./store.ts`), so the generated types do not carry it.
- `core` is developed with `"lib": ["ES2023", "DOM"]`: browser APIs only, no React.

## Known limitations

- **Fractions drift if the content height changes** between recording and playback (a list that loads late, for example). Scrolling "to the end" still lands at the end, but one in the middle may land differently.
- **Only typing and simple clicks are recorded**: no individual keys (Enter, Tab, arrows), double click, right click or drag and drop. Synthetic keys do not submit a form by themselves.
- Dragging the scroll bar and touch were not tested. Neither were `contenteditable` fields or rich text editors.
- **There is no undo**, and the script cannot be exported or imported (it lives only in `localStorage`).
- Tested only in **Chrome**.
- **There are no automated tests.** Everything was verified with ad hoc scripts against the playground.

## Ideas discussed and not done

- Detect whether a click had an effect (changes in the DOM, the URL or the network) and warn about it when recording and when playing back.
- A wait condition ("wait until X appears") in addition to the fixed time.
- Points in pixels from the center of the element, more robust than a percentage when the element changes size.
- A "reset to the recorded point" button in the cursor adjustment.
- Reordering or deleting a single step, and recording by inserting steps in the middle.
- Exporting and importing the script as JSON, and an external Playwright player that consumes it.
- A wrapper for Vue (and other frameworks) on top of `@ui-recorder/ui`.

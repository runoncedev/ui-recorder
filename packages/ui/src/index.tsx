import { createRoot } from "react-dom/client"
import { Recorder } from "./Recorder"

export type { Script, Step } from "@ui-recorder/core"

/**
 * Mounts the recorder bar (with React bundled inside, in its own root).
 * Returns the function that unmounts it.
 */
export function mountRecorder(parent: HTMLElement = document.body): () => void {
  const host = document.createElement("div")
  parent.append(host)
  const root = createRoot(host)
  root.render(<Recorder />)
  return () => {
    root.unmount()
    host.remove()
  }
}

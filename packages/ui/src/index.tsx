import { createRoot } from "react-dom/client"
import { Recorder } from "./Recorder"

export type { Script, Step } from "@ui-recorder/core"

/**
 * Monta la barra del recorder (con React empaquetado adentro, en su propio root).
 * Devuelve la función que la desmonta.
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

import { useEffect } from "react"
import { mountRecorder } from "@ui-recorder/ui"

export type { Script, Step } from "@ui-recorder/ui"

export function Recorder(): null {
  useEffect(() => mountRecorder(), [])
  return null
}

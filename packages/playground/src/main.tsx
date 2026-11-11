import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Recorder } from "@ui-recorder/react"

// Test page: buttons with no stable attributes, a panel that appears and
// disappears (state the following steps need), a list that
// appears late, a zone where the exact click point matters and an area with
// its own scroll (to test that playing brings into view an element that
// is outside the visible area), a controlled text field (to test typing) and a
// menu that opens with onMouseEnter/onMouseLeave (to test the JS-made hover), with buttons
// inside and its own scroll.

function App() {
    const [count, setCount] = useState(0)
    const [open, setOpen] = useState(false)
    const [choice, setChoice] = useState("none")
    const [late, setLate] = useState(false)
    const [point, setPoint] = useState("-")
    const [row, setRow] = useState("none")
    const [text, setText] = useState("")
    const [menu, setMenu] = useState(false)
    const [menuChoice, setMenuChoice] = useState("none")
    const menuRef = useRef<HTMLDivElement>(null)
    const [shift, setShift] = useState({ x: 0, y: 0 })

    // The menu comes out to the side of the button and shifts as needed so it never leaves the screen
    useLayoutEffect(() => {
        const el = menuRef.current
        if (!menu || !el) return setShift({ x: 0, y: 0 })
        const r = el.getBoundingClientRect()
        const m = 8
        const fit = (start: number, end: number, size: number) => {
            const d = Math.min(0, size - m - end)
            return start + d < m ? m - start : d
        }
        setShift({ x: fit(r.left, r.right, window.innerWidth), y: fit(r.top, r.bottom, window.innerHeight) })
    }, [menu])

    useEffect(() => {
        const timer = setTimeout(() => setLate(true), 800)
        return () => clearTimeout(timer)
    }, [])

    return (
        <main>
            <h1>Playground</h1>
            <button onClick={() => setCount(count + 1)}>Counter: {count}</button>
            <button data-testid="open-panel" onClick={() => setOpen(!open)}>
                {open ? "Close panel" : "Open panel"}
            </button>
            {open && (
                <div className="panel">
                    <p>Chosen: {choice}</p>
                    <button onClick={() => setChoice("A")}>Option A</button>
                    <button onClick={() => setChoice("B")}>Option B</button>
                </div>
            )}
            <div>
                {late ? (
                    <ul>
                        <li><button onClick={() => setChoice("list 1")}>Item 1 (late)</button></li>
                        <li><button onClick={() => setChoice("list 2")}>Item 2 (late)</button></li>
                    </ul>
                ) : (
                    <p>loading list…</p>
                )}
            </div>
            <div
                className="zone"
                onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setPoint(
                        `${Math.round(((e.clientX - r.left) / r.width) * 100)}%, ${Math.round(((e.clientY - r.top) / r.height) * 100)}%`
                    )
                }}
            >
                Zone: click at {point}
            </div>
            <p>Last row: {row}</p>
            <div className="scroller">
                {Array.from({ length: 30 }, (_, i) => (
                    <button key={i} onClick={() => setRow(String(i + 1))}>
                        Row {i + 1}
                    </button>
                ))}
            </div>
            <input
                placeholder="Type something"
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ display: "block", margin: "12px 0 4px", padding: "6px 8px", width: 320 }}
            />
            <p>You typed: {text}</p>
            <div
                style={{ position: "relative", display: "inline-block", margin: "12px 0" }}
                onMouseEnter={() => setMenu(true)}
                onMouseLeave={() => setMenu(false)}
            >
                <button data-testid="hover-target" style={{ margin: 0 }}>
                    Hover me
                </button>
                {menu && (
                    <div
                        ref={menuRef}
                        role="menu"
                        data-testid="hover-menu"
                        style={{
                            position: "absolute",
                            left: "100%",
                            top: 0,
                            transform: `translate(${shift.x}px, ${shift.y}px)`,
                            width: 180,
                            maxHeight: 130,
                            overflowY: "auto",
                            display: "flex",
                            flexDirection: "column",
                            background: "#fff",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                            boxShadow: "0 4px 12px rgba(0,0,0,.15)",
                            zIndex: 10,
                        }}
                    >
                        {Array.from({ length: 12 }, (_, i) => (
                            <button
                                key={i}
                                role="menuitem"
                                onClick={() => setMenuChoice(`option ${i + 1}`)}
                                style={{ margin: 0, textAlign: "left", border: 0, background: "none" }}
                            >
                                Option {i + 1}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <p>Menu: {menuChoice}</p>
            <Recorder />
        </main>
    )
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
)

import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Recorder } from "@ui-recorder/react"

// Página de prueba: botones sin atributos estables, un panel que aparece y
// desaparece (estado que los pasos siguientes necesitan), una lista que
// aparece tarde, una zona donde importa el punto exacto del click y un área con
// scroll propio (para probar que reproducir lleva a la vista un elemento que
// está fuera del área visible), un campo de texto controlado (para probar el tipeo) y un
// menú que se abre con onMouseEnter/onMouseLeave (para probar el hover hecho con JS), con botones
// adentro y scroll propio.

function App() {
    const [count, setCount] = useState(0)
    const [open, setOpen] = useState(false)
    const [choice, setChoice] = useState("ninguna")
    const [late, setLate] = useState(false)
    const [point, setPoint] = useState("-")
    const [row, setRow] = useState("ninguna")
    const [text, setText] = useState("")
    const [menu, setMenu] = useState(false)
    const [menuChoice, setMenuChoice] = useState("ninguna")
    const menuRef = useRef<HTMLDivElement>(null)
    const [shift, setShift] = useState({ x: 0, y: 0 })

    // El menú sale al costado del botón y se corre lo necesario para no salirse nunca de la pantalla
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
            <button onClick={() => setCount(count + 1)}>Contador: {count}</button>
            <button data-testid="open-panel" onClick={() => setOpen(!open)}>
                {open ? "Cerrar panel" : "Abrir panel"}
            </button>
            {open && (
                <div className="panel">
                    <p>Elegida: {choice}</p>
                    <button onClick={() => setChoice("A")}>Opción A</button>
                    <button onClick={() => setChoice("B")}>Opción B</button>
                </div>
            )}
            <div>
                {late ? (
                    <ul>
                        <li><button onClick={() => setChoice("lista 1")}>Item 1 (tarde)</button></li>
                        <li><button onClick={() => setChoice("lista 2")}>Item 2 (tarde)</button></li>
                    </ul>
                ) : (
                    <p>cargando lista…</p>
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
                Zona: click en {point}
            </div>
            <p>Última fila: {row}</p>
            <div className="scroller">
                {Array.from({ length: 30 }, (_, i) => (
                    <button key={i} onClick={() => setRow(String(i + 1))}>
                        Fila {i + 1}
                    </button>
                ))}
            </div>
            <input
                placeholder="Escribí algo"
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ display: "block", margin: "12px 0 4px", padding: "6px 8px", width: 320 }}
            />
            <p>Escribiste: {text}</p>
            <div
                style={{ position: "relative", display: "inline-block", margin: "12px 0" }}
                onMouseEnter={() => setMenu(true)}
                onMouseLeave={() => setMenu(false)}
            >
                <button data-testid="hover-target" style={{ margin: 0 }}>
                    Pasá el mouse
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
                                onClick={() => setMenuChoice(`opción ${i + 1}`)}
                                style={{ margin: 0, textAlign: "left", border: 0, background: "none" }}
                            >
                                Opción {i + 1}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <p>Menú: {menuChoice}</p>
            <Recorder />
        </main>
    )
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <App />
    </StrictMode>
)

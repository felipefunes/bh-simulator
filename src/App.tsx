import './App.css'
import { BlackHoleCanvas } from './components/BlackHoleCanvas/BlackHoleCanvas'
import { Sidebar } from './components/Sidebar/Sidebar'

function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="canvas-container">
        <BlackHoleCanvas />
      </main>
    </div>
  )
}

export default App

import { useState } from 'react'
import { Button } from '@/components/ui/button'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl">Cue Room</h1>
      <p className="text-muted-foreground">
        Edit <code>src/App.tsx</code> and save to test HMR
      </p>
      <Button onClick={() => setCount((count) => count + 1)}>
        Count is {count}
      </Button>
    </main>
  )
}

export default App

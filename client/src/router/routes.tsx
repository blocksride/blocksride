import { Routes, Route } from 'react-router-dom'
import { Landing } from '../pages/Landing'
import { Terminal } from '../pages/Terminal'
import { Terms } from '../pages/Terms'

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/terminal" element={<Terminal />} />
      <Route path="/terms" element={<Terms />} />
    </Routes>
  )
}

export default AppRoutes

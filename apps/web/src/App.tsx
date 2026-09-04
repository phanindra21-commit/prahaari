import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./routes/LoginPage";
import { ProtectedLayout } from "./routes/ProtectedLayout";
import { MapPage } from "./routes/MapPage";
import { PrioritiesPage } from "./routes/PrioritiesPage";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/map" element={<MapPage />} />
          <Route path="/priorities" element={<PrioritiesPage />} />
          <Route path="/" element={<Navigate to="/map" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/map" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

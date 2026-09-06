import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./routes/LoginPage";
import { ProtectedLayout } from "./routes/ProtectedLayout";
import { DashboardPage } from "./routes/DashboardPage";
import { MapPage } from "./routes/MapPage";
import { PrioritiesPage } from "./routes/PrioritiesPage";
import { ReviewQueuePage } from "./routes/ReviewQueuePage";
import { RecommendationDetailPage } from "./routes/RecommendationDetailPage";
import { DistrictReportPage } from "./routes/DistrictReportPage";
import { HabitationReportPage } from "./routes/HabitationReportPage";
import { FieldReportPage } from "./routes/FieldReportPage";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/priorities" element={<PrioritiesPage />} />
          <Route path="/recommendations" element={<ReviewQueuePage />} />
          <Route path="/recommendations/:id" element={<RecommendationDetailPage />} />
          <Route path="/reports/district/:districtId" element={<DistrictReportPage />} />
          <Route path="/reports/habitation/:habitationId" element={<HabitationReportPage />} />
          <Route path="/reports/field/:districtId" element={<FieldReportPage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

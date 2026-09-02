import { PILOT_DISTRICTS } from "@punarvas/shared";

export function App(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold">PunarVas</h1>
        <p className="text-sm text-slate-500">
          Human-in-the-Loop AI + GIS decision-support for proactive hazard zoning and relocation of
          vulnerable habitations
        </p>
      </header>

      <main className="p-6">
        <p className="mb-4 text-slate-600">
          Scaffold placeholder — the decision workbench UI is built in later steps.
        </p>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">
          Pilot Districts
        </h2>
        <ul className="space-y-1">
          {PILOT_DISTRICTS.map((d) => (
            <li key={d.name} className="rounded border border-slate-200 bg-white px-3 py-2">
              {d.name}, {d.state} — primary hazard: {d.primaryHazard}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

export default App;

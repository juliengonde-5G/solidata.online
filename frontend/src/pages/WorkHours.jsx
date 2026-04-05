import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function WorkHours() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [hours, setHours] = useState([]);
  const [summary, setSummary] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ employee_id: '', date: '', start_time: '', end_time: '', break_minutes: 60, type: 'normal' });

  useEffect(() => {
    api.get('/employees').then(r => setEmployees(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedEmployee) {
      loadHours();
      loadSummary();
    }
  }, [selectedEmployee, month]);

  const loadHours = async () => {
    try {
      const res = await api.get(`/employees/${selectedEmployee}/hours?month=${month}`);
      setHours(res.data);
    } catch (err) { console.error(err); }
  };

  const loadSummary = async () => {
    try {
      const res = await api.get(`/employees/${selectedEmployee}/hours/summary?month=${month}`);
      setSummary(res.data);
    } catch (err) { console.error(err); }
  };

  const createHours = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/employees/${form.employee_id}/hours`, form);
      setShowForm(false);
      if (form.employee_id === selectedEmployee) { loadHours(); loadSummary(); }
    } catch (err) { console.error(err); }
  };

  const validateHours = async (id) => {
    try {
      await api.put(`/employees/${selectedEmployee}/hours/${id}/validate`);
      loadHours();
      loadSummary();
    } catch (err) { console.error(err); }
  };

  const TYPE_LABELS = { normal: 'Normal', overtime: 'Heures sup.', absence: 'Absence', conge: 'Congé', maladie: 'Maladie' };
  const TYPE_COLORS = { normal: 'bg-blue-50 text-blue-700', overtime: 'bg-orange-50 text-orange-700', absence: 'bg-red-50 text-red-700', conge: 'bg-green-50 text-green-700', maladie: 'bg-yellow-50 text-yellow-700' };

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Heures de travail</h1>
            <p className="text-gray-500">Suivi et validation des heures</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-teal-700 text-sm font-medium">
            + Saisir des heures
          </button>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 mb-6">
          <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className="border rounded-lg px-3 py-2 text-sm w-64">
            <option value="">Sélectionner un collaborateur</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
          </select>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Total heures" value={`${summary.total_hours || 0}h`} color="text-primary" />
            <SummaryCard label="Jours travaillés" value={summary.days_worked || 0} color="text-blue-600" />
            <SummaryCard label="Heures sup." value={`${summary.overtime_hours || 0}h`} color="text-orange-600" />
            <SummaryCard label="Absences" value={`${summary.absence_days || 0}j`} color="text-red-600" />
          </div>
        )}

        {/* Hours Table */}
        {selectedEmployee && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Début</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Fin</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Pause</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Validé</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {hours.map(h => (
                  <tr key={h.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm font-medium">{new Date(h.date).toLocaleDateString('fr-FR')}</td>
                    <td className="p-3 text-sm">{h.start_time || '—'}</td>
                    <td className="p-3 text-sm">{h.end_time || '—'}</td>
                    <td className="p-3 text-sm text-gray-500">{h.break_minutes}min</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${TYPE_COLORS[h.type] || 'bg-gray-50'}`}>
                        {TYPE_LABELS[h.type] || h.type}
                      </span>
                    </td>
                    <td className="p-3">
                      {h.validated ? (
                        <span className="text-green-600 text-xs font-medium">Validé</span>
                      ) : (
                        <span className="text-orange-500 text-xs font-medium">En attente</span>
                      )}
                    </td>
                    <td className="p-3">
                      {!h.validated && (
                        <button onClick={() => validateHours(h.id)} className="text-primary text-xs font-medium hover:underline">
                          Valider
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {hours.length === 0 && (
                  <tr><td colSpan="7" className="p-8 text-center text-gray-400">Aucune heure saisie pour cette période</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!selectedEmployee && (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
            Sélectionnez un collaborateur pour voir ses heures
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createHours} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Saisir des heures</h2>
              <div className="space-y-3">
                <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Collaborateur *</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
                </select>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Début</label>
                    <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Fin</label>
                    <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Pause (minutes)</label>
                  <input type="number" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-primary text-white rounded-lg py-2 text-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

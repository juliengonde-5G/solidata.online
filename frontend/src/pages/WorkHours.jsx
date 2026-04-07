import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { DataTable, StatusBadge, Modal } from '../components';
import { Clock } from 'lucide-react';
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

  const hoursColumns = [
    { key: 'date', label: 'Date', sortable: true, render: (h) => <span className="font-medium">{new Date(h.date).toLocaleDateString('fr-FR')}</span> },
    { key: 'start_time', label: 'Début', render: (h) => h.start_time || '—' },
    { key: 'end_time', label: 'Fin', render: (h) => h.end_time || '—' },
    { key: 'break_minutes', label: 'Pause', render: (h) => <span className="text-gray-500">{h.break_minutes}min</span> },
    { key: 'type', label: 'Type', render: (h) => (
      <StatusBadge status={h.type} size="sm" label={TYPE_LABELS[h.type]} />
    )},
    { key: 'validated', label: 'Validé', render: (h) => h.validated
      ? <span className="text-green-600 text-xs font-medium">Validé</span>
      : <span className="text-orange-500 text-xs font-medium">En attente</span>
    },
    { key: 'actions', label: '', render: (h) => !h.validated && (
      <button onClick={() => validateHours(h.id)} className="text-primary text-xs font-medium hover:underline">
        Valider
      </button>
    )},
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Heures de travail</h1>
            <p className="text-gray-500">Suivi et validation des heures</p>
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
            + Saisir des heures
          </button>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 mb-6">
          <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)} className="select-modern w-auto">
            <option value="">Sélectionner un collaborateur</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
          </select>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input-modern w-auto" />
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
          <DataTable
            columns={hoursColumns}
            data={hours}
            loading={false}
            emptyIcon={Clock}
            emptyMessage="Aucune heure saisie pour cette période"
            dense
          />
        )}

        {!selectedEmployee && (
          <div className="card-modern p-12 text-center text-gray-400">
            Sélectionnez un collaborateur pour voir ses heures
          </div>
        )}

        {/* Form Modal */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Saisir des heures" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="workhours-form" className="flex-1 btn-primary text-sm">Enregistrer</button>
          </>}
        >
          <form id="workhours-form" onSubmit={createHours} className="space-y-3">
            <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })} className="select-modern" required>
              <option value="">Collaborateur *</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>)}
            </select>
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-modern" required />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Début</label>
                <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="input-modern" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Fin</label>
                <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} className="input-modern" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Pause (minutes)</label>
              <input type="number" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: parseInt(e.target.value) || 0 })} className="input-modern" />
            </div>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="select-modern">
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="card-modern p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

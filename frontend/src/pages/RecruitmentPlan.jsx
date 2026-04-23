import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { PageHeader, Section } from '../components';
import { ClipboardList } from 'lucide-react';
import api from '../services/api';

export default function RecruitmentPlan() {
  const [positions, setPositions] = useState([]);
  const [plan, setPlan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [posForm, setPosForm] = useState({ title: '', type: '', month: '', slots_open: 1 });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [months] = useState(() => {
    const arr = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return arr;
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, planRes] = await Promise.all([
        api.get('/candidates/positions/list').catch(() => ({ data: [] })),
        api.get(`/candidates/recruitment-plan?from=${months[0]}&to=${months[months.length - 1]}`).catch(() => ({ data: [] })),
      ]);
      setPositions(posRes.data || []);
      setPlan(planRes.data || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [months]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const updateSlots = async (positionId, month, slots) => {
    try {
      await api.post('/candidates/recruitment-plan', { position_id: positionId, month, slots_needed: Math.max(0, parseInt(slots) || 0) });
      loadAll();
    } catch (err) { console.error(err); }
  };

  const getSlots = (positionId, month) => {
    const entry = plan.find(p => p.position_id === positionId && p.month === month);
    return entry ? entry.slots_needed : 0;
  };

  const getHired = (positionId, month) => {
    const entry = plan.find(p => p.position_id === positionId && p.month === month);
    return entry ? (parseInt(entry.hired_count) || 0) : 0;
  };

  const formatMonth = (m) => {
    const [y, mo] = m.split('-');
    const names = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return `${names[parseInt(mo) - 1]} ${y}`;
  };

  const totalNeeded = (month) => positions.reduce((sum, p) => sum + getSlots(p.id, month), 0);
  const totalHired = (month) => positions.reduce((sum, p) => sum + getHired(p.id, month), 0);

  const addPosition = async () => {
    if (!posForm.title) return;
    try {
      await api.post('/candidates/positions', posForm);
      setPosForm({ title: '', type: '', month: '', slots_open: 1 });
      setShowPositionModal(false);
      loadAll();
    } catch (err) { console.error(err); }
  };

  return (
    <Layout>
      <div className="p-4 lg:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Plan de recrutement</h1>
            <p className="text-sm text-gray-500 mt-1">Planification mensuelle des besoins par poste</p>
          </div>
          <button onClick={() => setShowPositionModal(true)} className="btn-primary text-sm">+ Nouveau poste</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[180px]">Poste</th>
                    {months.map(m => (
                      <th key={m} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                        <span className={m === selectedMonth ? 'text-primary font-bold' : ''}>{formatMonth(m)}</span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-semibold text-gray-700 min-w-[80px]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(pos => {
                    const totalPos = months.reduce((sum, m) => sum + getSlots(pos.id, m), 0);
                    const totalPosHired = months.reduce((sum, m) => sum + getHired(pos.id, m), 0);
                    return (
                      <tr key={pos.id} className="border-b hover:bg-gray-50/50">
                        <td className="px-4 py-2 font-medium text-gray-800 sticky left-0 bg-white">
                          <div className="flex items-center justify-between">
                            <span>
                              {pos.title}
                              {pos.type && <span className="text-gray-400 text-xs ml-1">({pos.type})</span>}
                            </span>
                            <button onClick={async () => { await api.delete(`/candidates/positions/${pos.id}`); loadAll(); }} className="text-red-400 hover:text-red-600 text-xs ml-2">Suppr.</button>
                          </div>
                        </td>
                        {months.map(m => {
                          const needed = getSlots(pos.id, m);
                          const hired = getHired(pos.id, m);
                          return (
                            <td key={m} className="px-1 py-1 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <input type="number" min="0" value={needed}
                                  onChange={e => updateSlots(pos.id, m, e.target.value)}
                                  className="w-14 text-center border rounded px-1 py-1 text-sm focus:ring-1 focus:ring-primary focus:border-primary" />
                                {needed > 0 && (
                                  <span className={`text-[10px] font-medium ${hired >= needed ? 'text-green-600' : 'text-orange-500'}`}>
                                    {hired}/{needed}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-center font-bold">
                          <span className={totalPosHired >= totalPos && totalPos > 0 ? 'text-green-600' : 'text-gray-800'}>{totalPosHired}/{totalPos}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 font-bold">
                    <td className="px-4 py-3 sticky left-0 bg-gray-50 text-gray-700">Total</td>
                    {months.map(m => (
                      <td key={m} className="px-3 py-3 text-center">
                        <span className={totalHired(m) >= totalNeeded(m) && totalNeeded(m) > 0 ? 'text-green-600' : 'text-gray-800'}>
                          {totalHired(m)}/{totalNeeded(m)}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center text-primary">
                      {months.reduce((s, m) => s + totalHired(m), 0)}/{months.reduce((s, m) => s + totalNeeded(m), 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {positions.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p>Aucun poste configuré.</p>
                <p className="text-xs mt-1">Cliquez sur "Nouveau poste" pour commencer.</p>
              </div>
            )}
          </div>
        )}

        {/* Modal ajout poste */}
        {showPositionModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowPositionModal(false)}>
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-800 mb-4">Nouveau poste</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Intitulé du poste *</label>
                  <input value={posForm.title} onChange={e => setPosForm({ ...posForm, title: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 mt-1 text-sm focus:ring-1 focus:ring-primary focus:border-primary" placeholder="Ex: Agent de tri" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Type de contrat</label>
                  <select value={posForm.type} onChange={e => setPosForm({ ...posForm, type: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 mt-1 text-sm focus:ring-1 focus:ring-primary focus:border-primary">
                    <option value="">—</option>
                    <option value="CDDI">CDDI</option>
                    <option value="CDD">CDD</option>
                    <option value="CDI">CDI</option>
                    <option value="Stage">Stage</option>
                    <option value="Alternance">Alternance</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Postes ouverts</label>
                  <input type="number" min="1" value={posForm.slots_open} onChange={e => setPosForm({ ...posForm, slots_open: parseInt(e.target.value) || 1 })}
                    className="w-full border rounded-lg px-3 py-2 mt-1 text-sm focus:ring-1 focus:ring-primary focus:border-primary" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowPositionModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
                <button onClick={addPosition} className="btn-primary text-sm">Créer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

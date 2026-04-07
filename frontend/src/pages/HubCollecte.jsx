import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Map, Scale, Car, Sparkles, BarChart3, MapPin } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard } from '../components';
import api from '../services/api';

export default function HubCollecte() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const [toursRes, cavRes, vehiclesRes] = await Promise.all([
        api.get(`/tours?date=${today}`).catch(() => ({ data: [] })),
        api.get('/cav').catch(() => ({ data: [] })),
        api.get('/vehicles').catch(() => ({ data: [] })),
      ]);
      const tours = Array.isArray(toursRes.data) ? toursRes.data : (toursRes.data?.tours || []);
      const cavs = Array.isArray(cavRes.data) ? cavRes.data : (cavRes.data?.cavs || []);
      const vehicles = Array.isArray(vehiclesRes.data) ? vehiclesRes.data : (vehiclesRes.data?.vehicles || []);
      const vehiclesEnService = vehicles.filter(v => v.status === 'en_service' || v.status === 'active' || v.is_active);
      setStats({
        tourneesJour: tours.length,
        cavActifs: cavs.filter(c => c.is_active !== false && c.statut !== 'inactif').length || cavs.length,
        tonnageMois: '—',
        vehiculesService: vehiclesEnService.length || vehicles.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats collecte:', err);
      setStats({ tourneesJour: 0, cavActifs: 0, tonnageMois: '—', vehiculesService: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Tournées aujourd\'hui', value: loading ? '—' : (stats?.tourneesJour ?? 0).toLocaleString('fr-FR'), icon: Truck, accent: 'primary' },
    { title: 'CAV actifs', value: loading ? '—' : (stats?.cavActifs ?? 0).toLocaleString('fr-FR'), icon: Map, accent: 'slate' },
    { title: 'Tonnage du mois', value: loading ? '—' : stats?.tonnageMois, icon: Scale, accent: 'primary' },
    { title: 'Véhicules en service', value: loading ? '—' : (stats?.vehiculesService ?? 0).toLocaleString('fr-FR'), icon: Car, accent: 'amber' },
  ];

  const cards = [
    { path: '/tours', title: 'Tournées', desc: 'Planification et suivi des tournées de collecte', icon: Truck },
    { path: '/collection-proposals', title: 'Propositions IA', desc: 'Suggestions intelligentes de tournées optimisées', icon: Sparkles },
    { path: '/cav-map', title: 'Carte CAV', desc: 'Localisation géographique des conteneurs', icon: Map },
    { path: '/fill-rate', title: 'Remplissage CAV', desc: 'Taux de remplissage et prédictions IA', icon: BarChart3 },
    { path: '/live-vehicles', title: 'Suivi GPS', desc: 'Position des véhicules en temps réel', icon: MapPin },
  ];

  return (
    <Layout>
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
            <span className="w-10 h-10 rounded-card bg-primary-surface flex items-center justify-center">
              <Truck className="w-5 h-5 text-primary" />
            </span>
            Collecte — Vue d'ensemble
          </h1>
          <p className="text-slate-500 mt-1 text-sm ml-[52px]">Tournées, conteneurs, véhicules et suivi GPS</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>

        <h2 className="text-lg font-semibold text-slate-800 mb-4">Accès rapide</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <NavCard key={card.path} {...card} onClick={() => navigate(card.path)} />
          ))}
        </div>
      </div>
    </Layout>
  );
}

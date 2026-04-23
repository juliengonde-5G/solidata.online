import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Factory, Scissors, Package, Tag, Ship } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard, PageHeader, Section } from '../components';
import api from '../services/api';

export default function HubTriProduction() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [productionRes, stockRes, produitsRes] = await Promise.all([
        api.get('/production').catch(() => ({ data: [] })),
        api.get('/stock/summary').catch(() => ({ data: null })),
        api.get('/produits-finis').catch(() => ({ data: [] })),
      ]);
      const productions = Array.isArray(productionRes.data) ? productionRes.data : (productionRes.data?.productions || []);
      const today = new Date().toISOString().split('T')[0];
      const todayProd = productions.filter(p => p.date === today || (p.date && p.date.startsWith(today)));
      const totalKgToday = todayProd.reduce((sum, p) => sum + (parseFloat(p.poids_kg || p.weight_kg || 0)), 0);
      const stockData = stockRes.data;
      const totalStockT = stockData?.total_kg ? (parseFloat(stockData.total_kg) / 1000).toFixed(1) : (stockData?.total_tonnes ?? '—');
      const produitsFinis = Array.isArray(produitsRes.data) ? produitsRes.data : (produitsRes.data?.produits || []);
      const enStock = produitsFinis.filter(p => p.statut === 'en_stock' || p.status === 'in_stock' || !p.date_sortie);
      setStats({
        productionJour: Math.round(totalKgToday),
        chainesActives: '—',
        stockMP: totalStockT,
        produitsFinis: enStock.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats tri/production:', err);
      setStats({ productionJour: 0, chainesActives: '—', stockMP: '—', produitsFinis: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Production du jour', value: loading ? '—' : (stats?.productionJour ?? 0).toLocaleString('fr-FR'), unit: 'kg', icon: Factory, accent: 'primary' },
    { title: 'Chaînes actives', value: loading ? '—' : stats?.chainesActives, icon: Scissors, accent: 'slate' },
    { title: 'Stock matières', value: loading ? '—' : stats?.stockMP, unit: 't', icon: Package, accent: 'primary' },
    { title: 'Produits finis en stock', value: loading ? '—' : (stats?.produitsFinis ?? 0).toLocaleString('fr-FR'), icon: Tag, accent: 'amber' },
  ];

  const cards = [
    { path: '/production', title: 'Production', desc: 'Suivi quotidien de la production et KPI', icon: Factory },
    { path: '/chaine-tri', title: 'Chaînes de tri', desc: 'Gestion des chaînes et opérations de tri', icon: Scissors },
    { path: '/stock', title: 'Stock MP', desc: 'Mouvements de stock et inventaire matières premières', icon: Package },
    { path: '/produits-finis', title: 'Produits finis', desc: 'Catalogue et suivi des produits fabriqués', icon: Tag },
    { path: '/expeditions', title: 'Expéditions', desc: 'Expéditions et bons de livraison', icon: Ship },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="Tri & Production — Vue d'ensemble"
          subtitle="Production, chaînes de tri, stock et expéditions"
          icon={Factory}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.title} {...kpi} />
          ))}
        </div>

        <Section title="Accès rapide">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((card) => (
              <NavCard key={card.path} {...card} onClick={() => navigate(card.path)} />
            ))}
          </div>
        </Section>
      </div>
    </Layout>
  );
}

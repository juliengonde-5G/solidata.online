import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, ShoppingBag, ClipboardList, Calendar, Target, Upload, LayoutDashboard } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard, PageHeader, Section } from '../components';
import api from '../services/api';

export default function HubBoutiques() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);

      const [boutiquesRes, commandesRes] = await Promise.all([
        api.get('/boutiques?active=true').catch(() => ({ data: [] })),
        api.get('/boutique-commandes').catch(() => ({ data: [] })),
      ]);

      const boutiques = boutiquesRes.data || [];
      const commandes = commandesRes.data || [];

      let caMois = 0;
      let nbTicketsJour = 0;
      for (const b of boutiques) {
        try {
          const d = await api.get(`/boutique-ventes/analytics/daily?boutique_id=${b.id}&date_from=${firstDay}&date_to=${today}`);
          caMois += (d.data || []).reduce((s, r) => s + (r.ca_ttc || 0), 0);
          const jour = (d.data || []).find(r => r.jour?.startsWith?.(today));
          if (jour) nbTicketsJour += jour.nb_tickets || 0;
        } catch (_) {}
      }

      const enCours = commandes.filter(c => !['expediee', 'annulee'].includes(c.statut));

      setStats({
        nbBoutiques: boutiques.length,
        caMois,
        commandesEnCours: enCours.length,
        nbTicketsJour,
      });
    } catch (err) {
      console.error('Erreur chargement stats boutiques:', err);
      setStats({ nbBoutiques: 0, caMois: 0, commandesEnCours: 0, nbTicketsJour: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Boutiques actives', value: loading ? '—' : (stats?.nbBoutiques ?? 0).toLocaleString('fr-FR'), icon: Store, accent: 'primary' },
    { title: 'CA du mois (TTC)', value: loading ? '—' : `${(stats?.caMois ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`, icon: ShoppingBag, accent: 'primary' },
    { title: 'Commandes en cours', value: loading ? '—' : (stats?.commandesEnCours ?? 0).toLocaleString('fr-FR'), icon: ClipboardList, accent: 'amber' },
    { title: 'Tickets aujourd\'hui', value: loading ? '—' : (stats?.nbTicketsJour ?? 0).toLocaleString('fr-FR'), icon: Target, accent: 'slate' },
  ];

  const cards = [
    { path: '/boutiques', title: 'Tableau de bord', desc: 'Pilotage quotidien, mensuel et annuel', icon: LayoutDashboard },
    { path: '/boutiques/ventes', title: 'Ventes', desc: 'Analyse des ventes par rayon et article', icon: ShoppingBag },
    { path: '/boutiques/commandes', title: 'Commandes', desc: 'Commandes boutique vers atelier (lot/poids)', icon: ClipboardList },
    { path: '/boutiques/planning', title: 'Planning', desc: 'Affectation vendeurs et caissiers', icon: Calendar },
    { path: '/boutiques/objectifs', title: 'Objectifs', desc: 'Objectifs mensuels de CA par boutique', icon: Target },
    { path: '/boutiques/import', title: 'Import CSV', desc: 'Import et suivi des extractions caisse', icon: Upload },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="Boutiques — Vue d'ensemble"
          subtitle="Performance commerciale, commandes et pilotage retail 2nde main"
          icon={Store}
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

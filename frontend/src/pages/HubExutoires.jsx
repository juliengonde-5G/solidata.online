import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Truck, DollarSign, Users, BarChart3, Calendar } from 'lucide-react';
import Layout from '../components/Layout';
import { KpiCard, NavCard, PageHeader, Section } from '../components';
import api from '../services/api';

export default function HubExutoires() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [commandesRes, clientsRes] = await Promise.all([
        api.get('/commandes-exutoires').catch(() => ({ data: [] })),
        api.get('/clients-exutoires').catch(() => ({ data: [] })),
      ]);
      const commandes = Array.isArray(commandesRes.data) ? commandesRes.data : (commandesRes.data?.commandes || []);
      const clients = Array.isArray(clientsRes.data) ? clientsRes.data : (clientsRes.data?.clients || []);
      const enCours = commandes.filter(c => c.statut !== 'livree' && c.statut !== 'annulee' && c.statut !== 'facturee');
      const preparations = commandes.filter(c => c.statut === 'en_preparation' || c.statut === 'preparation');
      const facturesAttente = commandes.filter(c => c.statut === 'livree' || c.statut === 'a_facturer');
      const clientsActifs = clients.filter(c => c.is_active !== false && c.actif !== false);
      setStats({
        commandesEnCours: enCours.length,
        preparationsActives: preparations.length,
        facturesAttente: facturesAttente.length,
        clientsActifs: clientsActifs.length,
      });
    } catch (err) {
      console.error('Erreur chargement stats exutoires:', err);
      setStats({ commandesEnCours: 0, preparationsActives: 0, facturesAttente: 0, clientsActifs: 0 });
    }
    setLoading(false);
  };

  const kpis = [
    { title: 'Commandes en cours', value: loading ? '—' : (stats?.commandesEnCours ?? 0).toLocaleString('fr-FR'), icon: ClipboardList, accent: 'primary' },
    { title: 'Préparations actives', value: loading ? '—' : (stats?.preparationsActives ?? 0).toLocaleString('fr-FR'), icon: Truck, accent: 'slate' },
    { title: 'Factures en attente', value: loading ? '—' : (stats?.facturesAttente ?? 0).toLocaleString('fr-FR'), icon: DollarSign, accent: 'amber' },
    { title: 'Clients actifs', value: loading ? '—' : (stats?.clientsActifs ?? 0).toLocaleString('fr-FR'), icon: Users, accent: 'primary' },
  ];

  const cards = [
    { path: '/exutoires-commandes', title: 'Commandes', desc: 'Suivi des commandes logistiques (8 statuts)', icon: ClipboardList },
    { path: '/exutoires-preparation', title: 'Préparation', desc: 'Préparation des expéditions et colisage', icon: Truck },
    { path: '/exutoires-gantt', title: 'Gantt Chargement', desc: 'Planning Gantt des chargements', icon: BarChart3 },
    { path: '/exutoires-facturation', title: 'Facturation', desc: 'Gestion des factures logistiques', icon: DollarSign },
    { path: '/exutoires-calendrier', title: 'Calendrier', desc: 'Calendrier logistique des expéditions', icon: Calendar },
    { path: '/exutoires-clients', title: 'Clients', desc: 'Gestion des clients et débouchés', icon: Users },
    { path: '/exutoires-tarifs', title: 'Grille Tarifaire', desc: 'Tarifs et conditions par client', icon: DollarSign },
  ];

  return (
    <Layout>
      <div>
        <PageHeader
          title="Logistique — Vue d'ensemble"
          subtitle="Commandes, préparation, facturation et logistique"
          icon={ClipboardList}
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

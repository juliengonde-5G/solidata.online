import { useState } from 'react';
import Layout from '../components/Layout';
import { PageHeader } from '../components';
import { Clock, ListChecks, FileSpreadsheet, AlertTriangle, IdCard, MonitorPlay, Radio, Sliders, MessageSquare, Tv } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import JournalPointages from '../components/badgeuse/JournalPointages';
import FeuillesTemps from '../components/badgeuse/FeuillesTemps';
import AnomaliesBadgeuse from '../components/badgeuse/AnomaliesBadgeuse';
import GestionBadges from '../components/badgeuse/GestionBadges';
import PlaylistAffichage from '../components/badgeuse/PlaylistAffichage';
import ReseauxSociaux from '../components/badgeuse/ReseauxSociaux';
import SupervisionPostes from '../components/badgeuse/SupervisionPostes';
import EcranDirect from '../components/badgeuse/EcranDirect';
import ParametresBadgeuse from '../components/badgeuse/ParametresBadgeuse';
import MessagesBadgeage from '../components/badgeuse/MessagesBadgeage';

// Module « Temps & Présence » (badgeuse) — décompte du temps de travail par
// badge RFID (Raspberry Pi + lecteur au Houlme). Page à onglets, sur le
// modèle d'EnergieGES.jsx. Rôles : READ = ADMIN/RH/MANAGER (encadrant
// technique), WRITE_RH = ADMIN/RH, ADMIN_ONLY = ADMIN (appairage postes).
// Contrat d'API : docs/badgeuse/MODELE_DONNEES.md §3.
export default function TempsPresence() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWriteRh = ['ADMIN', 'RH'].includes(base);   // corrections RH, validation, exports, badges, playlist, paramètres
  const canCorrect = ['ADMIN', 'RH', 'MANAGER'].includes(base); // corrections (encadrant inclus, NOTE_RH §5.1)
  const isAdmin = base === 'ADMIN';                    // appairage/régénération de postes

  const [tab, setTab] = useState('journal');
  // Passerelle Anomalies → Journal : ouvre la modale de correction pré-remplie.
  const [journalPrefill, setJournalPrefill] = useState(null);
  // Sous-onglet de « Paramètres » : règles de gestion (existant) vs messages
  // de badgeage (écran d'information v2, CDC_AFFICHAGE_V2.md §4).
  const [parametresSousTab, setParametresSousTab] = useState('regles');

  const TABS = [
    { id: 'journal', label: 'Journal', icon: ListChecks },
    { id: 'feuilles', label: 'Feuilles de temps', icon: FileSpreadsheet },
    { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
    { id: 'badges', label: 'Badges', icon: IdCard },
    { id: 'affichage', label: 'Affichage', icon: MonitorPlay },
    // Onglet distinct de « Affichage » (qui reste l'écran de RÉGLAGE) : ici on
    // ne configure rien, on regarde ce qui passe réellement sur le poste.
    { id: 'direct', label: 'Écran en direct', icon: Tv },
    { id: 'supervision', label: 'Supervision', icon: Radio },
    { id: 'parametres', label: 'Paramètres', icon: Sliders },
  ];

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PageHeader
          title="Temps & Présence"
          subtitle="Pointage par badge RFID, feuilles de temps, corrections et exports paie / heures IAE"
          icon={Clock}
        />

        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'journal' && (
          <JournalPointages
            canCorrect={canCorrect}
            canWriteRh={canWriteRh}
            externalPrefill={journalPrefill}
            onConsumeExternalPrefill={() => setJournalPrefill(null)}
          />
        )}
        {tab === 'feuilles' && <FeuillesTemps canValidateEncadrant={canCorrect} canValidateRh={canWriteRh} canExport={canWriteRh} isAdmin={isAdmin} />}
        {tab === 'anomalies' && (
          <AnomaliesBadgeuse
            onCorrigerAnomalie={(prefill) => { if (prefill) setJournalPrefill(prefill); setTab('journal'); }}
          />
        )}
        {tab === 'badges' && <GestionBadges canWrite={canWriteRh} />}
        {tab === 'affichage' && (
          <div className="space-y-5">
            <PlaylistAffichage canWrite={canWriteRh} />
            <ReseauxSociaux canWrite={isAdmin} />
          </div>
        )}
        {tab === 'direct' && <EcranDirect />}
        {tab === 'supervision' && <SupervisionPostes isAdmin={isAdmin} />}
        {tab === 'parametres' && (
          <div className="space-y-4">
            <div className="flex gap-1 border-b border-slate-100">
              {[
                { id: 'regles', label: 'Règles de gestion', icon: Sliders },
                { id: 'messages', label: 'Messages de badgeage', icon: MessageSquare },
              ].map((t) => {
                const Icon = t.icon;
                const active = parametresSousTab === t.id;
                return (
                  <button key={t.id} onClick={() => setParametresSousTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    aria-current={active ? 'page' : undefined}>
                    <Icon className="w-3.5 h-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>
            {parametresSousTab === 'regles' && <ParametresBadgeuse canWrite={canWriteRh} />}
            {parametresSousTab === 'messages' && <MessagesBadgeage canWrite={canWriteRh} />}
          </div>
        )}
      </div>
    </Layout>
  );
}

// Squelette posé par l'orchestrateur (PR A) — remplacé par le lot 2 (maquette « Dossiers FSE+ »).
import PageHeader from '../components/PageHeader';
import { FolderOpen } from 'lucide-react';

export default function DossiersFSE() {
  return (
    <div>
      <PageHeader title="Dossiers FSE+ — pièces à compléter" subtitle="Écran en cours de construction" icon={FolderOpen} />
      <div className="text-sm text-slate-500">Cet écran arrive avec la PR A « Conformité immédiate ».</div>
    </div>
  );
}

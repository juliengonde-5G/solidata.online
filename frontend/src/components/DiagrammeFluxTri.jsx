/**
 * Diagramme des flux de tri — Chaîne Qualité & Chaîne Recyclage Exclusif
 * Mapping : Stock MP → flux entrant par chaîne → opérations (postes) → sorties par exutoire
 */
import { useState, useEffect } from 'react';
import api from '../services/api';

const BOX = 'rounded-lg border-2 p-3 text-sm';
const ARROW = 'text-gray-400 text-center py-1';
const EXUTOIRE = 'text-xs text-gray-600 bg-gray-50 rounded px-2 py-1';

export default function DiagrammeFluxTri() {
  const [fluxMois, setFluxMois] = useState(null);
  const [exutoires, setExutoires] = useState([]);
  const [showDetail, setShowDetail] = useState(true);

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7);
    Promise.all([
      api.get(`/production/dashboard?month=${month}`).then(r => r.data).catch(() => null),
      api.get('/referentiels/exutoires').then(r => r.data).catch(() => []),
    ]).then(([dashboard, exos]) => {
      setFluxMois(dashboard?.summary || null);
      setExutoires(exos || []);
    });
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-solidata-dark">Diagramme des flux de tri</h2>
        <button
          type="button"
          onClick={() => setShowDetail(!showDetail)}
          className="text-sm text-solidata-green hover:underline"
        >
          {showDetail ? 'Réduire' : 'Déplier'}
        </button>
      </div>

      {/* Flux entrants du mois (données Dashboard / SaisiesT) */}
      {fluxMois && (
        <div className="mb-4 p-3 bg-solidata-green/10 border border-solidata-green/30 rounded-lg text-sm">
          <span className="font-semibold text-solidata-dark">Flux entrant ce mois (données production) :</span>
          <span className="ml-2">
            Chaîne Qualité (ligne) : <strong>{Number(fluxMois.total_entree_ligne_kg || 0).toLocaleString('fr-FR')} kg</strong>
            {' · '}
            Chaîne Recyclage Exclusif (R3) : <strong>{Number(fluxMois.total_entree_r3_kg || 0).toLocaleString('fr-FR')} kg</strong>
          </span>
        </div>
      )}

      {/* Stock MP → 3 branches */}
      <div className={`space-y-4 ${!showDetail ? 'hidden' : ''}`}>
        <div className={`${BOX} border-solidata-green bg-solidata-green/5 max-w-md mx-auto`}>
          <p className="font-semibold text-center">Stock matières premières (SaisiesT)</p>
          <p className="text-xs text-gray-500 text-center mt-1">Pesée systématique</p>
        </div>
        <div className={ARROW}>▼</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`${BOX} border-blue-500 bg-blue-50/50`}>
            <p className="font-semibold text-blue-800">Chaîne Qualité</p>
            <p className="text-xs text-blue-600">5 opérations</p>
          </div>
          <div className={`${BOX} border-amber-600 bg-amber-50/50`}>
            <p className="font-semibold text-amber-800">Chaîne Recyclage Exclusif</p>
            <p className="text-xs text-amber-700">1 opération</p>
          </div>
          <div className={`${BOX} border-gray-400 bg-gray-50`}>
            <p className="font-semibold text-gray-700">Vente Original</p>
            <p className="text-xs text-gray-500">Brut, sans tri</p>
          </div>
        </div>

        {/* ═══ CHAÎNE QUALITÉ ═══ */}
        <div className="border-t-2 border-blue-200 pt-6 mt-6">
          <h3 className="text-lg font-bold text-blue-800 mb-4">Chaîne Qualité</h3>

          {/* OP.1 Crackage 1 */}
          <BlocOperation
            titre="OP.1 Crackage 1"
            postes={[{ nom: 'Crack 1', obligatoire: true }]}
            sorties={[
              { vers: 'Balle CSR', libelle: 'CSR Chaussures' },
              { vers: 'Exutoire spécifique', libelle: 'Jouets' },
              { vers: 'OP.2', libelle: 'Tout le reste' },
            ]}
            couleur="blue"
          />

          {/* OP.2 Crackage 2 */}
          <BlocOperation
            titre="OP.2 Crackage 2"
            postes={[{ nom: 'Crack 2', obligatoire: false }]}
            sorties={[
              { vers: 'Stock PF (SaisiesP)', libelle: 'Chaussures pairés' },
              { vers: 'Balle CSR', libelle: 'CSR Chaussures' },
              { vers: 'OP.5 (triage fin)', libelle: 'Accessoires' },
              { vers: 'OP.5 (triage fin)', libelle: 'Linge de maison' },
              { vers: 'OP.3', libelle: 'Tout le reste' },
            ]}
            couleur="blue"
          />

          {/* OP.3 Recyclage */}
          <BlocOperation
            titre="OP.3 Recyclage"
            postes={[
              { nom: 'R1', obligatoire: true, doublure: true },
              { nom: 'R2', obligatoire: true, doublure: true },
            ]}
            sorties={[
              { vers: 'Balle CSR', libelle: 'CSR' },
              { vers: 'Balle Effilochage', libelle: 'Jean' },
              { vers: 'Balle Effilochage', libelle: 'Effilo' },
              { vers: 'Poste Chiffons', libelle: 'Coton Blanc / Coton Couleur' },
              { vers: 'OP.4', libelle: 'Textiles réutilisables' },
            ]}
            couleur="blue"
          />

          {/* OP.4 Réutilisation */}
          <BlocOperation
            titre="OP.4 Réutilisation"
            postes={[{ nom: 'Réu', obligatoire: true, doublure: true }]}
            sorties={[
              { vers: 'Balle CSR', libelle: 'CSR' },
              { vers: 'OP.5', libelle: 'Hommes (VAK / Btq)' },
              { vers: 'OP.5', libelle: 'Femmes (VAK / Btq)' },
              { vers: 'OP.5', libelle: 'Layette (VAK / Btq)' },
            ]}
            couleur="blue"
          />

          {/* OP.5 Triage fin */}
          <BlocOperation
            titre="OP.5 Triage fin"
            postes={[{ nom: '2 postes facultatifs par type (ex. Hommes, Femmes, Layette)', obligatoire: false }]}
            entrant="Entrées : Hommes + Femmes + Layette (OP.4) + Accessoires + Linge (OP.2)"
            sorties={[
              { vers: 'Stock PF (SaisiesP)', libelle: 'Produits finis — 114 produits × Catégorie Eco-org × Genre × Saison × Gamme (BTQ Standard / VAK / CHIF / Pvak)' },
            ]}
            couleur="blue"
          />

          <div className="mt-2 text-xs text-gray-500">
            Poste supplémentaire : <strong>Chiffons</strong> (conditionnement Coton Blanc / Coton Couleur → Balles Chiffons).
          </div>
        </div>

        {/* ═══ CHAÎNE RECYCLAGE EXCLUSIF ═══ */}
        <div className="border-t-2 border-amber-200 pt-6 mt-6">
          <h3 className="text-lg font-bold text-amber-800 mb-4">Chaîne Recyclage Exclusif</h3>
          <BlocOperation
            titre="Opération unique : Recyclage"
            postes={[
              { nom: 'R3', obligatoire: true },
              { nom: 'R4', obligatoire: true },
            ]}
            sorties={[
              { vers: 'Balle CSR', libelle: 'CSR' },
              { vers: 'Balle Effilochage', libelle: 'Jean' },
              { vers: 'Balle Effilochage', libelle: 'Effilo' },
              { vers: 'Balle Chiffons Blanc', libelle: 'Coton Blanc' },
              { vers: 'Balle Chiffons Couleur', libelle: 'Coton Couleur' },
            ]}
            couleur="amber"
          />
        </div>

        {/* Sortants / Débouchés */}
        <div className="border-t-2 border-gray-300 pt-6 mt-6">
          <h3 className="text-lg font-bold text-solidata-dark mb-2">Sorties (37 débouchés)</h3>
          <p className="text-sm text-gray-600 mb-2">
            Stock PF (SaisiesP) · Balles recyclage · Balles CSR · Balles Chiffons · Original (brut) → Pesée sortie (Sortants) →
          </p>
          <div className="flex flex-wrap gap-2">
            {exutoires.length > 0
              ? exutoires.slice(0, 15).map(ex => (
                  <span key={ex.id} className={EXUTOIRE}>{ex.nom}</span>
                ))
              : (
                <span className={EXUTOIRE}>Alunited, Eurofrip, Gebetex, Ecotri, Limbotex, So TOWT…</span>
              )}
            {exutoires.length > 15 && <span className={EXUTOIRE}>+ {exutoires.length - 15} autres</span>}
          </div>
          <p className="text-xs text-gray-400 mt-2">Conteneurs : Balles · Curons · Remorque · Sacs · Cartons</p>
        </div>
      </div>
    </div>
  );
}

function BlocOperation({ titre, postes, sorties, entrant, couleur }) {
  const border = couleur === 'blue' ? 'border-blue-300 bg-blue-50/30' : 'border-amber-400 bg-amber-50/30';
  return (
    <div className={`${BOX} border ${border} mb-4`}>
      <h4 className="font-semibold text-solidata-dark mb-2">{titre}</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Postes de travail</p>
          <ul className="space-y-0.5">
            {postes.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.nom}</span>
                {p.obligatoire ? <span className="text-green-600 text-xs ml-1">obligatoire</span> : <span className="text-gray-500 text-xs ml-1">facultatif</span>}
                {p.doublure && <span className="text-gray-500 text-xs ml-1">+ doublure optionnelle</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          {entrant && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Flux entrant</p>
              <p className="text-gray-700 text-xs mb-2">{entrant}</p>
            </>
          )}
          <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Sortie d’opération → débouché</p>
          <ul className="space-y-0.5">
            {sorties.map((s, i) => (
              <li key={i} className="flex flex-wrap gap-1 items-baseline">
                <span className="text-gray-700">{s.libelle}</span>
                <span className="text-gray-400">→</span>
                <span className="text-solidata-green font-medium">{s.vers}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

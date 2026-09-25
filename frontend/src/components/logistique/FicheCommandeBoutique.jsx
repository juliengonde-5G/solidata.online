import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Package, ScanLine, Truck, XCircle } from 'lucide-react';
import { STATUTS_BOUTIQUE } from '../../utils/logistique-commandes';

/**
 * FICHE D'UNE COMMANDE BOUTIQUE — côté logistique (2.59.0).
 *
 * La boutique passe la commande ; c'est l'équipe logistique qui la valide,
 * l'ajuste, la prépare (scan des cartons en « Sortie cartons ») et l'expédie.
 * Les actions proposées dépendent du statut — une seule étape à la fois.
 */
export default function FicheCommandeBoutique({ commande, onAction, busy, message }) {
  const enCartons = commande.lignes.some((l) => l.nb_cartons_demande !== null && l.nb_cartons_demande !== undefined);
  const prep = commande.preparation || { lignes: [], hors_commande: [] };
  const parLigne = new Map(prep.lignes.map((l) => [l.ligne_id, l]));
  const [ajustements, setAjustements] = useState(() => commande.lignes.map((l) => (enCartons
    ? { ligne_id: l.id, nb_cartons_ajuste: l.nb_cartons_ajuste ?? l.nb_cartons_demande }
    : { ligne_id: l.id, poids_ajuste_kg: l.poids_ajuste_kg ?? l.poids_demande_kg })));
  const s = commande.statut;
  const ajustable = s === 'envoyee';
  const avecPreparation = ['ajustee', 'en_preparation', 'expediee'].includes(s);
  const d = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-800">{message}</div>
      )}
      <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-lg p-3">
        <div><span className="text-gray-500">Boutique :</span> <span className="font-medium">{commande.boutique_nom}</span></div>
        <div><span className="text-gray-500">Statut :</span> <span className="font-medium">{STATUTS_BOUTIQUE[s] || s}</span></div>
        <div><span className="text-gray-500">Commandée le :</span> {d(commande.date_commande)}</div>
        <div><span className="text-gray-500">Livraison souhaitée :</span> <span className="font-medium">{d(commande.date_livraison_souhaitee)}</span></div>
        <div><span className="text-gray-500">Passée par :</span> {commande.created_by_name || '—'}</div>
        {commande.ajuste_par_name && <div><span className="text-gray-500">Validée par :</span> {commande.ajuste_par_name}</div>}
        {commande.notes && <div className="col-span-2"><span className="text-gray-500">Notes de la boutique :</span> {commande.notes}</div>}
      </div>

      <div className="overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-600 mb-2">
          {enCartons ? 'Catégories commandées (en cartons)' : 'Lignes (au poids — ancien format)'}
        </h3>
        {ajustable && (
          <p className="text-xs text-slate-500 mb-2">
            Ajustez si besoin le nombre de cartons à servir (0 = ligne non servie), puis validez.
          </p>
        )}
        {enCartons ? (
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2">Catégorie</th>
                <th className="text-right py-2">Demandé</th>
                <th className="text-right py-2">À servir</th>
                <th className="text-right py-2">Scannés</th>
                <th className="text-right py-2">Expédiés</th>
              </tr>
            </thead>
            <tbody>
              {commande.lignes.map((l, i) => {
                const p = parLigne.get(l.id);
                const voulu = l.nb_cartons_ajuste ?? l.nb_cartons_demande;
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <div className="font-medium text-slate-800">{l.produit}</div>
                      <div className="text-xs text-slate-500">{l.gamme} · {l.genre} · {l.saison}{l.categorie_eco_org ? ` · ${l.categorie_eco_org}` : ''}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.nb_cartons_demande}</td>
                    <td className="py-2 text-right">
                      {ajustable ? (
                        <input
                          type="number" min={0} step={1}
                          aria-label={`Cartons à servir — ${l.produit}`}
                          value={ajustements[i]?.nb_cartons_ajuste ?? ''}
                          onChange={(e) => {
                            const n = [...ajustements];
                            const v = parseInt(e.target.value, 10);
                            n[i] = { ligne_id: l.id, nb_cartons_ajuste: Number.isFinite(v) && v >= 0 ? v : 0 };
                            setAjustements(n);
                          }}
                          className="w-16 text-right border border-slate-300 rounded px-2 py-1"
                        />
                      ) : (voulu ?? '—')}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {avecPreparation && p ? (
                        <span className={p.depasse ? 'text-amber-700 font-semibold' : p.scannes >= voulu ? 'text-emerald-700 font-semibold' : ''}>
                          {p.scannes}/{voulu}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.nb_cartons_expedies ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2">Catégorie</th>
                <th className="text-right py-2">Demandé (kg)</th>
                <th className="text-right py-2">Ajusté (kg)</th>
                <th className="text-right py-2">Expédié (kg)</th>
              </tr>
            </thead>
            <tbody>
              {commande.lignes.map((l, i) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{l.categorie}</td>
                  <td className="py-2 text-right">{l.poids_demande_kg != null ? Number(l.poids_demande_kg).toFixed(1) : '—'}</td>
                  <td className="py-2 text-right">
                    {ajustable ? (
                      <input
                        type="number" step="0.1"
                        value={ajustements[i]?.poids_ajuste_kg ?? ''}
                        onChange={(e) => {
                          const n = [...ajustements];
                          n[i] = { ligne_id: l.id, poids_ajuste_kg: parseFloat(e.target.value) || 0 };
                          setAjustements(n);
                        }}
                        className="w-20 text-right border border-slate-300 rounded px-2 py-1"
                      />
                    ) : (l.poids_ajuste_kg != null ? Number(l.poids_ajuste_kg).toFixed(1) : '—')}
                  </td>
                  <td className="py-2 text-right">{l.poids_expedie_kg != null ? Number(l.poids_expedie_kg).toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {enCartons && avecPreparation && (
          <p className="text-xs text-slate-500 mt-2">
            {prep.total_scannes} carton{prep.total_scannes > 1 ? 's' : ''} scanné{prep.total_scannes > 1 ? 's' : ''} pour
            {' '}cette commande sur {prep.total_voulu} à servir — {prep.total_kg} kg.
          </p>
        )}
        {enCartons && prep.hors_commande?.length > 0 && (
          <div className="mt-2 bg-amber-50 text-amber-800 text-xs p-2 rounded flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {prep.hors_commande.length} carton{prep.hors_commande.length > 1 ? 's' : ''} scanné{prep.hors_commande.length > 1 ? 's' : ''} hors
              {' '}des catégories commandées : {prep.hors_commande.map((c) => `${c.produit} (${c.code_barre})`).join(', ')}.
            </span>
          </div>
        )}
      </div>

      {s === 'en_preparation' && enCartons && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 text-sm text-indigo-900 flex flex-wrap items-center justify-between gap-2">
          <span>Préparez en scannant chaque carton : il est rattaché à sa ligne et sort du stock à l'expédition.</span>
          <Link to={`/inventaire/sortie-cartons?commande=${commande.id}`} className="btn-primary text-xs flex items-center gap-1.5">
            <ScanLine className="w-3.5 h-3.5" /> Scanner les cartons
          </Link>
        </div>
      )}

      {commande.historique?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Historique</h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {commande.historique.map((h) => (
              <div key={h.id} className="text-xs text-slate-600 flex flex-wrap gap-2">
                <span className="text-slate-400">{new Date(h.created_at).toLocaleString('fr-FR')}</span>
                <span>{STATUTS_BOUTIQUE[h.ancien_statut] || h.ancien_statut || '—'} → <span className="font-medium">{STATUTS_BOUTIQUE[h.nouveau_statut] || h.nouveau_statut}</span></span>
                <span className="text-slate-400">par {h.user_name || '—'}</span>
                {h.commentaire && <span className="text-slate-500 italic">{h.commentaire}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 flex-wrap">
        {s === 'envoyee' && (
          <button type="button" disabled={busy} onClick={() => onAction('ajuster', { ajustements }, 'Commande validée')} className="btn-primary text-sm flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Valider la commande
          </button>
        )}
        {s === 'ajustee' && (
          <button type="button" disabled={busy} onClick={() => onAction('preparer', {}, 'Préparation lancée')} className="btn-primary text-sm flex items-center gap-1.5">
            <Package className="w-4 h-4" /> Lancer la préparation
          </button>
        )}
        {s === 'en_preparation' && (
          <button type="button" disabled={busy} onClick={() => onAction('expedier', {}, 'Commande expédiée')} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50">
            <Truck className="w-4 h-4" /> Expédier (sortie des cartons scannés)
          </button>
        )}
        {['envoyee', 'ajustee', 'en_preparation'].includes(s) && (
          <button type="button" disabled={busy} onClick={() => onAction('annuler', {}, 'Commande annulée', true)} className="text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg text-sm flex items-center gap-1">
            <XCircle className="w-4 h-4" /> Annuler
          </button>
        )}
      </div>
    </div>
  );
}

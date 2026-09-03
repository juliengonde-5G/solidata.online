import { useState, useEffect, useCallback } from 'react';
import { History, Plus, Pencil, Trash2, X, AlertTriangle, PackageCheck } from 'lucide-react';
import api from '../../services/api';
import useConfirm from '../../hooks/useConfirm';
import { ErrorState, useToast } from '..';

/**
 * TourRepriseAdmin — corriger une tournée DÉJÀ TERMINÉE.
 *
 * Demande client (09/2026) : « rajouter la possibilité pour un administrateur
 * de modifier les données d'une tournée réalisée (volume déclaré et rajouter
 * des pesées) ».
 *
 * Pourquoi un panneau à part, et réservé à l'administrateur : sur une journée
 * close, ces chiffres ne sont plus de simples champs. Le poids a déjà été
 * réparti en tonnage par point et transformé en entrée de stock ; le volume
 * déclaré a déjà nourri l'apprentissage du moteur prédictif. Corriger, c'est
 * donc reprendre — et l'écran doit dire ce que la reprise refait, et ce
 * qu'elle ne refait pas (l'entrée de stock, qui se régularise par une écriture
 * datée depuis le module Stock).
 *
 * Deux principes portés par l'interface :
 *  • la PESÉE est horodatée par l'opérateur, pas par l'horloge du serveur —
 *    une pesée oubliée a eu lieu avant-hier à 16 h ;
 *  • le VOLUME d'une borne se corrige par PALIER (« un fond », « à moitié »…),
 *    le vocabulaire même du chauffeur, et jamais par deux nombres qui
 *    pourraient se contredire. Les paliers viennent du serveur.
 *
 * Props :
 *  - tourId    : id de la tournée (terminée)
 *  - tourDate  : date de la tournée, pour amorcer le champ d'horodatage
 *  - onChanged : () => Promise<void> — rafraîchit la fiche parente
 */

function fmtKg(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}

/** « 2026-08-28T16:00 » → « 28/08 à 16:00 ». Aucune conversion de fuseau : le
 *  serveur rend déjà l'heure de Paris, la retraiter la décalerait. */
function fmtHeureParis(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]} à ${m[4]}:${m[5]}` : iso;
}

const jourDe = (d) => (d ? String(d).slice(0, 10) : new Date().toISOString().slice(0, 10));

export default function TourRepriseAdmin({ tourId, tourDate, onChanged }) {
  const toast = useToast();
  const { confirm, ConfirmDialogElement } = useConfirm();

  const [bloc, setBloc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ouvert, setOuvert] = useState(false);

  const [edition, setEdition] = useState(null); // null | 'nouvelle' | id
  const [form, setForm] = useState({ weight_kg: '', tare_kg: '', is_intermediate: false, notes: '', recorded_at: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [pointEnCours, setPointEnCours] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/tours/${tourId}/reprise`);
      setBloc(res.data);
    } catch (err) {
      console.error('[TourRepriseAdmin] reprise :', err);
      setLoadError(err.response?.data?.error || 'Impossible de charger cette tournée pour reprise');
    } finally {
      setLoading(false);
    }
  }, [tourId]);

  useEffect(() => { if (ouvert) load(); }, [ouvert, load]);

  const ouvrirAjout = () => {
    setEdition('nouvelle');
    // La DATE est amorcée sur celle de la tournée — c'est un raccourci de
    // saisie, pas une donnée : l'heure reste à confirmer par l'opérateur, et
    // le serveur signale un horodatage qui sortirait de la journée.
    setForm({ weight_kg: '', tare_kg: '', is_intermediate: false, notes: '', recorded_at: `${jourDe(tourDate)}T12:00` });
    setFormError(null);
  };

  const ouvrirCorrection = (p) => {
    setEdition(p.id);
    setForm({
      weight_kg: p.weight_kg ?? '',
      tare_kg: p.tare_kg ?? '',
      is_intermediate: !!p.is_intermediate,
      notes: '',
      recorded_at: p.heure_paris || `${jourDe(tourDate)}T12:00`,
    });
    setFormError(null);
  };

  const fermer = () => { setEdition(null); setFormError(null); };

  /** Rend compte de ce que la correction a réellement entraîné. */
  const annoncerEffets = (d, base) => {
    const morceaux = [base];
    if (d?.total_pese_kg != null) morceaux.push(`Total pesé : ${fmtKg(d.total_pese_kg)}.`);
    if (d?.tonnage?.reconstruit) morceaux.push(`Tonnage reconstruit sur ${d.tonnage.points} point(s).`);
    if (d?.avertissement) morceaux.push(d.avertissement);
    toast.success(morceaux.join(' '));
  };

  const enregistrerPesee = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    const corps = {
      weight_kg: form.weight_kg,
      tare_kg: form.tare_kg === '' ? null : form.tare_kg,
      is_intermediate: form.is_intermediate,
      notes: form.notes.trim() || null,
      recorded_at: form.recorded_at,
    };
    try {
      const res = edition === 'nouvelle'
        ? await api.post(`/tours/${tourId}/reprise/pesees`, corps)
        : await api.put(`/tours/${tourId}/reprise/pesees/${edition}`, corps);
      annoncerEffets(res.data, edition === 'nouvelle' ? 'Pesée ajoutée.' : 'Pesée corrigée.');
      fermer();
      await load();
      await onChanged?.();
    } catch (err) {
      setFormError(err.response?.data?.error || "L'enregistrement de la pesée a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const supprimerPesee = async (p) => {
    const ok = await confirm({
      title: 'Supprimer cette pesée ?',
      message: `La pesée de ${fmtKg(p.weight_kg)} du ${fmtHeureParis(p.heure_paris)} sera retirée de la tournée. `
        + 'Le poids total et le tonnage par point seront recalculés sans elle. Cette suppression est définitive.',
      confirmLabel: 'Supprimer la pesée',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/tours/${tourId}/reprise/pesees/${p.id}`);
      annoncerEffets(res.data, 'Pesée supprimée.');
      await load();
      await onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'La suppression de la pesée a échoué.');
      load();
    }
  };

  const corrigerVolume = async (point, valeur) => {
    setPointEnCours(point.id);
    try {
      const corps = point.kind === 'association'
        ? { nb_sacs: valeur === '' ? null : valeur }
        : { palier: valeur === '' ? null : valeur };
      const res = await api.patch(`/tours/${tourId}/reprise/points/${point.kind}/${point.id}`, corps);
      annoncerEffets(res.data, 'Volume déclaré corrigé.');
      await load();
      await onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'La correction du volume a échoué.');
      load();
    } finally {
      setPointEnCours(null);
    }
  };

  // Repliée par défaut : la reprise est un acte délibéré, elle ne s'ouvre pas
  // toute seule sous les yeux de qui consulte simplement une fiche.
  if (!ouvert) {
    return (
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/50">
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 min-w-0">
            <History className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Reprise de la tournée (administrateur)
            </span>
          </span>
          <span className="text-[10px] text-amber-700 flex-shrink-0">Corriger pesées et volumes</span>
        </button>
      </div>
    );
  }

  const points = bloc?.points || [];
  const collectes = points.filter((p) => p.status === 'collected');
  const association = bloc?.tour?.association === true;
  const paliers = bloc?.paliers || [];
  const stock = bloc?.stock;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      {ConfirmDialogElement}

      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" />
          Reprise de la tournée (administrateur)
        </h3>
        <button type="button" onClick={() => setOuvert(false)} className="text-amber-700 hover:text-amber-900" aria-label="Replier">
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[11px] text-amber-900/80 mb-3 leading-relaxed">
        Cette journée est close : ses chiffres ont déjà produit le tonnage par point et l'entrée de stock.
        Une correction recalcule le poids de la tournée et <strong>reconstruit le tonnage</strong> ;
        elle ne touche <strong>jamais</strong> à l'entrée de stock, qui se régularise par une écriture
        datée depuis le module Stock. Chaque correction est journalisée.
      </p>

      {loading && !bloc && <p className="text-xs text-slate-500 italic">Chargement…</p>}
      {loadError && !bloc && <ErrorState variant="card" title="Reprise indisponible" message={loadError} onRetry={load} />}

      {bloc && (
        <>
          {/* ── Pesées ─────────────────────────────────────────────────── */}
          <div className="mb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Pesées au centre de tri
              </h4>
              <span className="text-xs text-slate-600">
                Total pesé : <strong className="tabular-nums">{fmtKg(bloc.total_pese_kg)}</strong>
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
              {bloc.pesees.length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-3 text-center">Aucune pesée sur cette tournée.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-1.5 px-2">Pesée le (heure de Paris)</th>
                      <th className="text-right py-1.5 px-2">Poids</th>
                      <th className="text-center py-1.5 px-2">Type</th>
                      <th className="text-right py-1.5 px-2 w-20"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloc.pesees.map((p) => (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 px-2 text-slate-600">{fmtHeureParis(p.heure_paris)}</td>
                        <td className="py-1.5 px-2 text-right font-semibold tabular-nums">{fmtKg(p.weight_kg)}</td>
                        <td className="py-1.5 px-2 text-center text-[10px] text-slate-500">
                          {p.is_intermediate ? 'intermédiaire' : 'finale'}
                        </td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">
                          <button type="button" onClick={() => ouvrirCorrection(p)} className="text-slate-400 hover:text-teal-600 mr-1.5" title="Corriger cette pesée">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => supprimerPesee(p)} className="text-slate-400 hover:text-red-600" title="Supprimer cette pesée">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {edition === null ? (
              <button type="button" onClick={ouvrirAjout} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800">
                <Plus className="w-3.5 h-3.5" /> Ajouter une pesée oubliée
              </button>
            ) : (
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Poids collecté (kg)</span>
                    <input
                      type="number" step="0.01" min="0" className="input-modern text-xs py-1"
                      value={form.weight_kg}
                      onChange={(e) => setForm((f) => ({ ...f, weight_kg: e.target.value }))}
                      autoFocus
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Tare (kg, facultatif)</span>
                    <input
                      type="number" step="0.01" min="0" className="input-modern text-xs py-1"
                      value={form.tare_kg}
                      onChange={(e) => setForm((f) => ({ ...f, tare_kg: e.target.value }))}
                    />
                  </label>
                  <label className="block col-span-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">
                      Date et heure de la pesée (heure de Paris)
                    </span>
                    <input
                      type="datetime-local" className="input-modern text-xs py-1"
                      value={form.recorded_at}
                      onChange={(e) => setForm((f) => ({ ...f, recorded_at: e.target.value }))}
                    />
                    <span className="text-[10px] text-slate-400">
                      L'heure du ticket de pesée, et non celle de la saisie.
                    </span>
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox" checked={form.is_intermediate}
                      onChange={(e) => setForm((f) => ({ ...f, is_intermediate: e.target.checked }))}
                    />
                    Pesée intermédiaire (chargement déposé en cours de journée)
                  </label>
                  <label className="block col-span-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Motif (facultatif)</span>
                    <input
                      type="text" maxLength={400} className="input-modern text-xs py-1"
                      value={form.notes} placeholder="Ex. ticket de pesée retrouvé"
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                </div>
                {formError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{formError}</p>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={enregistrerPesee} disabled={saving} className="btn-primary text-xs py-1 px-3 disabled:opacity-50">
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                  <button type="button" onClick={fermer} className="text-xs text-slate-500 hover:text-slate-700 px-2">Annuler</button>
                </div>
              </div>
            )}
          </div>

          {/* ── Volumes déclarés ───────────────────────────────────────── */}
          <div className="mb-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              {association ? 'Sacs déclarés par point' : 'Volume déclaré par borne'}
            </h4>
            {collectes.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Aucun point collecté : il n'y a pas de volume déclaré à corriger.
              </p>
            ) : (
              <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-1.5 px-2">Point</th>
                      <th className="text-left py-1.5 px-2">{association ? 'Sacs' : 'Remplissage'}</th>
                      <th className="text-right py-1.5 px-2">Kilos attribués</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectes.map((p) => (
                      <tr key={`${p.kind}-${p.id}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 px-2 text-slate-700">{p.nom || `Point ${p.point_id}`}</td>
                        <td className="py-1.5 px-2">
                          {association ? (
                            <input
                              // La clé porte la valeur du serveur : au
                              // rechargement, le champ se remonte sur ce que la
                              // base contient réellement. Sans cela, une saisie
                              // refusée resterait affichée comme si elle avait
                              // été enregistrée.
                              key={`sacs-${p.id}-${p.nb_sacs ?? 'nd'}`}
                              type="number" min="0" max={bloc.sacs?.max ?? 5000}
                              className="input-modern text-xs py-0.5 w-24"
                              defaultValue={p.nb_sacs ?? ''}
                              placeholder="non déclaré"
                              disabled={pointEnCours === p.id}
                              onBlur={(e) => {
                                const v = e.target.value;
                                const inchange = (v === '' && p.nb_sacs == null) || Number(v) === p.nb_sacs;
                                if (!inchange) corrigerVolume(p, v);
                              }}
                            />
                          ) : (
                            <select
                              className="input-modern text-xs py-0.5"
                              value={p.palier ?? ''}
                              disabled={pointEnCours === p.id}
                              onChange={(e) => corrigerVolume(p, e.target.value)}
                            >
                              <option value="">non déclaré</option>
                              {paliers.map((pal) => (
                                <option key={pal.code} value={pal.code}>
                                  {pal.libelle} ({pal.fill_percent} %)
                                </option>
                              ))}
                            </select>
                          )}
                          {/* Une correspondance approchée est DITE : sans
                              pourcentage stocké, le palier affiché est une
                              lecture, pas la déclaration d'origine. */}
                          {!association && p.palier && !p.palier_exact && (
                            <span className="ml-1.5 text-[10px] text-slate-400" title="Déclaration antérieure au relevé du pourcentage : palier approché">
                              approché
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{fmtKg(p.tonnage_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-1">
              {association
                ? 'Le nombre de sacs répartit le poids pesé entre les points : le corriger redistribue les kilos.'
                : 'Le camion est pesé au centre : le poids se partage à parts égales entre les bornes collectées. '
                  + 'Corriger un palier met à jour la déclaration et l\'apprentissage du moteur, sans changer cette répartition.'}
            </p>
          </div>

          {/* ── Entrée de stock : recensée, jamais réécrite ─────────────── */}
          {stock && (
            <div className={`rounded-lg border px-2.5 py-2 text-xs flex items-start gap-2 ${
              stock.disponible && stock.ecart_kg !== 0
                ? 'border-amber-300 bg-amber-100/60 text-amber-900'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
            >
              {stock.disponible && stock.ecart_kg !== 0
                ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                : <PackageCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-teal-600" />}
              <div>
                {!stock.disponible ? (
                  <span>Écart de stock non calculable ({stock.motif}).</span>
                ) : stock.ecart_kg === 0 ? (
                  <span>Entrée de stock à jour : {fmtKg(stock.entre_kg)} entrés pour {fmtKg(stock.pese_kg)} pesés.</span>
                ) : (
                  <>
                    <strong>{fmtKg(Math.abs(stock.ecart_kg))} à régulariser en stock</strong> —{' '}
                    {fmtKg(stock.entre_kg)} sont entrés à la clôture pour {fmtKg(stock.pese_kg)} désormais pesés.
                    <span className="block text-[11px] mt-0.5">
                      La reprise n'y touche pas : passez une écriture datée depuis le module Stock.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { Trash2, Lock, Unlock, Eye, EyeOff, MousePointerSquareDashed } from 'lucide-react';
import { CATEGORIES, COULEURS, categorieMeta, borner, TAILLE_MIN } from './constantes';

const champ = 'w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm '
  + 'focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500 disabled:bg-slate-50';
const etiquette = 'block text-xs font-medium text-slate-500 mb-1';

/**
 * PanneauProprietes — tout ce qui définit le bloc sélectionné.
 * Le caractère obligatoire/facultatif se change EN UN CLIC (bouton bascule) :
 * c'est l'arbitrage le plus fréquent quand on prépare une journée à effectif
 * réduit, il ne doit pas se cacher dans un formulaire.
 */
export default function PanneauProprietes({ bloc, lectureSeule, onModifier, onSupprimer }) {
  if (!bloc) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <MousePointerSquareDashed className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-slate-500">
          Sélectionnez un bloc du plan pour en voir et en modifier les propriétés.
        </p>
      </div>
    );
  }

  const meta = categorieMeta(bloc.categorie);
  const estPoste = bloc.categorie === 'poste';
  const couleur = bloc.proprietes?.couleur || meta.couleurDefaut;
  const maj = (champs) => onModifier(bloc.code, champs);

  // Un entier ou rien : une saisie vidée ne doit pas devenir 0 en silence.
  const entier = (valeur, defaut) => {
    if (valeur === '') return defaut;
    const n = parseInt(valeur, 10);
    return Number.isFinite(n) && n >= 0 ? n : defaut;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide font-semibold" style={{ color: couleur }}>
            {meta.libelle}
          </p>
          <h3 className="text-base font-semibold text-slate-800 truncate">{bloc.libelle}</h3>
          <p className="text-xs text-slate-400 font-mono">{bloc.code}</p>
        </div>
        {!lectureSeule && (
          <button
            type="button" onClick={() => onSupprimer(bloc.code)}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200
                       text-red-600 text-sm hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" /> Supprimer
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className={etiquette} htmlFor="chaine-libelle">Libellé affiché sur le plan</label>
          <input
            id="chaine-libelle" className={champ} value={bloc.libelle} maxLength={120}
            disabled={lectureSeule} onChange={(e) => maj({ libelle: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={etiquette} htmlFor="chaine-code">Code (identifiant du bloc)</label>
            <input
              id="chaine-code" className={`${champ} font-mono`} value={bloc.code} maxLength={40}
              disabled={lectureSeule}
              onChange={(e) => maj({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
            />
          </div>
          <div>
            <label className={etiquette} htmlFor="chaine-categorie">Nature du bloc</label>
            <select
              id="chaine-categorie" className={champ} value={bloc.categorie} disabled={lectureSeule}
              onChange={(e) => {
                const nouvelle = e.target.value;
                const porte = categorieMeta(nouvelle).porteEffectif;
                // Changer de nature remet les effectifs en cohérence : une zone
                // de dépose ne peut pas garder « 2 personnes » en mémoire.
                maj(porte
                  ? { categorie: nouvelle, effectif_min: Math.max(bloc.effectif_min, 0), effectif_max: Math.max(bloc.effectif_max, 1) }
                  : { categorie: nouvelle, effectif_min: 0, effectif_max: 0, obligatoire: false });
              }}
            >
              {CATEGORIES.map((c) => <option key={c.valeur} value={c.valeur}>{c.libelle}</option>)}
            </select>
          </div>
        </div>

        <p className="text-xs text-slate-400">{meta.description}</p>
      </div>

      {/* Obligatoire / facultatif — un clic, et le badge du plan change. */}
      <div className="p-4 space-y-3">
        <span className={etiquette}>Ce bloc est</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button" disabled={lectureSeule || !bloc.obligatoire}
            onClick={() => maj({ obligatoire: false })}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${
              !bloc.obligatoire ? 'border-amber-400 bg-amber-50 text-amber-800 font-medium'
                : 'border-slate-300 bg-white text-slate-600 hover:border-amber-300'}`}
          >
            <Unlock className="w-4 h-4" aria-hidden="true" /> Facultatif
          </button>
          <button
            type="button" disabled={lectureSeule || bloc.obligatoire}
            onClick={() => maj({ obligatoire: true })}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${
              bloc.obligatoire ? 'border-teal-500 bg-teal-50 text-teal-800 font-medium'
                : 'border-slate-300 bg-white text-slate-600 hover:border-teal-300'}`}
          >
            <Lock className="w-4 h-4" aria-hidden="true" /> Obligatoire
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Un bloc obligatoire est encadré d’un trait plein sur le plan, un bloc facultatif d’un pointillé.
        </p>

        <button
          type="button" disabled={lectureSeule}
          onClick={() => maj({ actif: bloc.actif === false })}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-teal-700 disabled:opacity-50"
        >
          {bloc.actif === false
            ? <><EyeOff className="w-4 h-4" aria-hidden="true" /> Bloc désactivé — le remettre en service</>
            : <><Eye className="w-4 h-4" aria-hidden="true" /> Bloc en service — le désactiver</>}
        </button>
        {bloc.actif === false && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
            Conservé sur le plan mais hors service : il ne compte pas dans l’effectif.
          </p>
        )}
      </div>

      {/* Capacité — seulement là où quelqu'un travaille. */}
      <div className="p-4">
        <span className={etiquette}>Capacité du poste</span>
        {estPoste ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1" htmlFor="chaine-min">
                Minimum de personnes
              </label>
              <input
                id="chaine-min" type="number" min={0} max={99} className={champ}
                value={bloc.effectif_min} disabled={lectureSeule}
                onChange={(e) => maj({ effectif_min: entier(e.target.value, 0) })}
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1" htmlFor="chaine-max">
                Maximum de personnes
              </label>
              <input
                id="chaine-max" type="number" min={0} max={99} className={champ}
                value={bloc.effectif_max} disabled={lectureSeule}
                onChange={(e) => maj({ effectif_max: entier(e.target.value, 0) })}
              />
            </div>
            {Number(bloc.effectif_min) > Number(bloc.effectif_max) && (
              <p className="col-span-2 text-xs text-red-600">
                Le minimum dépasse le maximum : le plan ne pourra pas être enregistré tel quel.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {meta.libelle} : aucun opérateur n’y est affecté, ce bloc ne compte pas dans l’effectif.
          </p>
        )}
      </div>

      <div className="p-4 space-y-3">
        <span className={etiquette}>Position et taille (en % du plan)</span>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['x', 'Gauche', bloc.x], ['y', 'Haut', bloc.y],
            ['largeur', 'Largeur', bloc.largeur], ['hauteur', 'Hauteur', bloc.hauteur],
          ].map(([cle, libelle, valeur]) => (
            <div key={cle}>
              <label className="block text-[11px] text-slate-500 mb-1" htmlFor={`chaine-${cle}`}>{libelle}</label>
              <input
                id={`chaine-${cle}`} type="number" step="0.5" min={0} max={100} className={champ}
                value={valeur ?? ''} disabled={lectureSeule}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  if (cle === 'x') maj({ x: borner(n, bloc.largeur) });
                  else if (cle === 'y') maj({ y: borner(n, bloc.hauteur) });
                  else if (cle === 'largeur') maj({ largeur: Math.max(TAILLE_MIN, Math.min(100 - bloc.x, n)) });
                  else maj({ hauteur: Math.max(TAILLE_MIN, Math.min(100 - bloc.y, n)) });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="p-4">
        <span className={etiquette}>Couleur du bloc</span>
        <div className="flex flex-wrap gap-2">
          {COULEURS.map((c) => (
            <button
              key={c.valeur} type="button" disabled={lectureSeule}
              title={c.libelle} aria-label={c.libelle} aria-pressed={couleur === c.valeur}
              onClick={() => maj({ proprietes: { ...(bloc.proprietes || {}), couleur: c.valeur } })}
              className={`w-7 h-7 rounded-lg border-2 disabled:opacity-50 ${
                couleur === c.valeur ? 'border-slate-800' : 'border-white shadow'}`}
              style={{ backgroundColor: c.valeur }}
            />
          ))}
        </div>
        {bloc.proprietes?.note_plan && (
          <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-2.5 py-2">
            Relevé du plan : {bloc.proprietes.note_plan}.
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { visuelGamme } from '../utils/etiquettes-visuels';

/**
 * Étiquette imprimée A4 — 2.57.0 (Étiquettes v2).
 *
 * Champ par champ, jamais un bloc unique : un carton neuf (v2) porte TOUJOURS
 * ses 5 dimensions (« Sans Genre » / « Sans Saison » s'impriment tels quels,
 * ce sont de vraies valeurs du référentiel depuis la 2.57.0 — plus de cas
 * « sans déclinaison » à traiter à part). Un carton ANCIEN réimprimé peut en
 * revanche porter un champ NULL (le stock historique importé ne connaissait
 * pas toujours le genre ou la saison) : ce champ est alors simplement OMIS —
 * un champ vide sur une étiquette se lit « donnée manquante », ce qui serait
 * faux ici (l'information n'a jamais existé, elle n'a pas disparu).
 */
export default function EtiquetteA4({ data }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!data?.code_barre || !svgRef.current) return;
    let cancelled = false;
    import('jsbarcode').then(({ default: JsBarcode }) => {
      if (cancelled || !svgRef.current) return;
      JsBarcode(svgRef.current, data.code_barre, {
        format: 'CODE128',
        height: 90,
        width: 2.2,
        displayValue: false, // le code lisible est imprimé séparément, en dessous (formeLisible v2 ou code brut)
        margin: 0,
      });
    });
    return () => { cancelled = true; };
  }, [data?.code_barre]);

  if (!data) return null;

  const dateLabel = data.date_fabrication
    ? new Date(data.date_fabrication).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  const gammeVisuel = data.gamme ? visuelGamme(data.gamme) : null;
  // Sous le code-barres : la forme segmentée (« 3-1-2A-02-2-00001F ») pour un
  // carton v2, le code brut pour un ancien format (formeLisible le renvoie
  // inchangé — voir codification-etiquettes.js). Repli sur code_barre si le
  // serveur n'a, pour une raison quelconque, pas renvoyé code_lisible.
  const codeLisible = data.code_lisible || data.code_barre;

  // Chaque champ déclinaison est indépendant : présent → imprimé (y compris
  // « Sans Genre »/« Sans Saison », qui sont de vraies valeurs) ; absent
  // (NULL, ancien stock) → la case n'existe simplement pas dans la grille.
  const declinaisons = [
    { label: 'Produit', valeur: data.produit },
    { label: 'Genre', valeur: data.genre },
    { label: 'Saison', valeur: data.saison },
  ].filter((d) => d.valeur != null && d.valeur !== '');

  return (
    <div id="etiquette-print-root" style={{ fontFamily: 'Arial, sans-serif', color: '#000' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '6mm',
        border: '2px solid #000',
        padding: '6mm',
        height: '270mm',
      }}>
        <div style={{
          fontSize: '52pt', fontWeight: 800, lineHeight: 1, alignSelf: 'start',
          ...(gammeVisuel ? {} : { gridColumn: '1 / -1' }),
        }}>
          {data.categorie_eco_org}
        </div>
        {gammeVisuel && (
          <div style={{
            alignSelf: 'start',
            textAlign: 'center',
            fontSize: '36pt',
            fontWeight: 800,
            color: '#fff',
            background: gammeVisuel.color,
            borderRadius: '6mm',
            padding: '6mm 4mm',
          }}>
            {data.gamme}
          </div>
        )}

        <div style={{ gridColumn: '1 / -1', borderTop: '2px solid #000', marginTop: '4mm' }} />

        {declinaisons.length > 0 && (
          <div style={{
            gridColumn: '1 / -1',
            display: 'grid',
            gridTemplateColumns: `repeat(${declinaisons.length}, 1fr)`,
            gap: '4mm',
            marginTop: '2mm',
          }}>
            {declinaisons.map((d) => (
              <div key={d.label}>
                <div style={{ fontSize: '14pt', color: '#444' }}>{d.label}</div>
                <div style={{ fontSize: '28pt', fontWeight: 700 }}>{d.valeur}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ gridColumn: '1 / -1', marginTop: declinaisons.length > 0 ? '4mm' : '2mm' }}>
          <div style={{ fontSize: '14pt', color: '#444' }}>Poids</div>
          <div style={{ fontSize: declinaisons.length > 0 ? '28pt' : '44pt', fontWeight: 700 }}>{data.poids_kg} kg</div>
        </div>

        <div style={{ gridColumn: '1 / -1', marginTop: '8mm', textAlign: 'center' }}>
          <svg ref={svgRef} />
          <div style={{ fontSize: '20pt', fontWeight: 700, letterSpacing: '0.08em', marginTop: '3mm', fontFamily: 'monospace' }}>
            {codeLisible}
          </div>
        </div>

        <div style={{ gridColumn: '1 / -1', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: '12pt', color: '#444' }}>
          <span>Date : {dateLabel}</span>
          <span>{data.poste_label || `Poste ${data.poste_etiquetage_id ?? 1}`}</span>
          {data.nb_impressions > 1 && <span>Impression n° {data.nb_impressions}</span>}
        </div>
      </div>
    </div>
  );
}

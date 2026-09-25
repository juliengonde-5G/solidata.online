import { useEffect, useRef } from 'react';
import { visuelGamme } from '../utils/etiquettes-visuels';
import {
  referenceCourte, dateEtiquette, heureEtiquette, couleurSaison, taillePoliceProduit,
} from '../utils/etiquette-champs';

/**
 * Étiquette carton — A4 PAYSAGE, modèle 2.59.0 (croquis client du 25/09/2026).
 *
 *   ┌──────────────────────────────────────────┬───────────────┐
 *   │ PRODUIT (catégorie éco-organisme)        │ GAMME         │ ← contour à la couleur de la gamme
 *   ├──────────────────────────────────────────┼───────────────┤
 *   │ GENRE                                    │ Date étiquette│
 *   ├──────┬───────────────────────────────────┼───────────────┤
 *   │ ●    │ SAISON        (Jaune = Été …)     │ Heure         │
 *   │coul. │                                   │ Poids         │
 *   ├──────┴───────────────────────────────────┼───────────────┤
 *   │ Code-barres + code lisible               │ Code vérif    │ ← référence courte du carton
 *   └──────────────────────────────────────────┴───────────────┘
 *
 * ENCRE : tout est noir sur blanc sauf deux signes — le CONTOUR de la case
 * Gamme (fond très pâle) et la PASTILLE de saison. Pas d'aplat.
 *
 * Un carton ancien réimprimé peut ne pas connaître son genre ou sa saison : la
 * case reste alors VIDE avec la mention « non renseigné » en petit — la case
 * ne peut pas disparaître sans casser la grille, et une case vide sans mention
 * se lirait « oubli à l'impression ».
 */

const BORD = '0.6mm solid #000';

function Case({ titre, children, style }) {
  return (
    <div style={{ border: BORD, padding: '3mm 4mm', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', ...style }}>
      {titre && <div style={{ fontSize: '10pt', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#333' }}>{titre}</div>}
      {children}
    </div>
  );
}

function Manquant() {
  return <div style={{ fontSize: '14pt', color: '#666', fontStyle: 'italic', marginTop: 'auto' }}>non renseigné</div>;
}

export default function EtiquetteA4({ data }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!data?.code_barre || !svgRef.current) return;
    let cancelled = false;
    import('jsbarcode').then(({ default: JsBarcode }) => {
      if (cancelled || !svgRef.current) return;
      JsBarcode(svgRef.current, data.code_barre, {
        format: 'CODE128',
        height: 110,
        width: 2.6,
        displayValue: false, // code lisible imprimé séparément, en dessous
        margin: 0,
      });
    });
    return () => { cancelled = true; };
  }, [data?.code_barre]);

  if (!data) return null;

  const gamme = data.gamme ? visuelGamme(data.gamme) : null;
  const pastille = couleurSaison(data.saison);
  const codeLisible = data.code_lisible || data.code_barre;
  const reference = referenceCourte(data.code_barre);

  return (
    <div id="etiquette-print-root" style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#000', background: '#fff' }}>
      <div
        data-testid="etiquette-a4"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 72mm',
          gridTemplateRows: '50mm 34mm 38mm 58mm',
          gap: '2.5mm',
          width: '277mm',
          height: '190mm',
          boxSizing: 'border-box',
        }}
      >
        {/* 1. Produit | Gamme */}
        <Case titre="Produit">
          <div data-champ="produit" style={{ fontSize: `${taillePoliceProduit(data.produit)}pt`, fontWeight: 800, lineHeight: 1.05, marginTop: 'auto' }}>
            {data.produit || '—'}
          </div>
          {data.categorie_eco_org && (
            <div data-champ="categorie" style={{ fontSize: '13pt', marginTop: '1.5mm' }}>{data.categorie_eco_org}</div>
          )}
        </Case>
        <Case
          titre="Gamme"
          style={gamme
            ? { border: `2.2mm solid ${gamme.color}`, background: gamme.bg, alignItems: 'center' }
            : { alignItems: 'center' }}
        >
          <div data-champ="gamme" style={{ fontSize: String(data.gamme || '').length > 6 ? '26pt' : '44pt', fontWeight: 800, margin: 'auto 0', color: gamme ? gamme.color : '#000' }}>
            {data.gamme || '—'}
          </div>
        </Case>

        {/* 2. Genre | Date étiquette */}
        <Case titre="Genre">
          {data.genre
            ? <div data-champ="genre" style={{ fontSize: '36pt', fontWeight: 700, marginTop: 'auto', lineHeight: 1.05 }}>{data.genre}</div>
            : <Manquant />}
        </Case>
        <Case titre="Date étiquette">
          <div data-champ="date" style={{ fontSize: '26pt', fontWeight: 700, marginTop: 'auto' }}>{dateEtiquette(data.date_fabrication) || '—'}</div>
        </Case>

        {/* 3. Couleur + Saison | Heure + Poids */}
        <div style={{ display: 'grid', gridTemplateColumns: '38mm 1fr', gap: '2.5mm', minWidth: 0 }}>
          <Case titre="Couleur" style={{ alignItems: 'center' }}>
            {pastille ? (
              <div
                data-champ="pastille"
                title={pastille.nom}
                style={{ width: '20mm', height: '20mm', borderRadius: '50%', background: pastille.fond, border: '0.6mm solid #000', margin: 'auto 0' }}
              />
            ) : (
              <div style={{ fontSize: '11pt', color: '#444', margin: 'auto 0', textAlign: 'center' }}>aucune</div>
            )}
          </Case>
          <Case titre="Saison">
            {data.saison
              ? <div data-champ="saison" style={{ fontSize: '36pt', fontWeight: 700, marginTop: 'auto' }}>{data.saison}</div>
              : <Manquant />}
            <div style={{ fontSize: '9pt', color: '#444', marginTop: '1mm' }}>Jaune = Été · Bleu = Hiver</div>
          </Case>
        </div>
        <div style={{ display: 'grid', gridTemplateRows: '13mm 1fr', gap: '2.5mm', minWidth: 0 }}>
          <div style={{ border: BORD, padding: '1mm 4mm', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10pt', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#333' }}>Heure</span>
            <span data-champ="heure" style={{ fontSize: '20pt', fontWeight: 700 }}>{heureEtiquette(data.date_fabrication) || '—'}</span>
          </div>
          <Case titre="Poids">
            <div data-champ="poids" style={{ fontSize: '32pt', fontWeight: 800, marginTop: 'auto' }}>
              {data.poids_kg != null ? `${String(data.poids_kg).replace('.', ',')} kg` : '—'}
            </div>
          </Case>
        </div>

        {/* 4. Code-barres | Code vérif */}
        <Case titre="Code-barres" style={{ alignItems: 'center' }}>
          <svg ref={svgRef} style={{ marginTop: 'auto', maxWidth: '100%' }} />
          <div data-champ="code-lisible" style={{ fontSize: '16pt', fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'monospace', marginTop: '2mm' }}>
            {codeLisible}
          </div>
        </Case>
        <Case titre="Code vérif" style={{ alignItems: 'center' }}>
          <div data-champ="code-verif" style={{ fontSize: reference.length > 8 ? '20pt' : '36pt', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.06em', margin: 'auto 0' }}>
            {reference || '—'}
          </div>
          {data.nb_impressions > 1 && (
            <div style={{ fontSize: '10pt', color: '#444' }}>Réimpression n° {data.nb_impressions}</div>
          )}
        </Case>
      </div>
    </div>
  );
}

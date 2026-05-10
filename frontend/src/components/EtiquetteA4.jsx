import { useEffect, useRef } from 'react';

const GAMME_COLORS = {
  'BTQ STAND': '#16a34a',
  'BTQ EXTRA': '#7c3aed',
  'VAK': '#2563eb',
  'CHIF': '#64748b',
  'Pvak': '#0891b2',
  'A': '#16a34a',
  'B': '#7c3aed',
  'C': '#64748b',
};

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
        width: 2.4,
        displayValue: true,
        fontSize: 24,
        margin: 0,
        textMargin: 8,
      });
    });
    return () => { cancelled = true; };
  }, [data?.code_barre]);

  if (!data) return null;

  const dateLabel = data.date_fabrication
    ? new Date(data.date_fabrication).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

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
        <div style={{ fontSize: '52pt', fontWeight: 800, lineHeight: 1, alignSelf: 'start' }}>
          {data.categorie_eco_org}
        </div>
        <div style={{
          alignSelf: 'start',
          textAlign: 'center',
          fontSize: '36pt',
          fontWeight: 800,
          color: '#fff',
          background: GAMME_COLORS[data.gamme] || '#1f2937',
          borderRadius: '6mm',
          padding: '6mm 4mm',
        }}>
          {data.gamme}
        </div>

        <div style={{ gridColumn: '1 / -1', borderTop: '2px solid #000', marginTop: '4mm' }} />

        <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4mm', marginTop: '2mm' }}>
          <div>
            <div style={{ fontSize: '14pt', color: '#444' }}>Produit</div>
            <div style={{ fontSize: '28pt', fontWeight: 700 }}>{data.produit}</div>
          </div>
          <div>
            <div style={{ fontSize: '14pt', color: '#444' }}>Genre</div>
            <div style={{ fontSize: '28pt', fontWeight: 700 }}>{data.genre}</div>
          </div>
          <div>
            <div style={{ fontSize: '14pt', color: '#444' }}>Saison</div>
            <div style={{ fontSize: '28pt', fontWeight: 700 }}>{data.saison}</div>
          </div>
          <div>
            <div style={{ fontSize: '14pt', color: '#444' }}>Poids</div>
            <div style={{ fontSize: '28pt', fontWeight: 700 }}>{data.poids_kg} kg</div>
          </div>
        </div>

        <div style={{ gridColumn: '1 / -1', marginTop: '8mm', textAlign: 'center' }}>
          <div style={{ fontSize: '20pt', color: '#444', marginBottom: '2mm' }}>Identifiant</div>
          <div style={{ fontSize: '64pt', fontWeight: 800, letterSpacing: '0.05em' }}>{data.code_barre}</div>
        </div>

        <div style={{ gridColumn: '1 / -1', marginTop: '6mm', textAlign: 'center' }}>
          <svg ref={svgRef} />
        </div>

        <div style={{ gridColumn: '1 / -1', marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: '12pt', color: '#444' }}>
          <span>Date : {dateLabel}</span>
          <span>{data.poste_label || `Poste ${data.poste_etiquetage_id ?? 1}`}</span>
        </div>
      </div>
    </div>
  );
}

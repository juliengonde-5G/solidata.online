/**
 * Bordereau de collecte des ESS sur les zones de réemploi (Métropole Rouen Normandie).
 *
 * Reproduction fidèle du formulaire papier remis par la Métropole : mêmes blocs,
 * mêmes cases, même ordre. SOLIDATA ne remplit QUE ce que la doctrine client prévoit :
 *   - la date de l'enlèvement ;
 *   - la case de la déchèterie concernée (bloc « Déchetterie ») ;
 *   - la case « Solidarité Textile » figée (bloc « ESS collectrice ») ;
 *   - le seul champ « TLC … en kg (estimation) » du bloc « Objets collectés (en kg) »,
 *     avec le poids INDICATIF saisi par le chauffeur ;
 *   - les deux signatures (agent de déchèterie, chauffeur de l'ESS) ;
 *   - la ligne de validation dans « Remarque(s) » une fois le manager passé.
 * Les blocs « en nombre » et « en caisses » restent vides : Solidarité Textiles ne
 * collecte que du TLC sur ces zones.
 *
 * Module PUR : aucune E/S, aucune base — reçoit des données, rend un Buffer PDF.
 * Les signatures arrivent en PNG (Buffer) ; une signature absente est NOMMÉE dans
 * sa case (« non recueillie »), jamais remplacée par un trait.
 */

'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/** Les 7 déchèteries du formulaire de la Métropole, dans l'ordre du document. */
const DECHETERIES_METROPOLE = Object.freeze([
  { code: 'cleon', libelle: 'Cléon' },
  { code: 'boos', libelle: 'Boos' },
  { code: 'caudebec_les_elbeuf', libelle: 'Caudebec-lès-Elbeuf' },
  { code: 'deville_les_rouen', libelle: 'Déville-lès-Rouen' },
  { code: 'petit_quevilly', libelle: 'Petit-Quevilly' },
  { code: 'le_trait', libelle: 'Le Trait' },
  { code: 'saint_etienne_du_rouvray', libelle: 'Saint-Étienne-du-Rouvray' },
]);

/** Les 8 ESS collectrices du formulaire, dans l'ordre du document. */
const ESS_COLLECTRICES = Object.freeze([
  'Atelier Autonome', 'Kintsu Jouets', 'Cicérone', 'La Marcotte',
  'Emmaüs', 'Résistes', 'Envie ERG', 'Solidarité Textile',
]);

/** La case figée : c'est toujours Solidarité Textiles qui collecte. */
const ESS_SOLIDATA = 'Solidarité Textile';

const OBJETS_EN_NOMBRE = ['DEA (mobilier)', 'Gros électroménagers', 'Petits électroménagers', 'Cycles'];
const OBJETS_EN_CAISSES = ['Jeux Jouets', 'Vaisselle', 'Décoration', 'Bricolage et Jardinage', 'Bois', 'Multimédia (livres, cd)'];

/** Logo officiel si fourni par le client (backend/assets/logo-metropole-rouen.png) ; sinon texte. */
const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'logo-metropole-rouen.png');

const INK = '#111827';
const GRID = '#374151';
const MUTED = '#6b7280';

function estDecheterieConnue(code) {
  return DECHETERIES_METROPOLE.some((d) => d.code === code);
}

function libelleDecheterie(code) {
  const d = DECHETERIES_METROPOLE.find((x) => x.code === code);
  return d ? d.libelle : null;
}

/** Date « JJ/MM/AAAA » en heure de Paris ; chaîne vide si absente ou illisible. */
function formatDateParis(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

function formatDateHeureParis(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d).replace(' ', ' à ');
}

/** Poids affiché : entier si entier, sinon 1 décimale, virgule française. */
function formatKg(kg) {
  if (kg === null || kg === undefined || kg === '') return null;
  const n = Number(kg);
  if (!Number.isFinite(n) || n < 0) return null;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return s.replace('.', ',');
}

/** La mention de validation ajoutée au bloc Remarque(s) (texte figé par le client). */
function mentionValidation(dateValidation) {
  return `Validé par Solidarité textiles sur Solidata le ${formatDateParis(dateValidation)}`;
}

/**
 * Texte complet du bloc Remarque(s) : remarques éventuelles du chauffeur/manager,
 * puis la ligne de validation si le bordereau est validé.
 */
function composerRemarques({ remarques, validation, decheterieHorsListe }) {
  const lignes = [];
  if (decheterieHorsListe) lignes.push(`Déchèterie : ${decheterieHorsListe}`);
  if (remarques && String(remarques).trim()) lignes.push(String(remarques).trim());
  if (validation && validation.date) lignes.push(mentionValidation(validation.date));
  return lignes;
}

/** Motifs d'absence de signature, liste FERMÉE (arbitrage client 06/09/2026). */
const MOTIFS_SIGNATURE_ABSENTE = Object.freeze({
  agent_indisponible: "Signature de l'agent non recueillie : agent indisponible",
  anonymisation: 'Signature retirée (anonymisation du salarié)',
});

function libelleSignatureAbsente(motif) {
  if (!motif) return null;
  return MOTIFS_SIGNATURE_ABSENTE[motif] || 'Signature non recueillie';
}

function estPngValide(buf) {
  return Buffer.isBuffer(buf) && buf.length > 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/* ---------------------------------------------------------------------------
 * Primitives de dessin
 * ------------------------------------------------------------------------- */

function cadre(doc, x, y, w, h) {
  doc.save().lineWidth(0.8).strokeColor(GRID).rect(x, y, w, h).stroke().restore();
}

function ligneV(doc, x, y1, y2) {
  doc.save().lineWidth(0.8).strokeColor(GRID).moveTo(x, y1).lineTo(x, y2).stroke().restore();
}

function ligneH(doc, x1, x2, y) {
  doc.save().lineWidth(0.8).strokeColor(GRID).moveTo(x1, y).lineTo(x2, y).stroke().restore();
}

/** Case à cocher 8 × 8 pt ; cochée = croix nette (pas de police de symboles). */
function caseACocher(doc, x, y, cochee, libelle, opts = {}) {
  const taille = 8;
  doc.save().lineWidth(0.8).strokeColor(INK).rect(x, y, taille, taille).stroke();
  if (cochee) {
    doc.lineWidth(1.4)
      .moveTo(x + 1.5, y + 1.5).lineTo(x + taille - 1.5, y + taille - 1.5).stroke()
      .moveTo(x + taille - 1.5, y + 1.5).lineTo(x + 1.5, y + taille - 1.5).stroke();
  }
  doc.restore();
  doc.font(cochee ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.fontSize || 9).fillColor(INK)
    .text(libelle, x + taille + 5, y - 1, { lineBreak: false });
}

function pointilles(doc, x1, x2, y) {
  doc.save().lineWidth(0.6).strokeColor(MUTED).dash(1, { space: 2 })
    .moveTo(x1, y).lineTo(x2, y).stroke().undash().restore();
}

/* ---------------------------------------------------------------------------
 * Rendu du bordereau
 * ------------------------------------------------------------------------- */

/**
 * @param {object} data
 * @param {Date|string} data.date_enlevement
 * @param {string|null} data.decheterie_code   code parmi DECHETERIES_METROPOLE, ou null
 * @param {string|null} data.decheterie_libelle_libre  nom écrit en clair si hors liste
 * @param {number|null} data.tlc_kg            poids INDICATIF déclaré par le chauffeur
 * @param {Buffer|null} data.signature_agent    PNG
 * @param {string|null} data.signature_agent_absente_motif  clé de MOTIFS_SIGNATURE_ABSENTE
 * @param {Buffer|null} data.signature_chauffeur PNG
 * @param {string|null} data.signature_chauffeur_absente_motif
 * @param {string|null} data.remarques
 * @param {{date: Date|string}|null} data.validation  présent = bordereau validé
 * @param {object} [data.meta]  { numero, tour_id, vehicule, cav_nom, genere_le }
 * @returns {Promise<Buffer>}
 */
function genererBordereauPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: 30,
      info: {
        Title: 'Bordereau de collecte des ESS sur les zones de réemploi',
        Author: 'Solidarité Textiles — SOLIDATA',
        Subject: data.meta && data.meta.numero ? `Bordereau ${data.meta.numero}` : 'Bordereau déchèterie',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      dessiner(doc, data);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function dessiner(doc, data) {
  const X = 30;
  const W = doc.page.width - 60; // 781.89
  let y = 40;

  const horsListe = data.decheterie_code && !estDecheterieConnue(data.decheterie_code)
    ? (data.decheterie_libelle_libre || data.decheterie_code)
    : (!data.decheterie_code && data.decheterie_libelle_libre ? data.decheterie_libelle_libre : null);

  /* ---- En-tête ---- */
  const hEntete = 52;
  const wDate = 200;
  const wLogo = 70;
  cadre(doc, X, y, W, hEntete);
  ligneV(doc, X + W - wDate, y, y + hEntete);
  // Logo (officiel si fourni, sinon texte)
  let logoOk = false;
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, X + 8, y + 6, { fit: [wLogo - 12, hEntete - 12] }); logoOk = true; } catch (_) { logoOk = false; }
  }
  if (!logoOk) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED)
      .text('MÉTROPOLE\nROUEN\nNORMANDIE', X + 6, y + 13, { width: wLogo - 8, align: 'center', lineGap: 1 });
  }
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(INK)
    .text('BORDEREAU DE COLLECTE DES ESS SUR LES ZONES DE REEMPLOI',
      X + wLogo, y + 19, { width: W - wDate - wLogo, align: 'center', lineBreak: false });
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text("Date de l'enlèvement le :", X + W - wDate, y + 9, { width: wDate, align: 'center' });
  const dateStr = formatDateParis(data.date_enlevement);
  doc.font('Helvetica-Bold').fontSize(12)
    .text(dateStr || '      /      /      ', X + W - wDate, y + 26, { width: wDate, align: 'center' });
  y += hEntete + 8;

  /* ---- Bloc Déchetterie ---- */
  const wLabel = 130;
  const hBloc = 46;
  cadre(doc, X, y, W, hBloc);
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text('Déchetterie :', X + 8, y + 18, { width: wLabel - 8, align: 'center' });
  {
    const colW = (W - wLabel) / 4;
    DECHETERIES_METROPOLE.forEach((d, i) => {
      const col = Math.floor(i / 2);
      const row = i % 2;
      const cx = X + wLabel + col * colW + 8;
      const cy = y + 10 + row * 19;
      caseACocher(doc, cx, cy, data.decheterie_code === d.code, d.libelle);
    });
  }
  y += hBloc + 8;

  /* ---- Bloc ESS collectrice ---- */
  cadre(doc, X, y, W, hBloc);
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text('ESS collectrice :', X + 8, y + 18, { width: wLabel - 8, align: 'center' });
  {
    const colW = (W - wLabel) / 4;
    ESS_COLLECTRICES.forEach((nom, i) => {
      const col = Math.floor(i / 2);
      const row = i % 2;
      const cx = X + wLabel + col * colW + 8;
      const cy = y + 10 + row * 19;
      caseACocher(doc, cx, cy, nom === ESS_SOLIDATA, nom);
    });
  }
  y += hBloc + 8;

  /* ---- Bloc Objets ---- */
  const hObjets = 150;
  const wNombre = Math.round(W * 0.36);
  const wCaisses = Math.round(W * 0.38);
  const wKg = W - wNombre - wCaisses;
  cadre(doc, X, y, W, hObjets);
  ligneV(doc, X + wNombre, y, y + hObjets);
  ligneV(doc, X + wNombre + wCaisses, y, y + hObjets);

  // Colonne « en nombre » — laissée vide
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text('Object(s) collecté(s) en nombre :', X, y + 10, { width: wNombre, align: 'center' });
  OBJETS_EN_NOMBRE.forEach((lib, i) => {
    const cy = y + 36 + i * 17;
    caseACocher(doc, X + 12, cy, false, lib);
    pointilles(doc, X + wNombre - 95, X + wNombre - 42, cy + 7);
    doc.font('Helvetica').fontSize(9).fillColor(INK).text('En Nb', X + wNombre - 38, cy - 1, { lineBreak: false });
  });

  // Colonne « en caisses » — laissée vide
  const xC = X + wNombre;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text('Objets collectés en caisses :', xC, y + 10, { width: wCaisses, align: 'center' });
  OBJETS_EN_CAISSES.forEach((lib, i) => {
    const cy = y + 36 + i * 17;
    caseACocher(doc, xC + 12, cy, false, lib);
    pointilles(doc, xC + wCaisses - 110, xC + wCaisses - 52, cy + 7);
    doc.font('Helvetica').fontSize(9).fillColor(INK).text('caisse(s)', xC + wCaisses - 48, cy - 1, { lineBreak: false });
  });

  // Colonne « en kg » — LE champ renseigné
  const xK = X + wNombre + wCaisses;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text('Objets collectés (en kg)', xK, y + 10, { width: wKg, align: 'center' });
  const kg = formatKg(data.tlc_kg);
  {
    const cy = y + 36;
    caseACocher(doc, xK + 12, cy, kg !== null, 'TLC :');
    const xVal = xK + 12 + 8 + 5 + 30;
    if (kg !== null) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(kg, xVal, cy - 2, { width: 50, align: 'center', lineBreak: false });
      ligneH(doc, xVal, xVal + 50, cy + 9);
    } else {
      pointilles(doc, xVal, xVal + 50, cy + 7);
    }
    doc.font('Helvetica').fontSize(9).fillColor(INK).text('en kg (estimation)', xVal + 54, cy - 1, { lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED)
      .text('Poids indicatif déclaré par le chauffeur — ne vaut pas pesée.', xK + 12, cy + 22, { width: wKg - 24 });
  }
  y += hObjets;

  /* ---- Signatures ---- */
  const hSig = 96;
  const wSigAgent = Math.round(W * 0.55);
  cadre(doc, X, y, W, hSig);
  ligneV(doc, X + wSigAgent, y, y + hSig);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK)
    .text("Signature de l'agent de déchetterie :", X + 6, y + 6, { lineBreak: false })
    .text("Signature du chauffeur de l'ESS :", X + wSigAgent + 6, y + 6, { lineBreak: false });
  placerSignature(doc, data.signature_agent, X + 6, y + 20, wSigAgent - 12, hSig - 26,
    libelleSignatureAbsente(data.signature_agent_absente_motif));
  placerSignature(doc, data.signature_chauffeur, X + wSigAgent + 6, y + 20, W - wSigAgent - 12, hSig - 26,
    libelleSignatureAbsente(data.signature_chauffeur_absente_motif));
  y += hSig;

  /* ---- Remarques ---- */
  const hRem = 64;
  cadre(doc, X, y, W, hRem);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text('Remarque(s) :', X + 6, y + 6, { lineBreak: false });
  const lignes = composerRemarques({ remarques: data.remarques, validation: data.validation, decheterieHorsListe: horsListe });
  doc.font('Helvetica').fontSize(9).fillColor(INK)
    .text(lignes.join('\n'), X + 6, y + 20, { width: W - 12, height: hRem - 24, ellipsis: true });
  y += hRem;

  /* ---- Pied de page discret (traçabilité SOLIDATA) ---- */
  const meta = data.meta || {};
  const parts = [];
  if (meta.numero) parts.push(`Bordereau ${meta.numero}`);
  if (meta.tour_id) parts.push(`tournée #${meta.tour_id}`);
  if (meta.vehicule) parts.push(`véhicule ${meta.vehicule}`);
  if (meta.cav_nom) parts.push(`point : ${meta.cav_nom}`);
  const genere = formatDateHeureParis(meta.genere_le || new Date());
  const statut = data.validation && data.validation.date ? 'validé' : 'en attente de validation par Solidarité Textiles';
  doc.font('Helvetica').fontSize(7).fillColor(MUTED)
    .text(`${parts.join(' — ')}${parts.length ? ' — ' : ''}généré par SOLIDATA le ${genere} — ${statut}`,
      X, y + 8, { width: W, align: 'left' });
}

function placerSignature(doc, png, x, y, w, h, libelleAbsence) {
  if (estPngValide(png)) {
    try {
      doc.image(png, x, y, { fit: [w, h], align: 'center', valign: 'center' });
      return;
    } catch (_) { /* image illisible → nommée ci-dessous */ }
  }
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
    .text(libelleAbsence || 'Signature non recueillie', x, y + h / 2 - 5, { width: w, align: 'center' });
}

module.exports = {
  DECHETERIES_METROPOLE,
  ESS_COLLECTRICES,
  ESS_SOLIDATA,
  MOTIFS_SIGNATURE_ABSENTE,
  estDecheterieConnue,
  libelleDecheterie,
  libelleSignatureAbsente,
  estPngValide,
  formatDateParis,
  formatKg,
  mentionValidation,
  composerRemarques,
  genererBordereauPdf,
};

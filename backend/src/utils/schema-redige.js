/**
 * Résumé de schéma EXPURGÉ d'une réponse d'API.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * À QUOI ÇA SERT, ET POURQUOI L'EXPURGATION N'EST PAS UNE PRÉCAUTION DE STYLE
 *
 * Pour brancher un import de paie, il faut connaître les NOMS des champs que
 * l'API renvoie — pas leur contenu. Or ce contenu, ce sont les dossiers du
 * personnel : état civil, adresse, date de naissance, salaire. Une sonde qui
 * les imprimerait sur un terminal les ferait sortir du périmètre par la porte
 * la plus banale qui soit — un copier-coller dans un ticket, un journal, un
 * message. La sonde rend donc la FORME et jamais la valeur.
 *
 * TROIS CHOSES SONT RENDUES, ET CHACUNE EST SÛRE :
 *  1. le chemin du champ (`employees[].contractType`) — un nom de colonne ;
 *  2. son type, le nombre d'occurrences et de valeurs vides ;
 *  3. un MOTIF de format (`9999-99-99`, `aaaa@aa.aa`) : les chiffres deviennent
 *     9, les lettres a, la ponctuation est conservée. On apprend qu'une date
 *     est en ISO sans apprendre laquelle.
 *
 * LES VALEURS NE SORTENT QUE POUR LES ÉNUMÉRATIONS, et la règle se vérifie
 * d'elle-même : un champ n'est déclaré « énumération » que si ses valeurs se
 * RÉPÈTENT à travers les enregistrements. Un patronyme est unique par
 * personne — il ne se répète pas, il est donc expurgé sans qu'on ait eu besoin
 * de le reconnaître comme un patronyme. La liste de noms interdits qui suit
 * n'est que la seconde ceinture, pour les petits échantillons.
 */

/** Champs dont la valeur ne sort JAMAIS, même si elle se répète. */
const NOMS_INTERDITS = /(nom|name|prenom|first|last|mail|phone|tel|mobile|adress|address|street|rue|zip|postal|code_?postal|birth|naissance|nir|ssn|secu|social|iban|bic|rib|bank|banque|numero|number|passport|permit|sejour|salair|salary|wage|remuner|montant|amount|matricule|identif|token|secret|password|\bid\b)/i;

/** Nombre minimal d'enregistrements avant d'oser parler d'énumération. */
const MIN_ENREGISTREMENTS = 5;
/** Au-delà, ce n'est plus une énumération mais une liste de données. */
const MAX_DISTINCTES = 8;
/** Une « valeur d'énumération » est courte par nature. */
const MAX_LONGUEUR = 40;
/** Bornes de parcours : une charge d'API ne doit pas pouvoir faire tourner la sonde en rond. */
const MAX_PROFONDEUR = 6;
const MAX_CHEMINS = 400;

/** Motif de format : chiffres → 9, lettres → a, le reste conservé. */
function motif(valeur) {
  return String(valeur)
    .slice(0, MAX_LONGUEUR)
    .replace(/[0-9]/g, '9')
    .replace(/[A-Za-zÀ-ÿ]/g, 'a');
}

function typeDe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function estVide(v) {
  return v === null || v === undefined || v === '';
}

/**
 * Parcourt un échantillon d'enregistrements et agrège, par chemin de champ,
 * ce qu'on a le droit d'en dire.
 * @param {Array<object>} enregistrements
 * @returns {Map<string, object>}
 */
function collecter(enregistrements, prefixe = '') {
  const champs = new Map();

  const visiter = (valeur, chemin, profondeur) => {
    if (profondeur > MAX_PROFONDEUR || champs.size >= MAX_CHEMINS) return;

    if (Array.isArray(valeur)) {
      const c = `${chemin}[]`;
      const f = champs.get(c) || { type: new Set(), n: 0, vides: 0, valeurs: new Set(), motifs: new Set(), longueurMax: 0 };
      f.type.add('array');
      f.n += 1;
      champs.set(c, f);
      // On n'inspecte que les premiers éléments : au-delà, on n'apprend plus
      // rien sur la FORME, on ne fait que lire des données.
      for (const el of valeur.slice(0, 20)) visiter(el, c, profondeur + 1);
      return;
    }

    if (valeur && typeof valeur === 'object') {
      for (const [k, v] of Object.entries(valeur)) {
        visiter(v, chemin ? `${chemin}.${k}` : k, profondeur + 1);
      }
      return;
    }

    const f = champs.get(chemin) || { type: new Set(), n: 0, vides: 0, valeurs: new Set(), motifs: new Set(), longueurMax: 0 };
    f.type.add(typeDe(valeur));
    f.n += 1;
    if (estVide(valeur)) { f.vides += 1; } else {
      const s = String(valeur);
      f.longueurMax = Math.max(f.longueurMax, s.length);
      if (f.valeurs.size <= MAX_DISTINCTES + 1) f.valeurs.add(s);
      if (f.motifs.size < 3) f.motifs.add(motif(s));
    }
    champs.set(chemin, f);
  };

  for (const e of enregistrements) visiter(e, prefixe, 0);
  return champs;
}

/** Décide, pour un champ, si ses valeurs peuvent sortir. */
function estEnumeration(chemin, f, nbEnregistrements) {
  const feuille = chemin.split('.').pop().replace(/\[\]$/, '');
  if (NOMS_INTERDITS.test(feuille)) return false;
  if (nbEnregistrements < MIN_ENREGISTREMENTS) return false;
  const distinctes = f.valeurs.size;
  if (distinctes === 0 || distinctes > MAX_DISTINCTES) return false;
  // La condition qui fait tout le travail : une valeur d'énumération se
  // RÉPÈTE. Un patronyme ne se répète pas — il tombe ici, sans qu'on ait eu
  // à deviner qu'il s'agissait d'un patronyme.
  if (distinctes >= f.n - f.vides) return false;
  if (f.longueurMax > MAX_LONGUEUR) return false;
  return true;
}

/**
 * Rend le résumé expurgé, prêt à être lu, collé dans un ticket et transmis.
 * @returns {{lignes: Array<object>, nb_enregistrements: number, texte: string}}
 */
function resumer(enregistrements, { prefixe = '' } = {}) {
  const liste = Array.isArray(enregistrements) ? enregistrements : [enregistrements];
  const champs = collecter(liste, prefixe);
  const lignes = [];

  for (const [chemin, f] of [...champs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const enumere = estEnumeration(chemin, f, liste.length);
    lignes.push({
      chemin,
      type: [...f.type].join('|'),
      n: f.n,
      vides: f.vides,
      valeurs: enumere ? [...f.valeurs].sort() : null,
      motifs: enumere ? null : [...f.motifs],
      expurge: !enumere && f.valeurs.size > 0,
    });
  }

  const largeur = Math.max(10, ...lignes.map((l) => l.chemin.length));
  const texte = lignes.map((l) => {
    const tete = `${l.chemin.padEnd(largeur)}  ${String(l.type).padEnd(16)} n=${String(l.n).padStart(4)} vides=${String(l.vides).padStart(4)}`;
    if (l.valeurs) return `${tete}  valeurs: ${l.valeurs.join(' | ')}`;
    if (l.motifs && l.motifs.length) return `${tete}  format: ${l.motifs.join(' | ')}`;
    return `${tete}  (toujours vide)`;
  }).join('\n');

  return { lignes, nb_enregistrements: liste.length, texte };
}

module.exports = { resumer, collecter, estEnumeration, motif, NOMS_INTERDITS, MIN_ENREGISTREMENTS, MAX_DISTINCTES };

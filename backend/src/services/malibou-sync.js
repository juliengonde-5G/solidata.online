/**
 * Synchronisation Malibou → SOLIDATA.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * CE QU'ELLE FAIT, ET CE QU'ELLE NE PEUT PAS FAIRE
 *
 * Elle COMPLÈTE l'import du classeur de paie, elle ne le remplace pas. La
 * spécification de l'API (v1.11.0) n'expose ni heures hebdomadaires
 * contractuelles, ni libellé de poste, et son énumération de contrats ignore
 * le CDDI — c'est-à-dire exactement ce dont dépendent le calcul des ETP
 * conventionnés et le périmètre d'insertion. Voir `malibou-mapping.js`.
 *
 * Ce qu'elle apporte : l'identité et les coordonnées tenues à jour en continu,
 * le statut d'emploi au jour le jour (une sortie se voit sans attendre
 * l'export mensuel), les dates de contrat, et surtout les ABSENCES.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * DEUX RÈGLES QU'ON NE TRANSGRESSE PAS
 *
 * 1. ELLE N'ÉCRIT QUE CE QU'ELLE A VU. Un salarié absent de la réponse n'est
 *    JAMAIS désactivé : l'API peut être filtrée par établissement, une page
 *    peut manquer, un scope peut avoir été retiré. Désactiver par omission
 *    ferait disparaître des personnes des effectifs sur un incident réseau.
 *
 * 2. ELLE NE SUPPRIME RIEN. Les écritures passent par `upsertCollaborators`,
 *    dont la fusion est non destructive (COALESCE) : ce que l'API ne porte pas
 *    — heures, poste, RQTH, titre de séjour — reste ce que le classeur a posé.
 *
 * Simulation par défaut : `{ appliquer: false }` lit tout, convertit tout,
 * rend le compte rendu, et n'écrit rien.
 */
const pool = require('../config/database');
const logger = require('../config/logger');
const malibou = require('./malibou');
const { upsertCollaborators } = require('./collaborator-import');
const {
  mapperCollaborateur, mapperAbsence, indexerMatricules,
} = require('./malibou-mapping');

/** Fenêtre d'absences lue par défaut : l'année civile en cours, large. */
const FENETRE_ABSENCES_JOURS = 400;

/** Jour ISO d'un décalage en jours par rapport à aujourd'hui, en UTC. */
function jourDecale(jours) {
  const d = new Date(Date.now() + jours * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Charge les collaborateurs, et leur fiche détaillée quand elle apporte
 * quelque chose.
 *
 * POURQUOI UN APPEL PAR SALARIÉ : le tableau des contrats — donc les dates de
 * FIN, dont dépendent les alertes de fin de CDDI et l'ETP prévisionnel — n'est
 * porté que par la fiche détaillée. La liste ne rend que le contrat COURANT,
 * sans son terme. Sur un effectif de l'ordre de la soixantaine, c'est une
 * soixantaine d'appels une fois par jour : la temporisation sur 429 du client
 * absorbe la limite de débit.
 *
 * Si le scope `org:contract:details:read` n'a pas été accordé, les fiches ne
 * portent pas de contrats : on ne les demande alors même pas, plutôt que de
 * collectionner des 403.
 */
async function chargerCollaborateurs({ avecContrats = true } = {}) {
  const bruts = await malibou.listerCollaborateurs();
  const index = indexerMatricules(bruts);
  const detailParId = new Map();
  const avertissements = [];

  if (avecContrats && bruts.length) {
    // Sonde : une seule fiche suffit à savoir si le scope est accordé.
    let scopeContrats = true;
    try {
      const premier = await malibou.lireCollaborateur(bruts[0].id);
      if (!Array.isArray(premier && premier.contracts)) {
        scopeContrats = false;
        avertissements.push(
          "Les contrats ne sont pas renvoyés : la clé n'a probablement pas la"
          + " permission « org:contract:details:read ». Les dates de FIN de contrat"
          + ' ne seront pas mises à jour (le classeur de paie reste la source).',
        );
      } else {
        detailParId.set(bruts[0].id, premier);
      }
    } catch (err) {
      scopeContrats = false;
      avertissements.push(`Fiche détaillée illisible (${err.message}) — dates de fin de contrat non synchronisées.`);
    }

    if (scopeContrats) {
      for (const c of bruts.slice(1)) {
        try {
          detailParId.set(c.id, await malibou.lireCollaborateur(c.id));
        } catch (err) {
          // Une fiche illisible ne fait pas échouer les soixante autres : elle
          // est NOMMÉE, et le salarié est tout de même mis à jour avec ce que
          // la liste portait.
          avertissements.push(`Fiche détaillée de ${c.personnelNumber || c.id} illisible : ${err.message}`);
        }
      }
    }
  }

  return { bruts, index, detailParId, avertissements };
}

/**
 * Synchronise les collaborateurs.
 * @returns {{lus, convertis, sans_matricule, crees, maj, erreurs, avertissements, applique}}
 */
async function synchroniserCollaborateurs({ appliquer = false, avecContrats = true } = {}) {
  const { bruts, index, detailParId, avertissements } = await chargerCollaborateurs({ avecContrats });

  const aEcrire = [];
  let sansMatricule = 0;
  for (const brut of bruts) {
    const detail = detailParId.get(brut.id);
    const converti = mapperCollaborateur(detail || brut, {
      matriculeParId: index,
      contrats: detail && Array.isArray(detail.contracts) ? detail.contracts : null,
    });
    if (!converti) continue;
    // Le matricule EST la clé de rapprochement de l'import de paie. Sans lui,
    // on ne saurait pas à qui rattacher la fiche — et l'apparier sur le nom
    // créerait des doublons au premier homonyme. On COMPTE ces cas au lieu de
    // les deviner, pour qu'ils soient corrigés dans Malibou.
    if (!converti.malibou_id) { sansMatricule += 1; continue; }
    aEcrire.push(converti);
  }

  if (!appliquer) {
    return {
      applique: false,
      lus: bruts.length,
      convertis: aEcrire.length,
      sans_matricule: sansMatricule,
      crees: 0, maj: 0, erreurs: [],
      avertissements,
      apercu: aEcrire.slice(0, 3).map((c) => ({ matricule: c.malibou_id, actif: c.is_active, contrat: c.contract_type })),
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await upsertCollaborators(client, aEcrire, { userId: null });
    await client.query('COMMIT');
    return {
      applique: true,
      lus: bruts.length,
      convertis: aEcrire.length,
      sans_matricule: sansMatricule,
      crees: res.created.length,
      maj: res.updated.length,
      erreurs: res.errors,
      avertissements: [...avertissements, ...(res.warnings || [])],
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Synchronise les absences sur une fenêtre.
 *
 * L'API désigne le salarié par son identifiant INTERNE ; `employee_leaves` est
 * rattachée à `employees.id`, lui-même rapproché par MATRICULE. Il faut donc
 * la liste des collaborateurs pour faire le pont — c'est pourquoi elle est
 * rechargée ici plutôt que supposée.
 */
async function synchroniserAbsences({ appliquer = false, debut = null, fin = null } = {}) {
  const startDate = debut || jourDecale(-FENETRE_ABSENCES_JOURS);
  const endDate = fin || jourDecale(FENETRE_ABSENCES_JOURS);

  const bruts = await malibou.listerCollaborateurs();
  const matriculeParId = indexerMatricules(bruts);

  const absencesBrutes = await malibou.listerAbsences({ startDate, endDate });
  const converties = [];
  const codesInconnus = new Set();
  let sansSalarie = 0;

  for (const a of absencesBrutes) {
    const abs = mapperAbsence(a);
    if (!abs) continue;
    if (!abs.type_connu) codesInconnus.add(abs.code_malibou || '(vide)');
    const matricule = matriculeParId.get(abs.collaborator_id_malibou);
    if (!matricule) { sansSalarie += 1; continue; }
    converties.push({ ...abs, matricule });
  }

  // Rapprochement matricule → identifiant SOLIDATA, en UNE requête.
  const matricules = [...new Set(converties.map((a) => a.matricule))];
  const idParMatricule = new Map();
  if (matricules.length) {
    const r = await pool.query('SELECT id, malibou_id FROM employees WHERE malibou_id = ANY($1)', [matricules]);
    for (const row of r.rows) idParMatricule.set(String(row.malibou_id), row.id);
  }

  const aEcrire = converties.filter((a) => idParMatricule.has(a.matricule));
  const inconnusEnBase = converties.length - aEcrire.length;

  const compte = {
    applique: false,
    periode: { debut: startDate, fin: endDate },
    lues: absencesBrutes.length,
    converties: converties.length,
    a_ecrire: aEcrire.length,
    sans_salarie_malibou: sansSalarie,
    salarie_absent_de_solidata: inconnusEnBase,
    codes_inconnus: [...codesInconnus],
    crees: 0, maj: 0,
    avertissements: [],
  };

  if (codesInconnus.size) {
    // Un code hors liste est compté comme une absence QUI DÉDUIT du réalisé
    // ETP. Le dire permet de le classer sciemment plutôt que de le subir.
    compte.avertissements.push(
      `${codesInconnus.size} type(s) d'absence propre(s) à l'organisation : ${[...codesInconnus].join(', ')}.`
      + ' Ils sont comptés comme des absences qui déduisent du réalisé ETP —'
      + ' à classer explicitement si certains sont en réalité des congés.',
    );
  }
  if (inconnusEnBase) {
    compte.avertissements.push(
      `${inconnusEnBase} absence(s) concernent un salarié absent de SOLIDATA`
      + " — lancer d'abord la synchronisation des collaborateurs, ou l'import du classeur.",
    );
  }

  if (!appliquer) return compte;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of aEcrire) {
      // Savepoint par absence : une ligne fautive (catégorie hors CHECK,
      // valeur trop longue) ne doit pas avorter la transaction et emporter
      // toutes les suivantes — c'est le défaut de cascade corrigé en 2.3.1.
      await client.query('SAVEPOINT abs_sp');
      try {
        const r = await client.query(
          `INSERT INTO employee_leaves
             (employee_id, leave_type, type_category, request_date, start_date, end_date,
              half_day_start, half_day_end, statut, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'malibou_api')
           ON CONFLICT (employee_id, leave_type, start_date) DO UPDATE SET
             type_category = EXCLUDED.type_category,
             request_date  = EXCLUDED.request_date,
             end_date      = EXCLUDED.end_date,
             half_day_start = EXCLUDED.half_day_start,
             half_day_end   = EXCLUDED.half_day_end,
             statut        = EXCLUDED.statut,
             source        = EXCLUDED.source,
             updated_at    = NOW()
           RETURNING (xmax = 0) AS creee`,
          [
            idParMatricule.get(a.matricule), a.leave_type, a.type_category, a.request_date,
            a.start_date, a.end_date, a.half_day_start, a.half_day_end, a.statut,
          ],
        );
        await client.query('RELEASE SAVEPOINT abs_sp');
        if (r.rows[0] && r.rows[0].creee) compte.crees += 1; else compte.maj += 1;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT abs_sp');
        compte.avertissements.push(`Absence ${a.absence_id_malibou} ignorée : ${err.message}`);
      }
    }
    await client.query('COMMIT');
    compte.applique = true;
    return compte;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Les deux synchronisations, dans l'ordre qui a du sens. */
async function synchroniserTout({ appliquer = false } = {}) {
  const debut = Date.now();
  // Les collaborateurs D'ABORD : une absence ne peut se rattacher qu'à un
  // salarié déjà connu de SOLIDATA.
  const collaborateurs = await synchroniserCollaborateurs({ appliquer });
  const absences = await synchroniserAbsences({ appliquer });
  const bilan = { applique: appliquer, duree_ms: Date.now() - debut, collaborateurs, absences };
  logger.info('[MALIBOU] synchronisation terminée', {
    applique: appliquer,
    collaborateurs: `${collaborateurs.crees} créé(s) / ${collaborateurs.maj} mis à jour`,
    absences: `${absences.crees} créée(s) / ${absences.maj} mise(s) à jour`,
  });
  return bilan;
}

module.exports = {
  FENETRE_ABSENCES_JOURS,
  jourDecale,
  chargerCollaborateurs,
  synchroniserCollaborateurs,
  synchroniserAbsences,
  synchroniserTout,
};

/* Interface kiosque du poste de pointage — SOLIDATA.
 *
 * Sans dependance : ni framework, ni bundler, ni police distante, ni requete
 * reseau sortante. L'agent local pousse tout par WebSocket ; l'interface
 * n'emet jamais rien (aucune interaction clavier ou souris n'est requise ni
 * possible — PST-10).
 *
 * Regles tenues ici :
 *  - AFF-01 : overlay prenom + initiale + sens + heure + pictogramme ;
 *  - duree d'overlay pilotee par le serveur, RE-PLAFONNEE A 8 s en dur
 *    ci-dessous (exigence juridique, troisieme verrou apres le serveur et
 *    l'agent), y compris pour la variante FESTIVE ;
 *  - AFF-02 : le cumul hebdomadaire ne s'affiche que si le message le porte ;
 *  - AFF-03 : information principale >= 48 px (le message du moment) ;
 *  - AFF-04 : deux sons distincts, synthetises (aucun fichier audio) ;
 *  - AFF-06 : fondus doux, aucun clignotement — les animations festives sont
 *    lentes (chute de ~7 s, soit ~0,14 Hz : tres en dessous du plafond de
 *    2 Hz) et ne touchent jamais l'opacite du texte ;
 *  - AFF-07 : la derniere playlist recue est rejouee, y compris hors ligne ;
 *  - PST-08 : bandeau discret « hors ligne — vos pointages sont enregistres » ;
 *  - jamais de photo, jamais de nom complet, jamais de statut.
 *
 * Ecran d'information v2 (CDC_AFFICHAGE_V2) :
 *  - overlay enrichi : message du moment (matin/pause/retour/soir), phrase de
 *    motivation generique, variante festive (anniversaire / anniversaire
 *    d'entreprise / premier jour) ;
 *  - playlist enrichie : annonces, actus, tournees, social, media, vak_live ;
 *  - meteo du lieu du poste et presse nationale (un ecran par article), toutes
 *    deux rapatriees COTE SERVEUR : le poste ne joint aucun domaine externe.
 *
 * Contrat de donnees des types dynamiques : le contenu est genere COTE
 * SERVEUR et transporte dans « corps » (JSON, comme le type historique
 * compte_a_rebours). Les formes consommees sont documentees devant chaque
 * moteur de rendu. Tout ce qui manque degrade proprement : un renderer qui
 * ne trouve pas ses donnees retombe sur le rendu texte, jamais sur un ecran
 * vide ou une icone cassee.
 */
'use strict';

(function () {

  /* ------------------------------------------------------------ constantes */

  var WS_URL = 'ws://127.0.0.1:8765';

  /** Plafond juridique de l'affichage nominatif : 8 s, quoi qu'annonce le serveur. */
  var OVERLAY_MAX_MS = 8000;
  var OVERLAY_MIN_MS = 3000;
  var OVERLAY_DEFAUT_MS = 5000;

  var DIAPO_DEFAUT_SEC = 12;
  var DIAPO_MIN_SEC = 3;
  var DIAPO_MAX_SEC = 120;

  var RECONNEXION_MIN_MS = 1000;
  var RECONNEXION_MAX_MS = 10000;

  /** Nombre de confettis de la variante festive (classes .conf-1 a .conf-12). */
  var CONFETTIS = 12;

  /** Longueur maximale d'une legende de publication sociale. */
  var LEGENDE_MAX = 180;

  /** Bornes d'un ecran de presse : au-dela, le texte n'est plus lisible a 3 m. */
  var TITRE_MAX = 140;
  var CHAPO_MAX = 260;

  var MESSAGES = {
    entree: 'Entrée enregistrée',
    sortie: 'Sortie enregistrée',
    inconnu: 'Pointage enregistré',
    badge_inconnu: 'Badge non reconnu — va voir ton encadrant',
    badge_illisible: 'Badge illisible — présente-le à nouveau',
    deja: 'Déjà enregistré',
    hors_ligne: 'Hors ligne — vos pointages sont enregistrés',
    lecteur: 'Lecteur de badge non détecté — préviens ton encadrant'
  };

  /** Pictogramme de chaque variante festive (aucune photo, jamais). */
  var PICTO_FESTIF = {
    premier_jour: '👋',
    anniversaire: '🎂',
    anniversaire_entreprise: '🎉'
  };

  var PICTO_ANNONCE = {
    anniversaire: '🎂',
    anniversaire_entreprise: '🎉',
    premier_jour: '👋'
  };

  var RESEAUX = { instagram: 'Instagram', facebook: 'Facebook' };

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ------------------------------------------------------------- elements */

  var elOverlay = document.getElementById('overlay');
  var elConfettis = document.getElementById('overlay-confettis');
  var elPicto = document.getElementById('overlay-picto');
  var elMoment = document.getElementById('overlay-moment');
  var elIdentite = document.getElementById('overlay-identite');
  var elSens = document.getElementById('overlay-sens');
  var elHeure = document.getElementById('overlay-heure');
  var elPhrase = document.getElementById('overlay-phrase');
  var elCumul = document.getElementById('overlay-cumul');

  var elHorloge = document.getElementById('horloge-heure');
  var elDate = document.getElementById('horloge-date');
  var elBandeau = document.getElementById('bandeau-hors-ligne');
  var elConsigne = document.getElementById('consigne');

  var diapos = [document.getElementById('diapo-a'), document.getElementById('diapo-b')];

  /* ----------------------------------------------------------------- etat */

  var overlayTimer = null;
  var playlist = [];
  var playlistIndex = 0;
  var playlistTimer = null;
  var diapoActive = 0;
  var socket = null;
  var reconnexionDelai = RECONNEXION_MIN_MS;
  var enLigne = true;
  var lecteurPresent = true;

  /* --------------------------------------------------------------- horloge */

  /**
   * Ecart entre l'horloge du NAVIGATEUR et celle du POSTE, en millisecondes.
   *
   * L'heure affichee doit etre celle que l'agent utilise pour horodater les
   * pointages (heure murale de Paris), pas celle du fuseau systeme de la
   * machine : sur une image Raspberry Pi OS restee en UTC, la veille affichait
   * 09:41 pendant que l'overlay de badgeage affichait 11:41. Deux heures
   * differentes sur le meme ecran, sur un dispositif dont les heures font foi.
   *
   * Repli tant qu'aucun etat n'est arrive : le fuseau du navigateur, c'est-a-dire
   * le comportement anterieur — jamais d'ecran sans horloge.
   */
  var decalageMs = -new Date().getTimezoneOffset() * 60000;

  function majHorloge() {
    // Les accesseurs UTC lisent les champs tels que le poste les a poses :
    // c'est ce qui rend l'affichage independant du fuseau du navigateur.
    var maintenant = new Date(Date.now() + decalageMs);
    elHorloge.textContent = deuxChiffres(maintenant.getUTCHours()) + ':' +
                            deuxChiffres(maintenant.getUTCMinutes());
    elDate.textContent = JOURS[maintenant.getUTCDay()] + ' ' + maintenant.getUTCDate() +
                         ' ' + MOIS[maintenant.getUTCMonth()];
  }

  /** Cale l'horloge sur celle du poste (« YYYY-MM-DDTHH:MM:SS », heure de Paris). */
  function calerHorloge(horlogeLocale) {
    if (!horlogeLocale) { return; }             // serveur anterieur : on garde le repli
    var instant = Date.parse(String(horlogeLocale) + 'Z');
    if (!isFinite(instant)) { return; }
    decalageMs = instant - Date.now();
    majHorloge();
  }

  function deuxChiffres(valeur) {
    return (valeur < 10 ? '0' : '') + valeur;
  }

  /* ----------------------------------------------------------------- audio */

  var audio = null;

  function contexteAudio() {
    if (audio === null) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audio = Ctx ? new Ctx() : false;
    }
    if (audio && audio.state === 'suspended') { audio.resume(); }
    return audio || null;
  }

  /** Note breve, enveloppe douce : pas de claquement dans les haut-parleurs. */
  function note(frequence, debutSec, dureeSec, forme, volume) {
    var ctx = contexteAudio();
    if (!ctx) { return; }

    var oscillateur = ctx.createOscillator();
    var gain = ctx.createGain();
    var depart = ctx.currentTime + debutSec;

    oscillateur.type = forme || 'sine';
    oscillateur.frequency.setValueAtTime(frequence, depart);

    gain.gain.setValueAtTime(0.0001, depart);
    gain.gain.exponentialRampToValueAtTime(volume || 0.25, depart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, depart + dureeSec);

    oscillateur.connect(gain);
    gain.connect(ctx.destination);
    oscillateur.start(depart);
    oscillateur.stop(depart + dureeSec + 0.03);
  }

  function sonSucces() {          // deux notes ascendantes, claires
    note(880, 0, 0.10, 'sine', 0.25);
    note(1318, 0.11, 0.16, 'sine', 0.22);
  }

  function sonErreur() {          // deux notes graves descendantes, distinctes
    note(311, 0, 0.18, 'square', 0.14);
    note(196, 0.20, 0.30, 'square', 0.14);
  }

  function sonNeutre() {          // rappel bref, ni succes ni echec
    note(587, 0, 0.12, 'triangle', 0.16);
  }

  /** Arpege court et doux pour un ecran festif (AFF-04 : reste discret). */
  function sonFestif() {
    note(659, 0, 0.12, 'sine', 0.20);
    note(880, 0.13, 0.12, 'sine', 0.20);
    note(1318, 0.26, 0.22, 'sine', 0.18);
  }

  /* --------------------------------------------------------------- overlay */

  function afficherOverlay(options) {
    if (overlayTimer !== null) {
      clearTimeout(overlayTimer);
      overlayTimer = null;
    }

    var classes = 'overlay ' + (options.variante || '');
    if (options.festif) { classes += ' festif festif-' + options.festif; }
    elOverlay.className = classes;

    elPicto.textContent = options.picto;

    // Information principale (>= 48 px) : le message du moment, ou le motif
    // de refus quand il n'y a pas de badge reconnu.
    texte(elMoment, options.moment);
    texte(elIdentite, options.identite);
    texte(elSens, options.sens);
    texte(elHeure, options.heure);
    texte(elPhrase, options.phrase);

    // AFF-02 : rien ne s'affiche si l'agent n'a pas envoye de cumul.
    texte(elCumul, options.cumul ? 'Cette semaine : ' + options.cumul : '');

    confettis(options.festif);

    elOverlay.hidden = false;
    // Force un cycle de rendu pour que la transition d'opacite s'applique.
    void elOverlay.offsetWidth;
    elOverlay.classList.add('visible');

    overlayTimer = setTimeout(masquerOverlay, dureeOverlay(options.duree));
  }

  function masquerOverlay() {
    elOverlay.classList.remove('visible');
    overlayTimer = setTimeout(function () {
      elOverlay.hidden = true;
      elConfettis.textContent = '';   // libere les animations
      overlayTimer = null;
    }, 300);
  }

  /** Ecrit un texte et masque l'element s'il est vide (jamais de ligne fantome). */
  function texte(noeud, valeur) {
    var contenu = valeur === null || valeur === undefined ? '' : String(valeur);
    noeud.textContent = contenu;
    noeud.hidden = contenu === '';
  }

  /** Plafond dur : meme si le serveur demandait 30 s, l'affichage cesse a 8 s. */
  function dureeOverlay(secondes) {
    var ms = Number(secondes) * 1000;
    if (!isFinite(ms) || ms <= 0) { ms = OVERLAY_DEFAUT_MS; }
    return Math.max(OVERLAY_MIN_MS, Math.min(OVERLAY_MAX_MS, ms));
  }

  /**
   * Confettis de la variante festive.
   *
   * Douze elements aux classes fixes (.conf-1 a .conf-12) : la position, le
   * delai et la duree de chute sont dans la feuille de style, donc AUCUN
   * style en ligne — la CSP 'self' reste tenable sans 'unsafe-inline'.
   * Chute lente et continue : aucun clignotement (AFF-06).
   */
  function confettis(actif) {
    elConfettis.textContent = '';
    if (!actif) { return; }
    for (var i = 1; i <= CONFETTIS; i += 1) {
      var piece = document.createElement('span');
      piece.className = 'confetti conf-' + i;
      elConfettis.appendChild(piece);
    }
  }

  function identite(prenom, initiale) {
    var texteIdentite = (prenom || '').trim();
    if (initiale) {
      // Initiale SEULE, jamais le nom de famille (ADR-0004 §1).
      texteIdentite += ' ' + String(initiale).trim().charAt(0) + '.';
    }
    return texteIdentite.trim();
  }

  /* -------------------------------------------------------------- playlist */

  function chargerPlaylist(elements) {
    playlist = Array.isArray(elements) ? elements.slice() : [];
    playlist.sort(function (a, b) { return (a.ordre || 0) - (b.ordre || 0); });
    playlistIndex = 0;

    if (playlistTimer !== null) {
      clearTimeout(playlistTimer);
      playlistTimer = null;
    }
    diapoSuivante();
  }

  function diapoSuivante() {
    var element = playlist.length ? playlist[playlistIndex % playlist.length] : null;
    var cible = diapos[1 - diapoActive];

    construireDiapo(cible, element);

    diapos[diapoActive].classList.remove('visible');
    cible.classList.add('visible');
    diapoActive = 1 - diapoActive;

    playlistIndex += 1;

    var secondes = element ? Number(element.duree_sec) : DIAPO_DEFAUT_SEC;
    if (!isFinite(secondes) || secondes <= 0) { secondes = DIAPO_DEFAUT_SEC; }
    secondes = Math.max(DIAPO_MIN_SEC, Math.min(DIAPO_MAX_SEC, secondes));

    if (playlist.length > 0) {
      playlistTimer = setTimeout(diapoSuivante, secondes * 1000);
    }
  }

  /**
   * Construit une diapositive.
   *
   * Tout passe par textContent : aucune injection possible, meme si un
   * contenu de playlist portait du HTML.
   */
  function construireDiapo(noeud, element) {
    noeud.className = 'diapo';
    noeud.textContent = '';

    if (!element) {
      noeud.appendChild(bloc('p', 'diapo-vide', 'Bonne journée'));
      return;
    }

    var type = element.type || 'message';
    var moteur = RENDERERS[type];
    var donnees = charge(element);

    noeud.classList.add('diapo-' + type);

    if (moteur && moteur(noeud, element, donnees)) { return; }

    // Repli commun : titre + corps textuel. Sert les types historiques
    // (message, planning) ET tout type dont les donnees manquent — dont un
    // ecran meteo dont le serveur n'a pas pu fournir la prevision.
    rendreTexte(noeud, element, donnees);
  }

  /* ---------------------------------------------------- moteurs de rendu */

  /** Rendu generique titre + corps (types historiques et repli universel). */
  function rendreTexte(noeud, element) {
    if (noeud.childNodes.length === 0 && element.titre) {
      noeud.appendChild(bloc('h1', 'diapo-titre', element.titre));
    }
    var corps = element.corps;
    if (corps && typeof corps === 'string' && corps.charAt(0) !== '{') {
      noeud.appendChild(bloc('p', 'diapo-corps', corps));
    } else if (noeud.childNodes.length === 0) {
      noeud.appendChild(bloc('p', 'diapo-vide', 'Bonne journée'));
    }
    return true;
  }

  /** image (historique) : media_url deja resolue en local par l'agent. */
  function rendreImage(noeud, element) {
    titre(noeud, element);
    var source = urlLocale(element.media_url);
    if (!source) { return false; }        // hors ligne : repli texte
    noeud.appendChild(image(source, element.titre));
    return true;
  }

  /**
   * media : image ou video televersee dans SOLIDATA, telechargee par l'agent
   * et servie depuis le cache local (/media/...). Le poste ne fetch jamais un
   * domaine externe (ADR-0004 §6).
   */
  function rendreMedia(noeud, element) {
    var source = urlLocale(element.media_url);
    if (!source) { return false; }        // pas encore en cache : repli texte

    titre(noeud, element);
    if (String(element.media_type || '').toLowerCase() === 'video') {
      noeud.appendChild(video(source));
    } else {
      noeud.appendChild(image(source, element.titre));
    }
    return true;
  }

  /**
   * annonces : evenements du jour.
   * corps = {"items":[{"prenom":"Karim","initiale":"B",
   *                    "type":"anniversaire","annees":2}]}
   * Prenom + initiale UNIQUEMENT, opt-in cote serveur (ADR-0004 §4).
   */
  function rendreAnnonces(noeud, element, donnees) {
    var items = liste(element, donnees, 'annonces');
    if (!items.length) { return false; }

    noeud.appendChild(bloc('h1', 'diapo-titre', element.titre || "Aujourd'hui"));

    var liste_ = document.createElement('ul');
    liste_.className = 'annonces';
    items.forEach(function (item) {
      var ligne = document.createElement('li');
      ligne.className = 'annonce';
      ligne.appendChild(bloc('span', 'annonce-picto',
                             PICTO_ANNONCE[item.type] || '🎉'));
      ligne.appendChild(bloc('span', 'annonce-nom',
                             identite(item.prenom, item.initiale)));
      var annees = entier(item.annees);
      if (annees > 0) {
        ligne.appendChild(bloc('span', 'annonce-detail',
                               annees + (annees > 1 ? ' ans' : ' an')));
      }
      liste_.appendChild(ligne);
    });
    noeud.appendChild(liste_);
    return true;
  }

  /**
   * actus : brèves du fil d'actualites SOLIDATA.
   * element.actus = [{"titre":"...","resume":"...","source":"..."}]
   */
  function rendreActus(noeud, element, donnees) {
    var items = liste(element, donnees, 'actus');
    if (!items.length) { return false; }

    noeud.appendChild(bloc('h1', 'diapo-titre', element.titre || 'Actualités'));

    var conteneur = document.createElement('div');
    conteneur.className = 'actus';
    items.forEach(function (item) {
      var carte = document.createElement('article');
      carte.className = 'actu';
      if (item.titre) { carte.appendChild(bloc('h2', 'actu-titre', item.titre)); }
      if (item.resume) {
        carte.appendChild(bloc('p', 'actu-resume', tronquer(item.resume, LEGENDE_MAX)));
      }
      if (item.source) { carte.appendChild(bloc('p', 'actu-source', item.source)); }
      conteneur.appendChild(carte);
    });
    noeud.appendChild(conteneur);
    return true;
  }

  /**
   * tournees : collectes en cours.
   * element.tournees = [{"libelle":"Tournée CAV","vehicule":"AB-123-CD",
   *                      "points_faits":7,"points_total":12,"statut":"in_progress"}]
   * JAMAIS de nom de chauffeur (ADR-0004 §5), jamais de carte.
   */
  function rendreTournees(noeud, element, donnees) {
    var items = liste(element, donnees, 'tournees');
    if (!items.length) { return false; }

    noeud.appendChild(bloc('h1', 'diapo-titre', element.titre || 'Collectes en cours'));

    var conteneur = document.createElement('div');
    conteneur.className = 'tournees';
    items.forEach(function (item) {
      var faits = entier(champ(item, ['points_faits', 'cav_faits']));
      var total = entier(champ(item, ['points_total', 'cav_total']));

      var ligne = document.createElement('div');
      ligne.className = 'tournee';

      var entete = document.createElement('div');
      entete.className = 'tournee-entete';
      entete.appendChild(bloc('span', 'tournee-libelle', item.libelle || 'Tournée'));
      if (item.vehicule) {
        entete.appendChild(bloc('span', 'tournee-vehicule', item.vehicule));
      }
      if (total > 0) {
        entete.appendChild(bloc('span', 'tournee-progression', faits + ' / ' + total));
      }
      ligne.appendChild(entete);

      if (total > 0) {
        ligne.appendChild(jauge(faits / total));
      }
      conteneur.appendChild(ligne);
    });
    noeud.appendChild(conteneur);
    return true;
  }

  /**
   * social : derniere publication d'un compte de la structure.
   * element.posts = [{"media_id":"s12","media_type":"image","reseau":"instagram",
   *                   "compte":"fripandcorouen","legende":"...","publie_le":"..."}]
   *
   * Chaque post porte SON visuel : l'agent les met tous en cache et reecrit
   * leur media_url vers la boucle locale. V1 affiche le PLUS RECENT (le
   * serveur en envoie plusieurs, deja tries) — un post par diapositive, la
   * rotation restant celle de la playlist.
   */
  function rendreSocial(noeud, element, donnees) {
    var posts = liste(element, donnees, 'posts');
    var post = posts.length ? posts[0] : donnees;

    var source = urlLocale(post.media_url || element.media_url);
    var legende = post.legende || donnees.legende || '';
    if (!source && !legende) { return false; }

    var reseau = String(post.reseau || donnees.reseau || '').toLowerCase();
    var compte = post.compte || donnees.compte;

    var badge = document.createElement('div');
    badge.className = 'social-badge';
    badge.appendChild(bloc('span', 'social-reseau', RESEAUX[reseau] || 'Réseaux'));
    if (compte) {
      badge.appendChild(bloc('span', 'social-compte', '@' + compte));
    }
    noeud.appendChild(badge);

    if (source) {
      if (String(post.media_type || element.media_type || '').toLowerCase() === 'video') {
        noeud.appendChild(video(source));
      } else {
        noeud.appendChild(image(source, compte || ''));
      }
    }
    if (legende) {
      noeud.appendChild(bloc('p', 'social-legende', tronquer(legende, LEGENDE_MAX)));
    }
    return true;
  }

  /**
   * vak_live : ecran promotionnel des jours de Vente Au Kilo.
   * element.vak = {"libelle":"VAK d'août","poids_kg":1234.5,
   *                "objectif_poids_kg":2000,"ca_ttc":...,"tickets":...}
   * Aucune donnee personnelle : vocation visiteurs, chiffres enormes.
   * Seuls le poids et son objectif sont affiches (le CA ne s'expose pas a des
   * visiteurs sur un ecran d'atelier).
   */
  function rendreVakLive(noeud, element, donnees) {
    var vak = objet(element, donnees, 'vak');
    var kg = nombre(champ(vak, ['poids_kg', 'kg']));
    if (kg === null) { return false; }

    var objectif = nombre(champ(vak, ['objectif_poids_kg', 'objectif_kg']));

    noeud.appendChild(bloc('p', 'vak-libelle',
                           vak.libelle || element.titre || 'Vente au Kilo'));
    noeud.appendChild(bloc('p', 'vak-compteur', nombreFr(kg, 1)));
    noeud.appendChild(bloc('p', 'vak-unite', 'kg vendus'));

    if (objectif !== null && objectif > 0) {
      noeud.appendChild(jauge(kg / objectif));
      noeud.appendChild(bloc('p', 'vak-objectif',
                             'Objectif ' + nombreFr(objectif, 0) + ' kg'));
    }
    return true;
  }

  /**
   * meteo : previsions du LIEU DU POSTE, rapatriees par le serveur.
   * element.meteo = {"lieu":"Le Houlme","lieu_source":"site|parametre",
   *                  "releve_le":"...","jour":{"date","code","libelle",
   *                  "temp_min","temp_max","precip_mm","vent_max"},
   *                  "prevision":[{"date","code","libelle","temp_min","temp_max"}]}
   *
   * Le poste ne contacte JAMAIS Open-Meteo : il affiche ce que le serveur lui
   * a donne, et rien s'il ne lui a rien donne (repli texte).
   * Le LIBELLE vient du serveur ; seul le PICTOGRAMME est choisi ici — c'est
   * une decision d'affichage, pas une interpretation de la donnee.
   */
  function rendreMeteo(noeud, element, donnees) {
    var meteo = objet(element, donnees, 'meteo');
    var jour = meteo && meteo.jour ? meteo.jour : null;
    if (!jour) { return false; }

    var maxi = nombre(jour.temp_max);
    var mini = nombre(jour.temp_min);
    if (maxi === null && mini === null) { return false; }   // rien de mesure : rien a montrer

    var lieu = meteo.lieu ? String(meteo.lieu) : '';
    noeud.appendChild(bloc('h1', 'diapo-titre',
                           element.titre || (lieu ? 'Météo — ' + lieu : 'Météo')));

    var actuel = document.createElement('div');
    actuel.className = 'meteo-jour';
    actuel.appendChild(bloc('span', 'meteo-picto', pictoMeteo(jour.code)));

    var colonne = document.createElement('div');
    colonne.className = 'meteo-colonne';
    // Information principale (AFF-03) : la temperature du jour, en tres grand.
    colonne.appendChild(bloc('p', 'meteo-temp',
                             maxi !== null ? degres(maxi) : degres(mini)));
    if (jour.libelle) { colonne.appendChild(bloc('p', 'meteo-libelle', jour.libelle)); }

    var details = [];
    if (maxi !== null && mini !== null) { details.push('min ' + degres(mini)); }
    var pluie = nombre(jour.precip_mm);
    if (pluie !== null && pluie > 0) { details.push(nombreFr(pluie, 1) + ' mm'); }
    var vent = nombre(jour.vent_max);
    if (vent !== null) { details.push('vent ' + nombreFr(vent, 0) + ' km/h'); }
    if (details.length) {
      colonne.appendChild(bloc('p', 'meteo-detail', details.join('  ·  ')));
    }
    actuel.appendChild(colonne);
    noeud.appendChild(actuel);

    var suite = Array.isArray(meteo.prevision) ? meteo.prevision : [];
    if (suite.length) {
      var bande = document.createElement('div');
      bande.className = 'meteo-prevision';
      suite.forEach(function (j) {
        var carte = document.createElement('div');
        carte.className = 'meteo-suivant';
        carte.appendChild(bloc('span', 'meteo-suivant-jour', jourCourt(j.date)));
        carte.appendChild(bloc('span', 'meteo-suivant-picto', pictoMeteo(j.code)));
        var haut = nombre(j.temp_max);
        var bas = nombre(j.temp_min);
        // Une temperature absente s'ecrit « — », jamais 0 (AFF : rien d'invente).
        carte.appendChild(bloc('span', 'meteo-suivant-temp',
                               (haut === null ? '—' : degres(haut)) +
                               (bas === null ? '' : ' / ' + degres(bas))));
        bande.appendChild(carte);
      });
      noeud.appendChild(bande);
    }
    return true;
  }

  /** Temperature entiere suffixee du degre (arrondi d'affichage seulement). */
  function degres(valeur) {
    var n = Number(valeur);
    return (isFinite(n) ? Math.round(n) : 0) + '°';
  }

  /**
   * Pictogramme d'un code WMO. Les bornes sont celles du libelle cote serveur
   * (utils/weather.js) : les deux doivent raconter la meme chose.
   */
  function pictoMeteo(code) {
    var c = nombre(code);
    if (c === null) { return '🌡️'; }
    if (c <= 1) { return '☀️'; }
    if (c <= 3) { return '⛅'; }
    if (c <= 48) { return '🌫️'; }
    if (c <= 57) { return '🌦️'; }
    if (c <= 67) { return '🌧️'; }
    if (c <= 77) { return '❄️'; }
    if (c <= 82) { return '🌧️'; }
    if (c <= 86) { return '❄️'; }
    if (c >= 95) { return '⛈️'; }
    return '🌡️';
  }

  /** « jeu. 21 » a partir d'une date ISO (jour civil), ou '' si illisible. */
  function jourCourt(date) {
    var d = new Date(String(date || '') + 'T12:00:00');
    if (isNaN(d.getTime())) { return ''; }
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  }

  /**
   * presse : UN ARTICLE, UN ECRAN (le serveur envoie un element par article).
   * element.article = {"titre","chapo","source","publie_le"}
   * element.media_url = vignette DEJA rapatriee par l'agent (cache local).
   *
   * La vignette vient du cache local du poste, jamais du site de presse : la
   * CSP du kiosque reste 'self' (ADR-0004 §6, ADR-0006). Si elle n'est pas
   * encore telechargee, l'article s'affiche sans image — le titre en grand
   * reste l'essentiel.
   */
  function rendrePresse(noeud, element, donnees) {
    var article = objet(element, donnees, 'article');
    if (!article || !article.titre) { return false; }

    var entete = document.createElement('div');
    entete.className = 'presse-entete';
    if (article.source) {
      // L'attribution de la source n'est pas decorative : c'est ce qui
      // distingue une depeche nationale d'une consigne de la structure.
      entete.appendChild(bloc('span', 'presse-source', String(article.source)));
    }
    var quand = dateCourte(article.publie_le);
    if (quand) { entete.appendChild(bloc('span', 'presse-date', quand)); }
    if (entete.childNodes.length) { noeud.appendChild(entete); }

    var source = urlLocale(element.media_url);
    if (source) { noeud.appendChild(image(source, '')); }

    noeud.appendChild(bloc('h1', 'presse-titre', tronquer(article.titre, TITRE_MAX)));
    if (article.chapo) {
      noeud.appendChild(bloc('p', 'presse-chapo', tronquer(article.chapo, CHAPO_MAX)));
    }
    return true;
  }

  /** « mer. 19 août, 07:12 » a partir d'un horodatage, ou '' si illisible. */
  function dateCourte(horodatage) {
    if (!horodatage) { return ''; }
    var d = new Date(horodatage);
    if (isNaN(d.getTime())) { return ''; }
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }) +
           ', ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /** compte_a_rebours (historique) : {"date_cible":"2026-12-31","libelle":"..."} */
  function rendreCompteARebours(noeud, element, donnees) {
    if (!donnees.date_cible) { return false; }

    var cible = new Date(donnees.date_cible);
    if (isNaN(cible.getTime())) { return false; }

    var aujourdhui = new Date();
    var minuitCible = Date.UTC(cible.getFullYear(), cible.getMonth(), cible.getDate());
    var minuitJour = Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth(),
                              aujourdhui.getDate());
    var jours = Math.max(0, Math.round((minuitCible - minuitJour) / 86400000));

    titre(noeud, element);
    noeud.appendChild(bloc('p', 'diapo-compteur', String(jours)));
    noeud.appendChild(bloc('p', 'diapo-unite',
                           jours > 1 ? 'jours restants' : 'jour restant'));
    if (donnees.libelle) {
      noeud.appendChild(bloc('p', 'diapo-corps', donnees.libelle));
    }
    return true;
  }

  var RENDERERS = {
    message: null,                       // repli texte
    planning: null,
    meteo: rendreMeteo,
    image: rendreImage,
    media: rendreMedia,
    lien: rendreMedia,                   // servi comme un media (ADR-0004 §6)
    annonces: rendreAnnonces,
    actus: rendreActus,
    tournees: rendreTournees,
    social: rendreSocial,
    vak_live: rendreVakLive,
    presse: rendrePresse,
    compte_a_rebours: rendreCompteARebours
  };

  /* ------------------------------------------------------ fabriques DOM */

  function bloc(balise, classe, contenu) {
    var noeud = document.createElement(balise);
    noeud.className = classe;
    noeud.textContent = contenu;
    return noeud;
  }

  function titre(noeud, element) {
    if (element.titre) { noeud.appendChild(bloc('h1', 'diapo-titre', element.titre)); }
  }

  function image(source, alternatif) {
    var noeud = document.createElement('img');
    noeud.className = 'diapo-image';
    noeud.alt = alternatif || '';
    noeud.src = source;
    return noeud;
  }

  /** Video muette, en boucle : aucun son intempestif dans l'atelier. */
  function video(source) {
    var noeud = document.createElement('video');
    noeud.className = 'diapo-video';
    noeud.muted = true;
    noeud.defaultMuted = true;
    noeud.autoplay = true;
    noeud.loop = true;
    noeud.playsInline = true;
    noeud.setAttribute('muted', '');
    noeud.setAttribute('playsinline', '');
    noeud.src = source;
    return noeud;
  }

  /**
   * Jauge de progression.
   *
   * Le remplissage passe par une classe par pas de 5 % (.jauge-p0 a
   * .jauge-p100) : aucun style en ligne, donc rien qui dependrait de
   * 'unsafe-inline' dans la CSP. Le pas de 5 % est invisible a 5 m.
   */
  function jauge(ratio) {
    var pourcent = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)));
    var pas = Math.round(pourcent / 5) * 5;

    var conteneur = document.createElement('div');
    conteneur.className = 'jauge';
    var barre = document.createElement('span');
    barre.className = 'jauge-barre jauge-p' + pas;
    conteneur.appendChild(barre);
    return conteneur;
  }

  /* --------------------------------------------------------- utilitaires */

  /** Donnees structurees d'un element : « corps » JSON, sinon objet vide. */
  function charge(element) {
    var corps = element.corps;
    if (corps && typeof corps === 'object') { return corps; }
    if (typeof corps === 'string' && corps.charAt(0) === '{') {
      try {
        var donnees = JSON.parse(corps);
        return donnees && typeof donnees === 'object' ? donnees : {};
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  /**
   * Liste d'items d'un type dynamique.
   *
   * Le serveur pose le contenu genere en CHAMP DE PREMIER NIVEAU de
   * l'element (element.annonces, element.actus, element.tournees,
   * element.posts) : c'est la source principale. Les autres formes
   * (« items », contenu JSON dans « corps ») sont acceptees en repli, pour
   * qu'un contenu saisi a la main reste affichable.
   */
  function liste(element, donnees, cle) {
    var candidats = [element[cle], donnees[cle], donnees.items, element.items];
    for (var i = 0; i < candidats.length; i += 1) {
      if (Array.isArray(candidats[i])) {
        return candidats[i].filter(function (item) {
          return item && typeof item === 'object';
        });
      }
    }
    return [];
  }

  /** Objet d'un type dynamique (ex. element.vak), avec repli sur « corps ». */
  function objet(element, donnees, cle) {
    if (element[cle] && typeof element[cle] === 'object') { return element[cle]; }
    if (donnees[cle] && typeof donnees[cle] === 'object') { return donnees[cle]; }
    return donnees;
  }

  /** Premiere valeur definie parmi plusieurs cles (tolerance de nommage). */
  function champ(source, cles) {
    for (var i = 0; i < cles.length; i += 1) {
      var valeur = source[cles[i]];
      if (valeur !== undefined && valeur !== null) { return valeur; }
    }
    return null;
  }

  /**
   * N'accepte qu'une ressource LOCALE : la page doit tenir hors ligne et le
   * poste ne doit jamais contacter un domaine externe (ADR-0004 §6).
   */
  function urlLocale(url) {
    if (!url) { return null; }
    var texteUrl = String(url);
    if (texteUrl.indexOf('data:image/') === 0) { return texteUrl; }
    try {
      var resolue = new URL(texteUrl, window.location.href);
      return resolue.origin === window.location.origin ? resolue.href : null;
    } catch (e) {
      return null;
    }
  }

  function tronquer(valeur, maximum) {
    var texteBrut = String(valeur === null || valeur === undefined ? '' : valeur).trim();
    if (texteBrut.length <= maximum) { return texteBrut; }
    return texteBrut.slice(0, maximum - 1).replace(/\s+$/, '') + '…';
  }

  function nombre(valeur) {
    var n = Number(valeur);
    return isFinite(n) ? n : null;
  }

  function entier(valeur) {
    var n = Number(valeur);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /**
   * Formatage francais sans dependre d'ICU : espace fine insecable pour les
   * milliers, virgule decimale. Deterministe sur tout poste.
   */
  function nombreFr(valeur, decimales) {
    var n = Number(valeur);
    if (!isFinite(n)) { return '0'; }

    var texteNombre = Math.abs(n).toFixed(decimales || 0);
    var morceaux = texteNombre.split('.');
    var entierPart = morceaux[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    var resultat = (n < 0 ? '-' : '') + entierPart;
    if (morceaux[1]) { resultat += ',' + morceaux[1]; }
    return resultat;
  }

  /* --------------------------------------------------------------- bandeau */

  function majBandeau() {
    var texteBandeau = null;
    if (!lecteurPresent) { texteBandeau = MESSAGES.lecteur; }
    else if (!enLigne) { texteBandeau = MESSAGES.hors_ligne; }

    // Sans lecteur, on n'invite plus a presenter un badge : demander un geste
    // qui ne PEUT PAS fonctionner, a cote du message qui dit qu'il ne
    // fonctionnera pas, ne fait qu'egarer le salarie.
    if (elConsigne) { elConsigne.hidden = !lecteurPresent; }

    if (texteBandeau === null) {
      elBandeau.classList.remove('visible');
      elBandeau.hidden = true;
      return;
    }
    elBandeau.textContent = texteBandeau;
    elBandeau.hidden = false;
    void elBandeau.offsetWidth;
    elBandeau.classList.add('visible');
  }

  /* ------------------------------------------------------------- websocket */

  function connecter() {
    try {
      socket = new WebSocket(WS_URL);
    } catch (e) {
      programmerReconnexion();
      return;
    }

    socket.onopen = function () {
      reconnexionDelai = RECONNEXION_MIN_MS;
    };

    socket.onmessage = function (evenement) {
      var message;
      try {
        message = JSON.parse(evenement.data);
      } catch (e) {
        return;
      }
      traiter(message);
    };

    socket.onclose = function () { programmerReconnexion(); };
    socket.onerror = function () { if (socket) { socket.close(); } };
  }

  function programmerReconnexion() {
    socket = null;
    setTimeout(connecter, reconnexionDelai);
    reconnexionDelai = Math.min(reconnexionDelai * 2, RECONNEXION_MAX_MS);
  }

  function traiter(message) {
    switch (message.type) {

      case 'badge_ok':
        badgeAccepte(message);
        break;

      case 'badge_err':
        afficherOverlay({
          variante: 'erreur',
          picto: '✗',
          moment: MESSAGES[message.raison] || MESSAGES.badge_inconnu,
          duree: message.overlay_duree_sec
        });
        sonErreur();
        break;

      case 'badge_repeat':
        afficherOverlay({
          variante: 'neutre',
          picto: '•',
          moment: MESSAGES.deja,
          identite: identite(message.prenom, ''),
          duree: message.overlay_duree_sec
        });
        sonNeutre();
        break;

      case 'playlist':
        chargerPlaylist(message.elements);
        break;

      case 'status':
        enLigne = message.online !== false;
        lecteurPresent = message.lecteur !== false;
        calerHorloge(message.horloge_locale);
        majBandeau();
        break;

      default:
        break;
    }
  }

  /**
   * Pointage accepte : overlay ordinaire ou variante festive.
   *
   * L'agent a deja decide du moment, du message, de la phrase et du festif
   * (module PUR moments.py) : l'interface ne recalcule rien et n'invente
   * aucun texte — elle affiche ce qu'on lui donne, ou rien.
   */
  function badgeAccepte(message) {
    var festif = message.festif && message.festif.type ? message.festif : null;

    afficherOverlay({
      variante: message.sens === 'sortie' ? 'sortie' : 'entree',
      festif: festif ? festif.type : null,
      picto: festif ? (PICTO_FESTIF[festif.type] || '🎉') : '✓',
      // Le message festif prime sur celui du moment : un seul message en
      // tres grand, jamais les deux empiles (overlay plafonne a 8 s).
      moment: (festif ? festif.message : message.message) ||
              MESSAGES[message.sens] || MESSAGES.inconnu,
      identite: identite(message.prenom, message.initiale),
      sens: MESSAGES[message.sens] || MESSAGES.inconnu,
      heure: message.heure_locale,
      phrase: message.phrase_motivation || '',
      cumul: message.cumul_hebdo,        // null tant que l'option est inactive
      duree: message.overlay_duree_sec
    });

    if (festif) { sonFestif(); } else { sonSucces(); }
  }

  /* --------------------------------------------------------------- demarrage */

  majHorloge();
  setInterval(majHorloge, 1000);
  chargerPlaylist([]);
  majBandeau();
  connecter();

})();

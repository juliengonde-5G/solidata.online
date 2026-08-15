/* Interface kiosque du poste de pointage — SOLIDATA.
 *
 * Sans dependance : ni framework, ni bundler, ni police distante.
 * L'agent local pousse tout par WebSocket ; l'interface n'emet jamais rien
 * (aucune interaction clavier ou souris n'est requise ni possible — PST-10).
 *
 * Regles tenues ici :
 *  - AFF-01 : overlay prenom + initiale + sens + heure + pictogramme ;
 *  - duree d'overlay pilotee par le serveur, RE-PLAFONNEE A 8 s en dur
 *    ci-dessous (exigence juridique, troisieme verrou apres le serveur et
 *    l'agent) ;
 *  - AFF-02 : le cumul hebdomadaire ne s'affiche que si le message le porte ;
 *  - AFF-04 : deux sons distincts, synthetises (aucun fichier audio) ;
 *  - AFF-06 : fondus doux, aucun clignotement ;
 *  - AFF-07 : la derniere playlist recue est rejouee, y compris hors ligne ;
 *  - PST-08 : bandeau discret « hors ligne — vos pointages sont enregistres » ;
 *  - jamais de photo, jamais de nom complet.
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

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ------------------------------------------------------------- elements */

  var elOverlay = document.getElementById('overlay');
  var elPicto = document.getElementById('overlay-picto');
  var elIdentite = document.getElementById('overlay-identite');
  var elMessage = document.getElementById('overlay-message');
  var elHeure = document.getElementById('overlay-heure');
  var elCumul = document.getElementById('overlay-cumul');

  var elHorloge = document.getElementById('horloge-heure');
  var elDate = document.getElementById('horloge-date');
  var elBandeau = document.getElementById('bandeau-hors-ligne');

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

  function majHorloge() {
    var maintenant = new Date();
    elHorloge.textContent = deuxChiffres(maintenant.getHours()) + ':' +
                            deuxChiffres(maintenant.getMinutes());
    elDate.textContent = JOURS[maintenant.getDay()] + ' ' + maintenant.getDate() +
                         ' ' + MOIS[maintenant.getMonth()];
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

  /* --------------------------------------------------------------- overlay */

  function afficherOverlay(options) {
    if (overlayTimer !== null) {
      clearTimeout(overlayTimer);
      overlayTimer = null;
    }

    elOverlay.className = 'overlay ' + (options.variante || '');
    elPicto.textContent = options.picto;
    elIdentite.textContent = options.identite || '';
    elIdentite.hidden = !options.identite;
    elMessage.textContent = options.message || '';
    elHeure.textContent = options.heure || '';
    elHeure.hidden = !options.heure;

    // AFF-02 : rien ne s'affiche si l'agent n'a pas envoye de cumul.
    if (options.cumul) {
      elCumul.textContent = 'Cette semaine : ' + options.cumul;
      elCumul.hidden = false;
    } else {
      elCumul.textContent = '';
      elCumul.hidden = true;
    }

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
      overlayTimer = null;
    }, 300);
  }

  /** Plafond dur : meme si le serveur demandait 30 s, l'affichage cesse a 8 s. */
  function dureeOverlay(secondes) {
    var ms = Number(secondes) * 1000;
    if (!isFinite(ms) || ms <= 0) { ms = OVERLAY_DEFAUT_MS; }
    return Math.max(OVERLAY_MIN_MS, Math.min(OVERLAY_MAX_MS, ms));
  }

  function identite(prenom, initiale) {
    var texte = (prenom || '').trim();
    if (initiale) { texte += ' ' + String(initiale).trim().charAt(0) + '.'; }
    return texte.trim();
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

  /** Construit une diapositive. Tout passe par textContent : aucune injection. */
  function construireDiapo(noeud, element) {
    noeud.textContent = '';

    if (!element) {
      noeud.appendChild(bloc('p', 'diapo-vide', 'Bonne journée'));
      return;
    }

    var type = element.type || 'message';

    if (element.titre) {
      noeud.appendChild(bloc('h1', 'diapo-titre', element.titre));
    }

    if (type === 'image') {
      var source = urlMemeOrigine(element.media_url);
      if (source) {
        var image = document.createElement('img');
        image.className = 'diapo-image';
        image.alt = element.titre || '';
        image.src = source;
        noeud.appendChild(image);
        return;
      }
      // Image indisponible hors ligne : on retombe sur le texte, jamais sur
      // une icone cassee.
    }

    if (type === 'compte_a_rebours') {
      var compte = compteARebours(element.corps);
      if (compte) {
        noeud.appendChild(bloc('p', 'diapo-compteur', String(compte.jours)));
        noeud.appendChild(bloc('p', 'diapo-unite',
                               compte.jours > 1 ? 'jours restants' : 'jour restant'));
        if (compte.libelle) {
          noeud.appendChild(bloc('p', 'diapo-corps', compte.libelle));
        }
        return;
      }
    }

    // message, planning, meteo et replis : rendu generique titre + corps.
    if (element.corps) {
      noeud.appendChild(bloc('p', 'diapo-corps', String(element.corps)));
    } else if (!element.titre) {
      noeud.appendChild(bloc('p', 'diapo-vide', 'Bonne journée'));
    }
  }

  function bloc(balise, classe, texte) {
    var noeud = document.createElement(balise);
    noeud.className = classe;
    noeud.textContent = texte;
    return noeud;
  }

  /** N'accepte qu'une ressource locale : la page doit tenir hors ligne. */
  function urlMemeOrigine(url) {
    if (!url) { return null; }
    var texte = String(url);
    if (texte.indexOf('data:image/') === 0) { return texte; }
    try {
      var resolue = new URL(texte, window.location.href);
      return resolue.origin === window.location.origin ? resolue.href : null;
    } catch (e) {
      return null;
    }
  }

  /** corps attendu : {"date_cible": "2026-12-31", "libelle": "..."} */
  function compteARebours(corps) {
    if (!corps) { return null; }
    var donnees;
    try {
      donnees = typeof corps === 'string' ? JSON.parse(corps) : corps;
    } catch (e) {
      return null;
    }
    if (!donnees || !donnees.date_cible) { return null; }

    var cible = new Date(donnees.date_cible);
    if (isNaN(cible.getTime())) { return null; }

    var aujourdhui = new Date();
    var minuitCible = Date.UTC(cible.getFullYear(), cible.getMonth(), cible.getDate());
    var minuitJour = Date.UTC(aujourdhui.getFullYear(), aujourdhui.getMonth(),
                              aujourdhui.getDate());
    var jours = Math.round((minuitCible - minuitJour) / 86400000);

    return { jours: Math.max(0, jours), libelle: donnees.libelle || '' };
  }

  /* --------------------------------------------------------------- bandeau */

  function majBandeau() {
    var texte = null;
    if (!lecteurPresent) { texte = MESSAGES.lecteur; }
    else if (!enLigne) { texte = MESSAGES.hors_ligne; }

    if (texte === null) {
      elBandeau.classList.remove('visible');
      elBandeau.hidden = true;
      return;
    }
    elBandeau.textContent = texte;
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
        afficherOverlay({
          variante: message.sens === 'sortie' ? 'sortie' : 'entree',
          picto: '✓',
          identite: identite(message.prenom, message.initiale),
          message: MESSAGES[message.sens] || MESSAGES.inconnu,
          heure: message.heure_locale,
          cumul: message.cumul_hebdo,     // null tant que l'option est inactive
          duree: message.overlay_duree_sec
        });
        sonSucces();
        break;

      case 'badge_err':
        afficherOverlay({
          variante: 'erreur',
          picto: '✗',
          identite: '',
          message: MESSAGES[message.raison] || MESSAGES.badge_inconnu,
          duree: message.overlay_duree_sec
        });
        sonErreur();
        break;

      case 'badge_repeat':
        afficherOverlay({
          variante: 'neutre',
          picto: '•',
          identite: identite(message.prenom, ''),
          message: MESSAGES.deja,
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
        majBandeau();
        break;

      default:
        break;
    }
  }

  /* --------------------------------------------------------------- demarrage */

  majHorloge();
  setInterval(majHorloge, 1000);
  chargerPlaylist([]);
  majBandeau();
  connecter();

})();

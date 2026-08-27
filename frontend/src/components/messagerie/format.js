// ══════════════════════════════════════════
// Messagerie — helpers purs (dates, texte, participants)
// Aucune E/S : uniquement du formatage, testable sans backend.
// ══════════════════════════════════════════

/** Heure courte "HH:MM" en français. */
export function formatHeure(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Libellé de séparateur de jour : "Aujourd'hui" / "Hier" / "lundi 26 août". */
export function libelleJour(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const auj = new Date();
  const hier = new Date();
  hier.setDate(auj.getDate() - 1);
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  if (memeJour(d, auj)) return "Aujourd'hui";
  if (memeJour(d, hier)) return 'Hier';
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== auj.getFullYear()) options.year = 'numeric';
  const libelle = d.toLocaleDateString('fr-FR', options);
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
}

/** Normalise casse + accents pour une comparaison de recherche insensible aux deux. */
export function normaliser(txt) {
  return (txt || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Le participant qui n'est pas l'utilisateur web courant (identité = users.id). */
export function autreParticipant(conversation, currentUserId) {
  if (!conversation?.participants) return null;
  return (
    conversation.participants.find(
      (p) => !(p.type === 'utilisateur' && p.user_id === currentUserId)
    ) || null
  );
}

/**
 * Titre affiché d'une conversation. Le backend fournit déjà `titre_affiche` ;
 * on ne se rabat sur le nom de l'autre participant, puis sur un libellé
 * neutre, que si cette information venait à manquer — jamais de nom inventé.
 */
export function titreConversation(conversation, currentUserId) {
  if (conversation?.titre_affiche) return conversation.titre_affiche;
  const autre = autreParticipant(conversation, currentUserId);
  if (autre?.nom) return autre.nom;
  return 'Conversation';
}

/** Initiales (1 ou 2 lettres) pour un avatar rond à partir d'un nom affiché. */
export function initiales(nom) {
  if (!nom) return '?';
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '?';
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase();
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase();
}

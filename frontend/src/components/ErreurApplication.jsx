import { Component } from 'react';

/**
 * Dernier rempart de l'application web.
 *
 * Quand un écran plante au rendu, React démonte TOUT l'arbre : l'utilisateur se
 * retrouve devant une page BLANCHE — sans un mot, sans un bouton, sans même
 * savoir s'il doit attendre ou recharger. L'application mobile a reçu ce
 * rempart en 2.40.1 après un incident en tournée ; le web, lui, n'en avait
 * aucun. Le cas s'est reproduit ici : un écran a passé un objet là où un
 * tableau était attendu, et toute la page a disparu alors que le serveur
 * répondait normalement.
 *
 * DEUX SITUATIONS, DEUX MESSAGES — les confondre serait inquiéter pour rien :
 *   - « module non chargé » : l'application vient d'être mise à jour et cet
 *     onglet demande un fichier qui n'existe plus sous ce nom. Ce n'est pas une
 *     panne, un rechargement suffit — et on le dit ainsi.
 *   - toute autre erreur : un écran a réellement échoué. On propose de
 *     recharger ET de revenir à l'accueil, car le défaut peut être propre à
 *     cette page.
 *
 * L'erreur technique part en console (diagnostic à distance), jamais à
 * l'écran : « TypeError: undefined is not a function » n'aide personne.
 *
 * AUCUNE dépendance — ni routeur, ni contexte, ni composant maison : ce
 * rempart doit pouvoir s'afficher précisément quand le reste est cassé. La
 * navigation se fait donc par `window.location`, jamais par le routeur.
 */

/** Un chargement de module échoué n'est pas un plantage : c'est une mise à jour. */
function estModuleNonCharge(error) {
  const texte = `${error?.name || ''} ${error?.message || ''}`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|Importing a module script failed/i
    .test(texte);
}

class ErreurApplication extends Component {
  constructor(props) {
    super(props);
    this.state = { enErreur: false, miseAJour: false };
  }

  static getDerivedStateFromError(error) {
    return { enErreur: true, miseAJour: estModuleNonCharge(error) };
  }

  componentDidCatch(error, info) {
    console.error('[SOLIDATA] Écran en erreur :', error, info?.componentStack);
  }

  render() {
    if (!this.state.enErreur) return this.props.children;
    const { miseAJour } = this.state;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: 24,
          background: '#F8FAFC',
          color: '#0F172A',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 48, lineHeight: 1 }}>
          {miseAJour ? '🔄' : '⚠️'}
        </span>

        <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, margin: 0, maxWidth: 560 }}>
          {miseAJour
            ? 'L’application a été mise à jour'
            : 'Cet écran a rencontré un problème'}
        </h1>

        <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: '#475569', maxWidth: 560 }}>
          {miseAJour ? (
            <>
              Une nouvelle version vient d’être déployée : cet onglet utilise encore
              l’ancienne. Rechargez la page pour continuer.
            </>
          ) : (
            <>
              L’affichage a échoué. Vos données ne sont pas perdues : rien n’a été
              enregistré depuis cet écran. Rechargez la page, ou revenez à l’accueil
              si le problème persiste.
            </>
          )}
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44,
              fontSize: 15,
              fontWeight: 600,
              color: '#FFFFFF',
              background: '#0D9488',
              border: 'none',
              borderRadius: 10,
              padding: '12px 22px',
              cursor: 'pointer',
            }}
          >
            Recharger la page
          </button>

          {!miseAJour && (
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              style={{
                minHeight: 44,
                fontSize: 15,
                fontWeight: 600,
                color: '#0F766E',
                background: '#FFFFFF',
                border: '1px solid #99F6E4',
                borderRadius: 10,
                padding: '12px 22px',
                cursor: 'pointer',
              }}
            >
              Retour à l’accueil
            </button>
          )}
        </div>

        {!miseAJour && (
          <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0, color: '#94A3B8', maxWidth: 560 }}>
            Si l’écran revient, signalez-le en précisant la page concernée : le détail
            technique est dans la console du navigateur.
          </p>
        )}
      </div>
    );
  }
}

export { estModuleNonCharge };
export default ErreurApplication;

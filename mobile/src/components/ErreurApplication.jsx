import { Component } from 'react';

/**
 * Dernier rempart de l'écran chauffeur.
 *
 * Quand un écran plante au rendu, React démonte TOUT l'arbre : le chauffeur se
 * retrouve devant une page BLANCHE, sans un mot, sans un bouton — il ne peut
 * même pas savoir s'il doit attendre, recharger, ou appeler le bureau. C'est
 * exactement ce qui est arrivé le 27/08/2026 sur les tournées association
 * (« lireArrivee is not defined »).
 *
 * Un défaut d'écran ne doit plus JAMAIS se traduire par du blanc en tournée :
 * on affiche un message court, en français, très lisible, avec une seule
 * action possible — recharger. L'erreur réelle part en console pour le
 * diagnostic, jamais à l'écran : « TypeError: undefined is not a function » ne
 * dit rien à un chauffeur et l'inquiète pour rien.
 *
 * AUCUNE dépendance (pas de routeur, pas de librairie) : ce composant doit
 * pouvoir s'afficher même quand le reste de l'application est cassé.
 */
class ErreurApplication extends Component {
  constructor(props) {
    super(props);
    this.state = { enErreur: false };
  }

  static getDerivedStateFromError() {
    return { enErreur: true };
  }

  componentDidCatch(error, info) {
    // Seule trace : la console. Elle sert au diagnostic à distance, pas au
    // chauffeur.
    console.error('[Mobile] Écran en erreur :', error, info?.componentStack);
  }

  render() {
    if (!this.state.enErreur) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          padding: 24,
          background: '#FFFFFF',
          color: '#0F172A',
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 64, lineHeight: 1 }}>⚠️</span>

        <p style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.25, margin: 0 }}>
          L'application a rencontré un problème
        </p>

        <p style={{ fontSize: 18, lineHeight: 1.45, margin: 0, color: '#334155' }}>
          Appuyez sur le bouton pour recharger.
          <br />
          Rien de ce que vous avez enregistré n'est perdu.
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            width: '100%',
            maxWidth: 420,
            minHeight: 72,
            fontSize: 22,
            fontWeight: 800,
            color: '#FFFFFF',
            background: '#0D9488',
            border: 'none',
            borderRadius: 18,
            padding: '18px 24px',
            cursor: 'pointer',
          }}
        >
          Recharger l'application
        </button>

        <p style={{ fontSize: 15, lineHeight: 1.4, margin: 0, color: '#64748B' }}>
          Si l'écran revient, prévenez le bureau.
        </p>
      </div>
    );
  }
}

export default ErreurApplication;

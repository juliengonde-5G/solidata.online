// Main canvas composition — 4 écrans × 4 variations
const { IOSDevice } = window;

function Phone({ label, dark = false, keyboard = false, children }) {
  return (
    <IOSDevice width={380} height={780} dark={dark} title={label} keyboard={keyboard}>
      {children}
    </IOSDevice>
  );
}
window.Phone = Phone;

function App() {
  return (
    <DesignCanvas>
      <DCSection id="login" title="01 · Écran d'accueil / login" subtitle="Chauffeurs avec gants · accès simple · picto fort">
        <DCArtboard id="login-pin" label="V1 · PIN 4 chiffres" width={420} height={820}>
          <Phone label="Connexion"><window.LoginPIN /></Phone>
        </DCArtboard>
        <DCArtboard id="login-photo" label="V2 · Photo + nom" width={420} height={820}>
          <Phone label="Qui es-tu ?"><window.LoginPhoto /></Phone>
        </DCArtboard>
        <DCArtboard id="login-qr" label="V3 · Scanner badge QR" width={420} height={820}>
          <Phone label="Scanner badge"><window.LoginQR /></Phone>
        </DCArtboard>
        <DCArtboard id="login-big" label="V4 · Un seul bouton" width={420} height={820}>
          <Phone label="Démarrer"><window.LoginBig /></Phone>
        </DCArtboard>
      </DCSection>

      <DCSection id="tournee" title="02 · Ma tournée du jour" subtitle="Conduite · usage gants · 1 action dominante par écran">
        <DCArtboard id="tour-list" label="V1 · Liste points" width={420} height={820}>
          <Phone label="Ma tournée"><window.TourneeList /></Phone>
        </DCArtboard>
        <DCArtboard id="tour-map" label="V2 · Carte plein écran" width={420} height={820}>
          <Phone label="Ma tournée"><window.TourneeMap /></Phone>
        </DCArtboard>
        <DCArtboard id="tour-step" label="V3 · Étape par étape XXL" width={420} height={820}>
          <Phone label="Point 3 / 8"><window.TourneeStep /></Phone>
        </DCArtboard>
        <DCArtboard id="tour-voice" label="V4 · Voix + photo" width={420} height={820}>
          <Phone label="Arrivée au point"><window.TourneeVoice /></Phone>
        </DCArtboard>
      </DCSection>

      <DCSection id="alerts" title="03 · Alertes & validations" subtitle="Consultation rapide · actions gros boutons · swipe possible">
        <DCArtboard id="al-chrono" label="V1 · Chronologie" width={420} height={820}>
          <Phone label="Alertes"><window.AlertsChrono /></Phone>
        </DCArtboard>
        <DCArtboard id="al-urgency" label="V2 · Triées par urgence" width={420} height={820}>
          <Phone label="Alertes"><window.AlertsUrgency /></Phone>
        </DCArtboard>
        <DCArtboard id="al-swipe" label="V3 · Swipe valider / rejeter" width={420} height={820}>
          <Phone label="À valider"><window.AlertsSwipe /></Phone>
        </DCArtboard>
        <DCArtboard id="al-focus" label="V4 · Une seule alerte à la fois" width={420} height={820}>
          <Phone label="1 alerte urgente"><window.AlertsFocus /></Phone>
        </DCArtboard>
      </DCSection>

      <DCSection id="pcm" title="04 · Test PCM sur mobile" subtitle="Candidat à distance · pictos forts · français simplifié">
        <DCArtboard id="pcm-basic" label="V1 · Pictos + audio" width={420} height={820}>
          <Phone label="Test · 3/12"><window.PCMBasic /></Phone>
        </DCArtboard>
        <DCArtboard id="pcm-slider" label="V2 · Slider d'intensité" width={420} height={820}>
          <Phone label="Test · 3/12"><window.PCMSlider /></Phone>
        </DCArtboard>
        <DCArtboard id="pcm-voice" label="V3 · Tout en audio" width={420} height={820}>
          <Phone label="Test parlé"><window.PCMVoice /></Phone>
        </DCArtboard>
        <DCArtboard id="pcm-swipe" label="V4 · Cartes swipe Tinder-like" width={420} height={820}>
          <Phone label="Test · 3/12"><window.PCMSwipe /></Phone>
        </DCArtboard>
      </DCSection>

      <DCSection id="dash" title="05 · Dashboard manager (bonus)" subtitle="Manager en déplacement · KPI du jour · alertes · coup d'œil">
        <DCArtboard id="d-cards" label="V1 · Cards empilées" width={420} height={820}>
          <Phone label="Aujourd'hui"><window.DashCards /></Phone>
        </DCArtboard>
        <DCArtboard id="d-story" label="V2 · Story / stories" width={420} height={820}>
          <Phone label="Brief du jour"><window.DashStory /></Phone>
        </DCArtboard>
        <DCArtboard id="d-priorities" label="V3 · 3 priorités max" width={420} height={820}>
          <Phone label="À gérer"><window.DashPrio /></Phone>
        </DCArtboard>
        <DCArtboard id="d-graph" label="V4 · Graphiques gros" width={420} height={820}>
          <Phone label="Performance"><window.DashGraph /></Phone>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

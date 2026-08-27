import { Truck } from 'lucide-react';
import { initiales } from './format';

/**
 * Ligne de résultat de recherche de contact — partagée entre le panneau
 * "nouvelle conversation" de ConversationsList et l'autocomplete @ du
 * composer. Un contact utilisateur ouvre une conversation directe avec un
 * collègue ; un contact véhicule ouvre une conversation avec le chauffeur
 * en tournée (identité = le véhicule, cf. contrat §2.2 / §12.4).
 */
export default function ContactRow({ contact, active = false, onClick, onMouseEnter }) {
  const estVehicule = contact.type === 'vehicule';
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
        active ? 'bg-primary-surface' : 'hover:bg-slate-50'
      }`}
    >
      <span
        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10.5px] font-bold text-white flex-shrink-0 ${
          estVehicule ? 'bg-slate-400' : 'bg-teal-500'
        }`}
      >
        {estVehicule ? <Truck className="w-3.5 h-3.5" /> : initiales(contact.nom)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800 truncate">{contact.nom}</span>
        {contact.role && <span className="block text-[10.5px] text-slate-400">{contact.role}</span>}
      </span>
    </button>
  );
}

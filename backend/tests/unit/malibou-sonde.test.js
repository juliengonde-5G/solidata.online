/**
 * Sonde Malibou — ce que la découverte a le droit de dire, et ce qu'elle ne
 * doit JAMAIS laisser sortir.
 *
 * La sortie de cette sonde est faite pour être lue, collée dans un ticket et
 * transmise. Ce qui la rend transmissible n'est pas une intention mais une
 * règle : une valeur ne sort que si elle se RÉPÈTE d'un salarié à l'autre.
 * Ces tests exercent la règle sur des jeux qui ressemblent à un vrai export de
 * paie — le seul cas où une erreur coûterait quelque chose.
 */
const { resumer, estEnumeration, motif } = require('../../src/utils/schema-redige');

/** Un échantillon réaliste : des identités uniques, des statuts répétés. */
function echantillonPaie(n = 12) {
  const noms = ['Dupont', 'Martin', 'Bernard', 'Petit', 'Durand', 'Leroy',
    'Moreau', 'Simon', 'Laurent', 'Michel', 'Garcia', 'David', 'Roux', 'Fontaine'];
  const types = ['CDDI', 'CDI', 'Apprentissage'];
  return Array.from({ length: n }, (_, i) => ({
    id: 48000 + i,
    lastName: noms[i % noms.length],
    firstName: `Prenom${i}`,
    email: `p${i}@solidarite-textiles.fr`,
    birthDate: `19${70 + (i % 25)}-0${1 + (i % 9)}-1${i % 9}`,
    contractType: types[i % types.length],
    isActive: i % 4 !== 0,
    grossSalary: 1850 + i * 10,
    iban: `FR7630001007941234567890${i}85`,
    socialSecurityNumber: `1${80 + i}0176012345${i}`,
    // Champ dont le NOM n'évoque rien d'interdit, mais dont la valeur est
    // unique par personne. C'est le cas que la liste de noms ne peut pas
    // couvrir — seule la règle de répétition le protège.
    referenceInterne: `RH-2026-${String(i).padStart(4, '0')}`,
  }));
}

const ligneDe = (res, chemin) => res.lignes.find((l) => l.chemin === chemin);

describe('expurgation — ce qui ne doit jamais sortir', () => {
  const res = resumer(echantillonPaie());

  it.each([
    ['lastName'], ['firstName'], ['email'], ['birthDate'],
    ['grossSalary'], ['iban'], ['socialSecurityNumber'], ['id'],
    // Nom anodin, valeur unique : SEULE la règle de répétition le protège.
    ['referenceInterne'],
  ])('%s : aucune valeur rendue', (champ) => {
    const l = ligneDe(res, champ);
    expect(l).toBeDefined();
    expect(l.valeurs).toBeNull();
  });

  it("aucune valeur d'un dossier ne se retrouve dans le texte imprimé", () => {
    const gens = echantillonPaie();
    const texte = resumer(gens).texte;
    for (const g of gens) {
      expect(texte).not.toContain(g.lastName);
      expect(texte).not.toContain(g.email);
      expect(texte).not.toContain(g.iban);
      expect(texte).not.toContain(g.socialSecurityNumber);
      expect(texte).not.toContain(String(g.grossSalary));
      expect(texte).not.toContain(g.birthDate);
      expect(texte).not.toContain(g.referenceInterne);
    }
  });

  it('un champ à nom anodin et à valeurs uniques est expurgé, même en petit nombre', () => {
    // SIX enregistrements, six valeurs distinctes : sous le plafond de
    // cardinalité (8), et le nom n'évoque rien d'interdit. Ni la liste de noms
    // ni le plafond ne peuvent refuser ici — c'est la règle de répétition,
    // seule, qui tient. Le cas est petit à dessein : les échantillons plus
    // larges laissaient le plafond faire le travail, et le test passait sans
    // jamais exercer ce qu'il prétendait vérifier.
    const gens = Array.from({ length: 6 }, (_, i) => ({ referenceInterne: `RH-${i}` }));
    expect(ligneDe(resumer(gens), 'referenceInterne').valeurs).toBeNull();
  });

  it('un patronyme RÉPÉTÉ reste expurgé — la liste de noms interdits est la seconde ceinture', () => {
    // Six salariés, deux patronymes : la règle de répétition, seule, laisserait
    // passer. C'est le nom du champ qui ferme ici.
    const gens = Array.from({ length: 6 }, (_, i) => ({ lastName: i < 3 ? 'Dupont' : 'Martin' }));
    expect(ligneDe(resumer(gens), 'lastName').valeurs).toBeNull();
  });
});

describe('expurgation — ce qui doit sortir, sinon la sonde ne sert à rien', () => {
  it('un type de contrat est rendu : c\'est lui qui décide du mappage', () => {
    const l = ligneDe(resumer(echantillonPaie()), 'contractType');
    expect(l.valeurs).toEqual(['Apprentissage', 'CDDI', 'CDI']);
  });

  it('un booléen de statut est rendu', () => {
    expect(ligneDe(resumer(echantillonPaie()), 'isActive').valeurs).toEqual(['false', 'true']);
  });

  it('le FORMAT est rendu pour les champs expurgés — sans leur contenu', () => {
    expect(ligneDe(resumer(echantillonPaie()), 'birthDate').motifs).toContain('9999-99-99');
  });
});

describe('petits échantillons — le cas où la règle pourrait se tromper', () => {
  it('sous 5 enregistrements, plus aucune valeur ne sort', () => {
    const gens = echantillonPaie(4);
    const res = resumer(gens);
    expect(res.lignes.every((l) => l.valeurs === null)).toBe(true);
  });

  it('un champ dont chaque valeur est unique n\'est jamais une énumération', () => {
    const f = { type: new Set(['string']), n: 6, vides: 0, valeurs: new Set(['a', 'b', 'c']), motifs: new Set(), longueurMax: 1 };
    // 3 distinctes pour 6 enregistrements → répétition → énumération
    expect(estEnumeration('statut', f, 6)).toBe(true);

    // 6 distinctes pour 6 enregistrements → aucune répétition → donnée.
    // L'échantillon est tenu SOUS le plafond de cardinalité (8) à dessein :
    // au-dessus, c'est ce plafond qui refuserait, et le test passerait sans
    // jamais exercer la règle de répétition — il passait pour cette mauvaise
    // raison avant que la contre-épreuve par mutation ne le démasque.
    const g = { ...f, valeurs: new Set('abcdef'.split('')) };
    expect(estEnumeration('statut', g, 6)).toBe(false);
  });
});

describe('robustesse — une charge d\'API ne doit pas faire tomber la sonde', () => {
  it('encaisse null, vides, imbrication et tableaux', () => {
    const gens = [
      { a: null, b: { c: [1, 2] }, d: [] },
      { a: '', b: { c: [3] } },
      { e: undefined },
    ];
    expect(() => resumer(gens)).not.toThrow();
    expect(resumer(gens).nb_enregistrements).toBe(3);
  });

  it('borne la profondeur d\'un objet récursif plutôt que de boucler', () => {
    const profond = { n: 0 };
    let cur = profond;
    for (let i = 1; i < 50; i += 1) { cur.suivant = { n: i }; cur = cur.suivant; }
    expect(() => resumer([profond])).not.toThrow();
  });

  it('le motif ne rend ni chiffre ni lettre d\'origine', () => {
    expect(motif('Jean-Pierre 1975')).toBe('aaaa-aaaaaa 9999');
  });
});

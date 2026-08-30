process.env.JWT_SECRET = 'x';
process.env.PCM_ENCRYPTION_KEY = 'y';
const path = '/home/user/solidata.online/backend/src/routes/pcm.js';
const mod = require(path);
const calc = mod.calculatePCMProfile;
const TYPES = ['analyseur','perseverant','empathique','imagineur','energiseur','promoteur'];
const CATS = {1:'perception',2:'perception',3:'perception',4:'points_forts',5:'relation',6:'motivation',7:'stress',8:'stress',9:'motivation',10:'stress',11:'communication',12:'communication',13:'communication',14:'besoin',15:'besoin',16:'besoin',17:'besoin',18:'situation',19:'situation',20:'situation'};

function answersAll(t){ return Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:t})); }

console.log('=== 1. 20 réponses identiques (analyseur) ===');
let r = calc(answersAll('analyseur'));
console.log({base:r.baseType, phase:r.phaseType, risk:r.riskAlert, bc:r.baseConfidence, pc:r.phaseConfidence, bi:r.baseIndetermine, etages:r.report.immeuble.length, immeuble:r.report.immeuble});

console.log('\n=== 2. Réponses PARFAITEMENT étalées (chaque type ~3 fois) ===');
const spread = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:TYPES[i%6]}));
r = calc(spread);
console.log({base:r.baseType, phase:r.phaseType, risk:r.riskAlert, bc:r.baseConfidence, pc:r.phaseConfidence, bi:r.baseIndetermine, pi:r.phaseIndetermine, etages:r.report.immeuble.length});
console.log('scores', r.normalizedScores);

console.log('\n=== 3. Numéros de question HORS questionnaire (aucune réponse valide) ===');
const bogus = Array.from({length:20},(_,i)=>({question_number:100+i, answer_value:'promoteur'}));
r = calc(bogus);
console.log({base:r.baseType, phase:r.phaseType, risk:r.riskAlert, bc:r.baseConfidence, bi:r.baseIndetermine, validAnswers:r.report.confidence.validAnswers, immeuble:r.report.immeuble});

console.log('\n=== 4. Fréquence de l’alerte RPS sur 20000 répondants aléatoires uniformes ===');
let alertes=0, indetB=0, indetP=0, etagesTot=0, baseEqPhase=0;
const distBase = {}; const distPhase={};
for(let n=0;n<20000;n++){
  const a = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:TYPES[Math.floor(Math.random()*6)]}));
  const x = calc(a);
  if(x.riskAlert) alertes++;
  if(x.baseIndetermine) indetB++;
  if(x.phaseIndetermine) indetP++;
  etagesTot += x.report.immeuble.length;
  if(x.baseType===x.phaseType) baseEqPhase++;
  distBase[x.baseType]=(distBase[x.baseType]||0)+1;
  distPhase[x.phaseType]=(distPhase[x.phaseType]||0)+1;
}
console.log('alerte RPS :', (alertes/200).toFixed(1)+'%');
console.log('base indéterminée :', (indetB/200).toFixed(1)+'%', '| phase indéterminée :', (indetP/200).toFixed(1)+'%');
console.log('étages moyens dans l’immeuble :', (etagesTot/20000).toFixed(2), '/ 6');
console.log('base == phase :', (baseEqPhase/200).toFixed(1)+'%');
console.log('distribution base :', distBase);
console.log('distribution phase :', distPhase);

console.log('\n=== 5. Immeuble : la Base est-elle toujours l’étage le plus haut ? ===');
let nonMonotone=0;
for(let n=0;n<5000;n++){
  const a = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:TYPES[Math.floor(Math.random()*6)]}));
  const x = calc(a);
  const im = x.report.immeuble;
  if(im.length>1 && im[0].score < im[1].score) nonMonotone++;
}
console.log('immeubles où l’étage 1 (Base) a un score INFÉRIEUR à l’étage 2 :', (nonMonotone/50).toFixed(1)+'%');

console.log('\n=== 6. Déterminisme : même jeu de réponses, 2 appels ===');
const a6 = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:TYPES[(i*7)%6]}));
const x1=calc(a6), x2=calc(a6);
console.log('identique :', x1.baseType===x2.baseType && x1.phaseType===x2.phaseType, x1.baseType, x1.phaseType);

console.log('\n=== 7. Ordre des réponses : influence-t-il le résultat ? ===');
const a7 = a6.slice().reverse();
const x3 = calc(a7);
console.log('même profil après inversion de l’ordre :', x3.baseType===x1.baseType && x3.phaseType===x1.phaseType, x3.baseType, x3.phaseType);

console.log('\n=== 8. Réponses en double sur une même question (non dédupliquées) ===');
const dup = [...answersAll('empathique'), {question_number:1, answer_value:'promoteur'}, {question_number:1, answer_value:'promoteur'}];
const xd = calc(dup);
console.log({base:xd.baseType, phase:xd.phaseType, validAnswers:xd.report.confidence.validAnswers});

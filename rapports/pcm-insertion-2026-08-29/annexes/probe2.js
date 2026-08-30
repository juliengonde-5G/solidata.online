process.env.JWT_SECRET='x'; process.env.PCM_ENCRYPTION_KEY='y';
const calc = require('/home/user/solidata.online/backend/src/routes/pcm.js').calculatePCMProfile;
const T=['analyseur','perseverant','empathique','imagineur','energiseur','promoteur'];

console.log('=== A. question_number en CHAÎNE de caractères ("1" au lieu de 1) ===');
const strNums = Array.from({length:20},(_,i)=>({question_number:String(i+1), answer_value:'empathique'}));
let r = calc(strNums);
console.log({base:r.baseType, phase:r.phaseType, valides:r.report.confidence.validAnswers, bi:r.baseIndetermine, immeuble:r.report.immeuble.length});

console.log('\n=== B. 18 réponses, les 2 omises étant des questions STRESS (7 et 8) ===');
const a18 = [];
for(let i=1;i<=20;i++){ if(i===7||i===8) continue; a18.push({question_number:i, answer_value:'imagineur'}); }
r = calc(a18);
console.log({base:r.baseType, phase:r.phaseType, risk:r.riskAlert, valides:r.report.confidence.validAnswers, total:r.report.confidence.totalQuestions, rps:r.report.rpsIndicators});

console.log('\n=== C. Une seule réponse « stress » cohérente sur 3 → alerte ? ===');
const mix = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:'empathique'}));
mix[6]={question_number:7, answer_value:'analyseur'};  // stress 1
mix[7]={question_number:8, answer_value:'promoteur'};  // stress 2
r = calc(mix);
console.log({phase:r.phaseType, risk:r.riskAlert});

console.log('\n=== D. Poids : combien de points au maximum pour Base et Phase ? ===');
const cats={perception:[1,2,3],points_forts:[4],relation:[5],communication:[11,12,13],motivation:[6,9],stress:[7,8,10],besoin:[14,15,16,17],situation:[18,19,20]};
const w={perception:4,points_forts:3,relation:2,communication:2,motivation:3,stress:4,besoin:3,situation:1.5};
let base=0, phase=0;
for(const [c,qs] of Object.entries(cats)){
  const pts = qs.length*w[c];
  if(['perception','points_forts','relation','communication'].includes(c)) base+=pts; else phase+=pts;
  console.log(`  ${c.padEnd(13)} ${qs.length} question(s) × poids ${w[c]} = ${pts}`);
}
console.log(`  → Base max ${base} pts sur 7 questions | Phase max ${phase} pts sur 13 questions`);

console.log('\n=== E. Une SEULE réponse différente peut-elle changer la Base ? (sensibilité) ===');
let flips=0;
for(let n=0;n<2000;n++){
  const a = Array.from({length:20},(_,i)=>({question_number:i+1, answer_value:T[Math.floor(Math.random()*6)]}));
  const b0 = calc(a).baseType;
  const j = Math.floor(Math.random()*20);
  const alt = a.map((x,i)=> i===j ? {...x, answer_value:T[Math.floor(Math.random()*6)]} : x);
  if(calc(alt).baseType !== b0) flips++;
}
console.log('changement de Base après modification d’UNE seule réponse :', (flips/20).toFixed(1)+'%');

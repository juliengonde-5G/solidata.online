require('dotenv').config();
const pool = require('../config/database');
const https = require('https');
const http = require('http');

// Liste des associations issues du fichier Liste_asso.xlsx
const ASSOCIATIONS = [
  { name: "Association Saint-Vincent de Paul", address: "1 rue de l'église", code_postal: "76520", ville: "Boos", phone: "06 30 66 72 37" },
  { name: "Centre Jean Texcier", address: "", code_postal: "", ville: "" },
  { name: "Centre Social Etienne Perret", address: "59 rue des Canadiens", code_postal: "76420", ville: "Bihorel", phone: "02 35 60 35 26" },
  { name: "Cravate Solidaire", address: "9 Rue Georges Braque", complement: "Bâtiment Alpha", code_postal: "76000", ville: "Rouen", phone: "06 33 72 20 11" },
  { name: "Etablissements Paroïelle", address: "1556 Route de Lyons", code_postal: "76160", ville: "Saint-Léger-du-Bourg-Denis", phone: "06 08 16 38 73" },
  { name: "Facility Serv", address: "27 rue Alfred Kastler", code_postal: "76130", ville: "Mont-Saint-Aignan", phone: "07 77 00 47 77" },
  { name: "Foyer de l'abbé Bazire (Emergence\"S\")", address: "", code_postal: "", ville: "" },
  { name: "Fraternité Rouen", address: "14 rue de l'épine", code_postal: "76000", ville: "Rouen", phone: "06 07 66 13 70" },
  { name: "Greta Rouen Maritime", address: "17 Avenue Franklin Roosevelt", code_postal: "76120", ville: "Le Grand-Quevilly" },
  { name: "Halte Garderie les P'tits Loups", address: "", code_postal: "", ville: "" },
  { name: "Hippodrome des trois pipes (Mairie d'Etancourt)", address: "Rue de verdun", code_postal: "76420", ville: "Bihorel", phone: "06 08 09 75 77" },
  { name: "Hope", address: "1556 Route de lyons", code_postal: "76160", ville: "Saint-Léger-du-Bourg-Denis", phone: "06 36 19 82 80" },
  { name: "IDHEFI", address: "1004 Route de Sahurs", code_postal: "76380", ville: "Canteleu" },
  { name: "La Case Départ", address: "3c Rue de Bapeaume", code_postal: "76000", ville: "Rouen", phone: "06 26 63 85 33" },
  { name: "Labo Victor Hugo", address: "27 Rue Victor Hugo", code_postal: "76000", ville: "Rouen", phone: "02 35 76 47 60" },
  { name: "Les Restos du Cœur Darnetal", address: "", code_postal: "", ville: "" },
  { name: "Les Restos du Cœur Maromme", address: "13 Rue du Moulin À Poudre", code_postal: "76150", ville: "Maromme", phone: "02 35 75 10 05" },
  { name: "LYCEE DU SACRE CŒUR", address: "32 RUE BLAISE PASCAL", code_postal: "76100", ville: "Rouen" },
  { name: "M. Daniel (Particulier)", address: "", code_postal: "", ville: "" },
  { name: "Mairie de Rouen", address: "Mairie de Rouen", complement: "Bâtiment Bourg l'Abbé", code_postal: "76000", ville: "Rouen" },
  { name: "Maison de la Solidarité", address: "122 rue Pasteur", code_postal: "76530", ville: "Grand Couronne" },
  { name: "Secours Catholique Elbeuf", address: "Rue Saint Amand", code_postal: "76500", ville: "Elbeuf", phone: "09 80 83 47 74" },
  { name: "Secours Catholique Montville", address: "Rue du docteur Mathieu", code_postal: "76710", ville: "Montville", phone: "06 47 77 72 89" },
  { name: "Secours Catholique Thuit Anger", address: "1 rue de la Mare d'Aulne", code_postal: "27370", ville: "Le Thuit Anger", phone: "06 11 78 68 99" },
  { name: "Secours Populaire Le Grand-Quevilly", address: "100 rue de la République", code_postal: "76120", ville: "Le Grand-Quevilly" },
  { name: "Secours Populaire Le Petit-Quevilly", address: "25 Rue Joseph Lebas", code_postal: "76140", ville: "Le Petit-Quevilly", phone: "02 35 72 28 55" },
  { name: "Secours Populaire Oissel", address: "48 Allée André Maurois", code_postal: "76350", ville: "Oissel", phone: "07 77 05 71 85" },
  { name: "Secours Populaire Rouen", address: "17 rue Louis Poterat", code_postal: "76000", ville: "Rouen", phone: "02 35 72 15 56" },
  { name: "Secours Populaire Saint-Étienne-du-Rouvray", address: "24 Rue de Stalingrad", code_postal: "76800", ville: "Saint-Étienne-du-Rouvray", phone: "02 35 65 19 58" },
  { name: "Secours Populaire Sotteville", address: "24 rue Lazare Hoche", code_postal: "76300", ville: "Sotteville-Lès-Rouen", phone: "06 15 67 00 80" },
  { name: "Secours Populaire Yerville", address: "", code_postal: "", ville: "" },
  { name: "Seine Ecopolis Pépinière et hôtel d'entreprises", address: "45 Rue Robert HOOKE", code_postal: "76000", ville: "Rouen" },
  { name: "Seine Innopolis", address: "72 rue de la république", code_postal: "76140", ville: "Le Petit-Quevilly", phone: "02 35 76 47 80" },
  { name: "Vesti' amis (Sainte Thérèse du Madrillet)", address: "1 rue Georges Guynemer", code_postal: "76800", ville: "Saint-Étienne-du-Rouvray" },
  { name: "Vestiaire CCAS Grand Quevilly", address: "26 avenue Kennedy", complement: "Immeuble Dauphiné", code_postal: "76120", ville: "Le Grand-Quevilly", phone: "02 35 68 93 61" },
];

// Géocodage via API adresse.data.gouv.fr
function geocodeAddress(address, city, postcode) {
  return new Promise((resolve) => {
    if (!address || !city) { resolve(null); return; }
    const query = encodeURIComponent(`${address} ${city}`);
    const url = `https://api-adresse.data.gouv.fr/search/?q=${query}&postcode=${postcode}&limit=1`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.features && json.features.length > 0) {
            const [lng, lat] = json.features[0].geometry.coordinates;
            resolve({ latitude: lat, longitude: lng });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function seedAssociations() {
  console.log('[SEED-ASSO] Début du seed des associations...');

  for (const asso of ASSOCIATIONS) {
    // Vérifier si l'association existe déjà
    const exists = await pool.query('SELECT id FROM association_points WHERE name = $1', [asso.name]);
    if (exists.rows.length > 0) {
      console.log(`  [SKIP] ${asso.name} — déjà existante`);
      continue;
    }

    // Géocodage si adresse disponible
    let coords = null;
    if (asso.address && asso.ville) {
      coords = await geocodeAddress(asso.address, asso.ville, asso.code_postal);
      // Petit délai pour ne pas surcharger l'API
      await new Promise(r => setTimeout(r, 200));
    }

    const fullAddress = [asso.address, asso.complement].filter(Boolean).join(', ');

    await pool.query(
      `INSERT INTO association_points (name, address, complement_adresse, code_postal, ville, latitude, longitude, geom, contact_phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
         ${coords ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)` : 'NULL'},
         $8, 'active')`,
      [
        asso.name,
        fullAddress || null,
        asso.complement || null,
        asso.code_postal || null,
        asso.ville || null,
        coords?.latitude || null,
        coords?.longitude || null,
        asso.phone || null,
      ]
    );

    console.log(`  [OK] ${asso.name}${coords ? ` (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)})` : ' (sans coordonnées)'}`);
  }

  // Créer une route standard "Association" avec tous les points actifs géolocalisés
  const routeExists = await pool.query("SELECT id FROM standard_routes WHERE name = 'Association'");
  if (routeExists.rows.length === 0) {
    const routeResult = await pool.query(
      "INSERT INTO standard_routes (name, description, is_active) VALUES ('Association', 'Tournée de collecte des points associatifs', true) RETURNING id"
    );
    const routeId = routeResult.rows[0].id;

    const points = await pool.query(
      "SELECT id FROM association_points WHERE latitude IS NOT NULL AND status = 'active' ORDER BY ville, name"
    );
    for (let i = 0; i < points.rows.length; i++) {
      await pool.query(
        'INSERT INTO standard_route_association (route_id, association_point_id, position) VALUES ($1, $2, $3)',
        [routeId, points.rows[i].id, i + 1]
      );
    }
    console.log(`[SEED-ASSO] Route standard "Association" créée avec ${points.rows.length} points`);
  }

  console.log('[SEED-ASSO] Seed terminé !');
}

if (require.main === module) {
  seedAssociations()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
} else {
  module.exports = { seedAssociations, ASSOCIATIONS };
}

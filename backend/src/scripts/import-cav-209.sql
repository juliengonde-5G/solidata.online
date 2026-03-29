-- SOLIDATA — Import 209 CAV depuis CSV du 29-03-2026
-- Mode UPSERT: insère les nouveaux, met à jour les existants
BEGIN;

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-ÉTIENNE-DU-ROUVRAY - 47 Rue de Seine (Déchetterie - 9h / 12h - 14h / 17h)', '47 Rue de Seine, Déchetterie - 9h / 12h - 14h / 17h', 'SAINT-ÉTIENNE-DU-ROUVRAY', 49.3703846, 1.1109495, ST_SetSRID(ST_MakePoint(1.1109495, 49.3703846), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 4 Rue Paul Eluard (Hôpital Psychiatrique)', '4 Rue Paul Eluard, Hôpital Psychiatrique', 'SOTTEVILLE-LÈS-ROUEN', 49.39488192605717, 1.0941487999694788, ST_SetSRID(ST_MakePoint(1.0941487999694788, 49.39488192605717), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('DÉVILLE-LÈS-ROUEN - 34 Rue De Verdun', '34 Rue De Verdun', 'DÉVILLE-LÈS-ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 30 avenue du 14 juillet (Parking Stade Sottevillais)', '30 avenue du 14 juillet, Parking Stade Sottevillais', 'SOTTEVILLE-LÈS-ROUEN', 49.406198, 1.0982421, ST_SetSRID(ST_MakePoint(1.0982421, 49.406198), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('OISSEL - 6 Avenue Du Général De Gaulle (Centre Commercial Saint Julien)', '6 Avenue Du Général De Gaulle, Centre Commercial Saint Julien', 'OISSEL', 49.3383041, 1.0831592, ST_SetSRID(ST_MakePoint(1.0831592, 49.3383041), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('OISSEL - Rue Masson  (Place de la république)', 'Rue Masson, Place de la république', 'OISSEL', 49.340531, 1.094681, ST_SetSRID(ST_MakePoint(1.094681, 49.340531), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('TOURVILLE-LA-RIVIÈRE - Rue Jean Jaures (Place de la Poste)', 'Rue Jean Jaures, Place de la Poste', 'TOURVILLE-LA-RIVIÈRE', 49.2971761, 1.0160943, ST_SetSRID(ST_MakePoint(1.0160943, 49.2971761), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('TOURVILLE-LA-RIVIÈRE - Avenue Gustave Picard (Parking Carrefour)', 'Avenue Gustave Picard, Parking Carrefour', 'TOURVILLE-LA-RIVIÈRE', 49.32821531917378, 1.0973494076568802, ST_SetSRID(ST_MakePoint(1.0973494076568802, 49.32821531917378), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DUCLAIR - 28 rue de Ronnenberg (Face au Relais Dellard - Parking de droite)', '28 rue de Ronnenberg, Face au Relais Dellard - Parking de droite', 'DUCLAIR', 49.480997, 0.875153, ST_SetSRID(ST_MakePoint(0.875153, 49.480997), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 4 rue du Docteur Galouen', '4 rue du Docteur Galouen', 'SOTTEVILLE-LÈS-ROUEN', 49.400325, 1.080932, ST_SetSRID(ST_MakePoint(1.080932, 49.400325), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 19 rue Marius Vallée (Face au gymnase)', '19 rue Marius Vallée, Face au gymnase', 'SOTTEVILLE-LÈS-ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DUCLAIR - 5 impasse du Maupas (Déchetterie Hameau les Monts 9h-12h / 13h30-17h30)', '5 impasse du Maupas, Déchetterie Hameau les Monts 9h-12h / 13h30-17h30', 'DUCLAIR', 49.4908143, 0.8668575, ST_SetSRID(ST_MakePoint(0.8668575, 49.4908143), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BERVILLE-SUR-SEINE - 1061 rue du Village (Près de l''église)', '1061 rue du Village, Près de l''''église', 'BERVILLE-SUR-SEINE', 49.473411, 0.903698, ST_SetSRID(ST_MakePoint(0.903698, 49.473411), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 57 avenue des Canadiens (Angle rue L. Antier)', '57 avenue des Canadiens, Angle rue L. Antier', 'LE PETIT-QUEVILLY', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 136 avenue des Martyrs de la Résistance (Angle rue du Maréchal Galliéni)', '136 avenue des Martyrs de la Résistance, Angle rue du Maréchal Galliéni', 'LE PETIT-QUEVILLY', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 9 rue Pierre Forfait (Angle Place de Lattre de Tassigny)', '9 rue Pierre Forfait, Angle Place de Lattre de Tassigny', 'ROUEN', 49.43754, 1.0807013, ST_SetSRID(ST_MakePoint(1.0807013, 49.43754), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 2 rue Blaise Pascal (Angle rue d''Elbeuf)', '2 rue Blaise Pascal, Angle rue d''''Elbeuf', 'ROUEN', 49.428497, 1.084405, ST_SetSRID(ST_MakePoint(1.084405, 49.428497), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 103 rue Pierre Mendès-France (Parking Immeuble Habitat 76)', '103 rue Pierre Mendès-France, Parking Immeuble Habitat 76', 'SOTTEVILLE-LÈS-ROUEN', 49.4139236, 1.0927764, ST_SetSRID(ST_MakePoint(1.0927764, 49.4139236), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 36 rue Léon Salva (Angle rue Garibaldi)', '36 rue Léon Salva, Angle rue Garibaldi', 'SOTTEVILLE-LÈS-ROUEN', 49.4200766, 1.0907488, ST_SetSRID(ST_MakePoint(1.0907488, 49.4200766), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-LÈS-ROUEN - 59 Rue Pierre Bérégovoy (A coté de la colonne à verre)', '59 Rue Pierre Bérégovoy, A coté de la colonne à verre', 'SOTTEVILLE-LÈS-ROUEN', 49.4226399, 1.08954, ST_SetSRID(ST_MakePoint(1.08954, 49.4226399), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 77 rue Méridienne (Angle Rue Octave Crutel)', '77 rue Méridienne, Angle Rue Octave Crutel', 'ROUEN', 49.4250071, 1.0843887, ST_SetSRID(ST_MakePoint(1.0843887, 49.4250071), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 26 Rue Michel Corroy (Place Du Québec)', '26 Rue Michel Corroy, Place Du Québec', 'LE GRAND-QUEVILLY', 49.4017997, 1.057087, ST_SetSRID(ST_MakePoint(1.057087, 49.4017997), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 106 rue Paul Cezanne', '106 rue Paul Cezanne', 'LE GRAND-QUEVILLY', 49.4022886, 1.0432186, ST_SetSRID(ST_MakePoint(1.0432186, 49.4022886), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MONT-SAINT-AIGNAN - Centre Commercial La Vatine (Parking Carrefour)', 'Centre Commercial La Vatine, Parking Carrefour', 'MONT-SAINT-AIGNAN', 49.469906696445484, 1.0914162455078147, ST_SetSRID(ST_MakePoint(1.0914162455078147, 49.469906696445484), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BARENTIN - Centre commercial du Mesnil Roux (Parking Carrefour en face du Feu Vert)', 'Centre commercial du Mesnil Roux, Parking Carrefour en face du Feu Vert', 'BARENTIN', 49.53551416050364, 0.9655591899352833, ST_SetSRID(ST_MakePoint(0.9655591899352833, 49.53551416050364), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('FONTAINE-SOUS-PRÉAUX - 81 Route de la Fontaine (Parking Salle des fêtes)', '81 Route de la Fontaine, Parking Salle des fêtes', 'FONTAINE-SOUS-PRÉAUX', 49.4845001, 1.1655718, ST_SetSRID(ST_MakePoint(1.1655718, 49.4845001), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-MARTIN-DU-VIVIER - 1377 Route de la Vallée (Parking a coté de la Mairie)', '1377 Route de la Vallée, Parking a coté de la Mairie', 'SAINT-MARTIN-DU-VIVIER', 49.4675439, 1.1616814, ST_SetSRID(ST_MakePoint(1.1616814, 49.4675439), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('VAL-DE-LA-HAYE - 2 Rue Henri Chivé', '2 Rue Henri Chivé', 'VAL-DE-LA-HAYE', 49.3776629, 1.0022928, ST_SetSRID(ST_MakePoint(1.0022928, 49.3776629), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BIHOREL - 212 Rue du Sansonnet  (Parking derrière Centre Commercial du Chapitre)', '212 Rue du Sansonnet, Parking derrière Centre Commercial du Chapitre', 'BIHOREL', 49.4694847, 1.1423773, ST_SetSRID(ST_MakePoint(1.1423773, 49.4694847), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('RONCHEROLLES-SUR-LE-VIVIER - 20 Impasse Des Prés Verts (Parking Centre De Loisirs Les Pépinières)', '20 Impasse Des Prés Verts, Parking Centre De Loisirs Les Pépinières', 'RONCHEROLLES-SUR-LE-VIVIER', 49.4642576, 1.1791064, ST_SetSRID(ST_MakePoint(1.1791064, 49.4642576), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BOOS - 60 Impasse de la Grande Mare', '60 Impasse de la Grande Mare', 'BOOS', 49.3897847, 1.2007032, ST_SetSRID(ST_MakePoint(1.2007032, 49.3897847), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('FRANQUEVILLE-SAINT-PIERRE - 962 Rue Pierre Curie (Cimetière)', '962 Rue Pierre Curie, Cimetière', 'FRANQUEVILLE-SAINT-PIERRE', 49.4064014, 1.1781562, ST_SetSRID(ST_MakePoint(1.1781562, 49.4064014), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MALAUNAY - 10 Rue Louis Lesouef (Parking face à Renault)', '10 Rue Louis Lesouef, Parking face à Renault', 'MALAUNAY', 49.5224944, 1.0376784, ST_SetSRID(ST_MakePoint(1.0376784, 49.5224944), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MONTVILLE - 1 Sentier des Jumelles (Parking Intermarché)', '1 Sentier des Jumelles, Parking Intermarché', 'MONTVILLE', 49.5405801, 1.0634101, ST_SetSRID(ST_MakePoint(1.0634101, 49.5405801), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MONTVILLE - 693 rue des Reservoirs (Déchetterie - 9h30 / 11h45)', '693 rue des Reservoirs, Déchetterie - 9h30 / 11h45', 'MONTVILLE', 49.5379517, 1.0999617, ST_SetSRID(ST_MakePoint(1.0999617, 49.5379517), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('FONTAINE LE BOURG - 318 rue Delamare Deboutteville', '318 rue Delamare Deboutteville', 'FONTAINE LE BOURG', 49.5616059, 1.1605071, ST_SetSRID(ST_MakePoint(1.1605071, 49.5616059), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('QUINCAMPOIX - 11 Rue de Cailly (Parking du Cimetière)', '11 Rue de Cailly, Parking du Cimetière', 'QUINCAMPOIX', 49.5145259, 1.1705615, ST_SetSRID(ST_MakePoint(1.1705615, 49.5145259), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('HAUTOT-SUR-SEINE - 8 rue de l''Eglise (Place Poullard)', '8 rue de l''''Eglise, Place Poullard', 'HAUTOT-SUR-SEINE', 49.3603847, 0.9783553, ST_SetSRID(ST_MakePoint(0.9783553, 49.3603847), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ISNEAUVILLE - 3 Route de Dieppe (Parking Intermarché)', '3 Route de Dieppe, Parking Intermarché', 'ISNEAUVILLE', 49.5024921, 1.1504061, ST_SetSRID(ST_MakePoint(1.1504061, 49.5024921), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('ROUEN - 64 Boulevard d''Orléans (En face du Coccinelle)', '64 Boulevard d''''Orléans, En face du Coccinelle', 'ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ISNEAUVILLE - 31 Rue André Le Nosle', '31 Rue André Le Nosle', 'ISNEAUVILLE', 49.4946399, 1.1446697, ST_SetSRID(ST_MakePoint(1.1446697, 49.4946399), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('HOUPPEVILLE - 86 rue de la Voix Maline (A coté de la colonne à verre)', '86 rue de la Voix Maline, A coté de la colonne à verre', 'HOUPPEVILLE', 49.511496, 1.087103, ST_SetSRID(ST_MakePoint(1.087103, 49.511496), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('HOUPPEVILLE - 140 Rue Louis Pasteur (Près des Jardins ouvriers)', '140 Rue Louis Pasteur, Près des Jardins ouvriers', 'HOUPPEVILLE', 49.5095306, 1.0702444, ST_SetSRID(ST_MakePoint(1.0702444, 49.5095306), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAHURS - 3 Rue du Bas (Parking Place Maurice Alexandre)', '3 Rue du Bas, Parking Place Maurice Alexandre', 'SAHURS', 49.357756, 0.943662, ST_SetSRID(ST_MakePoint(0.943662, 49.357756), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('NOTRE-DAME-DE-BONDEVILLE - 90 rue des longs Vallons', '90 rue des longs Vallons', 'NOTRE-DAME-DE-BONDEVILLE', 49.4839336, 1.0494244, ST_SetSRID(ST_MakePoint(1.0494244, 49.4839336), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PIERRE-DE-MANNEVILLE - 15 Route de Sahurs (Parking près de la mairie)', '15 Route de Sahurs, Parking près de la mairie', 'SAINT-PIERRE-DE-MANNEVILLE', 49.390736, 0.9316159, ST_SetSRID(ST_MakePoint(0.9316159, 49.390736), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOTTEVILLE-SOUS-LE-VAL - 2 Chemin des devises (Croisement avec Rue des canadiens)', '2 Chemin des devises, Croisement avec Rue des canadiens', 'SOTTEVILLE-SOUS-LE-VAL', 49.3183323, 1.1233006, ST_SetSRID(ST_MakePoint(1.1233006, 49.3183323), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('QUEVILLON - 31 Route de Belaitre (Parking Verger et Gite de Belaitre)', '31 Route de Belaitre, Parking Verger et Gite de Belaitre', 'QUEVILLON', 49.424576, 0.955078, ST_SetSRID(ST_MakePoint(0.955078, 49.424576), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-MARTIN-DE-BOSCHERVILLE - 62 Route de l''Abbaye (Au fond du parking)', '62 Route de l''''Abbaye, Au fond du parking', 'SAINT-MARTIN-DE-BOSCHERVILLE', 49.4486164, 0.9677917, ST_SetSRID(ST_MakePoint(0.9677917, 49.4486164), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('NOTRE-DAME-DE-BONDEVILLE - Rue des Bernardines (Devant les ateliers municipaux)', 'Rue des Bernardines, Devant les ateliers municipaux', 'NOTRE-DAME-DE-BONDEVILLE', 49.4907799, 1.0424471, ST_SetSRID(ST_MakePoint(1.0424471, 49.4907799), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('INCARVILLE - 19 Rue des Prés (Parking Leclerc)', '19 Rue des Prés, Parking Leclerc', 'INCARVILLE', 49.2372353, 1.1808578, ST_SetSRID(ST_MakePoint(1.1808578, 49.2372353), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE MESNIL-ESNARD - 3 Rue Gontran Pailhès (Carrefour Market)', '3 Rue Gontran Pailhès, Carrefour Market', 'LE MESNIL-ESNARD', 49.4074142, 1.1528802, ST_SetSRID(ST_MakePoint(1.1528802, 49.4074142), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-MARTIN-DE-BOSCHERVILLE - 17 Chaussée Saint-Georges (Dechetterie)', '17 Chaussée Saint-Georges, Dechetterie', 'SAINT-MARTIN-DE-BOSCHERVILLE', 49.447552278510685, 0.9579646815147447, ST_SetSRID(ST_MakePoint(0.9579646815147447, 49.447552278510685), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LOUVIERS - 2 rue Saint-Jean (CHU - Dans l''enceinte de l''Hôpital - Parking)', '2 rue Saint-Jean, CHU - Dans l''''enceinte de l''''Hôpital - Parking', 'LOUVIERS', 49.211441967209545, 1.1766511509956334, ST_SetSRID(ST_MakePoint(1.1766511509956334, 49.211441967209545), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BARDOUVILLE - 300 rue de l’Ecole (En face du cimetière)', '300 rue de l’Ecole, En face du cimetière', 'BARDOUVILLE', 49.43626, 0.927723, ST_SetSRID(ST_MakePoint(0.927723, 49.43626), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('QUATREMARE - 3 route de Louviers', '3 route de Louviers', 'QUATREMARE', 49.1854483, 1.0824028, ST_SetSRID(ST_MakePoint(1.0824028, 49.1854483), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('BOIS-GUILLAUME - 2001 rue Herbeuse (Déchetterie - 9h / 12h - 14h / 17h30)', '2001 rue Herbeuse, Déchetterie - 9h / 12h - 14h / 17h30', 'BOIS-GUILLAUME', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('PITRES - 30 Rue de l''Eglise (Salle des fêtes)', '30 Rue de l''''Eglise, Salle des fêtes', 'PITRES', 49.3185296, 1.2295495, ST_SetSRID(ST_MakePoint(1.2295495, 49.3185296), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ANNEVILLE-AMBOURVILLE - 2701 route de Bourg Achard (Déchetterie)', '2701 route de Bourg Achard, Déchetterie', 'ANNEVILLE-AMBOURVILLE', 49.4331906, 0.892609, ST_SetSRID(ST_MakePoint(0.892609, 49.4331906), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BONSECOURS - 23 Rue Camille Saint Saens (Parking du Stade des Hautes Haies)', '23 Rue Camille Saint Saens, Parking du Stade des Hautes Haies', 'BONSECOURS', 49.42201, 1.1299639, ST_SetSRID(ST_MakePoint(1.1299639, 49.42201), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROMILLY-SUR-ANDELLE - 1674 rue Blingue', '1674 rue Blingue', 'ROMILLY-SUR-ANDELLE', 49.3276351, 1.2530567, ST_SetSRID(ST_MakePoint(1.2530567, 49.3276351), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE TRAIT - Boulevard Industriel (Déchetterie LE TRAIT)', 'Boulevard Industriel, Déchetterie LE TRAIT', 'LE TRAIT', 49.486032792820005, 0.7935174407226686, ST_SetSRID(ST_MakePoint(0.7935174407226686, 49.486032792820005), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE TRAIT - 365 Rue Denis Papin (Parking Carrefour Market)', '365 Rue Denis Papin, Parking Carrefour Market', 'LE TRAIT', 49.4829822, 0.8071803, ST_SetSRID(ST_MakePoint(0.8071803, 49.4829822), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('HÉNOUVILLE - 9 rue du Stade (Salle polyvalente - Ecole)', '9 rue du Stade, Salle polyvalente - Ecole', 'HÉNOUVILLE', 49.4796359, 0.9594667, ST_SetSRID(ST_MakePoint(0.9594667, 49.4796359), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('JUMIÈGES - 752 Rue Alphonse Calais (Parking Camping-car)', '752 Rue Alphonse Calais, Parking Camping-car', 'JUMIÈGES', 49.4304292, 0.8143114, ST_SetSRID(ST_MakePoint(0.8143114, 49.4304292), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('YAINVILLE - 1 Rue de la République (Allée derrière la pharmacie)', '1 Rue de la République, Allée derrière la pharmacie', 'YAINVILLE', 49.4540569, 0.8300998, ST_SetSRID(ST_MakePoint(0.8300998, 49.4540569), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 132 rue du Président Kennedy (Croisement rue de la République)', '132 rue du Président Kennedy, Croisement rue de la République', 'LE PETIT-QUEVILLY', 49.4316933, 1.0670571, ST_SetSRID(ST_MakePoint(1.0670571, 49.4316933), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 87 rue Jean Macé (Croisement rue Francois Mitterand)', '87 rue Jean Macé, Croisement rue Francois Mitterand', 'LE PETIT-QUEVILLY', 49.4242357, 1.0626464, ST_SetSRID(ST_MakePoint(1.0626464, 49.4242357), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ELBEUF - 26 Rue Leveillé', '26 Rue Leveillé', 'ELBEUF', 49.2844764, 1.0063901, ST_SetSRID(ST_MakePoint(1.0063901, 49.2844764), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CLÉON - Rue Marie-Louise et Raymond Boucher (Déchetterie de Cléon - 10h / 18h)', 'Rue Marie-Louise et Raymond Boucher, Déchetterie de Cléon - 10h / 18h', 'CLÉON', 49.31915735339666, 1.0562184915405437, ST_SetSRID(ST_MakePoint(1.0562184915405437, 49.31915735339666), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE MESNIL-ESNARD - 5 Rue des Perets (Parking de l''école)', '5 Rue des Perets, Parking de l''''école', 'LE MESNIL-ESNARD', 49.411191, 1.134608, ST_SetSRID(ST_MakePoint(1.134608, 49.411191), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('AMFREVILLE-LA-MI-VOIE - 25 rue François Mitterrand', '25 rue François Mitterrand', 'AMFREVILLE-LA-MI-VOIE', 49.397001, 1.1257119, ST_SetSRID(ST_MakePoint(1.1257119, 49.397001), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('AMFREVILLE-LA-MI-VOIE - 541 Chemin du Mesnil-Esnard (Parking de la crèche - Ecole Maternelle)', '541 Chemin du Mesnil-Esnard, Parking de la crèche - Ecole Maternelle', 'AMFREVILLE-LA-MI-VOIE', 49.4021325, 1.1314687, ST_SetSRID(ST_MakePoint(1.1314687, 49.4021325), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 1 Quai du Pré aux loups (Dechetterie - 8h30 / 18h30)', '1 Quai du Pré aux loups, Dechetterie - 8h30 / 18h30', 'ROUEN', 49.434978814830345, 1.1034501640708916, ST_SetSRID(ST_MakePoint(1.1034501640708916, 49.434978814830345), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 1 Avenue Jacques Chastellain (Ile Lacroix)', '1 Avenue Jacques Chastellain, Ile Lacroix', 'ROUEN', 49.4311553, 1.1022802, ST_SetSRID(ST_MakePoint(1.1022802, 49.4311553), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DÉVILLE-LÈS-ROUEN - 18 Impasse Barbet (Déchetterie)', '18 Impasse Barbet, Déchetterie', 'DÉVILLE-LÈS-ROUEN', 49.4590316, 1.0477964, ST_SetSRID(ST_MakePoint(1.0477964, 49.4590316), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-JEAN-DU-CARDONNAY - Côte de la Valette (Déchetterie de Maromme - 8h30 /18h30)', 'Côte de la Valette, Déchetterie de Maromme - 8h30 /18h30', 'SAINT-JEAN-DU-CARDONNAY', 49.487386476098955, 1.0248914560668787, ST_SetSRID(ST_MakePoint(1.0248914560668787, 49.487386476098955), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-LÉGER-DU-BOURG-DENIS - 76 rue des Sources (Parking Mairie)', '76 rue des Sources, Parking Mairie', 'SAINT-LÉGER-DU-BOURG-DENIS', 49.43243, 1.157459, ST_SetSRID(ST_MakePoint(1.157459, 49.43243), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-LÉGER-DU-BOURG-DENIS - 321 Rue des broches', '321 Rue des broches', 'SAINT-LÉGER-DU-BOURG-DENIS', 49.4321409, 1.1461591, ST_SetSRID(ST_MakePoint(1.1461591, 49.4321409), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-EPINAY - 127 Rue de l''Eglise (Parking de l''école)', '127 Rue de l''''Eglise, Parking de l''''école', 'SAINT-AUBIN-EPINAY', 49.4217741, 1.1770492, ST_SetSRID(ST_MakePoint(1.1770492, 49.4217741), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('PONT-SAINT-PIERRE - 2 rue du Collège (Parking de la Piscine)', '2 rue du Collège, Parking de la Piscine', 'PONT-SAINT-PIERRE', 49.3372127, 1.2742826, ST_SetSRID(ST_MakePoint(1.2742826, 49.3372127), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINTE-MARGUERITE-SUR-DUCLAIR - 14 Route de Saint Paër (Parking)', '14 Route de Saint Paër, Parking', 'SAINTE-MARGUERITE-SUR-DUCLAIR', 49.508078, 0.8399526, ST_SetSRID(ST_MakePoint(0.8399526, 49.508078), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-JACQUES-SUR-DARNÉTAL - 35 Rue de Verdun (Entre la Mairie et l''Eglise)', '35 Rue de Verdun, Entre la Mairie et l''''Eglise', 'SAINT-JACQUES-SUR-DARNÉTAL', 49.4400478, 1.2027215, ST_SetSRID(ST_MakePoint(1.2027215, 49.4400478), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 98 Rue Sadi Carnot (Face à la Mairie)', '98 Rue Sadi Carnot, Face à la Mairie', 'DARNÉTAL', 49.4406483, 1.144694, ST_SetSRID(ST_MakePoint(1.144694, 49.4406483), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 152 rue Gambetta (Croisement rue Paul Langevin - Près école de musique)', '152 rue Gambetta, Croisement rue Paul Langevin - Près école de musique', 'LE PETIT-QUEVILLY', 49.4141603, 1.0666575, ST_SetSRID(ST_MakePoint(1.0666575, 49.4141603), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BOURG-ACHARD - 510 Rue du Dr Duvrac (Parking Loic Gréaume)', '510 Rue du Dr Duvrac, Parking Loic Gréaume', 'BOURG-ACHARD', 49.3593819, 0.8181938, ST_SetSRID(ST_MakePoint(0.8181938, 49.3593819), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA BOUILLE - 111 Allée des Lauriers', '111 Allée des Lauriers', 'LA BOUILLE', 49.35053640212772, 0.9335095079345601, ST_SetSRID(ST_MakePoint(0.9335095079345601, 49.35053640212772), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CLÉON - 83 rue Alain Colas (Parking Leader Price)', '83 rue Alain Colas, Parking Leader Price', 'CLÉON', 49.30898629499202, 1.0371775086677637, ST_SetSRID(ST_MakePoint(1.0371775086677637, 49.30898629499202), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ELBEUF - 7 Rue du Neubourg (Carrefour Market - Station Service)', '7 Rue du Neubourg, Carrefour Market - Station Service', 'ELBEUF', 49.285096, 1.0099438, ST_SetSRID(ST_MakePoint(1.0099438, 49.285096), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 8 Rue Lenormand', '8 Rue Lenormand', 'CAUDEBEC-LÈS-ELBEUF', 49.284012, 1.0126363, ST_SetSRID(ST_MakePoint(1.0126363, 49.284012), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 856 Rue Emile Zola', '856 Rue Emile Zola', 'CAUDEBEC-LÈS-ELBEUF', 49.2815389, 1.0204458, ST_SetSRID(ST_MakePoint(1.0204458, 49.2815389), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 67 Rue de Strasbourg (Place de l''Assemblée)', '67 Rue de Strasbourg, Place de l''''Assemblée', 'CAUDEBEC-LÈS-ELBEUF', 49.2916303, 1.0284224, ST_SetSRID(ST_MakePoint(1.0284224, 49.2916303), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 37 Rue Edouard Branly', '37 Rue Edouard Branly', 'DARNÉTAL', 49.4419378, 1.1433416, ST_SetSRID(ST_MakePoint(1.1433416, 49.4419378), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 1 Rue de Préaux (Rond Point de la Girafe - Face à boulangerie)', '1 Rue de Préaux, Rond Point de la Girafe - Face à boulangerie', 'DARNÉTAL', 49.4493106, 1.1513028, ST_SetSRID(ST_MakePoint(1.1513028, 49.4493106), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MOULINEAUX - 79 Chemin des Coquelicots', '79 Chemin des Coquelicots', 'MOULINEAUX', 49.3427399, 0.9664346, ST_SetSRID(ST_MakePoint(0.9664346, 49.3427399), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA LONDE - 30 rue des Fusillés (Croisement rue Frete)', '30 rue des Fusillés, Croisement rue Frete', 'LA LONDE', 49.3063384, 0.9602677, ST_SetSRID(ST_MakePoint(0.9602677, 49.3063384), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA NEUVILLE-CHANT-D''OISEL - Rue du Froc aux Moines (Stade de Foot)', 'Rue du Froc aux Moines, Stade de Foot', 'LA NEUVILLE-CHANT-D''''OISEL', 49.368749062688885, 1.2451182344627432, ST_SetSRID(ST_MakePoint(1.2451182344627432, 49.368749062688885), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA LONDE - 590 rue Adolphe Marie (Stade de Foot)', '590 rue Adolphe Marie, Stade de Foot', 'LA LONDE', 49.3021885, 0.950701, ST_SetSRID(ST_MakePoint(0.950701, 49.3021885), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PIERRE-LÈS-ELBEUF - 67 rue Galbois (Parking à coté des écoles)', '67 rue Galbois, Parking à coté des écoles', 'SAINT-PIERRE-LÈS-ELBEUF', 49.2712549, 1.049438, ST_SetSRID(ST_MakePoint(1.049438, 49.2712549), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-OUEN-DU-TILLEUL - 40 rue des Canadiens (Face à la Mairie)', '40 rue des Canadiens, Face à la Mairie', 'SAINT-OUEN-DU-TILLEUL', 49.2949586, 0.9503699, ST_SetSRID(ST_MakePoint(0.9503699, 49.2949586), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PIERRE-LÈS-ELBEUF - 625 rue du Puits Mérot (Parking Leader Price / Face à la mairie)', '625 rue du Puits Mérot, Parking Leader Price / Face à la mairie', 'SAINT-PIERRE-LÈS-ELBEUF', 49.2761596, 1.0432253, ST_SetSRID(ST_MakePoint(1.0432253, 49.2761596), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA SAUSSAYE - 22 Route du Neubourg (Derrière le Manoir Saint-Nicolas)', '22 Route du Neubourg, Derrière le Manoir Saint-Nicolas', 'LA SAUSSAYE', 49.260836, 0.9767508, ST_SetSRID(ST_MakePoint(0.9767508, 49.260836), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 318 Rue Antoine de Saint Exupery', '318 Rue Antoine de Saint Exupery', 'CAUDEBEC-LÈS-ELBEUF', 49.276142, 1.0267816, ST_SetSRID(ST_MakePoint(1.0267816, 49.276142), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - Rue du Docteur Villers (CHI - Parking usagers)', 'Rue du Docteur Villers, CHI - Parking usagers', 'SAINT-AUBIN-LÈS-ELBEUF', 49.30416367931222, 1.0422025843391358, ST_SetSRID(ST_MakePoint(1.0422025843391358, 49.30416367931222), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - Rue du Docteur Villers (Entrée EHPAD)', 'Rue du Docteur Villers, Entrée EHPAD', 'SAINT-AUBIN-LÈS-ELBEUF', 49.30401280525894, 1.041674189163202, ST_SetSRID(ST_MakePoint(1.041674189163202, 49.30401280525894), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - 20 Espace Foudriots (Derrière La Poste)', '20 Espace Foudriots, Derrière La Poste', 'SAINT-AUBIN-LÈS-ELBEUF', 49.3027597, 1.0127645, ST_SetSRID(ST_MakePoint(1.0127645, 49.3027597), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - 5 rue Pierre Saint Georges (Gare de Saint Aubin)', '5 rue Pierre Saint Georges, Gare de Saint Aubin', 'SAINT-AUBIN-LÈS-ELBEUF', 49.3027374, 1.0089665, ST_SetSRID(ST_MakePoint(1.0089665, 49.3027374), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 1049 Rue de la Villette', '1049 Rue de la Villette', 'CAUDEBEC-LÈS-ELBEUF', 49.282711, 1.035268, ST_SetSRID(ST_MakePoint(1.035268, 49.282711), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ELBEUF - 2 rue Jean Jaures (Sous le pont Jean Jaurès)', '2 rue Jean Jaures, Sous le pont Jean Jaurès', 'ELBEUF', 49.2919875, 1.009519, ST_SetSRID(ST_MakePoint(1.009519, 49.2919875), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('SAINT-PIERRE-DES-FLEURS - Route de Neuboug (Parking Cimetière)', 'Route de Neuboug, Parking Cimetière', 'SAINT-PIERRE-DES-FLEURS', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ELBEUF - 13 Rue de Rouen (D 938 sortie ELBEUF)', '13 Rue de Rouen, D 938 sortie ELBEUF', 'ELBEUF', 49.2938423, 0.9962223, ST_SetSRID(ST_MakePoint(0.9962223, 49.2938423), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ORIVAL - 26 Rue de Rouen', '26 Rue de Rouen', 'ORIVAL', 49.2972863, 0.9944486, ST_SetSRID(ST_MakePoint(0.9944486, 49.2972863), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CAUDEBEC-LÈS-ELBEUF - 627 Rue de la Chaussée (Déchetterie)', '627 Rue de la Chaussée, Déchetterie', 'CAUDEBEC-LÈS-ELBEUF', 49.2908071, 1.0306552, ST_SetSRID(ST_MakePoint(1.0306552, 49.2908071), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PIERRE-LÈS-ELBEUF - Route de Pont de l''Arche (En face L''Auto E.Leclerc)', 'Route de Pont de l''''Arche, En face L''''Auto E.Leclerc', 'SAINT-PIERRE-LÈS-ELBEUF', 49.290625826596894, 1.0378892518066296, ST_SetSRID(ST_MakePoint(1.0378892518066296, 49.290625826596894), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - CHI  rue du docteur Villers (entrée des urgences)', 'CHI  rue du docteur Villers, entrée des urgences', 'SAINT-AUBIN-LÈS-ELBEUF', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 33 Rue du Roule', '33 Rue du Roule', 'DARNÉTAL', 49.438313, 1.1668016, ST_SetSRID(ST_MakePoint(1.1668016, 49.438313), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-LÈS-ELBEUF - 26 Rue de Freneuse (Croisement ruelle Arthus)', '26 Rue de Freneuse, Croisement ruelle Arthus', 'SAINT-AUBIN-LÈS-ELBEUF', 49.2994624, 1.0403029, ST_SetSRID(ST_MakePoint(1.0403029, 49.2994624), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('ROUEN - 238 Rue Saint Julien (Angle Rue Jacquard)', '238 Rue Saint Julien, Angle Rue Jacquard', 'ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE PETIT-QUEVILLY - 438 Chemin du Gord (Déchetterie - 9h / 12h - 14h 17h00)', '438 Chemin du Gord, Déchetterie - 9h / 12h - 14h 17h00', 'LE PETIT-QUEVILLY', 49.4266815, 1.038447, ST_SetSRID(ST_MakePoint(1.038447, 49.4266815), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 229 Rue Saint Julien (Angle rue Parmentier)', '229 Rue Saint Julien, Angle rue Parmentier', 'ROUEN', 49.425260390877064, 1.0725975521148579, ST_SetSRID(ST_MakePoint(1.0725975521148579, 49.425260390877064), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('QUÉVREVILLE-LA-POTERIE - Chemin du Vaudin (Parking Salle des fêtes)', 'Chemin du Vaudin, Parking Salle des fêtes', 'QUÉVREVILLE-LA-POTERIE', 49.35613833102769, 1.1879760402282624, ST_SetSRID(ST_MakePoint(1.1879760402282624, 49.35613833102769), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('YMARE - Mairie (Pôle Déchets)', 'Mairie, Pôle Déchets', 'YMARE', 49.3503139, 1.1778794, ST_SetSRID(ST_MakePoint(1.1778794, 49.3503139), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LES AUTHIEUX-SUR-LE-PORT-SAINT-OUEN - 260 rue du Docteur Gallouen (Parking de la salle des fêtes)', '260 rue du Docteur Gallouen, Parking de la salle des fêtes', 'LES AUTHIEUX-SUR-LE-PORT-SAINT-OUEN', 49.3408846, 1.1328675, ST_SetSRID(ST_MakePoint(1.1328675, 49.3408846), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('GOUY - 28 rue du Poste (Suivre "Résidence Perelles" - Sur le parking)', '28 rue du Poste, Suivre "Résidence Perelles" - Sur le parking', 'GOUY', 49.3534984, 1.1474265, ST_SetSRID(ST_MakePoint(1.1474265, 49.3534984), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 19 rue du Général Giraud', '19 rue du Général Giraud', 'ROUEN', 49.4414885, 1.0865305, ST_SetSRID(ST_MakePoint(1.0865305, 49.4414885), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 25 rue de la Poterne (Entrée escalier Parking)', '25 rue de la Poterne, Entrée escalier Parking', 'ROUEN', 49.4435782, 1.0926687, ST_SetSRID(ST_MakePoint(1.0926687, 49.4435782), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 35 rue Orbe (Près de Franprix)', '35 rue Orbe, Près de Franprix', 'ROUEN', 49.4431433, 1.1041131, ST_SetSRID(ST_MakePoint(1.1041131, 49.4431433), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 72 rue de Martainville', '72 rue de Martainville', 'ROUEN', 49.4386581, 1.1036246, ST_SetSRID(ST_MakePoint(1.1036246, 49.4386581), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 2 Rue François Couperin (Parking Eglise Sainte-Claire)', '2 Rue François Couperin, Parking Eglise Sainte-Claire', 'ROUEN', 49.4477877, 1.1406381, ST_SetSRID(ST_MakePoint(1.1406381, 49.4477877), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('ROUEN - 27 rue Saint-Sever (Cours Clémenceau)', '27 rue Saint-Sever, Cours Clémenceau', 'ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 2 Rue Roger Bésus (Centre Charlotte Delbo)', '2 Rue Roger Bésus, Centre Charlotte Delbo', 'ROUEN', 49.4233886, 1.0706877, ST_SetSRID(ST_MakePoint(1.0706877, 49.4233886), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 2 rue Edouard Branly', '2 rue Edouard Branly', 'DARNÉTAL', 49.4412967, 1.1414569, ST_SetSRID(ST_MakePoint(1.1414569, 49.4412967), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 132 Rue de la République (Centre Marx Dormoy)', '132 Rue de la République, Centre Marx Dormoy', 'LE GRAND-QUEVILLY', 49.4136846, 1.0342013, ST_SetSRID(ST_MakePoint(1.0342013, 49.4136846), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-AUBIN-CELLOVILLE - 12 Rue de la Mairie  (Ruelle Atelier Municipal - Salle des Fêtes)', '12 Rue de la Mairie, Ruelle Atelier Municipal - Salle des Fêtes', 'SAINT-AUBIN-CELLOVILLE', 49.364568, 1.155796, ST_SetSRID(ST_MakePoint(1.155796, 49.364568), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - Rue du Chanoine Maubec (Angle Ferdinand Marrou - Derrière le Coccinelle)', 'Rue du Chanoine Maubec, Angle Ferdinand Marrou - Derrière le Coccinelle', 'ROUEN', 49.45720248268819, 1.1296958227538978, ST_SetSRID(ST_MakePoint(1.1296958227538978, 49.45720248268819), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 41 Rue des Canadiens', '41 Rue des Canadiens', 'ROUEN', 49.4524062, 1.118665, ST_SetSRID(ST_MakePoint(1.118665, 49.4524062), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BIHOREL - 15 Rue Philibert Caux (En face de l''école Ste Victrice)', '15 Rue Philibert Caux, En face de l''''école Ste Victrice', 'BIHOREL', 49.4591153, 1.1144951, ST_SetSRID(ST_MakePoint(1.1144951, 49.4591153), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DÉVILLE-LÈS-ROUEN - 51 Rue de la République (Devant Créapolis)', '51 Rue de la République, Devant Créapolis', 'DÉVILLE-LÈS-ROUEN', 49.473328, 1.041946, ST_SetSRID(ST_MakePoint(1.041946, 49.473328), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 8 Sente de la Ravine (Déchetterie)', '8 Sente de la Ravine, Déchetterie', 'DARNÉTAL', 49.4450289, 1.160058, ST_SetSRID(ST_MakePoint(1.160058, 49.4450289), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROCQUEMONT - 709 Grande Rue  (Côté Eglise)', '709 Grande Rue, Côté Eglise', 'ROCQUEMONT', 49.603358, 1.284158, ST_SetSRID(ST_MakePoint(1.284158, 49.603358), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MONTEROLIER - 1 Rue du Mesnil (Devant le terrain de tennis)', '1 Rue du Mesnil, Devant le terrain de tennis', 'MONTEROLIER', 49.6276563, 1.3446324, ST_SetSRID(ST_MakePoint(1.3446324, 49.6276563), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SOMMERY - 479 rue de la Gare (Parking Gare)', '479 rue de la Gare, Parking Gare', 'SOMMERY', 49.6298681, 1.4354724, ST_SetSRID(ST_MakePoint(1.4354724, 49.6298681), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('NEUFCHATEL-EN-BRAY - 29 Impasse de la Gare (Face crèperie)', '29 Impasse de la Gare, Face crèperie', 'NEUFCHATEL-EN-BRAY', 49.7334807, 1.4359706, ST_SetSRID(ST_MakePoint(1.4359706, 49.7334807), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DARNÉTAL - 10 rue aux Juifs', '10 rue aux Juifs', 'DARNÉTAL', 49.4373767, 1.1484635, ST_SetSRID(ST_MakePoint(1.1484635, 49.4373767), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BIHOREL - 34 Rue de Verdun (Parking de la Piscine Transat)', '34 Rue de Verdun, Parking de la Piscine Transat', 'BIHOREL', 49.459388, 1.1233008, ST_SetSRID(ST_MakePoint(1.1233008, 49.459388), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BOOS - Rue des Canadiens (Déchetterie Boos - D91 vers Saint-Aubin-Celloville)', 'Rue des Canadiens, Déchetterie Boos - D91 vers Saint-Aubin-Celloville', 'BOOS', 49.3757041412845, 1.18180979092406, ST_SetSRID(ST_MakePoint(1.18180979092406, 49.3757041412845), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BELBEUF - 8 rue des canadiens (Parking Salle Jacques Anquetil)', '8 rue des canadiens, Parking Salle Jacques Anquetil', 'BELBEUF', 49.388972, 1.140556, ST_SetSRID(ST_MakePoint(1.140556, 49.388972), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BAPEAUME-LÈS-ROUEN - 9021 Rue du Canal (Derrière la Station Service)', '9021 Rue du Canal, Derrière la Station Service', 'BAPEAUME-LÈS-ROUEN', 49.4584663, 1.0438016, ST_SetSRID(ST_MakePoint(1.0438016, 49.4584663), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 11 Rue Antheaume (Résidence Vallon Saint Hilaire)', '11 Rue Antheaume, Résidence Vallon Saint Hilaire', 'ROUEN', 49.4448577, 1.1168911, ST_SetSRID(ST_MakePoint(1.1168911, 49.4448577), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DÉVILLE-LÈS-ROUEN - 340 Route de Dieppe (Parking Salle communale (Mairie))', '340 Route de Dieppe, Parking Salle communale (Mairie)', 'DÉVILLE-LÈS-ROUEN', 49.4691713, 1.0516405, ST_SetSRID(ST_MakePoint(1.0516405, 49.4691713), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('DÉVILLE-LÈS-ROUEN - 8 Rue De Fontenelle', '8 Rue De Fontenelle', 'DÉVILLE-LÈS-ROUEN', 49.4762554, 1.0525354, ST_SetSRID(ST_MakePoint(1.0525354, 49.4762554), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 41 Avenue J. F. Kennedy', '41 Avenue J. F. Kennedy', 'LE GRAND-QUEVILLY', 49.4080799, 1.0544188, ST_SetSRID(ST_MakePoint(1.0544188, 49.4080799), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MONT-SAINT-AIGNAN - 27 Boulevard André Siegfried', '27 Boulevard André Siegfried', 'MONT-SAINT-AIGNAN', 49.4574649, 1.0640513, ST_SetSRID(ST_MakePoint(1.0640513, 49.4574649), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 46 Rue Desseaux (Proche bac verre)', '46 Rue Desseaux, Proche bac verre', 'ROUEN', 49.4325742, 1.0912983, ST_SetSRID(ST_MakePoint(1.0912983, 49.4325742), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 18 Rue Maryse Bastié (Parking école Maryse Bastié)', '18 Rue Maryse Bastié, Parking école Maryse Bastié', 'LE GRAND-QUEVILLY', 49.4103894, 1.0566569, ST_SetSRID(ST_MakePoint(1.0566569, 49.4103894), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE GRAND-QUEVILLY - 1 Rue Joseph-Jérome De Lalande (Parking)', '1 Rue Joseph-Jérome De Lalande, Parking', 'LE GRAND-QUEVILLY', 49.4062043, 1.0636446, ST_SetSRID(ST_MakePoint(1.0636446, 49.4062043), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 53 rue Desseaux (Resto du Cœur)', '53 rue Desseaux, Resto du Cœur', 'ROUEN', 49.4318405, 1.0917689, ST_SetSRID(ST_MakePoint(1.0917689, 49.4318405), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MARTOT - 2 rue de l''Eure (Parking Eglise)', '2 rue de l''''Eure, Parking Eglise', 'MARTOT', 49.297138, 1.0650021, ST_SetSRID(ST_MakePoint(1.0650021, 49.297138), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('FRENEUSE - 4 rue Côte aux Blancs', '4 rue Côte aux Blancs', 'FRENEUSE', 49.3130842, 1.0789846, ST_SetSRID(ST_MakePoint(1.0789846, 49.3130842), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 2 Rue du Mail (Angle Boulevard de l''Europe)', '2 Rue du Mail, Angle Boulevard de l''''Europe', 'ROUEN', 49.4287093, 1.0930389, ST_SetSRID(ST_MakePoint(1.0930389, 49.4287093), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 137 Route de Darnétal', '137 Route de Darnétal', 'ROUEN', 49.440485, 1.1264055, ST_SetSRID(ST_MakePoint(1.1264055, 49.440485), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 37 Rue de l''Enseigne Renaud (Angle Chemin de l''école Jules Ferry)', '37 Rue de l''''Enseigne Renaud, Angle Chemin de l''''école Jules Ferry', 'ROUEN', 49.4349673, 1.123745, ST_SetSRID(ST_MakePoint(1.123745, 49.4349673), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 5 place Saint Hilaire (Rond point Saint Hilaire)', '5 place Saint Hilaire, Rond point Saint Hilaire', 'ROUEN', 49.4423987, 1.1122919, ST_SetSRID(ST_MakePoint(1.1122919, 49.4423987), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 49 Boulevard de Verdun (Au pied du Monumental)', '49 Boulevard de Verdun, Au pied du Monumental', 'ROUEN', 49.4454662, 1.108453, ST_SetSRID(ST_MakePoint(1.108453, 49.4454662), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 14 Place du Boulingrin (Angle Rampe Beauvoisine)', '14 Place du Boulingrin, Angle Rampe Beauvoisine', 'ROUEN', 49.4473698, 1.1064779, ST_SetSRID(ST_MakePoint(1.1064779, 49.4473698), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 49 Rue de Bihorel (Angle rue Jouvenet)', '49 Rue de Bihorel, Angle rue Jouvenet', 'ROUEN', 49.4498315, 1.1035948, ST_SetSRID(ST_MakePoint(1.1035948, 49.4498315), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 19 rue Charles de Beaurepaire (Angle Côte de Neufchâtel)', '19 rue Charles de Beaurepaire, Angle Côte de Neufchâtel', 'ROUEN', 49.4524778, 1.0981059, ST_SetSRID(ST_MakePoint(1.0981059, 49.4524778), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('ROUEN - Rue Sénard (En face du 13 rue sénard)', 'Rue Sénard, En face du 13 rue sénard', 'ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 86 Boulevard de l''Yser', '86 Boulevard de l''''Yser', 'ROUEN', 49.44734459362683, 1.0954728324888219, ST_SetSRID(ST_MakePoint(1.0954728324888219, 49.44734459362683), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 27 Rue Verte (Gare)', '27 Rue Verte, Gare', 'ROUEN', 49.4487775, 1.0931311, ST_SetSRID(ST_MakePoint(1.0931311, 49.4487775), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 44 Boulevard de la Marne (Angle Rampe Bouvreuil)', '44 Boulevard de la Marne, Angle Rampe Bouvreuil', 'ROUEN', 49.4469485, 1.0920252, ST_SetSRID(ST_MakePoint(1.0920252, 49.4469485), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 59 Rue Crevier (Angle rue d''Herbouville)', '59 Rue Crevier, Angle rue d''''Herbouville', 'ROUEN', 49.449081, 1.086073, ST_SetSRID(ST_MakePoint(1.086073, 49.449081), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 15 Rue Tabouret (Angle rue de la Cavée St Gervais)', '15 Rue Tabouret, Angle rue de la Cavée St Gervais', 'ROUEN', 49.449783, 1.0840698, ST_SetSRID(ST_MakePoint(1.0840698, 49.449783), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 29 Rue George d''Ambroise (Angle rue Duguay Trouin)', '29 Rue George d''''Ambroise, Angle rue Duguay Trouin', 'ROUEN', 49.4430129, 1.0808909, ST_SetSRID(ST_MakePoint(1.0808909, 49.4430129), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 65 Rue Saint Maur (Angle rue Maladrerie)', '65 Rue Saint Maur, Angle rue Maladrerie', 'ROUEN', 49.4513399, 1.0878016, ST_SetSRID(ST_MakePoint(1.0878016, 49.4513399), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 3 Place Eglise Saint Gervais', '3 Place Eglise Saint Gervais', 'ROUEN', 49.4493018, 1.0820767, ST_SetSRID(ST_MakePoint(1.0820767, 49.4493018), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 23 rue Guillaume d''Estouteville', '23 rue Guillaume d''''Estouteville', 'ROUEN', 49.452936, 1.0699945, ST_SetSRID(ST_MakePoint(1.0699945, 49.452936), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 43 Rue Stanislas Girardin (Angle rue A. Flaubert)', '43 Rue Stanislas Girardin, Angle rue A. Flaubert', 'ROUEN', 49.4472438, 1.0805579, ST_SetSRID(ST_MakePoint(1.0805579, 49.4472438), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-ÉTIENNE-DU-ROUVRAY - 135 rue du Madrillet (Bâtiment AFPA)', '135 rue du Madrillet, Bâtiment AFPA', 'SAINT-ÉTIENNE-DU-ROUVRAY', 49.3909564, 1.0731051, ST_SetSRID(ST_MakePoint(1.0731051, 49.3909564), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CANTELEU - 1 Avenue Charles Gounod (En face du collège)', '1 Avenue Charles Gounod, En face du collège', 'CANTELEU', 49.4544441, 1.0323677, ST_SetSRID(ST_MakePoint(1.0323677, 49.4544441), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PAËR - 119 Route de Duclair (Après le croisement Rue de l''église à coté des bacs à verre)', '119 Route de Duclair, Après le croisement Rue de l''''église à coté des bacs à verre', 'SAINT-PAËR', 49.5155313, 0.880296, ST_SetSRID(ST_MakePoint(0.880296, 49.5155313), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('SAINT-PIERRE-DE-VARENGEVILLE - 240 Rue de la Paix (Parking du Cimetière)', '240 Rue de la Paix, Parking du Cimetière', 'SAINT-PIERRE-DE-VARENGEVILLE', 49.5016503, 0.9217114, ST_SetSRID(ST_MakePoint(0.9217114, 49.5016503), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CANTELEU - 7 Rue Alexandre Dumas', '7 Rue Alexandre Dumas', 'CANTELEU', 49.4438684, 1.0322824, ST_SetSRID(ST_MakePoint(1.0322824, 49.4438684), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CANTELEU - 36 Avenue de Versailles', '36 Avenue de Versailles', 'CANTELEU', 49.446971, 1.035878, ST_SetSRID(ST_MakePoint(1.035878, 49.446971), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LA VAUPALIÈRE - 133 rue de l''Eglise (Parking en face de l''Espace WAPALLERIA)', '133 rue de l''''Eglise, Parking en face de l''''Espace WAPALLERIA', 'LA VAUPALIÈRE', 49.4895761, 0.9990714, ST_SetSRID(ST_MakePoint(0.9990714, 49.4895761), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('POMMEREVAL - 989 Route de l''Eglise', '989 Route de l''''Eglise', 'POMMEREVAL', 49.740456, 1.319002, ST_SetSRID(ST_MakePoint(1.319002, 49.740456), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ARDOUVAL - 4 Rue des Bouleaux (Suivre panneau "Foyer des Jeunes")', '4 Rue des Bouleaux, Suivre panneau "Foyer des Jeunes"', 'ARDOUVAL', 49.746722, 1.273509, ST_SetSRID(ST_MakePoint(1.273509, 49.746722), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BELLENCOMBRE - 2 bis Chemin du Cimetière', '2 bis Chemin du Cimetière', 'BELLENCOMBRE', 49.7067743, 1.2251442, ST_SetSRID(ST_MakePoint(1.2251442, 49.7067743), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('COTTEVRARD - 77 Place de l''Eglise (En face de l''église - Parking au fond)', '77 Place de l''''Eglise, En face de l''''église - Parking au fond', 'COTTEVRARD', 49.6318038, 1.2212548, ST_SetSRID(ST_MakePoint(1.2212548, 49.6318038), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('BOSC LE HARD - 159 Rue des Forges', '159 Rue des Forges', 'BOSC LE HARD', 49.6290962, 1.1776388, ST_SetSRID(ST_MakePoint(1.1776388, 49.6290962), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('YERVILLE - 3 Place Bernard Alexandre', '3 Place Bernard Alexandre', 'YERVILLE', 49.669995, 0.8992293, ST_SetSRID(ST_MakePoint(0.8992293, 49.669995), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('VIBEUF - 25 rue de la Mare des Champs (Entrée parking communal)', '25 rue de la Mare des Champs, Entrée parking communal', 'VIBEUF', 49.693223, 0.9027505, ST_SetSRID(ST_MakePoint(0.9027505, 49.693223), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ETOUTTEVILLE - 520 rue du Prieuré (Parking)', '520 rue du Prieuré, Parking', 'ETOUTTEVILLE', 49.6758125, 0.7899252, ST_SetSRID(ST_MakePoint(0.7899252, 49.6758125), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('FLAMANVILLE - 1 Rue de l''Eglise (Intersection Rue de l''Ecole)', '1 Rue de l''''Eglise, Intersection Rue de l''''Ecole', 'FLAMANVILLE', 49.63501511998083, 0.8386936533035305, ST_SetSRID(ST_MakePoint(0.8386936533035305, 49.63501511998083), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MOTTEVILLE - 156 Rue de la Gare (Face à la gare)', '156 Rue de la Gare, Face à la gare', 'MOTTEVILLE', 49.6372744, 0.8497941, ST_SetSRID(ST_MakePoint(0.8497941, 49.6372744), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('CIDEVILLE - 55 rue du Centre (A côté du garage et bacs verre)', '55 rue du Centre, A côté du garage et bacs verre', 'CIDEVILLE', 49.6154562, 0.8944882, ST_SetSRID(ST_MakePoint(0.8944882, 49.6154562), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MAROMME - 13 Route de Duclair (Parking Signa)', '13 Route de Duclair, Parking Signa', 'MAROMME', 49.478762680186776, 1.023723836245729, ST_SetSRID(ST_MakePoint(1.023723836245729, 49.478762680186776), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('MAROMME - 2 Rue de Binche (Parking école Delbos)', '2 Rue de Binche, Parking école Delbos', 'MAROMME', 49.474356, 1.0413057, ST_SetSRID(ST_MakePoint(1.0413057, 49.474356), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('PETIT-COURONNE - 220 Rue Du 14 Juillet (Croisement rue du Pommeret)', '220 Rue Du 14 Juillet, Croisement rue du Pommeret', 'PETIT-COURONNE', 49.3838783, 1.028463, ST_SetSRID(ST_MakePoint(1.028463, 49.3838783), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('PETIT-COURONNE - 44 Place Pierre Mendès France (Parking Coccinelle)', '44 Place Pierre Mendès France, Parking Coccinelle', 'PETIT-COURONNE', 49.3884892, 1.0376402, ST_SetSRID(ST_MakePoint(1.0376402, 49.3884892), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('GRAND-COURONNE - 5 Allée de la Côté Mutel (Déchetterie - 9h / 12h - 14h - 17h30)', '5 Allée de la Côté Mutel, Déchetterie - 9h / 12h - 14h - 17h30', 'GRAND-COURONNE', 49.3667909, 1.0150717, ST_SetSRID(ST_MakePoint(1.0150717, 49.3667909), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 84 Rue du Renard (Ecole Achille Lefort)', '84 Rue du Renard, Ecole Achille Lefort', 'ROUEN', 49.448144, 1.080758, ST_SetSRID(ST_MakePoint(1.080758, 49.448144), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 1 Place de la Madeleine (Angle rue Constantine)', '1 Place de la Madeleine, Angle rue Constantine', 'ROUEN', 49.4455345, 1.0788793, ST_SetSRID(ST_MakePoint(1.0788793, 49.4455345), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, nb_containers, status)
VALUES ('ROUEN - Avenue des Martyrs (Angle rue Linné)', 'Avenue des Martyrs, Angle rue Linné', 'ROUEN', 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 79 Rue Amédée Dormoy (A coté de l''entrée Intermarché)', '79 Rue Amédée Dormoy, A coté de l''''entrée Intermarché', 'ROUEN', 49.4499497, 1.0665611, ST_SetSRID(ST_MakePoint(1.0665611, 49.4499497), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 10 Rue Moise', '10 Rue Moise', 'ROUEN', 49.451788, 1.064157, ST_SetSRID(ST_MakePoint(1.064157, 49.451788), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 145 Boulevard Jean Jaurès (Face au n°306)', '145 Boulevard Jean Jaurès, Face au n°306', 'ROUEN', 49.4527917, 1.058519, ST_SetSRID(ST_MakePoint(1.058519, 49.4527917), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('ROUEN - 2 rue du Loup', '2 rue du Loup', 'ROUEN', 49.453197, 1.05537, ST_SetSRID(ST_MakePoint(1.05537, 49.453197), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

INSERT INTO cav (name, address, commune, latitude, longitude, geom, nb_containers, status)
VALUES ('LE HOULME - 73 A rue du Général de Gaulle (Devant l''Association)', '73 A rue du Général de Gaulle, Devant l''''Association', 'LE HOULME', 49.501335, 1.042073, ST_SetSRID(ST_MakePoint(1.042073, 49.501335), 4326), 1, 'active')
ON CONFLICT (name) DO UPDATE SET
  address = COALESCE(NULLIF(EXCLUDED.address, ''), cav.address),
  commune = COALESCE(NULLIF(EXCLUDED.commune, ''), cav.commune),
  latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
  geom = EXCLUDED.geom, updated_at = NOW();

COMMIT;

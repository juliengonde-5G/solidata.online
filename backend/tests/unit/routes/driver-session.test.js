// Session chauffeur « 1 URL = 1 véhicule » — helpers purs.
//
// `driverVehicleIdFromToken` porte la garde de périmètre du mobile : tout
// relâchement du parsing élargit ce qu'un raccourci détourné peut atteindre.
// La cascade `resolveDriverEmployeeId` est la réponse au blocage « Aucune fiche
// employé liée à votre compte » : l'accès vient du véhicule, le chauffeur n'est
// qu'un rattachement — inconnu, il vaut null, jamais une valeur inventée.
const {
  driverVehicleIdFromToken,
  isDriverSession,
  resolveDriverEmployeeId,
  SQL_TODAY_PARIS,
} = require('../../../src/routes/tours/driver-session');

describe('driverVehicleIdFromToken', () => {
  it('lit le claim explicite vehicle_id', () => {
    expect(driverVehicleIdFromToken({ vehicle_id: 5, username: 'driver_5' })).toBe(5);
    expect(driverVehicleIdFromToken({ vehicle_id: '7' })).toBe(7);
  });

  it('replie sur le username historique « driver_<id> »', () => {
    expect(driverVehicleIdFromToken({ username: 'driver_12' })).toBe(12);
  });

  it('renvoie null pour tout compte non-chauffeur', () => {
    expect(driverVehicleIdFromToken({ username: 'admin', role: 'ADMIN' })).toBeNull();
    expect(driverVehicleIdFromToken({ username: 'driver_abc' })).toBeNull();
    expect(driverVehicleIdFromToken({ username: 'xdriver_5' })).toBeNull();
    expect(driverVehicleIdFromToken({})).toBeNull();
    expect(driverVehicleIdFromToken(null)).toBeNull();
  });

  it('isDriverSession suit la même règle', () => {
    expect(isDriverSession({ username: 'driver_5' })).toBe(true);
    expect(isDriverSession({ username: 'admin' })).toBe(false);
  });
});

describe('resolveDriverEmployeeId — cascade', () => {
  const poolWith = (handlers) => ({
    query: jest.fn(async (sql, params) => {
      for (const [pattern, rows] of handlers) {
        if (pattern.test(String(sql))) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    }),
  });

  it('1. employé porté par le jeton chauffeur', async () => {
    const pool = poolWith([[/FROM employees WHERE id = \$1/, [{ id: 42 }]]]);
    await expect(resolveDriverEmployeeId(pool, { id: 4, employee_id: 42 }, 5)).resolves.toBe(42);
  });

  it('2. fiche employé liée au compte utilisateur', async () => {
    const pool = poolWith([[/FROM employees WHERE user_id = \$1/, [{ id: 7 }]]]);
    await expect(resolveDriverEmployeeId(pool, { id: 3 }, 5)).resolves.toBe(7);
  });

  it('3. chauffeur affecté au véhicule (jeton hérité)', async () => {
    const pool = poolWith([[/assigned_driver_id FROM vehicles/, [{ assigned_driver_id: 21 }]]]);
    await expect(resolveDriverEmployeeId(pool, { id: 4, username: 'driver_5' }, 5)).resolves.toBe(21);
  });

  it('4. aucun chauffeur identifiable → null (la tournée reste portée par le véhicule)', async () => {
    const pool = poolWith([[/assigned_driver_id FROM vehicles/, [{ assigned_driver_id: null }]]]);
    await expect(resolveDriverEmployeeId(pool, { id: 4, username: 'driver_5' }, 5)).resolves.toBeNull();
  });

  it('un employee_id du jeton devenu introuvable ne fait pas échouer la cascade', async () => {
    const pool = poolWith([
      [/FROM employees WHERE id = \$1/, []],            // fiche supprimée depuis l'émission
      [/assigned_driver_id FROM vehicles/, [{ assigned_driver_id: 21 }]],
    ]);
    await expect(resolveDriverEmployeeId(pool, { id: 4, employee_id: 999 }, 5)).resolves.toBe(21);
  });

  it('sans véhicule cible ni compte lié → null', async () => {
    const pool = poolWith([]);
    await expect(resolveDriverEmployeeId(pool, { id: 4 }, null)).resolves.toBeNull();
  });
});

describe('SQL_TODAY_PARIS', () => {
  it('exprime le jour civil de Paris (le conteneur tourne en UTC)', () => {
    expect(SQL_TODAY_PARIS).toContain("Europe/Paris");
    expect(SQL_TODAY_PARIS).not.toContain('CURRENT_DATE');
  });
});

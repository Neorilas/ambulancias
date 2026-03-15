/**
 * Test funcional completo de la API
 * Uso: node test_api.mjs
 */

const BASE = 'https://api.vapss.net/api/v1';
const ADMIN_CREDS = { username: 'findelias', password: 'FiNDe991))!' };
const TECH_CREDS  = { username: 'jlopez',    password: 'Tecnico2025.-' };

let pass = 0, fail = 0, warn = 0;
const issues = [];

function ok(label, val, detail = '') {
  if (val) { console.log(`  ✅ ${label}${detail ? ' — '+detail : ''}`); pass++; }
  else      { console.log(`  ❌ ${label}${detail ? ' — '+detail : ''}`); fail++; issues.push(label); }
}
function warning(label, detail) {
  console.log(`  ⚠️  ${label}${detail ? ': '+detail : ''}`); warn++;
}

async function req(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch { return { status: r.status, body: text }; }
}

async function login(creds) {
  const r = await req('POST', '/auth/login', null, creds);
  if (!r.body?.success) throw new Error(`Login failed for ${creds.username}: ${r.body?.message}`);
  return r.body.data;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

async function testAuth() {
  console.log('\n── AUTH ─────────────────────────────────────────────');

  let adminData, techData;

  try {
    adminData = await login(ADMIN_CREDS);
    ok('Admin login exitoso', true);
    ok('Admin accessToken presente', !!adminData.accessToken);
    ok('Admin refreshToken presente', !!adminData.refreshToken);
    ok('Admin tiene roles', adminData.user?.roles?.length > 0);
    console.log(`     roles: ${adminData.user.roles}`);

    if (!adminData.user.permissions) {
      warning('permissions ausente en JWT', 'migration_v4.sql pendiente en prod (superadmin + permisos)');
    } else {
      ok('Admin tiene permissions en JWT', adminData.user.permissions.length > 0);
      console.log(`     permisos: ${adminData.user.permissions}`);
    }

    // Verificar el rol: debería ser superadmin o al menos administrador
    const hasAdminRole = adminData.user.roles.includes('administrador') || adminData.user.roles.includes('superadmin');
    ok('findelias tiene rol administrador o superadmin', hasAdminRole);
    if (adminData.user.roles.includes('administrador') && !adminData.user.roles.includes('superadmin')) {
      warning('findelias tiene administrador pero no superadmin', 'migration_v3.sql pendiente — ejecutar en prod');
    }
  } catch(e) { ok('Admin login exitoso', false, e.message); return {}; }

  try {
    techData = await login(TECH_CREDS);
    ok('Técnico login exitoso', true);
    ok('Técnico tiene rol tecnico', techData.user?.roles?.includes('tecnico'));
  } catch(e) { ok('Técnico login exitoso', false, e.message); }

  // Credenciales incorrectas → 401
  const bad = await req('POST', '/auth/login', null, { username: 'findelias', password: 'wrongpass' });
  ok('Login incorrecto devuelve 401', bad.status === 401);

  // Sin token → 401
  const noauth = await req('GET', '/vehicles', null);
  ok('Sin token devuelve 401', noauth.status === 401);

  // Token manipulado → 401
  const badtok = await req('GET', '/vehicles', 'fake.token.here');
  ok('Token inválido devuelve 401', badtok.status === 401);

  // /auth/me
  const me = await req('GET', '/auth/me', adminData.accessToken);
  ok('/auth/me devuelve usuario correcto', me.body?.success && me.body?.data?.username === 'findelias');

  // Refresh token
  const ref = await req('POST', '/auth/refresh', null, { refreshToken: adminData.refreshToken });
  ok('Refresh token devuelve nuevo accessToken', ref.body?.success && !!ref.body?.data?.accessToken);

  // Refresh inválido → 401
  const badRef = await req('POST', '/auth/refresh', null, { refreshToken: 'fakefake-invalid' });
  ok('Refresh inválido devuelve 401', badRef.status === 401);

  // Logout
  const logout = await req('POST', '/auth/logout', adminData.accessToken, { refreshToken: adminData.refreshToken });
  ok('Logout exitoso', logout.body?.success);

  // Después del logout, re-login para continuar tests
  adminData = await login(ADMIN_CREDS);

  return { adminToken: adminData.accessToken, techToken: techData?.accessToken };
}

// ─── VEHICLES ────────────────────────────────────────────────────────────────

async function testVehicles(adminToken, techToken) {
  console.log('\n── VEHICLES ─────────────────────────────────────────');

  // Listar
  const list = await req('GET', '/vehicles', adminToken);
  ok('Admin lista vehículos', list.body?.success);
  console.log(`     vehículos en BD: ${list.body?.pagination?.total ?? list.body?.data?.length ?? 0}`);

  // Técnico solo ve vehículos de trabajos activos donde esté asignado
  const techList = await req('GET', '/vehicles', techToken);
  ok('Técnico lista vehículos (solo activos suyos)', techList.body?.success);
  console.log(`     vehículos visibles para técnico: ${techList.body?.data?.length ?? 0}`);

  // Búsqueda
  const search = await req('GET', '/vehicles?search=amb', adminToken);
  ok('Búsqueda de vehículos funciona', search.body?.success);

  // Crear vehículo de test con matrícula única para evitar 409 entre ejecuciones
  const testMatricula = `ZTEST${Date.now().toString().slice(-5)}`;
  const create = await req('POST', '/vehicles', adminToken, {
    matricula: testMatricula,
    alias: 'Ambulancia Test API',
    kilometros_actuales: 1000,
    fecha_itv: '2026-12-31',
    fecha_its: '2026-06-30',
  });
  const vehicleId = create.body?.data?.id;
  ok('Admin crea vehículo', create.body?.success, vehicleId ? `id=${vehicleId} mat=${testMatricula}` : create.body?.message);

  let testVehicleId = vehicleId;

  // Técnico NO puede crear vehículo
  const techCreate = await req('POST', '/vehicles', techToken, { matricula: 'ZTEST99', alias: 'No debería', kilometros_actuales: 0 });
  ok('Técnico no puede crear vehículo (403)', techCreate.status === 403);

  if (testVehicleId) {
    // Obtener por id
    const get = await req('GET', `/vehicles/${testVehicleId}`, adminToken);
    ok('Admin obtiene vehículo por id', get.body?.success);
    ok('Vehículo tiene campos esperados', !!get.body?.data?.matricula && !!get.body?.data?.kilometros_actuales !== undefined);

    // Actualizar
    const upd = await req('PUT', `/vehicles/${testVehicleId}`, adminToken, {
      alias: 'Ambulancia Test API (upd)',
      kilometros_actuales: 1050,
    });
    ok('Admin actualiza vehículo', upd.body?.success);

    // Técnico no puede actualizar
    const techUpd = await req('PUT', `/vehicles/${testVehicleId}`, techToken, { alias: 'hackeo' });
    ok('Técnico no puede actualizar vehículo (403)', techUpd.status === 403);

    // Historial
    const hist = await req('GET', `/vehicles/${testVehicleId}/historial`, adminToken);
    ok('Admin obtiene historial del vehículo', hist.body?.success);
    ok('Historial tiene estructura correcta', !!hist.body?.data?.vehicle && Array.isArray(hist.body?.data?.trabajos));

    // Imágenes
    const imgs = await req('GET', `/vehicles/${testVehicleId}/images`, adminToken);
    ok('Admin obtiene imágenes del vehículo', imgs.body?.success);

    // Incidencias — listar
    const incs = await req('GET', `/vehicles/${testVehicleId}/incidencias`, adminToken);
    ok('Admin lista incidencias del vehículo', incs.body?.success);

    // Crear incidencia
    const incCreate = await req('POST', `/vehicles/${testVehicleId}/incidencias`, adminToken, {
      tipo: 'dano_exterior',
      gravedad: 'leve',
      descripcion: 'Arañazo en puerta lateral (test API)',
    });
    ok('Admin crea incidencia', incCreate.body?.success);
    const incId = incCreate.body?.data?.id;

    // Actualizar incidencia
    if (incId) {
      const incUpd = await req('PATCH', `/vehicles/${testVehicleId}/incidencias/${incId}`, adminToken, {
        estado: 'en_revision',
        gravedad: 'moderado',
      });
      ok('Admin actualiza incidencia', incUpd.body?.success);

      // Resolver incidencia
      const incResolve = await req('PATCH', `/vehicles/${testVehicleId}/incidencias/${incId}`, adminToken, {
        estado: 'resuelto',
      });
      ok('Admin resuelve incidencia', incResolve.body?.success);
    }

    // Revisiones — listar
    const revs = await req('GET', `/vehicles/${testVehicleId}/revisiones`, adminToken);
    ok('Admin lista revisiones del vehículo', revs.body?.success);

    // Crear revisión
    const revCreate = await req('POST', `/vehicles/${testVehicleId}/revisiones`, adminToken, {
      tipo: 'itv',
      fecha_revision: '2026-03-10',
      fecha_proxima: '2028-03-10',
      resultado: 'aprobado',
      descripcion: 'ITV favorable (test API)',
    });
    ok('Admin crea revisión ITV', revCreate.body?.success);
    const revId = revCreate.body?.data?.id;

    // Actualizar revisión
    if (revId) {
      const revUpd = await req('PUT', `/vehicles/${testVehicleId}/revisiones/${revId}`, adminToken, {
        descripcion: 'ITV favorable (test API upd)',
      });
      ok('Admin actualiza revisión', revUpd.body?.success);

      // Eliminar revisión
      const revDel = await req('DELETE', `/vehicles/${testVehicleId}/revisiones/${revId}`, adminToken);
      ok('Admin elimina revisión', revDel.body?.success);
    }

    // Técnico no puede acceder a historial
    const techHist = await req('GET', `/vehicles/${testVehicleId}/historial`, techToken);
    ok('Técnico no puede ver historial (403)', techHist.status === 403);
  }

  return testVehicleId;
}

// ─── TRABAJOS ─────────────────────────────────────────────────────────────────

async function testTrabajos(adminToken, techToken, vehicleId) {
  console.log('\n── TRABAJOS ─────────────────────────────────────────');

  // Listar como admin
  const list = await req('GET', '/trabajos', adminToken);
  ok('Admin lista trabajos', list.body?.success);
  console.log(`     trabajos en BD: ${list.body?.pagination?.total ?? list.body?.data?.length ?? 0}`);

  // Listar como técnico (solo los suyos)
  const techList = await req('GET', '/trabajos', techToken);
  ok('Técnico lista trabajos (solo los suyos)', techList.body?.success);

  // Calendario
  const cal = await req('GET', '/trabajos/calendario?year=2026&month=3', adminToken);
  ok('Calendario marzo 2026 funciona', cal.body?.success && Array.isArray(cal.body?.data));
  const techCal = await req('GET', '/trabajos/calendario?year=2026&month=3', techToken);
  ok('Técnico puede ver calendario (los suyos)', techCal.body?.success);

  // Mis trabajos (técnico)
  const mis = await req('GET', '/trabajos/mis-trabajos', techToken);
  ok('Técnico obtiene mis-trabajos', mis.body?.success);
  console.log(`     mis trabajos del técnico: ${mis.body?.pagination?.total ?? mis.body?.data?.length ?? 0}`);

  if (!vehicleId) { warning('Tests de mutación de trabajos', 'saltados (sin vehicleId)'); return; }

  const TECH_ID = 2; // jlopez
  const now = new Date();
  const en2dias = new Date(now.getTime() + 2 * 24*60*60*1000);
  const en5dias = new Date(now.getTime() + 5 * 24*60*60*1000);

  // Crear trabajo de test
  const create = await req('POST', '/trabajos', adminToken, {
    nombre: 'Trabajo TEST API',
    tipo: 'traslado',
    fecha_inicio: en2dias.toISOString().slice(0,19).replace('T',' '),
    fecha_fin:    en5dias.toISOString().slice(0,19).replace('T',' '),
    vehiculos: [{ vehicle_id: vehicleId, responsable_user_id: TECH_ID, kilometros_inicio: 1050 }],
    usuarios: [TECH_ID],
  });
  ok('Admin crea trabajo', create.body?.success);
  const trabajoId = create.body?.data?.id;
  const identificador = create.body?.data?.identificador;
  if (trabajoId) console.log(`     trabajo id=${trabajoId} ref=${identificador}`);

  // Técnico no puede crear trabajo
  const techCreate = await req('POST', '/trabajos', techToken, {
    nombre: 'No debería', tipo: 'traslado',
    fecha_inicio: en2dias.toISOString().slice(0,19).replace('T',' '),
    fecha_fin: en5dias.toISOString().slice(0,19).replace('T',' '),
  });
  ok('Técnico no puede crear trabajo (403)', techCreate.status === 403);

  if (!trabajoId) return;

  // Obtener trabajo
  const get = await req('GET', `/trabajos/${trabajoId}`, adminToken);
  ok('Admin obtiene trabajo por id', get.body?.success);
  ok('Trabajo tiene vehículos asignados', get.body?.data?.vehiculos?.length > 0);
  ok('Trabajo tiene usuarios asignados', get.body?.data?.usuarios?.length > 0);

  // Técnico puede ver el trabajo (está asignado)
  const techGet = await req('GET', `/trabajos/${trabajoId}`, techToken);
  ok('Técnico ve trabajo donde está asignado', techGet.body?.success);

  // Actualizar
  const upd = await req('PUT', `/trabajos/${trabajoId}`, adminToken, { nombre: 'Trabajo TEST API (upd)' });
  ok('Admin actualiza trabajo', upd.body?.success);

  // Filtros de búsqueda
  const filtered = await req('GET', `/trabajos?estado=programado`, adminToken);
  ok('Filtro por estado=programado funciona', filtered.body?.success);
  const foundTest = filtered.body?.data?.some(t => t.id === trabajoId);
  ok('Trabajo test aparece en lista programados', foundTest);

  // Intentar finalizar sin evidencias (debe fallar)
  const earlyFinalize = await req('POST', `/trabajos/${trabajoId}/finalize`, adminToken, {
    vehiculos_km: [{ vehicle_id: vehicleId, kilometros_fin: 1100 }]
  });
  ok('Finalizar sin fotos devuelve error 400', earlyFinalize.status === 400);
  console.log(`     mensaje esperado: "${earlyFinalize.body?.message?.slice(0,60)}"`);

  // Activar trabajo — como operacional no puede (24h antes)
  const activateTech = await req('POST', `/trabajos/${trabajoId}/activar`, techToken);
  ok('Técnico no puede activar con >24h de antelación (400)', activateTech.status === 400 || activateTech.status === 403);

  // Admin sí puede activar
  const activateAdmin = await req('POST', `/trabajos/${trabajoId}/activar`, adminToken);
  ok('Admin puede activar trabajo', activateAdmin.body?.success);
  ok('Trabajo pasa a estado activo', activateAdmin.body?.data?.estado === 'activo');

  // No se puede eliminar trabajo activo
  const delActive = await req('DELETE', `/trabajos/${trabajoId}`, adminToken);
  ok('No se puede eliminar trabajo activo (400)', delActive.status === 400);

  // Acceso de técnico a trabajo activo
  const techGetActive = await req('GET', `/trabajos/${trabajoId}`, techToken);
  ok('Técnico puede ver trabajo activo donde está asignado', techGetActive.body?.success);

  // Subir evidencia — necesitaría una imagen real, testeamos el error de falta de archivo
  const noImg = await req('POST', `/trabajos/${trabajoId}/evidencias`, adminToken, {
    vehicle_id: vehicleId, tipo_imagen: 'frontal'
  });
  ok('Upload evidencia sin imagen devuelve error', noImg.status === 400);

  // Finalizar sin todas las fotos (debe rechazar)
  const partialFinalize = await req('POST', `/trabajos/${trabajoId}/finalize`, adminToken, {
    vehiculos_km: [{ vehicle_id: vehicleId, kilometros_fin: 1100 }]
  });
  ok('Finalizar trabajo sin fotos completas devuelve 400', partialFinalize.status === 400);

  // Limpiar: técnico no puede finalizar si no es responsable de ningún vehículo
  // (aquí SÍ es responsable pero faltarían fotos de todos modos)

  return trabajoId;
}

// ─── USERS ───────────────────────────────────────────────────────────────────

async function testUsers(adminToken, techToken) {
  console.log('\n── USERS ────────────────────────────────────────────');

  // Listar usuarios
  const list = await req('GET', '/users', adminToken);
  ok('Admin lista usuarios', list.body?.success);
  const total = list.body?.pagination?.total;
  ok('Respuesta tiene paginación', total !== undefined, `total=${total}`);
  console.log(`     usuarios: ${total}`);

  // Técnico no puede listar usuarios
  const techList = await req('GET', '/users', techToken);
  ok('Técnico no puede listar usuarios (403)', techList.status === 403);

  // Listar roles
  const roles = await req('GET', '/users/roles', adminToken);
  ok('Admin lista roles disponibles', roles.body?.success);
  const roleNames = roles.body?.data?.map(r => r.nombre) || [];
  console.log(`     roles disponibles: ${roleNames.join(', ')}`);
  ok('Rol superadmin existe en BD', roleNames.includes('superadmin'));

  // Obtener usuario por id
  const getUser = await req('GET', '/users/1', adminToken);
  ok('Admin obtiene usuario id=1 (findelias)', getUser.body?.success);
  ok('Usuario tiene roles', getUser.body?.data?.roles?.length > 0);

  // Técnico no puede obtener listado de usuarios
  const techGetUser = await req('GET', '/users/1', techToken);
  ok('Técnico no puede ver perfil de otros usuarios (403)', techGetUser.status === 403);

  // Crear usuario de test
  const create = await req('POST', '/users', adminToken, {
    username: 'test_api_user',
    password: 'TestApi2025!',
    nombre: 'Test',
    apellidos: 'API',
    dni: '99999998Z',
    roles: ['tecnico'],
  });
  ok('Admin crea usuario de test', create.body?.success || create.status === 409);
  const newUserId = create.body?.data?.id;
  if (newUserId) console.log(`     nuevo usuario id=${newUserId}, roles=${create.body?.data?.roles}`);

  if (newUserId) {
    // Actualizar usuario
    const upd = await req('PUT', `/users/${newUserId}`, adminToken, {
      nombre: 'Test Updated',
      roles: ['tecnico', 'enfermero'],
    });
    ok('Admin actualiza usuario', upd.body?.success);
    ok('Roles actualizados correctamente', upd.body?.data?.roles?.includes('enfermero'));

    // Técnico no puede actualizar otros usuarios
    const techUpd = await req('PUT', `/users/${newUserId}`, techToken, { nombre: 'hackeo' });
    ok('Técnico no puede actualizar otros usuarios (403)', techUpd.status === 403);

    // Intentar eliminar uno mismo (admin no puede borrarse a sí mismo)
    // usamos otro usuario
    const delSelf = await req('DELETE', `/users/1`, adminToken);
    ok('No se puede eliminar usuario propio (400)', delSelf.status === 400);

    // Eliminar usuario de test
    const del = await req('DELETE', `/users/${newUserId}`, adminToken);
    ok('Admin elimina usuario de test', del.body?.success);
  }

  // Crear nuevo rol
  const createRole = await req('POST', '/users/roles', adminToken, {
    nombre: 'test_rol_api',
    descripcion: 'Rol de test API'
  });
  ok('Admin crea nuevo rol', createRole.body?.success || createRole.status === 409);
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────

async function testAdminPanel(adminToken, techToken) {
  console.log('\n── ADMIN PANEL (/admin) ─────────────────────────────');

  const statsAdmin = await req('GET', '/admin/stats', adminToken);

  if (statsAdmin.status === 404) {
    ok('/admin/stats ruta encontrada', false, '404 — backend NO reconstruido desde último commit');
    warning('Acción necesaria', 'docker-compose up -d --build para desplegar admin routes');
    return;
  }

  if (statsAdmin.status === 403) {
    ok('Admin (no superadmin) bloqueado en panel (esperado)', true);
    warning('findelias necesita rol superadmin', 'migration_v3.sql y migration_v4.sql pendientes');
  } else if (statsAdmin.body?.success) {
    ok('Panel superadmin accesible', true);
    console.log(`     total audit_logs: ${statsAdmin.body?.data?.total_audits}`);
    console.log(`     total error_logs: ${statsAdmin.body?.data?.total_errors}`);

    // Test audit log list
    const audit = await req('GET', '/admin/audit?limit=5', adminToken);
    ok('Lista audit_logs devuelve datos', audit.body?.success);

    // Test error log list
    const errors = await req('GET', '/admin/errors?limit=5', adminToken);
    ok('Lista error_logs devuelve datos', errors.body?.success);
  } else {
    ok('/admin/stats responde', false, `${statsAdmin.status} ${statsAdmin.body?.message}`);
  }

  // Técnico nunca puede acceder al panel
  const techStats = await req('GET', '/admin/stats', techToken);
  ok('Técnico no puede acceder al panel admin (403)', techStats.status === 403 || techStats.status === 404);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════');
console.log(' TEST FUNCIONAL API — Sistema Gestión Ambulancias');
console.log(`  Base URL: ${BASE}`);
console.log(`  Fecha:    ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════════════');

const { adminToken, techToken } = await testAuth();

if (!adminToken) { console.error('Sin token de admin, abortando tests'); process.exit(1); }

const vehicleId = await testVehicles(adminToken, techToken);
const trabajoId = await testTrabajos(adminToken, techToken, vehicleId);
await testUsers(adminToken, techToken);
await testAdminPanel(adminToken, techToken);

// Limpiar vehículo de test al final (después de haber testado trabajos)
if (vehicleId) {
  // Si hay un trabajo activo, no podemos borrar el vehículo
  if (trabajoId) {
    console.log(`\n  ℹ️  Trabajo id=${trabajoId} dejado en estado activo (sin fotos, no se puede finalizar desde test)`);
    console.log(`     Para limpiar: eliminar manualmente desde el frontend o esperar que se borre con soft-delete`);
  } else {
    const delV = await req('DELETE', `/vehicles/${vehicleId}`, adminToken);
    if (delV.body?.success) console.log(`\n  ℹ️  Vehículo de test (id=${vehicleId}) eliminado`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
if (issues.length > 0) {
  console.log(' FALLOS:');
  issues.forEach(i => console.log(`  ❌ ${i}`));
  console.log('');
}
console.log(` RESULTADO: ✅ ${pass} ok  ❌ ${fail} fail  ⚠️  ${warn} avisos`);
console.log('═══════════════════════════════════════════════════════════════');

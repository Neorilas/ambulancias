# API REST - Documentación

Base URL: `http://localhost:3001/api/v1`

Todos los endpoints (excepto auth) requieren:
```
Authorization: Bearer <accessToken>
```

Respuesta estándar:
```json
{ "success": true,  "data": {...},    "message": "OK" }
{ "success": false, "message": "...", "errors": [...] }
```

---

## AUTH

### POST /auth/login
Rate limited: 5 intentos/15min por IP.

**Body:**
```json
{ "username": "ops_root_x9A7", "password": "Contraseña@123" }
```

**Response 200:**
```json
{
  "data": {
    "accessToken":  "eyJhbGc...",
    "refreshToken": "uuid-xxxxx-hex",
    "expiresIn":    900,
    "user": { "id": 1, "username": "ops_root_x9A7", "roles": ["administrador"] }
  }
}
```

**Errores:** 401 Credenciales incorrectas | 429 Cuenta bloqueada / Rate limit

---

### POST /auth/refresh

**Body:** `{ "refreshToken": "..." }`

**Response 200:** Igual que login (sin `user`, pero con nuevos tokens rotados).

---

### POST /auth/logout

**Body:** `{ "refreshToken": "..." }` (opcional)

Revoca el refresh token en BD.

---

### GET /auth/me  🔒

Devuelve datos del usuario autenticado + roles.

---

## USERS  🔒

### GET /users  (admin | gestor)

**Query params:** `page`, `limit`, `search`, `role`, `deleted=true`

**Response:** Lista paginada con `pagination: { total, page, limit, totalPages, hasNext, hasPrev }`

---

### GET /users/:id  (admin | gestor)

---

### POST /users  (admin)

**Body:**
```json
{
  "username":  "juan.garcia",
  "password":  "Segura@1234",
  "nombre":    "Juan",
  "apellidos": "García López",
  "dni":       "12345678A",
  "email":     "juan@empresa.com",
  "telefono":  "600123456",
  "roles":     ["tecnico"]
}
```

---

### PUT /users/:id  (admin | gestor*)

* Gestor no puede asignar rol administrador ni editar a otro administrador.

**Body:** Mismos campos que POST (todos opcionales).

---

### DELETE /users/:id  (admin) — Soft delete

---

### GET /users/roles

Devuelve la lista de todos los roles disponibles.

---

### POST /users/roles  (admin)

**Body:** `{ "nombre": "supervisor", "descripcion": "..." }`

---

## VEHICLES  🔒

### GET /vehicles

**Query:** `page`, `limit`, `search`

---

### GET /vehicles/:id

Incluye array `images` con todas las imágenes del vehículo.

---

### POST /vehicles  (admin | gestor)

**Body:**
```json
{
  "matricula":             "1234-ABC",
  "alias":                 "Ambulancia-01",
  "kilometros_actuales":   85000,
  "fecha_ultima_revision": "2024-01-15",
  "fecha_ultimo_servicio": "2024-03-20"
}
```

---

### PUT /vehicles/:id  (admin | gestor)

**Body:** Campos opcionales (excepto matricula que no se puede cambiar).

---

### DELETE /vehicles/:id  (admin) — Soft delete

Error 400 si el vehículo tiene trabajos activos.

---

### POST /vehicles/:id/images  (autenticado)

**Content-Type:** `multipart/form-data`

**Fields:**
- `image` (file) — JPEG/PNG/WebP, max 10MB
- `tipo_imagen` — `frontal|lateral_derecho|trasera|lateral_izquierdo|liquidos`
- `trabajo_id` (opcional)

---

### GET /vehicles/:id/images

**Query:** `trabajo_id` (filtrar por trabajo)

---

## TRABAJOS  🔒

### GET /trabajos

**Query:** `page`, `limit`, `search`, `estado`, `tipo`, `fecha_desde`, `fecha_hasta`

Los usuarios operacionales solo ven sus propios trabajos.

---

### GET /trabajos/calendario

**Query:** `year`, `month`

Devuelve todos los trabajos del mes (para vista agenda).

---

### GET /trabajos/mis-trabajos

Trabajos asignados al usuario autenticado.

---

### GET /trabajos/:id

Incluye: `vehiculos[]`, `usuarios[]`, `evidencias[]`

---

### POST /trabajos  (admin | gestor)

**Body:**
```json
{
  "nombre":       "Traslado hospitalario urgente",
  "tipo":         "traslado",
  "fecha_inicio": "2024-07-01T08:00:00",
  "fecha_fin":    "2024-07-01T14:00:00",
  "vehiculos": [
    {
      "vehicle_id":          1,
      "responsable_user_id": 3,
      "kilometros_inicio":   85000
    }
  ],
  "usuarios": [3, 5, 7]
}
```

---

### PUT /trabajos/:id  (admin | gestor)

No se puede modificar un trabajo finalizado.

---

### DELETE /trabajos/:id  (admin | gestor) — Soft delete

No se puede eliminar un trabajo activo.

---

### POST /trabajos/:id/finalize

Finaliza el trabajo. Requiere que las evidencias ya hayan sido subidas.

**Body:**
```json
{
  "vehiculos_km": [
    { "vehicle_id": 1, "kilometros_fin": 85450 }
  ],
  "motivo_finalizacion_anticipada": "Texto (solo si antes de fecha_fin)"
}
```

**Validaciones:**
- 5 fotos subidas por cada vehículo
- Kilómetros finales ≥ km inicio
- Motivo si antes de fecha_fin

---

### POST /trabajos/:id/evidencias

Subida de evidencias fotográficas para un trabajo específico.

**Content-Type:** `multipart/form-data`

**Fields:**
- `image` (file)
- `vehicle_id` (int)
- `tipo_imagen` (frontal|lateral_derecho|trasera|lateral_izquierdo|liquidos)

Si ya existe una imagen del mismo tipo para ese trabajo+vehículo, se sobreescribe.

**Response incluye `progreso`:**
```json
{
  "progreso": {
    "completado": 3,
    "total": 5,
    "faltantes": ["trasera", "liquidos"],
    "completo": false
  }
}
```

---

## Códigos de error comunes

| Código | Significado                                    |
|--------|------------------------------------------------|
| 400    | Petición inválida (campos faltantes, lógica)   |
| 401    | No autenticado o token expirado/inválido       |
| 403    | Sin permisos para esa acción                   |
| 404    | Recurso no encontrado                          |
| 409    | Conflicto (ej: matrícula duplicada)            |
| 422    | Errores de validación de campos                |
| 429    | Rate limit alcanzado                           |
| 500    | Error interno del servidor                     |

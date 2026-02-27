# Sistema de Gestión de Ambulancias

Sistema interno PWA para gestión de servicios, flota y personal de una empresa privada de ambulancias.

---

## Arquitectura

```
ambulancia/
├── database/            ← Esquema MySQL y datos iniciales
├── backend/             ← API REST (Node.js + Express)
│   ├── server.js
│   ├── src/
│   │   ├── config/      ← BD, constantes
│   │   ├── middleware/  ← Auth, RBAC, rate limiting, upload
│   │   ├── routes/      ← Definición de rutas
│   │   ├── controllers/ ← Lógica de negocio
│   │   └── utils/       ← JWT, bcrypt, respuestas, logger
│   └── scripts/         ← Setup BD, creación admin
└── frontend/            ← PWA React + Vite + Tailwind
    ├── public/          ← manifest, iconos
    └── src/
        ├── components/  ← Layout, cámara, calendario, UI
        ├── pages/       ← Vistas por módulo
        ├── services/    ← Clientes API
        ├── context/     ← Auth, Notificaciones
        └── utils/       ← Helpers, constantes
```

---

## Stack tecnológico

| Capa        | Tecnología          | Justificación                                      |
|-------------|---------------------|----------------------------------------------------|
| Frontend    | React 18 + Vite     | Ecosistema maduro, HMR rápido, JSX                 |
| Estilos     | Tailwind CSS v3     | Utility-first, responsive sin CSS custom           |
| PWA         | vite-plugin-pwa     | Workbox integrado, manifest auto                   |
| Router      | React Router v6     | Estándar de facto React SPA                        |
| HTTP Client | Axios               | Interceptores JWT, cancel tokens                   |
| Backend     | Node.js + Express   | JS isomorfo, amplio ecosistema                     |
| ORM/DB      | mysql2/promise      | Raw SQL con pool de conexiones, sin ORM overhead   |
| Auth        | JWT (HS256)         | Stateless, escalable; refresh token en BD          |
| Passwords   | bcryptjs            | Implementación bcrypt pura JS, sin nativas         |
| Rate Limit  | express-rate-limit  | Ventana deslizante, configurable                   |
| Imágenes    | Multer + Sharp      | Redimensionado/compresión en servidor              |
| Logging     | Winston             | Niveles, rotación de archivos, JSON/texto          |
| Base datos  | MySQL 8             | Transacciones ACID, FK, índices compuestos         |

---

## Diagrama Entidad-Relación

```
users
  id PK
  username UNIQUE
  password_hash
  email UNIQUE nullable
  nombre, apellidos, dni UNIQUE
  direccion, telefono
  activo
  timestamps + soft delete

roles
  id PK
  nombre UNIQUE
  descripcion

user_roles (N:M)
  user_id FK → users
  role_id FK → roles
  assigned_by FK → users

login_attempts
  id PK
  username, ip_address
  success
  attempted_at

refresh_tokens
  id PK
  user_id FK → users
  token_hash UNIQUE (SHA-256)
  expires_at
  revoked, revoked_at

vehicles
  id PK
  matricula UNIQUE
  alias
  kilometros_actuales
  fecha_ultima_revision, fecha_ultimo_servicio
  timestamps + soft delete

trabajos
  id PK
  identificador UNIQUE (TRB-YYYY-NNNN)
  nombre, tipo
  fecha_inicio, fecha_fin
  estado
  motivo_finalizacion_anticipada nullable
  created_by FK → users
  timestamps + soft delete

trabajo_vehiculos (N:M trabajos-vehicles)
  id PK
  trabajo_id FK → trabajos
  vehicle_id FK → vehicles
  responsable_user_id FK → users
  kilometros_inicio, kilometros_fin

trabajo_usuarios (N:M trabajos-users)
  trabajo_id FK → trabajos
  user_id FK → users

vehicle_images
  id PK
  vehicle_id FK → vehicles
  tipo_imagen ENUM(frontal,lateral_derecho,trasera,lateral_izquierdo,liquidos)
  image_url
  trabajo_id FK → trabajos (nullable - null=imagen general)
  uploaded_by FK → users
```

---

## Flujo de autenticación

```
1. POST /api/v1/auth/login
   → Verificar rate limit (5 intentos/15min por IP)
   → Verificar bloqueo de cuenta (5 fallos/30min)
   → Validar credenciales (bcrypt compare)
   → Emitir access token (JWT, 15min) + refresh token (UUID, 7d)
   → Guardar hash SHA-256 del refresh token en BD

2. Cada request autenticado:
   → Bearer <accessToken> en Authorization header
   → auth.middleware valida JWT y verifica usuario activo en BD
   → req.user = { id, username, roles }

3. Expirado el access token:
   → Frontend intercepta 401 automáticamente (Axios interceptor)
   → POST /api/v1/auth/refresh con refreshToken
   → Se rota el refresh token (viejo revocado, nuevo emitido)
   → Se reintentan los requests en cola
```

---

## Roles y permisos

| Acción                          | admin | gestor | técnico/enf/médico |
|---------------------------------|:-----:|:------:|:------------------:|
| Crear usuarios                  | ✅    | ✗      | ✗                  |
| Eliminar usuarios (soft)        | ✅    | ✗      | ✗                  |
| Editar usuarios                 | ✅    | ✅*    | ✗                  |
| Asignar rol administrador       | ✅    | ✗      | ✗                  |
| Crear/editar vehículos          | ✅    | ✅     | ✗                  |
| Eliminar vehículos              | ✅    | ✗      | ✗                  |
| Crear/editar trabajos           | ✅    | ✅     | ✗                  |
| Eliminar trabajos               | ✅    | ✅     | ✗                  |
| Ver trabajos propios            | ✅    | ✅     | ✅                 |
| Subir evidencias                | ✅    | ✅     | ✅                 |
| Finalizar trabajo               | ✅    | ✅     | ✅ (responsable)   |

*Gestor no puede editar a otros administradores.

---

## Lógica de finalización de trabajo

Un trabajo puede finalizarse cuando:
- La `fecha_fin` ha llegado O el responsable pulsa "Finalizar"

Al finalizar, el sistema exige:
1. **5 fotografías** por vehículo (en orden: frontal → lateral D → trasera → lateral I → líquidos)
2. **Kilómetros finales** de cada vehículo
3. Si es antes de `fecha_fin`: **motivo obligatorio**

El proceso en móvil usa `getUserMedia` con:
- Overlay con marco guía de encuadre
- Captura en orden forzado (no se puede saltar)
- Compresión cliente (canvas → JPEG ~80% calidad)
- Compresión servidor (Sharp, redimensionado a 1280px)

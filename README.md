# Radicación de reclamaciones de vida

Sistema para recibir reclamaciones de seguros de vida, determinar si el expediente está completo y vigilar el plazo legal del artículo 1080 del Código de Comercio, sin que la decisión de pagar u objetar salga nunca de manos de una persona.

| Pieza | Dónde |
|---|---|
| Canal de radicación (público, sin usuario) | `/` y `/seguimiento/{token}` |
| Motor (clasificación, validación, reloj, avisos) | `src/lib/motor.ts`, `src/lib/ia/`, `supabase/migrations/` |
| Panel del analista (privado) | `/panel` |
| Las cuatro respuestas del punto 7 | `/panel/metricas` y `GET /api/metricas` |
| Salud del sistema (monitoreo externo) | `GET /api/salud` |

---

## 1. Arquitectura

```
 Beneficiario (celular)                        Analista
        │                                          │
        ▼                                          ▼
 ┌───────────────┐   URL firmada    ┌──────────────────────────┐
 │  Next.js web  │ ───────────────► │ Supabase Storage (privado)│
 │  / seguimiento│                  └──────────────────────────┘
 │  /panel       │ ◄──── sesión ────  Supabase Auth
 │  /api/*       │
 └──────┬────────┘
        │ service role (solo servidor)
        ▼
 ┌──────────────────────────────────────────────┐        ┌────────────┐
 │ Postgres (Supabase)                          │        │  Gemini    │
 │  reclamaciones · documentos · eventos (inm.) │ ◄────► │  (extrae y │
 │  decisiones (inm.) · ejecuciones_ia (inm.)   │        │  sugiere)  │
 │  pg_cron ─► vigilar_plazos() cada 15 min     │        └────────────┘
 │  pg_cron ─► POST /api/cron/tick cada 15 min  │
 └──────────────────────────────────────────────┘
        │
        └─► Correo SMTP / Gmail (beneficiario y alertas a analistas)
```

**Stack (todo con plan gratuito):** Next.js 15 + TypeScript · Supabase (Postgres, Storage, Auth, pg_cron, pg_net) · Gemini 3.5 Flash (respaldo: 3.5 Flash Lite) · Vercel · Gmail SMTP (nodemailer) · UptimeRobot.

### Flujo de una radicación

1. El beneficiario llena el formulario. El navegador genera una **llave de idempotencia** (UUID) que sobrevive a recargas.
2. `POST /api/radicar` valida los datos, crea el caso y devuelve **URLs de subida firmadas** de un solo uso.
3. El navegador sube cada archivo directo al almacenamiento, a una zona de cuarentena (`entrantes/`).
4. `POST /api/cargas/confirmar`: el servidor descarga cada archivo, verifica su **tipo real por contenido** (no por extensión), calcula su **SHA-256**, descarta duplicados y lo mueve a su ubicación definitiva.
5. Después de responder al navegador, el **motor** analiza el caso: Gemini clasifica y extrae datos, las reglas en código validan cada documento y se decide si el expediente está completo.
6. Si quedó completo, arranca el reloj. En todos los casos se le dice al beneficiario, en lenguaje claro, qué falta o qué llegó pero no sirve.
7. Cada 15 minutos, sin intervención humana, `pg_cron` evalúa los plazos, genera alertas antes del vencimiento, envía recordatorios a quienes no han completado y reintenta lo que haya fallado.

---

## 2. Decisiones de diseño

### Canal: web móvil sin usuario + enlace personal de seguimiento
- Quien radica acaba de perder a un familiar. Una página web no exige instalar nada, ni recordar contraseñas, ni conversar con un bot; se puede hacer en varias sesiones.
- Subir 7 u 8 documentos es mucho más claro en una web (ve la lista, quita, agrega) que en un chat.
- **La conversación no termina al radicar**: cada correo lleva un enlace personal (`/seguimiento/{token}`) donde ve, documento por documento, qué está bien, qué llegó pero no sirve (y por qué) y qué falta, y desde ahí sube lo que le pidan. El sistema además le escribe solo si el caso se queda quieto (días 3, 7 y 15).
- El token es aleatorio (256 bits), se guarda solo su hash y caduca a los 180 días.

### El modelo no decide
- Gemini **solo** clasifica el tipo de reclamación y extrae de cada documento: qué es, si es legible, si tiene firma y a nombre de quién está.
- **Si un documento sirve lo decide el código** (`validarDocumento` en `src/lib/motor.ts`): por ejemplo, compara el número de cédula extraído con el que declaró el beneficiario. Una alucinación del modelo no puede, por sí sola, completar un expediente.
- Pagar, objetar o pedir documentos solo se puede hacer desde el panel, por un analista autenticado; queda en la tabla `decisiones` (inmutable) con su identidad, hora y justificación obligatoria.
- Antes de pagar u objetar, el analista debe **confirmar o corregir** el tipo sugerido por el modelo. Eso alimenta la métrica de correcciones.
- No se puede aprobar el pago de un expediente incompleto.

### Control de lo que el modelo se inventa
- Salida restringida por **esquema JSON** (tipos y documentos son enumeraciones cerradas) y validada otra vez con Zod; cualquier respuesta fuera de esquema se descarta, no se "repara".
- `temperature: 0`.
- La evidencia que cita el modelo debe aparecer **literalmente** en el relato; si no aparece, su confianza se rebaja automáticamente.
- Confianza baja en el tipo (< 0,6) → el caso va a **revisión manual** y el reloj no arranca solo.
- Texto del relato y de los documentos se trata como datos: el prompt lo indica y, sobre todo, ninguna salida del modelo dispara acciones. El conjunto de prueba incluye un intento de inyección (E30).
- Cada llamada queda en `ejecuciones_ia` (inmutable): modelo, versión del prompt, qué se envió (relato + id y hash de cada archivo), respuesta exacta y latencia.

### Qué pasa si el modelo no responde
- Timeout de 45 s. El caso queda en `recibido` y el error queda registrado.
- El cron lo reintenta (hasta 3 veces). Si se agota, pasa a **revisión manual** y se avisa a los analistas por correo.
- El beneficiario nunca ve un error: su página dice que el caso está en revisión.
- El analista puede reintentar el análisis desde el panel.

### El reloj legal
- Corre desde que el expediente queda **completo**, no desde la radicación. Ejemplo del enunciado: radicada incompleta el 1 de octubre, completada el 20 → vence el 20 de noviembre (escenario E12).
- "Un mes" se cuenta como mes calendario (`fecha + interval '1 month'` en hora de Colombia).
- Criterio conservador: el inicio es el momento en que **llegó el último documento válido**, no el momento en que el sistema o una persona lo confirmó. Si la confirmación tarda, el plazo no se estira a favor de la aseguradora.
- Un trigger en la base impide reiniciar el reloj una vez fijado: ni un duplicado, ni una reclasificación, ni un reproceso pueden moverlo.
- Semáforo: en plazo → **en riesgo** (≤ 10 días) → **crítico** (≤ 3 días) → vencido. Las alertas se generan **una sola vez por umbral** (llave única) y salen antes del vencimiento.
- El vigilante corre **dentro de la base** (`vigilar_plazos()` con pg_cron), así que sigue funcionando aunque la aplicación web esté caída.

### Duplicados (tres niveles)
1. **Mismo envío** (doble clic, recarga, reintento de red): `idempotency_key` única → se devuelve el mismo caso.
2. **Misma reclamación otro día** (nuevo formulario): índice único parcial sobre (cédula del asegurado, cédula del beneficiario) para casos abiertos → los documentos se suman al expediente existente y **el reloj no se toca**. Por seguridad, el enlace de ese caso no se muestra en pantalla: se envía al correo registrado (conocer dos cédulas no debe dar acceso a un expediente ajeno).
3. **Mismo archivo** dentro del caso: restricción única (reclamación, SHA-256) → se ignora y se registra.

### Todo caso se puede reconstruir
`eventos`, `decisiones` y `ejecuciones_ia` son de solo inserción: un trigger rechaza `UPDATE` y `DELETE`. La función `historia_caso(radicado)` une todo en orden cronológico; el panel la muestra en cada caso.

---

## 3. Las cuatro respuestas (punto 7)

Calculadas en vivo con vistas SQL sobre lo que realmente pasó.

| Pregunta | Dónde verla | Fuente |
|---|---|---|
| 1. Casos abiertos, día del plazo de cada uno, en riesgo, vencidos | `/panel` (tabla) y `/panel/metricas` | `v_casos_plazo`, `v_resumen_plazos` |
| 2. Clasificaciones del modelo corregidas por una persona | `/panel/metricas` | `v_correcciones_clasificacion`, `v_correcciones_documentos` |
| 3. Tiempo desde la radicación hasta decirle al beneficiario qué falta | `/panel/metricas` (promedio, mediana, p90 vs. 4,5 días) | `v_tiempo_primera_respuesta` |
| 4. Historia completa de un caso al azar | `/panel/metricas` → "Abrir un caso al azar", o `GET /api/metricas/historia/{radicado}` | `historia_caso()` |

En JSON (con sesión de analista): `GET /api/metricas`.

Consultas directas en el SQL Editor de Supabase:
```sql
select * from v_resumen_plazos;
select radicado, semaforo, dia_del_plazo, dias_restantes from v_casos_plazo where estado <> 'cerrado' order by dias_restantes;
select * from v_correcciones_clasificacion;
select * from v_tiempo_primera_respuesta;
select * from historia_caso('RAD-2026-1000');
```

---

## 4. Seguridad

**Canal público (abierto a cualquiera, recibe archivos de desconocidos)**
- Los archivos nunca pasan por el servidor web: suben con URL firmada de un solo uso a una zona de cuarentena y solo se aceptan después de verificar su **tipo real por magic bytes** (PDF, JPG, PNG, WEBP), tamaño ≤ 10 MB y máximo 15 por envío. El bucket además restringe tipos y tamaño.
- En el almacenamiento, el nombre del archivo es su hash, nunca el nombre que envió el usuario.
- Bucket **privado**: los analistas ven los archivos con enlaces que caducan en 5 minutos.
- Límite de envíos por IP (10/hora, IP guardada como hash con sal), campo trampa contra bots, validación estricta con Zod en servidor.
- Cabeceras: CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`; las páginas no se indexan.
- Consentimiento explícito de tratamiento de datos (Ley 1581 de 2012), con fecha y hora registradas.

**Panel (privado)**
- Supabase Auth + middleware en `/panel/*`. Además, cada página y cada acción verifica en el servidor que el usuario esté en la tabla `analistas` y activo: **tener una cuenta no basta**.
- No hay registro público de analistas; se crean con un script (`npm run analista:crear`).
- RLS activo en todas las tablas sin políticas para `anon`: con la llave pública no se puede leer ni escribir nada. Todo acceso a datos ocurre en el servidor con la service role, que nunca llega al navegador.
- `/api/cron/tick` exige un secreto (comparación en tiempo constante).

**Datos y modelo**
- En este entorno de prueba se usa el plan gratuito de Gemini, que puede usar los datos enviados para mejorar el servicio. Por eso el conjunto de prueba es 100 % ficticio. En producción se usaría Azure OpenAI o Vertex AI, con acuerdo de no retención ni entrenamiento (ver sección 8).

---

## 5. Operación: cómo me entero de que algo se rompió antes que el usuario

- `GET /api/salud` responde **503** si: el vigilante de plazos o el tick de la app llevan más de 40 min sin latido, hay casos sin procesar hace más de 30 min, hay notificaciones fallidas o la base no responde. Se conecta a **UptimeRobot** (gratis, cada 5 min) para recibir alerta por correo.
- Cada ejecución del cron deja un latido en la tabla `latidos`.
- Los errores del modelo quedan en `ejecuciones_ia` y en el caso (`ultimo_error_ia`).
- Las notificaciones tienen estado (`pendiente`, `enviada`, `fallida`, `omitida`) y se reintentan hasta 5 veces.
- Supabase pausa los proyectos gratuitos tras 7 días sin actividad; el cron y el monitor lo mantienen activo.

---

## 6. Levantar la solución desde cero

**Requisitos:** Node.js 20+, una cuenta de Supabase, una API key de Gemini (Google AI Studio). Opcional: una cuenta de Gmail con contraseña de aplicación para enviar correos.

```bash
git clone <este-repo> && cd radicacion-siniestros
npm install
cp .env.example .env.local   # y llénelo (ver abajo)
```

### 6.1 Base de datos
En Supabase → **SQL Editor**, ejecute en orden los archivos de `supabase/migrations/`:
1. `0001_esquema.sql`
2. `0002_reloj_y_metricas.sql`
3. `0003_cron.sql` (activa pg_cron y pg_net)
4. `0004_simulacion.sql` (solo para datos de prueba)

### 6.2 Variables de entorno (`.env.local`)
| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `APP_URL` | `http://localhost:3000` en local; la URL de Vercel en producción |
| `CRON_SECRET`, `HASH_SALT` | Cadenas aleatorias largas (`openssl rand -hex 32`) |
| `SMTP_USER`, `SMTP_PASS` | Opcional. Cuenta de Gmail y su **contraseña de aplicación** (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones) |
| `ALERTAS_EMAIL` | Opcional. Correos que reciben las alertas internas; vacío = analistas activos |

Si faltan las opcionales, las notificaciones quedan como `omitida` (visibles en el panel) y el beneficiario igual ve todo en su enlace de seguimiento.

### 6.3 Activar el cron
En el SQL Editor (con la URL pública de la app y el mismo `CRON_SECRET`):
```sql
select vault.create_secret('https://SU-APP.vercel.app', 'app_url');
select vault.create_secret('EL_MISMO_CRON_SECRET', 'cron_secret');
```

### 6.4 Usuario del panel y datos de prueba
```bash
npm run analista:crear -- analista@prueba.co "UnaClaveLarga2026!" "Analista de prueba"
npm run dev                       # http://localhost:3000
npm run datos:cargar              # en otra terminal: carga los 34 escenarios
```

### 6.5 Despliegue en Vercel
Importe el repositorio en Vercel, copie las mismas variables de entorno (con `APP_URL` = URL de Vercel) y despliegue. Actualice el secreto `app_url` del paso 6.3.

---

## 7. Conjunto de datos de prueba

`datos-prueba/escenarios.ts` define **34 radicaciones** ficticias; `datos-prueba/cargar.ts` las envía por la **API real** (el mismo camino que un beneficiario, incluido el modelo) y al final compara lo que determinó el sistema con lo esperado. Genera `datos-prueba/generados/reporte.md` con la precisión de la clasificación y de la completitud.

| Cobertura | Escenarios |
|---|---|
| Muerte natural / accidental / incapacidad | E01–E14 / E15–E22 / E23–E28 |
| Expedientes completos | E01, E02, E09–E12, E14, E15, E17, E19, E21–E23, E27 |
| Llegó pero no sirve: sin firma | E05, E20, E28 |
| Llegó pero no sirve: ilegible (foto borrosa) | E07, E25, E34 |
| Llegó pero no sirve: de otra persona | E06, E18, E26 |
| Misma radicación dos veces (doble clic) | E13 |
| Reenvío otro día con los mismos archivos | E14 |
| Mismo archivo dos veces en un envío | E32 |
| Reloj desde completitud, no desde radicación | E12 |
| En riesgo / crítico / vencido | E09, E19 / E10, E27 / E11 |
| Clasificación inferida de documentos, no del relato | E17, E22 |
| Bordes de clasificación (homicidio, relato vago) | E21, E33 |
| Documento irrelevante (factura) | E29 |
| Inyección de instrucciones en el relato | E30 |
| Archivo malicioso disfrazado de PDF | E31 |

Para mostrar plazos en riesgo y vencidos sin esperar 30 días, los escenarios marcados usan `simular_antiguedad()`, que desplaza las fechas del caso **y deja constancia en la bitácora** (`simulacion_antiguedad`), de modo que nunca se confunde con un hecho real.

---

## 8. Llevarlo a Azure

| Hoy | En Azure |
|---|---|
| Vercel (Next.js) | Azure App Service (Node 20) o Azure Static Web Apps + Functions |
| Supabase Postgres | Azure Database for PostgreSQL – Flexible Server (el SQL de `supabase/migrations` es Postgres estándar) |
| pg_cron / pg_net | pg_cron está disponible en Flexible Server; el llamado HTTP se reemplaza por una **Azure Function con Timer Trigger** |
| Supabase Storage + URLs firmadas | Azure Blob Storage + **SAS** de escritura de corta duración |
| Supabase Auth | **Microsoft Entra ID** (SSO corporativo, grupos para el rol de analista) |
| Gemini | **Azure OpenAI** con abuso/retención deshabilitados y red privada |
| Gmail SMTP | Azure Communication Services (correo) y alertas a un canal de **Microsoft Teams** |
| UptimeRobot | Azure Monitor + Application Insights (alertas sobre `/api/salud`) |
| Secretos en `.env` | Azure Key Vault con identidades administradas |

El código de dominio (`motor.ts`, `expediente.ts`, `dominio.ts`) no depende del proveedor; los cambios se concentran en `src/lib/supabase/*`, `src/lib/ia/analizar.ts` y `src/lib/notificaciones.ts`.

---

## 9. Supuestos y preguntas abiertas

Preguntas que haría al negocio y el supuesto que tomé mientras tanto:

1. **¿"Un mes" es calendario o hábil?** Supuse calendario (art. 67 C.C. / art. 829 C. Co.).
2. **¿Pedir documentos adicionales después de completo suspende el plazo?** Supuse que **no**: el reloj sigue corriendo. Es la opción que protege del pago de intereses de mora.
3. **¿Un homicidio cuenta como "muerte accidental" en la póliza?** Depende del clausulado. El modelo lo sugiere como accidental y el analista lo confirma (E21).
4. **¿Varios beneficiarios de la misma póliza?** Cada beneficiario tiene su expediente (la llave es asegurado + beneficiario). Faltaría agruparlos por póliza.
5. **¿Hay vigencia máxima para la certificación bancaria?** El texto al beneficiario pide ≤ 30 días, pero no se valida automáticamente.
6. **¿El número de póliza se conoce al radicar?** No se pide, porque el beneficiario muchas veces no lo tiene.

---

## 10. Qué dejé por fuera y por qué

- **WhatsApp/Telegram como canal de radicación.** Prioricé un solo canal sólido; el seguimiento por enlace + correo cubre la conversación posterior. Agregar WhatsApp implica aprobación de Meta y plantillas.
- **Validación contra el core de pólizas** (¿el asegurado tiene póliza vigente?, ¿el reclamante es beneficiario designado?). No hay fuente de datos en la prueba; sería el siguiente paso.
- **Antivirus** sobre los archivos. Hoy se valida el tipo real y se aísla en cuarentena; en Azure se activaría Microsoft Defender for Storage.
- **Pruebas automatizadas end-to-end.** El conjunto de prueba ejecutado contra la API cumple ese papel para esta entrega; con más tiempo agregaría pruebas unitarias de `validarDocumento` y `evaluarExpediente`.
- **Cálculo de intereses de mora.** Fuera de alcance por diseño: el sistema no calcula valores.

---

## 11. Estructura

```
src/
  app/
    page.tsx                         Formulario de radicación
    seguimiento/[token]/             Página del beneficiario
    panel/                           Panel del analista (login, casos, caso, operación)
    api/radicar                      Paso 1: datos + URLs de subida
    api/cargas/confirmar             Paso 2: validación de archivos + motor
    api/seguimiento/[token]/cupos    Subir más documentos desde el enlace
    api/cron/tick                    Vigilante + reintentos + envíos
    api/salud                        Chequeo de salud
    api/metricas                     Las cuatro respuestas en JSON
  lib/
    motor.ts                         Orquestación, reglas y reloj
    expediente.ts                    Evaluación determinística del expediente
    ia/analizar.ts                   Llamada al modelo con esquema estricto
    dominio.ts                       Reglas del negocio y textos
    notificaciones.ts, correo.ts     Correo (beneficiario y alertas) con reintentos
    seguridad.ts, radicacion.ts      Validación de archivos, tokens, límites
supabase/migrations/                 Esquema, vistas, vigilante, cron
datos-prueba/                        Generador de documentos y 34 escenarios
scripts/                             Alta de analistas
```

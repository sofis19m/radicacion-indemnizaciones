# Radicación de indemnizaciones · Seguros de vida

Sistema para recibir reclamaciones de seguros de vida, determinar si el expediente está completo y vigilar el plazo legal del artículo 1080 del Código de Comercio, sin que la decisión de pagar u objetar salga nunca de manos de una persona.

## Probarlo

| Qué | Dónde |
|---|---|
| **Canal de radicación** (público, sin usuario) | https://radicacion-indemnizaciones.vercel.app |
| **Panel del analista** | https://radicacion-indemnizaciones.vercel.app/panel/login |
| Usuario de prueba | `analista@prueba.co` · la contraseña se entrega en el correo de entrega (el repositorio es público) |
| **Las cuatro respuestas del punto 7** | En el panel: secciones *Resumen/Plazos* (1), *Desempeño* (2), *Respuesta* (3) y *Abrir un caso al azar* (4). En JSON: `GET /api/metricas` (con sesión) |
| Salud del sistema (para el monitor externo) | https://radicacion-indemnizaciones.vercel.app/api/salud |
| Resultados del conjunto de prueba | [`datos-prueba/README.md`](datos-prueba/README.md) y sección 7 |
| Explicación del motor en lenguaje simple | [`docs/como-funciona-el-motor.md`](docs/como-funciona-el-motor.md) |

**Recorrido sugerido:** radique un caso desde el celular con su correo (puede subir fotos de cualquier documento) → mire su página de seguimiento y el correo que recibe → entre al panel, abra el caso, revise qué determinó el sistema y registre una decisión.

---

## 1. Arquitectura

```
 Beneficiario (celular)                        Analista
        │                                          │
        ▼                                          ▼
 ┌───────────────┐   URL firmada    ┌───────────────────────────┐
 │  Next.js web  │ ───────────────► │ Supabase Storage (privado) │
 │  / seguimiento│                  └───────────────────────────┘
 │  /panel       │ ◄──── sesión ────  Supabase Auth
 │  /api/*       │
 └──────┬────────┘
        │ service role (solo servidor)
        ▼
 ┌──────────────────────────────────────────────┐        ┌─────────────────┐
 │ Postgres (Supabase)                          │        │ Gemini (cadena  │
 │  reclamaciones · documentos · eventos (inm.) │ ◄────► │ de 4 modelos):  │
 │  decisiones (inm.) · ejecuciones_ia (inm.)   │        │ observa y       │
 │  pg_cron ─► vigilar_plazos() cada 15 min     │        │ sugiere         │
 │  pg_cron ─► POST /api/cron/tick cada 15 min  │        └─────────────────┘
 └──────────────────────────────────────────────┘
        │
        └─► Correo (Gmail SMTP): al beneficiario y alertas a los analistas
```

**Stack (todo con plan gratuito):** Next.js 15 + TypeScript · Supabase (Postgres, Storage, Auth, pg_cron, pg_net, Vault) · Gemini (Google AI Studio) · Vercel · Gmail SMTP (nodemailer).

### Flujo de una radicación

1. El beneficiario indica qué ocurrió, deja sus datos, cuenta con sus palabras qué pasó y sube cada documento **en su casilla**. El navegador genera una **llave de idempotencia** que sobrevive a recargas.
2. `POST /api/radicar` valida los datos, calcula una **pista preliminar** del tipo (sin IA), crea el caso y devuelve **URLs de subida firmadas** de un solo uso.
3. El navegador sube cada archivo directo al almacenamiento, a una zona de cuarentena.
4. `POST /api/cargas/confirmar`: el servidor verifica el **tipo real** de cada archivo por su contenido, calcula su **SHA-256**, descarta duplicados y lo mueve a su ubicación definitiva.
5. El **motor** analiza el caso: el modelo clasifica y revisa cada documento contra la **ficha técnica**; las **reglas en código** deciden si cada documento sirve y si el expediente está completo.
6. Si quedó completo, arranca el reloj. En todos los casos se le dice al beneficiario, en lenguaje claro, qué falta o qué llegó pero hay que corregir.
7. Cada 15 minutos, sin intervención humana, el vigilante evalúa los plazos, avisa antes del vencimiento, recuerda al beneficiario que no ha completado y reintenta lo que haya fallado.

---

## 2. Decisiones de diseño

### Canal: web para celular, sin usuario, con enlace personal de seguimiento
- Quien radica acaba de perder a un familiar. Una página web no exige instalar nada, recordar contraseñas ni conversar con un bot, y se puede completar en varias sesiones.
- **Una casilla por documento**: la persona no tiene que renombrar archivos, el sistema sabe qué *dice* ser cada uno y verifica que lo sea. La cédula acepta frente y reverso en dos fotos.
- La sección *"¿Qué ocurrió?"* solo **organiza** qué casillas se muestran. **No es la clasificación**: el tipo lo determina el sistema con el relato y los documentos, y si no coincide con lo que eligió la persona se genera una alerta para el analista.
- **La conversación no termina al radicar**: cada correo lleva un enlace personal (`/seguimiento/{token}`) donde la persona ve, documento por documento, qué está bien, qué hay que corregir y qué falta, y sube lo que le pidan. Si el caso se queda quieto, el sistema le escribe a los 3, 7 y 15 días.
- El token del enlace es aleatorio (256 bits), se guarda solo su hash y caduca a los 180 días.

### El modelo observa, las reglas deciden, la persona resuelve
- El modelo **solo** clasifica y reporta lo que ve en cada documento: qué es, si se lee, si tiene firma, huella y sello, qué elementos de la ficha faltan, qué problemas tiene y a nombre de quién está.
- **Si un documento sirve lo decide el código** (`src/lib/validacion.ts`), con seis reglas en orden: calidad de la imagen, reconocimiento, firma/huella/sello, vigencia, contenido según la ficha y titular (comparación exacta de números de documento). Una alucinación del modelo no puede, por sí sola, completar un expediente.
- Pagar, objetar o pedir documentos solo se puede hacer desde el panel, por un analista autenticado; queda en la tabla `decisiones` (inmutable) con su identidad, hora y justificación obligatoria. Antes de pagar u objetar, el analista debe **confirmar o corregir** el tipo sugerido (eso alimenta la pregunta 2), y no se puede aprobar el pago de un expediente incompleto.

### Cómo se clasifica el tipo de reclamación
La lógica vive en una **base de conocimiento** editable (`src/lib/ia/base-conocimiento.ts`): por cada tipo, su definición, las frases típicas del relato, los documentos que lo delatan y los casos borde (caída y muerte días después en el hospital, homicidio, suicidio, relato que contradice al documento...).

1. **Pista preliminar, al radicar y sin IA:** puntos por frases del relato, por las casillas usadas y, como pista débil, por la cantidad de documentos. Solo propone un tipo si hay ventaja clara.
2. **Modelo, leyendo los documentos:** recibe la base de conocimiento y la pista. Regla de prioridad: **los documentos pesan más que el relato**. Si contradice la pista, debe explicar por qué y queda registrado.
3. **Analista:** confirma o corrige. El panel muestra los tres pasos y la evidencia (cita literal del relato, razón y confianza).

### Ficha técnica de documentos
`src/lib/ia/fichas-documentos.ts` define, para cada documento, **cómo se reconoce, qué debe contener y qué alertas revisar**, y un **catálogo cerrado de problemas** (borroso, cortado, mal escaneado, una sola cara, sin firma, sin huella, sin sello, campos vacíos, vencido, enmendaduras, posible alteración...). Las alertas tienen dos niveles:
- **Del documento** (se corrige reenviándolo): el documento no cuenta y se le explica a la persona qué corregir.
- **Para el analista** (asuntos de fondo: porcentaje de pérdida de capacidad bajo, dictamen sin ejecutoria, enmendaduras, fechas que no coinciden entre documentos, firmante distinto al beneficiario): el documento cuenta, pero el caso queda marcado. Decidir sobre ellas es pagar u objetar, y eso es humano.

Además, el código **cruza documentos entre sí** (fecha de muerte en registro civil, certificado e informe; nombre del fallecido frente al asegurado) y genera alertas si no coinciden. El sistema **no certifica autenticidad**: señala inconsistencias para revisión humana.

### Control de lo que el modelo se inventa
- Salida restringida por **esquema JSON** con enumeraciones cerradas, validada otra vez con Zod; una respuesta fuera de esquema se descarta, no se "repara". `temperature: 0`.
- La cita del relato debe aparecer **literalmente**; si no, la confianza se rebaja.
- Confianza baja (< 0,6) → **revisión manual**, y el reloj no arranca solo.
- El relato y los documentos son datos, no instrucciones; ninguna salida del modelo dispara acciones (escenario E30: intento de inyección).
- Cada llamada queda en `ejecuciones_ia` (inmutable): modelo, versión del prompt, qué se envió, respuesta exacta y latencia.

### Qué pasa si el modelo no responde
- **Cadena de cuatro modelos** (`GEMINI_MODELOS`), del más capaz al de último recurso, cada uno con su propia cuota: si uno no responde, está saturado, agotó su cuota diaria o fue retirado, se usa el siguiente.
- Si respondió un modelo **"lite"** (menos preciso), el expediente **no se completa automáticamente**: lo confirma un analista. Esta regla se agregó porque en pruebas un modelo lite dio por válido un SARLAFT sin firma.
- Si ninguno responde, el caso queda en cola, el error queda registrado y el vigilante lo reintenta; tras 3 intentos pasa a **revisión manual** y se avisa por correo a los analistas. El beneficiario nunca ve un error técnico.

### El reloj legal
- Corre desde que el expediente queda **completo**, no desde la radicación (escenario E12).
- "Un mes" es mes calendario, en hora de Colombia.
- Criterio conservador: el inicio es cuando **llegó el último documento válido**, no cuando el sistema o una persona lo confirmó.
- Un trigger impide reiniciar el reloj: ni un duplicado, ni una reclasificación, ni un reproceso pueden moverlo.
- Semáforo: en plazo → **en riesgo** (≤ 10 días) → **crítico** (≤ 3 días) → vencido. Cada alerta sale **una sola vez por nivel** y antes del vencimiento.
- El vigilante corre **dentro de la base** (`vigilar_plazos()` con pg_cron), así que sigue funcionando aunque la aplicación web esté caída.

### Duplicados (tres niveles)
1. **Mismo envío** (doble clic, recarga, reintento): `idempotency_key` única → se devuelve el mismo caso.
2. **Misma reclamación otro día**: índice único parcial sobre (asegurado, beneficiario) en casos abiertos → los documentos se suman al expediente existente y **el reloj no se toca**. El enlace de ese caso se envía al correo registrado, no se muestra en pantalla.
3. **Mismo archivo** dentro del caso: restricción única (reclamación, SHA-256) → se ignora y se registra.

### Todo caso se puede reconstruir
`eventos`, `decisiones` y `ejecuciones_ia` son de solo inserción: un trigger rechaza `UPDATE` y `DELETE`. `historia_caso(radicado)` une todo en orden cronológico y el panel la muestra en la ficha de cada caso.

---

## 3. Las cuatro respuestas (punto 7)

Calculadas en vivo con vistas SQL sobre lo que realmente pasó.

| Pregunta | En el panel | Fuente |
|---|---|---|
| 1. Casos abiertos, día del plazo de cada uno, en riesgo y vencidos | Tarjetas de resumen + sección **1 · Plazos** (dona, barra con el día del plazo de cada caso) + sección **2 · Casos** | `v_casos_plazo`, `v_resumen_plazos` |
| 2. Clasificaciones del modelo corregidas por una persona | Sección **3 · Desempeño del modelo** (clasificadas, revisadas, corregidas, tasa) | `v_correcciones_clasificacion`, `v_correcciones_documentos` |
| 3. Tiempo desde la radicación hasta decirle al beneficiario qué falta | Sección **4 · Tiempo de respuesta** (promedio, mediana, p90 frente a los 4,5 días del proceso manual) | `v_tiempo_primera_respuesta` |
| 4. Historia completa de un caso al azar | Botón **"Abrir un caso al azar"** → ficha del caso → *Historia del caso*. También `GET /api/metricas/historia/{radicado}` | `historia_caso()` |

La tasa de corrección se calcula solo sobre casos que una persona revisó: los no revisados no cuentan como aciertos.

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
- Los archivos nunca pasan por el servidor web: suben con URL firmada de un solo uso a una zona de cuarentena y solo se aceptan tras verificar su **tipo real por contenido** (PDF, JPG, PNG, WEBP), tamaño ≤ 10 MB y máximo 15 por envío. El bucket también restringe tipos y tamaño.
- En el almacenamiento el archivo se nombra con su hash, nunca con el nombre que envió el usuario.
- Bucket **privado**: los analistas ven los archivos con enlaces que caducan en 5 minutos.
- Límite de envíos por IP (10/hora, IP guardada como hash con sal), campo trampa contra bots, validación estricta en servidor.
- Cabeceras: CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`; las páginas no se indexan.
- Consentimiento explícito de tratamiento de datos (Ley 1581 de 2012), con fecha y hora registradas.

**Panel (privado)**
- Sesión obligatoria en `/panel/*` y, además, cada página y cada acción verifica en el servidor que el usuario esté registrado como analista activo: **tener una cuenta no basta**.
- No hay registro público de analistas; se crean con `npm run analista:crear`.
- RLS activo en todas las tablas y permisos explícitos solo para el servidor: con la llave pública no se puede leer ni escribir nada.
- `/api/cron/tick` exige un secreto (comparación en tiempo constante); la URL y el secreto que usa pg_cron viven cifrados en Supabase Vault.

**Datos y modelo**
- El plan gratuito de Gemini puede usar los datos enviados para mejorar el servicio. Por eso el conjunto de prueba es 100 % ficticio. En producción se usaría Azure OpenAI con acuerdo de no retención ni entrenamiento (sección 8).

---

## 5. Operación: cómo me entero de que algo se rompió antes que el usuario

- `GET /api/salud` responde **503** si el vigilante o el trabajo de la aplicación llevan más de 40 minutos sin latido, si hay casos sin procesar hace más de 30 minutos, si hay notificaciones fallidas o si la base no responde. Está pensado para un monitor externo (por ejemplo UptimeRobot, gratis, cada 5 minutos).
- Cada ejecución del vigilante deja un latido en la tabla `latidos`.
- Los errores del modelo quedan en `ejecuciones_ia` y en el caso; las notificaciones tienen estado (`pendiente`, `enviada`, `fallida`, `omitida`) y se reintentan hasta 5 veces.
- Supabase pausa los proyectos gratuitos tras 7 días sin actividad; el vigilante lo mantiene activo.

---

## 6. Levantar la solución desde cero

**Requisitos:** Node.js 20+, una cuenta de Supabase y una API key de Gemini (Google AI Studio). Opcional: una cuenta de Gmail con contraseña de aplicación para enviar correos.

```bash
git clone https://github.com/sofis19m/radicacion-indemnizaciones.git
cd radicacion-indemnizaciones
npm install
cp .env.example .env.local   # y llénelo (ver abajo)
```

### 6.1 Variables de entorno (`.env.local`)
| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `DATABASE_URL` | Supabase → Connect → Session pooler (solo para aplicar migraciones y los scripts) |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |
| `GEMINI_MODELOS` | Cadena de modelos, del más capaz al de último recurso (ver `.env.example`) |
| `APP_URL` | `http://localhost:3000` en local; la URL pública en producción |
| `CRON_SECRET`, `HASH_SALT` | Cadenas aleatorias largas (`openssl rand -hex 32`) |
| `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_NAME` | Opcional. Gmail y su **contraseña de aplicación** (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones) |
| `ALERTAS_EMAIL` | Opcional. Correos que reciben las alertas internas; vacío = analistas activos |

Si falta el correo, las notificaciones quedan como `omitida` (visibles en el panel) y el beneficiario igual ve todo en su enlace de seguimiento.

### 6.2 Base de datos
```bash
npm run db:migrar     # aplica supabase/migrations/0001 … 0009, cada una una sola vez
```
También se pueden ejecutar los archivos de `supabase/migrations/` en orden desde el SQL Editor de Supabase.

### 6.3 Usuario del panel, aplicación y datos de prueba
```bash
npm run analista:crear -- analista@prueba.co "UnaClaveLarga2026!" "Analista de prueba"
npm run dev                       # http://localhost:3000
npm run datos:cargar              # en otra terminal: carga los 34 escenarios por la API real
npm run datos:reporte             # compara lo que determinó el sistema con lo esperado
```

### 6.4 Despliegue en Vercel y activación del vigilante
1. Importe el repositorio en Vercel y copie las variables de entorno (con `APP_URL` = URL pública). No hace falta `DATABASE_URL`.
2. En el SQL Editor de Supabase, guarde la URL y el secreto que usa pg_cron para llamar a la aplicación:
```sql
select vault.create_secret('https://SU-APP.vercel.app', 'app_url');
select vault.create_secret('EL_MISMO_CRON_SECRET', 'cron_secret');
```
3. Verifique `GET /api/salud` → `"ok": true` tras unos 15 minutos.

---

## 7. Conjunto de datos de prueba

**34 radicaciones ficticias** en [`datos-prueba/`](datos-prueba/README.md): E01–E14 muerte natural, E15–E22 muerte accidental, E23–E28 incapacidad y E29–E34 situaciones de error y seguridad. Cada escenario declara lo que se espera del sistema; `cargar.ts` las envía por la **API real** (el mismo camino que un beneficiario, incluido el modelo) con nombres de archivo genéricos (`documento_3.pdf`, `IMG_5.png`), así que el modelo reconoce cada documento por su contenido.

**Resultados** (`npm run datos:reporte`, sobre el estado real de la base):

| Métrica | Resultado |
|---|---|
| Expediente completo / incompleto determinado correctamente | **34/34** |
| Tipo de reclamación clasificado correctamente | **30/30** casos procesados por el modelo (0 errores) |
| Documentos con el estado esperado (válido, sin firma, ilegible, no corresponde, vencido, incompleto) | **199/199** documentos procesados |
| Expedientes creados en los escenarios de duplicados | **1** por caso (E13, E14, E32) |
| Casos en cola por cuota diaria del modelo | 4 (E08, E29, E33, E34): quedaron en revisión manual con el error registrado, sin perderse ni dar un resultado falso; se reprocesan cuando se restablece la cuota |

El plan gratuito de Gemini permite unas 20 consultas diarias por modelo: suficiente para la operación real (240 reclamaciones al mes son unas 8 al día), pero no para cargar 34 casos de una vez. La cadena de modelos y la cola de reintentos son la respuesta a esa limitación.

| Cobertura | Escenarios |
|---|---|
| Completos | E01, E02, E09–E12, E14, E15, E17, E19, E21–E23, E27 |
| Llegó pero no sirve: sin firma | E05, E20 |
| Llegó pero no sirve: ilegible (foto borrosa) | E07, E25, E34 |
| Llegó pero no sirve: de otra persona | E06, E18, E26 |
| Llegó pero no sirve: vencido | E28 |
| Cédula solo por el frente / en dos fotos | E08 / E23 |
| Misma radicación dos veces (doble clic) / reenvío otro día | E13 / E14 |
| Mismo archivo dos veces en un envío | E32 |
| Reloj desde completitud, no desde radicación | E12 |
| En riesgo / crítico / vencido | E09, E19 / E10, E27 / E11 |
| Tipo inferido de los documentos, no del relato | E17, E22 |
| Lo elegido en "¿Qué ocurrió?" no coincide con los documentos | E17 |
| Bordes de clasificación (homicidio, relato vago) | E21, E33 |
| Archivo en la casilla equivocada | E29 |
| Inyección de instrucciones en el relato | E30 |
| Archivo malicioso disfrazado de PDF | E31 |

Para mostrar plazos en riesgo y vencidos sin esperar 30 días, los escenarios marcados usan `simular_antiguedad()`, que desplaza las fechas del caso **y deja constancia en la bitácora**, de modo que nunca se confunde con un hecho real.

**Lo que las pruebas encontraron y se corrigió:** (1) un modelo lite dio por válido un SARLAFT sin firma → los modelos lite ya no completan expedientes solos; (2) la regla de "ambas caras" rechazaba frente y reverso subidos en fotos separadas → ahora se evalúa juntando los archivos; (3) una respuesta vacía pasajera del almacenamiento tumbaba la radicación con una página de error → ahora responde con un mensaje claro y el reintento es seguro gracias a la idempotencia.

---

## 8. Llevarlo a Azure

| Hoy | En Azure |
|---|---|
| Vercel (Next.js) | Azure App Service (Node 20) o Azure Static Web Apps + Functions |
| Supabase Postgres | Azure Database for PostgreSQL – Flexible Server (el SQL de `supabase/migrations` es Postgres estándar) |
| pg_cron / pg_net | pg_cron existe en Flexible Server; el llamado HTTP se reemplaza por una **Azure Function con Timer Trigger** |
| Supabase Storage + URLs firmadas | Azure Blob Storage + **SAS** de escritura de corta duración; **Microsoft Defender for Storage** como antivirus |
| Supabase Auth | **Microsoft Entra ID** (SSO corporativo y grupos para el rol de analista) |
| Gemini | **Azure OpenAI** con retención deshabilitada y red privada |
| Gmail SMTP | Azure Communication Services (correo) y alertas a un canal de **Microsoft Teams** |
| Monitor externo | Azure Monitor + Application Insights (alertas sobre `/api/salud`) |
| Secretos en variables de entorno / Vault | Azure Key Vault con identidades administradas |

El código de dominio (`validacion.ts`, `expediente.ts`, `dominio.ts`, `fichas-documentos.ts`, `base-conocimiento.ts`) no depende del proveedor; los cambios se concentran en `src/lib/supabase/*`, `src/lib/ia/analizar.ts` y `src/lib/correo.ts`.

---

## 9. Supuestos y preguntas abiertas

Preguntas que haría al negocio, con el supuesto que tomé mientras tanto:

1. **¿"Un mes" es calendario o hábil?** Supuse calendario.
2. **¿Pedir documentos adicionales después de completo suspende el plazo?** Supuse que **no**: el reloj sigue. Es la opción que protege del pago de intereses de mora.
3. **¿Un homicidio cuenta como "muerte accidental" en la póliza?** Depende del clausulado: el sistema lo sugiere como accidental y lo marca para confirmación del analista (E21).
4. **¿Varios beneficiarios de la misma póliza?** Cada beneficiario tiene su expediente (llave asegurado + beneficiario). Faltaría agruparlos por póliza.
5. **¿El número de póliza se conoce al radicar?** No se pide en el formulario porque el beneficiario muchas veces no lo tiene; la ficha técnica lo exige en el formato de reclamación.
6. **¿Qué alertas de la ficha deben rechazar el documento y cuáles solo avisar?** Separé en "del documento" (se corrige reenviándolo) y "para el analista" (de fondo). La lista es editable en `fichas-documentos.ts`.

---

## 10. Qué dejé por fuera y por qué

- **WhatsApp o Telegram como canal.** Prioricé un solo canal sólido; el enlace de seguimiento y el correo cubren la conversación posterior. WhatsApp exige aprobación de Meta y plantillas.
- **Validación contra el core de pólizas** (póliza vigente, beneficiario designado, valores) y contra fuentes oficiales (Registraduría, ReTHUS, Fiscalía). No hay fuente de datos en la prueba; es el siguiente paso.
- **Antivirus** sobre los archivos. Hoy se valida el tipo real y se aísla en cuarentena; en Azure se activaría Defender for Storage.
- **Pruebas unitarias automatizadas.** El conjunto de 34 escenarios ejecutado contra la API real cumple ese papel en esta entrega; con más tiempo agregaría pruebas de `validacion.ts` y `expediente.ts`.
- **Cálculo de intereses de mora o del valor a pagar.** Fuera de alcance por diseño: el sistema no calcula valores.

---

## 11. Estructura

```
src/
  app/
    page.tsx                         Formulario de radicación
    seguimiento/[token]/             Página del beneficiario
    panel/                           Panel del analista (login, resumen, ficha del caso)
    api/radicar                      Paso 1: datos + URLs de subida
    api/cargas/confirmar             Paso 2: validación de archivos + motor
    api/seguimiento/[token]/cupos    Subir más documentos desde el enlace
    api/cron/tick                    Envíos, reintentos y latido (lo llama pg_cron)
    api/salud                        Chequeo de salud
    api/metricas                     Las cuatro respuestas en JSON
  lib/
    motor.ts                         Orquestación: modelo → reglas → expediente → reloj → respuesta
    validacion.ts                    Las seis reglas que deciden si un documento sirve + cruces
    expediente.ts                    Checklist del expediente y mensaje al beneficiario
    ia/base-conocimiento.ts          Cómo se reconoce cada tipo de reclamación
    ia/fichas-documentos.ts          Ficha técnica de cada documento y catálogo de problemas
    ia/analizar.ts                   Instrucciones al modelo, esquema y cadena de modelos
    dominio.ts, casillas.ts          Requisitos por tipo, textos y casillas del formulario
    notificaciones.ts, correo.ts     Correo al beneficiario y alertas, con reintentos
    seguridad.ts, radicacion.ts      Validación de archivos, tokens, límites, idempotencia
supabase/migrations/                 Esquema, reloj, vigilante, cron, permisos
datos-prueba/                        34 escenarios, generador de documentos, carga y reporte
docs/                                Explicación del motor en lenguaje simple
scripts/                             Migraciones, alta de analistas, reinicio de datos de prueba
```

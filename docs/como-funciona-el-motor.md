# Cómo funciona el motor, pieza por pieza

El motor es la parte del sistema que trabaja por detrás, sin que nadie la vea: recibe la reclamación, entiende de qué se trata, revisa los documentos, le responde al beneficiario y vigila el plazo legal. Este documento explica cada pieza con una lógica simple, con ejemplos y con el archivo donde vive.

---

## La idea central: la IA observa, las reglas deciden, la persona resuelve

| Quién | Qué hace | Qué NO hace |
|---|---|---|
| **La IA (Gemini)** | Lee el relato y los documentos, y reporta lo que ve: qué documento es, si se lee, si tiene firma, a nombre de quién está | No decide si un documento sirve ni si el expediente está completo |
| **Las reglas (código)** | Con lo que reportó la IA, decide con reglas fijas si cada documento sirve y si el expediente está completo | No paga, no objeta, no calcula valores |
| **El analista (persona)** | Confirma o corrige lo que sugirió el sistema y decide: pagar, objetar o pedir documentos | — |

Así, si la IA se equivoca, una regla fija la frena, y la decisión de fondo siempre la toma una persona con su nombre.

---

## 1. Recibir y guardar la radicación

**Qué pasa:** la persona llena el formulario y sube sus documentos, cada uno en su casilla.

1. Se crea el caso con un número de radicado (por ejemplo `RAD-2026-1015`).
2. Cada archivo se revisa antes de aceptarlo: ¿es de verdad un PDF o una foto? (se mira su contenido, no su nombre), ¿pesa menos de 10 MB?
3. A cada archivo se le calcula una **huella digital** (SHA-256). Si el mismo archivo llega dos veces, se reconoce y no se guarda de nuevo.
4. Todo queda anotado en una **bitácora** que no se puede editar ni borrar.

**Ejemplo:** alguien hace doble clic en "Radicar". Las dos solicitudes llegan con la misma llave, así que el sistema devuelve el mismo caso y no crea uno nuevo.

**Dónde vive:** `src/app/api/radicar/route.ts`, `src/lib/radicacion.ts`.

---

## 2. Entender de qué tipo de reclamación se trata

**Qué pasa:** el tipo (muerte natural, muerte accidental o incapacidad) se deduce del relato y de los documentos, en tres pasos:

| Paso | Cómo funciona | Ejemplo |
|---|---|---|
| **1. Pista preliminar (sin IA)** | Busca frases típicas en el relato y mira qué documentos llegaron | *"lo atropelló un bus"* + informe de policía → apunta a accidental |
| **2. Clasificación de la IA** | Lee todo con una **base de conocimiento** (qué es cada tipo, frases típicas, documentos que lo delatan, casos difíciles). Regla: **el documento pesa más que el relato** | El relato dice *"murió dormido"*, pero llega una noticia criminal por monóxido de carbono → accidental |
| **3. Confirmación del analista** | La persona confirma o corrige. De ahí sale cuántas veces se equivocó el modelo | El analista cambia "natural" por "accidental": cuenta como una corrección |

**Controles para que la IA no invente:**
- Solo puede responder uno de los tres tipos.
- Debe citar una frase **literal** del relato. Si la frase no existe, se le baja la confianza.
- Con confianza menor al 60 %, el caso pasa a **revisión manual**.

**Lo que indicó el beneficiario en "¿Qué ocurrió?"** solo organiza qué casillas ve en el formulario. No reemplaza la clasificación: si no coincide con lo que dicen los documentos, se genera una alerta para el analista.

**Dónde vive:** `src/lib/ia/base-conocimiento.ts` (la base de conocimiento) y `src/lib/ia/analizar.ts` (las instrucciones a la IA).

---

## 3. Revisar si cada documento sirve

**Qué pasa:** la IA compara cada documento con una **ficha técnica** que dice, para cada uno, cómo se reconoce, qué debe contener y qué alertas revisar. Después, las reglas deciden en este orden:

| Paso | Pregunta | Si la respuesta es no |
|---|---|---|
| 1 | ¿Se puede leer? (no borroso, no cortado, no oscuro) | 🔍 Ilegible: *"tome una foto nueva con buena luz"* |
| 2 | ¿Es alguno de los documentos de la lista? | ❓ No reconocido |
| 3 | ¿Tiene firma, huella y sello cuando se exigen? | ✍️ Sin firma: *"fírmelo y vuelva a enviarlo"* |
| 4 | ¿Está vigente? (certificación bancaria de 30 días o menos) | 📅 Vencido: *"fue expedido hace 75 días"* |
| 5 | ¿Tiene todo lo que debe contener según la ficha? | ⬜ Incompleto: *"falta el número de póliza"* |
| 6 | ¿El número de cédula coincide con el declarado? (comparación exacta) | 🚫 No corresponde: *"es de otra persona"* |

Si pasa las seis preguntas → ✅ **válido**.

**Qué ve cada quien:** la tabla de arriba es lo que el sistema determina **por dentro**, y eso lo ve solo el analista en el panel. Al beneficiario no se le muestran detalles técnicos ni lo que se encontró en el documento: solo se le dice *"Recibimos este documento, pero necesitamos que nos lo envíe nuevamente"*. Cuando ayuda a no repetir el error, se agrega una indicación sencilla: *"con su firma y huella"*, *"con una foto más clara"* o *"necesitamos uno con fecha más reciente"*.

**Alertas de fondo:** algunas cosas no se rechazan, sino que se le avisan al analista, porque decidir sobre ellas es decidir el pago. Por ejemplo: un dictamen con menos del 50 % de pérdida de capacidad, enmendaduras, posibles alteraciones, o fechas de muerte distintas entre el registro civil y el certificado médico.

**¿Detecta documentos falsos?** No: ninguna IA puede certificar que un documento es auténtico. Lo que hace es señalar inconsistencias para que una persona las revise. En producción, la verificación real se haría contra fuentes oficiales (Registraduría, ReTHUS, Fiscalía).

**Dónde vive:** `src/lib/ia/fichas-documentos.ts` (la ficha técnica) y `src/lib/validacion.ts` (las seis reglas).

---

## 4. Revisar si el expediente está completo

**Qué pasa:** con cada documento ya revisado, se toma la lista oficial según el tipo:

| Tipo | Documentos requeridos |
|---|---|
| Muerte natural | 7 |
| Muerte accidental | 8 (los mismos 7 + informe de la autoridad) |
| Incapacidad total y permanente | 6 |

Regla única: **el expediente está completo solo si cada documento de la lista tiene al menos un archivo válido.**

Cada documento queda en una de tres situaciones:

| | Situación | Qué se le dice |
|---|---|---|
| ✅ | Llegó y sirve | — |
| ⚠️ | Llegó, pero no se pudo aceptar | *"Lo recibimos, pero necesitamos que nos lo envíe nuevamente"* |
| ⬜ | No llegó | *"Aún no lo recibimos"* |

**Ejemplo:** llegaron los 7 documentos, pero el SARLAFT sin firma. El expediente está **incompleto**, porque un documento con error no cuenta. Al beneficiario se le pide que **envíe nuevamente** el SARLAFT, con su firma y huella; no se le dice que le **falta**.

**La cédula en dos fotos:** si llega el frente en una foto y el reverso en otra, el sistema las junta y cuentan como un solo documento.

**Dónde vive:** `src/lib/expediente.ts` y la lista de requisitos en `src/lib/dominio.ts`.

---

## 5. Responderle al beneficiario en lenguaje claro

**Qué pasa:** apenas termina la revisión, el sistema le escribe:
- Si está completo: *"Su expediente está completo. No necesita enviar nada más por ahora."*
- Si no: la lista exacta de lo que falta y de lo que hay que corregir, con instrucciones para conseguir cada documento.

Llega por **correo**, con un botón a su **enlace personal de seguimiento**, donde ve el estado de cada documento y sube lo que falta, sin usuario ni contraseña.

Si el caso se queda quieto, el sistema le recuerda a los **3, 7 y 15 días**.

La hora de esa primera respuesta queda guardada: de ahí sale la medición *"¿cuánto tarda en decirle qué le falta?"* (antes, 4,5 días).

**Dónde vive:** `src/lib/expediente.ts` (los textos), `src/lib/notificaciones.ts` y `src/lib/correo.ts` (el envío), `src/app/seguimiento/` (la página).

---

## 6. Arrancar el reloj legal y vigilarlo solo

**La regla del artículo 1080:** la aseguradora tiene **un mes** para pagar u objetar, contado **desde que el expediente queda completo**, no desde que se radicó.

**Ejemplo:** radicada incompleta el 1 de octubre y completada el 20 → vence el **20 de noviembre**.

**Cómo funciona:**
1. Cuando el expediente queda completo, se fija la fecha de inicio (el día en que llegó el último documento válido) y la fecha de vencimiento (+1 mes).
2. La base de datos **impide reiniciar el reloj**: ni un archivo repetido, ni un cambio de tipo, ni un reproceso lo mueven.
3. Un **vigilante** se despierta **cada 15 minutos**, solo, y calcula para cada caso en qué día del plazo va y su semáforo.

El vigilante vive **dentro de la base de datos**, así que sigue trabajando aunque la página web esté caída.

**Dónde vive:** `supabase/migrations/0001_esquema.sql` (el reloj y su bloqueo), `0002_reloj_y_metricas.sql` (el semáforo), `0003_cron.sql` (el despertador cada 15 minutos) y `0006_alertas_por_correo.sql` (el vigilante).

---

## 7. Avisar antes de que se venza

El semáforo de cada caso:

| Semáforo | Cuándo | Aviso |
|---|---|---|
| 🟢 En plazo | Más de 10 días restantes | — |
| 🟡 En riesgo | 10 días o menos | Correo a los analistas |
| 🟠 Crítico | 3 días o menos | Segundo correo, más urgente |
| 🔴 Vencido | Pasó la fecha | Correo de vencido (ya corren intereses de mora) |

Cada aviso se envía **una sola vez** por nivel, para no llenar el correo de alertas repetidas. Las alertas también se ven en el panel.

---

## 8. Qué pasa cuando algo falla

| Falla | Qué hace el sistema |
|---|---|
| La IA no responde o agotó su cuota | Prueba con el siguiente modelo de una cadena de cuatro. Si ninguno responde, el caso queda en cola y se reintenta cada 15 minutos. Tras 3 intentos pasa a revisión manual y avisa a los analistas |
| Responde un modelo de menor capacidad ("lite") | El caso no se completa solo: lo confirma un analista |
| Falla pasajera de red al radicar | La persona ve *"intente de nuevo"*. Reintentar es seguro: la llave del envío evita un caso duplicado |
| El vigilante deja de correr | El chequeo de salud (`/api/salud`) lo detecta y el monitor externo avisa antes que nadie |

El beneficiario nunca ve un error técnico: ve *"estamos revisando sus documentos"*.

---

## 9. Todo queda registrado

Cada paso deja una anotación en la bitácora, que no se puede editar ni borrar: qué llegó, qué determinó la IA (con la entrada y la respuesta exactas), qué reglas aplicaron, qué se le escribió al beneficiario, qué alertas salieron y qué decidió cada analista, con su nombre y su justificación.

Por eso, de cualquier caso escogido al azar se puede reconstruir su historia completa, de principio a fin. En el panel: **"Abrir un caso al azar"** → **"Historia del caso"**.

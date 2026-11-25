# Conjunto de datos de prueba

El enunciado pide construir **mínimo 30 radicaciones** que cubran los tres tipos de reclamación, expedientes completos e incompletos, al menos un documento que llegue pero no sirva y al menos un caso donde la misma radicación llegue dos veces. No se entregaron datos reales, así que este conjunto se construyó desde cero: **34 radicaciones ficticias**.

## Cómo se numeraron

Los códigos **E01 a E34** ("E" de *escenario*) son una numeración propia de este conjunto de prueba, creada solo para organizarlo y poder referirse a cada caso. No hacen parte de la clasificación de la compañía. Los tipos de reclamación sí son los del enunciado: muerte natural, muerte accidental e incapacidad total y permanente.

| Bloque | Escenarios | Qué prueba |
|---|---|---|
| **Muerte natural** | E01 – E14 | Expedientes completos e incompletos, documentos que llegan pero no sirven, plazos en riesgo, críticos y vencidos, y las dos formas de duplicado (E13 doble clic, E14 reenvío otro día) |
| **Muerte accidental** | E15 – E22 | Lo mismo para el tipo que exige informe de autoridad, más casos donde el relato no basta y el tipo se infiere de los documentos (E17, E22) y el borde del homicidio (E21) |
| **Incapacidad total y permanente** | E23 – E28 | El asegurado vivo que reclama por sí mismo, con dictamen, sin dictamen, ilegible o de otra persona |
| **Situaciones de error y seguridad** | E29 – E34 | Problemas al momento de radicar o subir documentos: un archivo que no es ningún soporte, un intento de manipular al modelo desde el relato, un archivo malicioso disfrazado de PDF, el mismo archivo dos veces en un envío, un relato demasiado vago y una cédula ilegible |

Todos los escenarios E29 – E34 son reclamaciones por **muerte natural**: el tipo se dejó fijo para que lo único que cambie sea la situación de error que se quiere probar.

## Detalle de los 34 escenarios

| Esc. | Tipo | Situación | Resultado esperado |
|---|---|---|---|
| E01 | Natural | Expediente completo | Completo, arranca el reloj |
| E02 | Natural | Completo, relato breve y emocional | Completo |
| E03 | Natural | Falta la certificación bancaria | Incompleto: **falta** |
| E04 | Natural | Faltan SARLAFT y registro civil | Incompleto: **faltan** dos |
| E05 | Natural | SARLAFT sin firma | Incompleto: **llegó pero no sirve** (sin firma) |
| E06 | Natural | Cédula del asegurado de otra persona | Incompleto: **llegó pero no sirve** (no corresponde) |
| E07 | Natural | Registro civil en foto borrosa | Incompleto: **llegó pero no sirve** (ilegible) |
| E08 | Natural | Pocos documentos y la cédula del asegurado solo por el frente | Incompleto: faltan cuatro y **falta el reverso** de la cédula |
| E09 | Natural | Completo hace 22 días | Semáforo **en riesgo** |
| E10 | Natural | Completo hace 28 días | Semáforo **crítico** |
| E11 | Natural | Completo hace 35 días sin decisión | Semáforo **vencido** |
| E12 | Natural | Radicado incompleto, completado 20 días después | El plazo cuenta desde que se completó, no desde la radicación |
| E13 | Natural | El mismo envío llega dos veces (doble clic) | Un solo expediente |
| E14 | Natural | Reenvío otro día con los mismos archivos | Un solo expediente; archivos repetidos ignorados; el reloj no se reinicia |
| E15 | Accidental | Completo (accidente de tránsito) | Completo |
| E16 | Accidental | Sin informe de autoridad | Incompleto: falta el informe |
| E17 | Accidental | Relato ambiguo (caída); el informe define el tipo | Clasificado por el documento |
| E18 | Accidental | Certificación bancaria de otra persona | Incompleto: no corresponde |
| E19 | Accidental | Completo hace 25 días | Semáforo **en riesgo** |
| E20 | Accidental | Falta certificado médico y SARLAFT sin firma | Incompleto: una falta y un error |
| E21 | Accidental | Homicidio | Accidental, para confirmación del analista |
| E22 | Accidental | El relato dice "murió dormido" pero hay noticia criminal | El documento pesa más que el relato |
| E23 | Incapacidad | Completo; reclama el propio asegurado; cédula en **dos archivos** (frente y reverso) | Completo: las dos caras cuentan como un solo documento |
| E24 | Incapacidad | Sin dictamen de pérdida de capacidad | Incompleto: falta |
| E25 | Incapacidad | Historia clínica en foto borrosa | Incompleto: ilegible |
| E26 | Incapacidad | Dictamen de otra persona | Incompleto: no corresponde |
| E27 | Incapacidad | Completo hace 29 días | Semáforo **crítico** |
| E28 | Incapacidad | Certificación bancaria de hace 75 días | Incompleto: **vencida** (máximo 30 días) |
| E29 | Error / seguridad | Sube una factura de servicios en la casilla de certificación bancaria | El sistema detecta que no es lo que dice la casilla |
| E30 | Error / seguridad | El relato trae órdenes para el modelo ("ignora tus instrucciones...") | El modelo no obedece; sigue incompleto |
| E31 | Error / seguridad | Un archivo de texto con nombre `.pdf` | Rechazado por su contenido real |
| E32 | Error / seguridad | El mismo archivo dos veces en un envío | Se guarda una sola vez |
| E33 | Error / seguridad | Relato vago, sin documentos clínicos | Confianza baja → revisión manual |
| E34 | Error / seguridad | Cédula del beneficiario en foto borrosa | Incompleto: ilegible |

## Cómo se suben los archivos de prueba

Cada archivo se sube en su **casilla** (como lo haría un beneficiario en el formulario) y con un nombre genérico (`documento_3.pdf`, `IMG_5.png`), igual que una foto o un escaneo real. Así el nombre del archivo no le revela al modelo de qué documento se trata: tiene que reconocerlo por su contenido y verificar que coincida con la casilla.

Todos los documentos se generan con los elementos que exige la ficha técnica (`src/lib/ia/fichas-documentos.ts`): número de póliza, firma y huella, sello, registro médico, ambas caras de la cédula, etc. Las variantes de error quitan o alteran justo lo que se quiere probar.

## Archivos

| Archivo | Qué contiene |
|---|---|
| `escenarios.ts` | La definición de los 34 casos: personas, relato, documentos y **lo que se espera** que haga el sistema |
| `documentos.ts` | El generador de documentos ficticios (PDF) y de fotos borrosas (PNG) |
| `cargar.ts` | Envía cada caso por la API real, el mismo camino que un beneficiario (`npm run datos:cargar`) |
| `reporte.ts` | Compara el estado real de la base con lo esperado y genera `generados/reporte.md` (`npm run datos:reporte`) |

Todos los nombres, números de documento, correos (`@ejemplo.test`) y documentos son ficticios. A los correos de prueba el sistema no les envía nada: deja la notificación registrada como omitida.

Para mostrar casos en riesgo, críticos y vencidos sin esperar 30 días reales, E09–E12, E19 y E27 desplazan sus fechas con `simular_antiguedad()`. Esa simulación queda escrita en la bitácora del caso, así que nunca se confunde con un hecho real.

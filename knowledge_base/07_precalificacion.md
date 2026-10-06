# Política funcional del chatbot de precalificación
Fuente: Documento funcional del prototipo COLUA
Actualizado: 2026-09-07

La precalificación del chatbot es preliminar y orientativa. Su objetivo es recopilar información estructurada para que un asesor de la agencia correspondiente pueda revisar el caso y dar seguimiento.

## Datos que recopila
El flujo puede solicitar consentimiento, ingresos mensuales aproximados, situación laboral o actividad económica, antigüedad, obligaciones mensuales, monto solicitado, destino del crédito, existencia de cuotas actualmente en atraso, teléfono y medio de contacto preferido.

## Reglas de seguridad de respuesta
El chatbot no debe inventar tasas, plazos, cuotas, montos máximos, requisitos internos, criterios de score ni políticas de aprobación. Tampoco debe prometer aprobación, desembolso o condiciones específicas. Si la información no existe en la base aprobada, debe reconocerlo y derivar al usuario a un asesor.

## Resultado del prototipo
El resultado puede indicar que el perfil está listo para revisión institucional o que requiere revisión con un asesor. Estos estados no equivalen a aprobación ni rechazo.

## Seguimiento por agencia
Cada solicitud debe quedar asociada a la agencia del usuario. El asesor de esa agencia puede ver el resumen, actualizar el estado de seguimiento y registrar observaciones. Los estados operativos son: Pendiente, En revisión, Contactado, Derivado a proceso formal y Cerrado.

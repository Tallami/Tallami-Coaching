# Mensajes entre el alumno y Tallami

Fecha: 12 de noviembre de 2026. Tercera y última de las piezas que pidió Tallami para hacer todo desde la web: (1) cuentas de alumno y su página, hecha; (2) pagos en la web, hecha; (3) mensajes con él, este documento. Cuando se le preguntó cómo seguir dijo "seguí como te parezca": salvo lo que figura en "Lo que dijo Tallami", todo lo de este documento es **decisión del diseñador** y él puede cambiarlo.

## Para qué

Después de una compra, Tallami y el alumno tienen que ponerse de acuerdo: el día de una sesión en vivo, qué falta mandar, por dónde hablar. Hoy la web solo le deja a Tallami el email o el usuario de Discord en la ficha del alumno, y las preguntas frecuentes prometen "te escribo para coordinar" sin decir dónde. Falta un lugar dentro de la web donde los dos se escriban y quede guardado.

## Lo que dijo Tallami

- Todo desde la página: que los alumnos "puedan chatear conmigo también".
- Solo texto: "I just need to be able to chat with them so I can send them my discord id and then we talk there". Las llamadas no hacen falta; si quiere hablar en vivo, pasa su Discord por el chat.

## Objetivos

1. Un alumno con su cuenta vinculada le escribe a Tallami desde el portal y lee lo que él le contesta.
2. Tallami lee y contesta desde el panel, ve de un vistazo qué conversaciones tienen algo sin leer, y puede escribir primero.
3. Cada uno se entera de que le escribieron sin tener que entrar a mirar.
4. Una conversación la leen solo ellos dos.

## No objetivos

- Tiempo real: nada de "escribiendo…" ni mensajes que aparecen al instante.
- Que el alumno vea si Tallami ya leyó.
- Archivos, imágenes, audios, links que se puedan tocar.
- Chat para quien todavía no compró: para eso está el formulario de contacto.
- Editar o borrar un mensaje suelto.
- Varias conversaciones por alumno, o conversaciones de grupo. En Temporada Pro cada integrante tiene su cuenta y su conversación.
- Notificaciones en el celular y bot de Discord.

## Lo que sería un fracaso aunque funcione

- Que un alumno lea o escriba en la conversación de otro.
- Que un mensaje se ejecute como código en el panel: quien escriba `<script>` no puede tocar la sesión de Tallami.
- Que el email de aviso lleve el texto del mensaje.
- Que una ráfaga de mensajes llene el correo de Tallami.
- Que el formulario diga "enviado" y el mensaje no se haya guardado.
- Que la portada o las páginas públicas dejen de ser estáticas.
- Que se guarde de un menor más de lo que hace falta para hablar con él.

## Decisiones

### Quién puede escribir

- Solo una cuenta del portal **vinculada a un alumno del panel**: alguien que compró en la web o a quien Tallami invitó. Una cuenta sin vincular no ve mensajes; sin sesión, la página ofrece entrar.
- **Una conversación por alumno** (`customers`), no por compra ni por cuenta. Nace con el primer mensaje, lo escriba quien lo escriba.

### El mensaje

- Texto plano de 1 a 2.000 caracteres, sin los espacios de las puntas. Los saltos de línea se respetan. Siempre se muestra como texto.
- El alumno puede mandar hasta 30 mensajes por hora; pasado eso, la página le dice que espere. Tallami no tiene tope.

### El alumno, en el portal

- Página nueva `/{idioma}/portal/mensajes`, dinámica y privada como el portal: sin buscadores y sin `Referer` hacia otros sitios.
- En la página del portal, arriba de las compras, una tarjeta "Mensajes con Tallami" con cuántos hay sin leer y el enlace.
- La conversación va del mensaje más viejo al más nuevo, cada uno con quién lo escribió y cuándo. La hora se muestra en la zona horaria del navegador del alumno.
- El formulario es un cuadro de texto y un botón. Funciona sin JavaScript; con JavaScript, el mensaje aparece sin recargar y el cuadro queda vacío.
- Sin tiempo real: mientras la pestaña está a la vista, la página vuelve a pedir los mensajes cada 20 segundos. Con la pestaña oculta no pide nada.

### Leído y sin leer

- La conversación guarda cuándo leyó cada lado por última vez. Sin leer son los mensajes del otro posteriores a esa marca.
- Se marca como leída cuando la página se abre de verdad en el navegador, nunca en una precarga del link, y también cada vez que llegan mensajes nuevos con la pestaña a la vista.
- Mandar un mensaje marca la conversación como leída para quien lo manda: así también funciona sin JavaScript.

### Tallami, en el panel

- Sección nueva **Mensajes** en el menú, con el número de conversaciones que tienen algo sin leer.
- Bandeja: primero las que tienen algo sin leer, después por último mensaje. Cada fila muestra el alumno, el comienzo del último mensaje y cuándo fue.
- Conversación en `/admin/mensajes/{alumno}`, con el formulario para contestar. Existe aunque esté vacía: Tallami puede escribir primero. Las horas, en hora de Argentina.
- Se llega también desde la ficha del alumno (botón "Mensajes") y desde cada fila de "Por coordinar" (enlace "Escribirle").
- Si el alumno no tiene una cuenta del portal vinculada, la conversación lo dice, ofrece ir a invitarlo y no deja escribir: nadie leería el mensaje.
- Tallami puede **borrar la conversación entera**, con confirmación. Sirve para un pedido de privacidad.

### Avisos por email

- **A Tallami:** cuando un alumno escribe y esa conversación no tenía ya mensajes suyos sin leer. Los siguientes no mandan otro email hasta que Tallami la abra. Dice quién escribió y lleva el enlace a la conversación.
- **Al alumno:** lo mismo al revés, cuando Tallami escribe y el alumno no tenía ya mensajes sin leer. Va al email de su cuenta, en su idioma, con el enlace a sus mensajes.
- **Ningún email lleva el texto del mensaje.**
- El idioma del alumno es el de la última vez que entró al portal; se guarda en su cuenta al ingresar. Las cuentas de antes quedan en español.
- Si la cuenta no tiene email (Discord sin email verificado), no hay aviso. La conversación del panel lo dice y muestra su usuario de Discord, para que Tallami le avise por ahí.
- Si el email no sale, el mensaje queda guardado igual. Decidir si corresponde aviso y guardar el mensaje pasan en la misma transacción, así dos mensajes a la vez no mandan dos emails.

### Cuánto se guarda

- Los mensajes se guardan mientras exista el alumno en el panel. Borrar o desvincular la cuenta del portal no los borra: son del alumno, y si vuelve a vincular una cuenta los ve.
- Una conversación sin mensajes nuevos en 24 meses se borra sola, en la misma limpieza de pasada que el resto (`purgeExpiredRecords`).

### Textos que cambian, en los tres idiomas

- Preguntas frecuentes: "¿Qué pasa después de pagar?" pasa a "Te escribo por el chat de tu portal para coordinar. Todo lo que te entrego queda guardado ahí." y "¿Cómo agendo la sesión?" a "Coordinamos día y hora por el chat de tu portal. Para hablar en vivo te paso mi Discord."
- "Cómo funciona", paso "Coordinamos": "Si es un VOD offline, pegás tus códigos de replay en el portal. Si es en vivo, arreglamos día y hora por el chat."
- El email de confirmación de compra suma una línea con el enlace a los mensajes.
- Términos (cláusula de entrega) y privacidad: los mensajes se guardan, los leen solo Tallami y el alumno, y se borran a pedido o a los 24 meses sin actividad. Son un borrador para el abogado, como el resto.
- Para el abogado queda una pregunta nueva: si el chat privado con alumnos menores necesita algo más, por ejemplo un aviso al adulto que pagó.

### Base de datos

Migración 0009, con RLS: conversaciones (una por alumno, con las dos marcas de lectura y la hora del último mensaje), mensajes (conversación, quién, texto, cuándo) y el idioma en la cuenta del portal.

### Seguridad

- Cada acción del alumno lee la sesión y usa el alumno de esa cuenta. Del formulario llega solo el texto: nunca un id de conversación ni de alumno.
- En el panel, `requireAdmin()` primero en cada página y acción, también para leer el número del menú.
- Los logs no llevan texto de mensajes ni datos personales.

### Pruebas

De punta a punta, sin red, con los servidores falsos que ya existen: el alumno escribe, Tallami lo ve sin leer en la bandeja y en el menú, contesta, el alumno lo ve y le llega el aviso. Además: otro alumno no ve ni puede escribir en esa conversación; `<script>` se ve como texto en el portal y en el panel; 2.001 caracteres y un mensaje vacío se rechazan; el tope de 30 por hora; una cuenta sin vincular; el formulario sin JavaScript; el segundo mensaje seguido no manda otro email; borrar la conversación; accesibilidad con axe.

## Queda a criterio de quien lo construya

- Nombres de archivos, tablas y componentes.
- El diseño visual de la conversación, dentro de la marca del sitio, cómoda en el celular.
- Cómo se formatea la hora en cada lado.
- La redacción de los textos en los tres idiomas, sin inventar datos.

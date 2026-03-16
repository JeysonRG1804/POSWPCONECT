function doPost(e) {
    var sheet = SpreadsheetApp.openById("1W4Fz25lZjDCtq_PnlHajwnqzYi29IyPLWbFYLXYqyjM").getSheetByName("Inscripciones");
    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
        new Date(),
        data.correo,
        data.dni,
        data.nombre,
        data.apellidos,
        data.unidad,
        data.programa,
        data.detalle_programa,
        data.domicilio,
        data.fecha_nacimiento,
        data.telefono,
        data.medio_conocimiento
    ]);

    return ContentService
        .createTextOutput(JSON.stringify({ result: "success" }))
        .setMimeType(ContentService.MimeType.JSON);
}

function onEditar(e) {
    Logger.log("🟢 onEditar ejecutado");

    const TARGET_SHEET = 'Inscripciones';
    const sheet = e.source.getActiveSheet();
    if (sheet.getName() !== TARGET_SHEET) return;

    const range = e.range;
    const row = range.getRow();

    if (row === 1) return; // Ignora encabezado

    // Captura los datos requeridos
    const nombre = sheet.getRange(row, 4).getValue();  // Columna D
    const unidad = sheet.getRange(row, 6).getValue();  // Columna F
    const programa = sheet.getRange(row, 7).getValue();  // Columna G
    const telefono = sheet.getRange(row, 11).getValue(); // Columna K
    const estado = sheet.getRange(row, 13).getValue(); // Columna M

    Logger.log(`🔍 Fila ${row}: DNI=${dni}, Nombre=${nombre}, Unidad=${unidad}, Programa=${programa}, Teléfono=${telefono}, Estado=${estado}`);

    // Solo si todos los campos están llenos y aún no se ha enviado
    if (nombre && unidad && programa && telefono && !estado) {
        const enviado = enviarMensajeWhatsApp(nombre, unidad, programa, telefono);
        if (enviado) {
            sheet.getRange(row, 12).setValue("✅ Enviado");
        } else {
            sheet.getRange(row, 12).setValue("❌ Error");
        }
    }
}


function revisarNuevasFilas() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Inscripciones');
    const data = sheet.getDataRange().getValues();

    for (let row = 1; row < data.length; row++) {
        const nombre = data[row][3]; // Columna D
        const unidad = data[row][5]; // Columna F
        const programa = data[row][6]; // Columna G
        const telefono = data[row][10]; // Columna K
        const estado = data[row][11]; // Columna L

        if (nombre && unidad && programa && telefono && !estado) {
            const enviado = enviarMensajeWhatsApp(nombre, unidad, programa, telefono);
            if (enviado) {
                sheet.getRange(row + 1, 12).setValue("✅ Enviado");
            }
        }
    }
}


function enviarMensajeWhatsApp(nombre, unidad, programa, telefono) {
    const url = 'https://b9bb842d7a94.ngrok-free.app/api/enviar-mensaje';

    const payload = {
        numero: String(telefono),
        mensaje: nombre,         // ← solo el nombre
        facultad: unidad,        // ← ahora facultad = unidad
        programa: programa       // ← programa
    };

    const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    try {
        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();
        const respuestaTexto = response.getContentText();

        Logger.log(`✅ Mensaje enviado a ${telefono}: ${respuestaTexto}`);
        return statusCode >= 200 && statusCode < 300;
    } catch (error) {
        Logger.log(`❌ Error enviando a ${telefono}: ${error}`);
        return false;
    }
}




function doGet(e) {
    try {
        // 1. SI EL BOT PIDE UN TELÉFONO -> BUSCAR Y DEVOLVER JSON
        if (e.parameter && e.parameter.telefono) {
            var salidaJson = ContentService.createTextOutput();
            salidaJson.setMimeType(ContentService.MimeType.JSON);

            var telefonoBuscado = String(e.parameter.telefono).replace(/\D/g, '');
            var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Inscripciones");
            var data = sheet.getDataRange().getValues();

            var indexFechaRegistro = 0;
            var indexNombre = 3;
            var indexApellidos = 4;
            var indexUnidad = 5;       
            var indexProgramaBase = 6;
            var indexDetallePrograma = 7;
            var indexTelefono = 10;

            for (var i = 1; i < data.length; i++) {
                var telefonoFila = String(data[i][indexTelefono]).replace(/\D/g, '');

                if (telefonoFila !== "" && telefonoBuscado.endsWith(telefonoFila)) {
                    var programaFinal = data[i][indexDetallePrograma] ? data[i][indexDetallePrograma] : data[i][indexProgramaBase];
                    var fechaCelda = data[i][indexFechaRegistro];
                    var fechaIso = (fechaCelda instanceof Date && !isNaN(fechaCelda.valueOf())) ? fechaCelda.toISOString() : String(fechaCelda);

                    var resultado = {
                        encontrado: true,
                        fechaRegistro: fechaIso,
                        nombre: data[i][indexNombre],
                        apellidos: data[i][indexApellidos],
                        facultad: data[i][indexUnidad],
                        programa: programaFinal,
                        fila: i + 1
                    };

                    salidaJson.setContent(JSON.stringify(resultado));
                    return salidaJson;
                }
            }

            // Si enviaron telefono pero no se encontró
            salidaJson.setContent(JSON.stringify({ encontrado: false }));
            return salidaJson;
        }

        // 2. SI NO HAY PARÁMETRO DE TELÉFONO -> DEVOLVER CSV (COMPORTAMIENTO ORIGINAL)
        else {
            const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Inscripciones");
            const data = sheet.getDataRange().getValues();
            let csv = "";

            data.forEach((row, i) => {
                // Si quieres, omite la primera fila (cabecera)
                csv += row.map(cell => `"${cell}"`).join(",") + "\n";
            });

            return ContentService
                .createTextOutput(csv)
                .setMimeType(ContentService.MimeType.CSV);
        }

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ error: error.message })).setMimeType(ContentService.MimeType.JSON);
    }
}


function aplicarMenusDesplegablesSoloCarpetasPostulantes() {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Registro_subidas_carpeta_postulantes");
    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return;

    // Rango desde fila 2 en columnas G (7) e I (9)
    const rangoColG = hoja.getRange(2, 7, ultimaFila - 1);
    const rangoColI = hoja.getRange(2, 9, ultimaFila - 1);

    const validacionesG = rangoColG.getDataValidations();
    const validacionesI = rangoColI.getDataValidations();

    const valoresG = rangoColG.getValues();
    const valoresI = rangoColI.getValues();

    // Opciones para columna G
    const opcionesG = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Pendiente", "Rechazado", "Aceptado"], true)
        .setAllowInvalid(false)
        .build();

    // Opciones para columna I
    const opcionesI = SpreadsheetApp.newDataValidation()
        .requireValueInList(["---", "Sí", "No"], true)
        .setAllowInvalid(false)
        .build();

    for (let i = 0; i < valoresG.length; i++) {
        // Columna G (estado)
        if (!validacionesG[i][0]) {
            rangoColG.getCell(i + 1, 1).setDataValidation(opcionesG);
        }
        if (!valoresG[i][0]) {
            valoresG[i][0] = "Pendiente";
        }

        // Columna I (Sí / No)
        if (!validacionesI[i][0]) {
            rangoColI.getCell(i + 1, 1).setDataValidation(opcionesI);
        }
        if (valoresI[i][0] === "" || valoresI[i][0] === null) {
            valoresI[i][0] = "---";  // CAMBIADO AQUÍ
        }
    }

    rangoColG.setValues(valoresG);
    rangoColI.setValues(valoresI);

    SpreadsheetApp.flush();
    Logger.log(`Validaciones aplicadas desde la fila 2 hasta la ${ultimaFila}.`);
}




function onEdit(e) {
    const hojaEditada = e.range.getSheet();
    const hojaNombre = hojaEditada.getName();
    const filaEditada = e.range.getRow();
    const columnaEditada = e.range.getColumn();
    const valorNuevo = e.value;

    // Detener si es la fila de encabezado o el valor es nulo/vacío
    if (filaEditada < 2 || !valorNuevo) {
        return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hojaInscripciones = ss.getSheetByName("Inscripciones");
    const hojaRegistros = ss.getSheetByName("Registro_subidas_carpeta_postulantes");

    // --- Caso 1: Edición en "Registro_subidas_carpeta_postulantes" (Columna E o G) ---
    if (hojaNombre === "Registro_subidas_carpeta_postulantes" && (columnaEditada === 5 || columnaEditada === 7)) {
        // Col B (Nombre), Col C (Correo)
        const nombreReg = hojaEditada.getRange(filaEditada, 2).getValue().toString().toLowerCase().trim();
        const correoReg = hojaEditada.getRange(filaEditada, 3).getValue().toString().toLowerCase().trim();

        // Rango de búsqueda en INSCRIPCIONES: Col B (Correo) y Col D (Nombre). 
        // Obtenemos B, C, D (3 columnas, empezando en B (2)).
        // Nota: DatosInscripciones[i][0] = Correo (Col B), DatosInscripciones[i][2] = Nombre (Col D)
        const datosInscripciones = hojaInscripciones.getRange(2, 2, hojaInscripciones.getLastRow() - 1, 3).getValues();

        for (let i = 0; i < datosInscripciones.length; i++) {
            const correoIns = datosInscripciones[i][0].toString().toLowerCase().trim();
            // Comparación principal por correo (dato único y más confiable)
            if (correoIns === correoReg) {
                // Validación secundaria por nombre (opcional, pero útil si el correo no fuera único)
                // Se verifica si el nombre de registro contiene el nombre de inscripción o viceversa para flexibilidad
                const nomIns = datosInscripciones[i][2].toString().toLowerCase().trim();
                if (nombreReg.includes(nomIns) || nomIns.includes(nombreReg) || nombreReg === nomIns) {

                    const filaDestino = i + 2; // Fila real en Inscripciones

                    if (columnaEditada === 5) { // Edición en Col E (Estado_Seguimiento)
                        let valorRevisionCarpeta = 'No'; // Default para Pendiente/Rechazado
                        if (String(valorNuevo).toLowerCase() === 'aceptado') {
                            valorRevisionCarpeta = 'Sí';
                        }
                        // Actualiza Columna P (16) -> Revisión Carpeta
                        hojaInscripciones.getRange(filaDestino, 16).setValue(valorRevisionCarpeta);

                    } else if (columnaEditada === 7) { // Edición en Col G (Confirmación_Carpeta_Postulante)
                        // Copiar valor exacto a Col Q (17)
                        hojaInscripciones.getRange(filaDestino, 17).setValue(valorNuevo);

                        // Sincronizar Conocimiento Pago (13) y Conocimiento Inscripción (14)
                        if (String(valorNuevo) === "Sí") {
                            hojaInscripciones.getRange(filaDestino, 13).setValue("Sí");
                            hojaInscripciones.getRange(filaDestino, 14).setValue("Sí");
                        } else if (String(valorNuevo) === "No") {
                            hojaInscripciones.getRange(filaDestino, 13).setValue("No");
                            hojaInscripciones.getRange(filaDestino, 14).setValue("No");
                        }
                    }
                    break; // Detener la búsqueda al encontrar coincidencia
                }
            }
        }
    }

    // --- Caso 2: Edición en "Inscripciones" (Columna P o Q) - Sincronización Bidireccional ---
    else if (hojaNombre === "Inscripciones" && (columnaEditada === 16 || columnaEditada === 17)) {

        // Col B (Correo), Col D (Nombre) de Inscripciones
        const correoIns = hojaEditada.getRange(filaEditada, 2).getValue().toString().toLowerCase().trim();
        const nombreIns = hojaEditada.getRange(filaEditada, 4).getValue().toString().toLowerCase().trim();

        // Rango de búsqueda en REGISTRO: Col B (Nombre) y Col C (Correo). 
        // Obtenemos B y C (2 columnas, empezando en B (2)).
        // Nota: DatosRegistros[i][0] = Nombre (Col B), DatosRegistros[i][1] = Correo (Col C)
        const datosRegistros = hojaRegistros.getRange(2, 2, hojaRegistros.getLastRow() - 1, 2).getValues();

        for (let i = 0; i < datosRegistros.length; i++) {
            const correoReg = datosRegistros[i][1].toString().toLowerCase().trim();

            // Comparación principal por correo
            if (correoReg === correoIns) {
                // Validación secundaria por nombre
                const nomReg = datosRegistros[i][0].toString().toLowerCase().trim();
                if (nomReg.includes(nombreIns) || nombreIns.includes(nomReg) || nomReg === nombreIns) {

                    const filaDestino = i + 2; // Fila real en Registro

                    if (columnaEditada === 16) { // Edición en Col P (Revisión Carpeta)
                        // Lógica inversa: Sí -> Aceptado; No -> Rechazado
                        let valorEstado = 'Pendiente'; // Default
                        if (String(valorNuevo).toLowerCase() === 'sí' || String(valorNuevo).toLowerCase() === 'si') {
                            valorEstado = 'Aceptado';
                        } else if (String(valorNuevo).toLowerCase() === 'no') {
                            valorEstado = 'Rechazado';
                        }
                        // Actualizar Col E (5) -> Estado_Seguimiento
                        hojaRegistros.getRange(filaDestino, 5).setValue(valorEstado);

                    } else if (columnaEditada === 17) { // Edición en Col Q (Confirmación Carpeta)
                        // Copiar valor exacto a Col G (7)
                        hojaRegistros.getRange(filaDestino, 7).setValue(valorNuevo);
                    }
                    break; // Detener búsqueda
                }
            }
        }
    }
}


function aplicarMenusDesplegablesSoloNuevasFilas() {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Inscripciones");
    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return;

    const opciones = SpreadsheetApp.newDataValidation()
        .requireValueInList(["Sí", "No"], true)
        .setAllowInvalid(false)
        .build();

    // Columnas M (13) y N (14) desde la fila 2
    const rangoCol13 = hoja.getRange(2, 13, ultimaFila - 1);
    const rangoCol14 = hoja.getRange(2, 14, ultimaFila - 1);

    const validaciones13 = rangoCol13.getDataValidations();
    const validaciones14 = rangoCol14.getDataValidations();

    for (let i = 0; i < ultimaFila - 1; i++) {
        const celda13 = rangoCol13.getCell(i + 1, 1);
        const celda14 = rangoCol14.getCell(i + 1, 1);

        // Aplicar validación y valor por defecto en columna 13 (M)
        if (!validaciones13[i][0]) {
            celda13.setDataValidation(opciones);
            if (celda13.getValue() === "") {
                celda13.setValue("No");
            }
        }

        // Aplicar validación y valor por defecto en columna 14 (N)
        if (!validaciones14[i][0]) {
            celda14.setDataValidation(opciones);
            if (celda14.getValue() === "") {
                celda14.setValue("No");
            }
        }
    }

    SpreadsheetApp.flush();
    Logger.log(`Validaciones aplicadas desde la fila 2 hasta la ${ultimaFila}.`);
}


function crearTriggerCada6HorasMenusDesplegables() {
    // Borra triggers previos que apuntan a esta función
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'aplicarMenusDesplegablesATodasLasFilas') {
            ScriptApp.deleteTrigger(trigger);
        }
    });

    // Crea un nuevo trigger que se ejecuta cada 6 horas
    ScriptApp.newTrigger('aplicarMenusDesplegablesATodasLasFilas')
        .timeBased()
        .everyHours(6)
        .create();
}




import { join } from 'path'
import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS } from '@builderbot/bot'
import { MemoryDB as Database } from '@builderbot/bot'
import { WPPConnectProvider as Provider } from '@builderbot/provider-wppconnect'
import QRPortalWeb from '@bot-whatsapp/portal'
import { readFileSync, existsSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Obtener __dirname para ES Modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT ?? 3008

// Número del administrador para recibir solicitudes de contacto
const ADMIN_NUMBER = '51900969591@c.us'

// ============= MANEJADORES DE ERRORES GLOBALES =============
process.on('uncaughtException', (err) => {
    console.error('🔴 Uncaught Exception:', err.message)
    console.error(err.stack)
})

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔴 Unhandled Rejection at:', promise)
    console.error('Reason:', reason)
})

// ============= UTILIDADES =============

// Función de delay simple
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Función de delay aleatorio entre min y max milisegundos
const delayAleatorio = (minMs = 2000, maxMs = 4000) => {
    const tiempo = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
    console.log(`⏳ Esperando ${tiempo}ms antes del siguiente mensaje...`)
    return delay(tiempo)
}

// Quitar acentos para normalizar respuestas
const quitarAcentos = (txt) =>
    txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Conjuntos de respuestas válidas
const RESP_SI = new Set(['1', 'si', 's', 'y', 'yes'])
const RESP_NO = new Set(['2', 'no', 'n', 'nop'])

// Contador de solicitudes
let contadorSolicitudes = 1

// ============= BASE DE DATOS LOCAL =============
const DB_PATH = join(__dirname, 'local_db.json')

function readDb() {
    if (!existsSync(DB_PATH)) {
        return { user_state: {}, solicitudes_contacto: [] }
    }
    try {
        const data = readFileSync(DB_PATH, 'utf-8')
        return JSON.parse(data)
    } catch (e) {
        return { user_state: {}, solicitudes_contacto: [] }
    }
}

function writeDb(data) {
    try {
        writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('❌ Error al escribir en la base de datos:', error.message)
    }
}

async function guardarEstado(usuarioId, data) {
    try {
        const db = readDb()
        if (!db.user_state) db.user_state = {}

        db.user_state[usuarioId] = {
            ...db.user_state[usuarioId],
            ...data,
            updatedAt: new Date().toISOString()
        }

        writeDb(db)
    } catch (error) {
        console.error('❌ Error al guardar estado:', error.message)
    }
}

async function obtenerEstado(usuarioId) {
    try {
        const db = readDb()
        return db.user_state ? db.user_state[usuarioId] : null
    } catch (error) {
        console.error('❌ Error al obtener estado:', error.message)
        return null
    }
}

async function borrarEstado(usuarioId) {
    try {
        const db = readDb()
        if (db.user_state && db.user_state[usuarioId]) {
            delete db.user_state[usuarioId]
            writeDb(db)
        }
    } catch (error) {
        console.error('❌ Error al borrar estado:', error.message)
    }
}

async function guardarSolicitudContacto(data) {
    const db = readDb()
    if (!db.solicitudes_contacto) db.solicitudes_contacto = []

    db.solicitudes_contacto.push({
        ...data,
        createdAt: new Date().toISOString()
    })

    writeDb(db)
}

// ============= UTILIDAD PARA LEER ARCHIVOS =============
function leerArchivo(relPath, porDefecto = 'No disponible.') {
    try {
        const absPath = join(__dirname, relPath)
        if (!existsSync(absPath)) {
            console.warn(`⚠️ Archivo no encontrado: ${relPath}`)
            return porDefecto
        }

        const stats = statSync(absPath)
        if (stats.isDirectory()) {
            console.warn(`⚠️ La ruta es un directorio: ${relPath}`)
            return porDefecto
        }

        return readFileSync(absPath, 'utf8')
    } catch (error) {
        console.error(`❌ Error al leer archivo ${relPath}:`, error.message)
        return porDefecto
    }
}

// Función para enviar media de forma segura con reintentos
async function enviarMediaSeguro(flowDynamic, texto, mediaUrl, maxReintentos = 3) {
    if (!mediaUrl || !mediaUrl.startsWith('http')) {
        console.warn(`⚠️ URL de media inválida: ${mediaUrl}`)
        await flowDynamic(texto + '\n(Documento no disponible)')
        return
    }

    const fileName = decodeURIComponent(mediaUrl.split('/').pop())

    for (let intento = 1; intento <= maxReintentos; intento++) {
        try {
            console.log(`📤 Intento ${intento}/${maxReintentos} enviando media: ${fileName}`)
            await flowDynamic([{
                body: texto,
                media: mediaUrl,
                fileName: fileName
            }])
            console.log(`✅ Media enviada exitosamente: ${fileName}`)
            return // Éxito, salir de la función
        } catch (error) {
            console.warn(`⚠️ Intento ${intento}/${maxReintentos} falló: ${error.message}`)

            if (intento < maxReintentos) {
                console.log(`🔄 Reintentando en 3 segundos...`)
                await delay(3000) // Esperar 3 segundos antes de reintentar
            } else {
                console.error(`❌ Error al enviar media después de ${maxReintentos} intentos:`, error.message)
                await flowDynamic(texto + '\n(Error al cargar documento, intente más tarde)')
            }
        }
    }
}

// ============= MENSAJES =============
const menu = leerArchivo('mensajes/menu.txt')
const programas = leerArchivo('mensajes/programas.txt')
const admision = leerArchivo('mensajes/admision.txt')
const requisitos = leerArchivo('mensajes/requisitos.txt')
const costos = leerArchivo('mensajes/costos.txt')
// eslint-disable-next-line no-unused-vars
const fechasadmision = leerArchivo('mensajes/fechasadmision.txt')
const infoplus = leerArchivo('desc/info.txt')

// ============= FACULTADES =============
// ============= CARGAR FACULTADES DESDE JSON =============
function cargarFacultades() {
    try {
        const facultadesPath = join(__dirname, 'facultades.json')
        const data = JSON.parse(readFileSync(facultadesPath, 'utf-8'))
        console.log('✅ Facultades cargadas correctamente')
        return data
    } catch (error) {
        console.error('❌ Error al cargar facultades.json:', error.message)
        return {}
    }
}

const facultades = cargarFacultades()

// ============= FLUJOS =============

// Flujo de Contacto - Usando state interno del bot
const flowContacto = addKeyword(utils.setEvent('CONTACTO_FLOW'))
    .addAnswer(
        '📋 *Formulario de contacto personalizado*\n' +
        '¿Cuál es el tipo de consulta?\n' +
        '1. Información académica\n2. Admisiones y becas\n3. Proceso de inscripción\n4. Documentación\n5. Otro',
        { capture: true },
        async (ctx, { state, fallBack }) => {
            if (!['1', '2', '3', '4', '5'].includes(ctx.body)) return fallBack()
            await state.update({ tipoConsulta: ctx.body })
        }
    )
    .addAnswer(
        '¿Cuál es tu canal preferido para que te contactemos?\n1. WhatsApp\n2. Correo\n3. Teléfono\n4. Videollamada',
        { capture: true },
        async (ctx, { state, fallBack }) => {
            if (!['1', '2', '3', '4'].includes(ctx.body)) return fallBack()
            await state.update({ canal: ctx.body })
        }
    )
    .addAnswer('👤 Por favor, escribe tu *nombre completo*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ nombre: ctx.body })
    })
    .addAnswer('📧 Ahora escribe tu *correo electrónico*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ correo: ctx.body.trim().toLowerCase() })
    })
    .addAnswer('📱 Tu *número de teléfono*:', { capture: true }, async (ctx, { state }) => {
        await state.update({ telefono: ctx.body })
    })
    .addAnswer('✍️ Por último, escribe un *mensaje o detalle de tu consulta*:', { capture: true }, async (ctx, { state, flowDynamic, provider }) => {
        try {
            const myState = state.getMyState() || {}

            // Mapear tipos de consulta
            const tiposConsulta = {
                '1': 'Información académica',
                '2': 'Admisiones y becas',
                '3': 'Proceso de inscripción',
                '4': 'Documentación',
                '5': 'Otro'
            }

            // Mapear canales
            const canales = {
                '1': 'WhatsApp',
                '2': 'Correo',
                '3': 'Teléfono',
                '4': 'Videollamada'
            }

            const solicitud = {
                usuarioId: ctx.from,
                tipoConsulta: myState.tipoConsulta || 'No especificado',
                canal: myState.canal || 'No especificado',
                nombre: myState.nombre || 'No proporcionado',
                correo: myState.correo || 'No proporcionado',
                telefono: myState.telefono || 'No proporcionado',
                mensaje: ctx.body
            }

            // Guardar en la base de datos local
            await guardarSolicitudContacto(solicitud)
            contadorSolicitudes++

            // Enviar notificación al administrador
            const mensajeAdmin = `📩 *NUEVA SOLICITUD DE CONTACTO #${contadorSolicitudes}*

👤 *Nombre:* ${solicitud.nombre}
📞 *Teléfono:* ${solicitud.telefono}
📧 *Correo:* ${solicitud.correo}
📋 *Tipo de consulta:* ${tiposConsulta[solicitud.tipoConsulta] || solicitud.tipoConsulta}
📱 *Canal preferido:* ${canales[solicitud.canal] || solicitud.canal}
💬 *Mensaje:* ${solicitud.mensaje}

🔗 *WhatsApp del usuario:* wa.me/${ctx.from.replace('@c.us', '').replace('51', '')}
📅 *Fecha:* ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}`

            try {
                await provider.sendMessage(ADMIN_NUMBER, mensajeAdmin, {})
                console.log('✅ Solicitud enviada al administrador:', ADMIN_NUMBER)
            } catch (sendError) {
                console.error('❌ Error al enviar al administrador:', sendError.message)
            }

            // Confirmación al usuario
            await flowDynamic('✅ Gracias. Tu solicitud fue registrada y un asesor te contactará pronto.\nSu ID de solicitud es: ' + contadorSolicitudes)

            // Limpiar estado
            await state.clear()
        } catch (error) {
            console.error('❌ Error en flowContacto:', error.message)
            await flowDynamic('❌ Ocurrió un error al registrar tu solicitud. Por favor intenta de nuevo.')
        }
    })

// Flujo Exit
const flowExit = addKeyword(['adios', 'bye', 'chau'])
    .addAnswer('👋 ¡Gracias por comunicarte con nosotros! Que tengas un excelente día.')
    .addAction(async (ctx, { endFlow }) => {
        return endFlow()
    })

// Flujo Calendario
const flowCalendario = addKeyword(utils.setEvent('CALENDARIO_FLOW'))
    .addAnswer([
        'Este es nuestro nuevo calendario académico para el 2026-I, puede visitar nuestra página web:',
        'https://posgrado.unac.edu.pe/admision/cronograma.html'
    ])

// ============= FLUJOS DE DOCTORADOS =============

const flowNuevoDoctorado = addKeyword(utils.setEvent('NUEVO_DOCTORADO'))
    .addAnswer(
        ['¿Necesita consultar otro doctorado?, digite el número de la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const entrada = quitarAcentos(ctx.body.trim().toLowerCase())

            if (RESP_SI.has(entrada)) {
                return gotoFlow(flowFacultadDoctorados)
            }
            if (RESP_NO.has(entrada)) {
                return gotoFlow(flowExit)
            }

            await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
            return gotoFlow(flowNuevoDoctorado)
        }
    )

const flowSeleccionDoctorado = addKeyword(utils.setEvent('SELECCION_DOCTORADO'))
    .addAnswer('📩 Seleccione un Doctorado:', { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const usuarioId = ctx.from
            const input = ctx.body.trim()

            try {
                const currentState = await obtenerEstado(usuarioId)
                const facultadId = currentState?.facultadId

                if (!facultadId || !facultades[facultadId]) {
                    await flowDynamic('❌ Error: Información de facultad perdida. Regresando al menú.')
                    return gotoFlow(flowFacultadDoctorados)
                }

                if (input === '0') {
                    await borrarEstado(usuarioId)
                    return gotoFlow(flowFacultadDoctorados)
                }

                const facultad = facultades[facultadId]
                const doctoradoKeys = Object.keys(facultad.doctorados || {})
                const selectedIndex = parseInt(input) - 1

                if (selectedIndex < 0 || selectedIndex >= doctoradoKeys.length) {
                    await flowDynamic('❌ Opción inválida. Intente de nuevo.')
                    return gotoFlow(flowSeleccionDoctorado)
                }

                const selectedKey = doctoradoKeys[selectedIndex]
                const doctorado = facultad.doctorados[selectedKey]

                const descripcion = typeof doctorado.descripcion === 'function'
                    ? doctorado.descripcion()
                    : doctorado.descripcion

                await flowDynamic([
                    `🎓 *${doctorado.nombre || 'Doctorado'}*`,
                    descripcion || 'Descripción no disponible',
                    infoplus || ''
                ])

                if (doctorado.brochure) {
                    await enviarMediaSeguro(flowDynamic, '📄 Aquí tienes el brochure:', doctorado.brochure)
                } else {
                    await flowDynamic('📄 Brochure no disponible para este doctorado.')
                }

                await borrarEstado(usuarioId)
                return gotoFlow(flowNuevoDoctorado)

            } catch (error) {
                console.error('❌ Error en flowSeleccionDoctorado:', error)
                await flowDynamic('❌ Ocurrió un error. Regresando al menú de facultades.')
                await borrarEstado(usuarioId)
                return gotoFlow(flowFacultadDoctorados)
            }
        })

const flowFacultadDoctorados = addKeyword(utils.setEvent('FACULTAD_DOCTORADOS'))
    .addAnswer('*DOCTORADOS DE LA UNIVERSIDAD NACIONAL DEL CALLAO*')
    .addAnswer('Estas son nuestras facultades:', {
        media: 'https://posgrado.unac.edu.pe/img/escuela.jpg'
    })
    .addAnswer([
        '1️⃣ Facultad de Ciencias de la Salud',
        '2️⃣ Facultad de Ciencias Administrativas',
        '3️⃣ Facultad de Ingeniería Industrial y de Sistemas',
        '4️⃣ Facultad de Ciencias Contables',
        '5️⃣ Facultad de Ingeniería Eléctrica y Electrónica',
        '6️⃣ Facultad de Ciencias de la Educación',
        '0️⃣ Volver al menú principal'
    ], { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        let facultadId = ctx.body.trim()
        const usuarioId = ctx.from

        if (!['1', '2', '3', '4', '5', '6', '0'].includes(facultadId)) {
            await flowDynamic('❌ Opción inválida. Intente de nuevo.')
            return gotoFlow(flowFacultadDoctorados)
        }

        if (facultadId === '6') {
            facultadId = '12'
        }

        if (facultadId === '0') {
            return gotoFlow(programasFlow)
        }

        const facultad = facultades[facultadId]
        if (!facultad || !facultad.doctorados) {
            await flowDynamic('❌ Facultad no encontrada o sin doctorados.')
            return gotoFlow(flowFacultadDoctorados)
        }

        try {
            await guardarEstado(usuarioId, { facultadId })

            const doctoradoEntries = Object.entries(facultad.doctorados)
            const opciones = doctoradoEntries
                .map(([doctoradoId, doctorado], index) =>
                    `${index + 1}️⃣ ${doctorado.nombre || 'Doctorado ' + doctoradoId}`
                )
                .join('\n')

            await flowDynamic([
                `📚 *${facultad.nombre}*`,
                'Seleccione un doctorado para ver más detalles:',
                opciones,
                '0️⃣ Volver al listado de facultades'
            ])

            return gotoFlow(flowSeleccionDoctorado)
        } catch (error) {
            console.error('❌ Error al guardar estado:', error)
            await flowDynamic('❌ Error interno. Intente de nuevo más tarde.')
            return gotoFlow(flowFacultadDoctorados)
        }
    })

// ============= FLUJOS DE MAESTRÍAS =============

const flowNuevaMaestria = addKeyword(utils.setEvent('NUEVA_MAESTRIA'))
    .addAnswer(
        ['¿Necesita consultar otra maestría?, digite el número la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(flowNuevaMaestria)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowFacultadMaestrias)
                case '2':
                    return gotoFlow(flowExit)
            }
        }
    )

const flowSeleccionMaestria = addKeyword(utils.setEvent('SELECCION_MAESTRIA'))
    .addAnswer('📩 Seleccione una maestría:', { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const usuarioId = ctx.from
            const input = ctx.body.trim()

            try {
                const currentState = await obtenerEstado(usuarioId)
                const facultadId = currentState?.facultadId

                if (!facultadId || !facultades[facultadId]) {
                    await flowDynamic('❌ Error: Información de facultad perdida. Regresando al menú.')
                    return gotoFlow(flowFacultadMaestrias)
                }

                if (input === '0') {
                    await borrarEstado(usuarioId)
                    return gotoFlow(flowFacultadMaestrias)
                }

                const facultad = facultades[facultadId]
                const maestriaKeys = Object.keys(facultad.maestrias)
                const selectedIndex = parseInt(input) - 1

                if (selectedIndex < 0 || selectedIndex >= maestriaKeys.length) {
                    await flowDynamic('❌ Opción inválida. Intente de nuevo.')
                    return gotoFlow(flowSeleccionMaestria)
                }

                const selectedKey = maestriaKeys[selectedIndex]
                const maestria = facultad.maestrias[selectedKey]

                const descripcion = typeof maestria.descripcion === 'function'
                    ? maestria.descripcion()
                    : maestria.descripcion

                await flowDynamic([
                    `🎓 *${maestria.nombre || 'Maestría'}*`,
                    descripcion || 'Descripción no disponible',
                    infoplus || ''
                ])

                if (maestria.brochure) {
                    await enviarMediaSeguro(flowDynamic, '📄 Aquí tienes el brochure:', maestria.brochure)
                } else {
                    await flowDynamic('📄 Brochure no disponible para esta maestría.')
                }

                await borrarEstado(usuarioId)
                return gotoFlow(flowNuevaMaestria)

            } catch (error) {
                console.error('❌ Error en flowSeleccionMaestria:', error)
                await flowDynamic('❌ Ocurrió un error. Regresando al menú de facultades.')
                await borrarEstado(usuarioId)
                return gotoFlow(flowFacultadMaestrias)
            }
        })

const flowFacultadMaestrias = addKeyword(utils.setEvent('FACULTAD_MAESTRIAS'))
    .addAnswer('*MAESTRÍAS DE LA UNIVERSIDAD NACIONAL DEL CALLAO*')
    .addAnswer('Estas son nuestras facultades:', {
        media: 'https://posgrado.unac.edu.pe/img/escuela.jpg'
    })
    .addAnswer([
        '1️⃣ Facultad de Ciencias de la Salud',
        '2️⃣ Facultad de Ciencias Administrativas',
        '3️⃣ Facultad de Ingeniería Industrial y de Sistemas',
        '4️⃣ Facultad de Ciencias Contables',
        '5️⃣ Facultad de Ingeniería Eléctrica y Electrónica',
        '6️⃣ Facultad de Ingeniería Pesquera y de Alimentos',
        '7️⃣ Facultad de Ingeniería Mecánica y Energía',
        '8️⃣ Facultad de Ciencias Naturales y Matemática',
        '9️⃣ Facultad de Ingeniería Ambiental y Recursos Naturales',
        '🔟 Facultad de Ciencias Económicas',
        '1️⃣1️⃣ Facultad de Ingeniería Química',
        '1️2️⃣ Facultad de Ciencias de la Educación',
        '0️⃣ Volver al menú principal'
    ], { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        const facultadId = ctx.body.trim()
        const usuarioId = ctx.from

        if (!['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '0'].includes(facultadId)) {
            await flowDynamic('❌ Opción inválida. Intente de nuevo.')
            return gotoFlow(flowFacultadMaestrias)
        }

        if (facultadId === '0') {
            return gotoFlow(programasFlow)
        }

        const facultad = facultades[facultadId]
        if (!facultad) {
            await flowDynamic('❌ Facultad no encontrada.')
            return gotoFlow(flowFacultadMaestrias)
        }

        try {
            await guardarEstado(usuarioId, { facultadId })

            const maestriaEntries = Object.entries(facultad.maestrias)
            const opciones = maestriaEntries
                .map(([maestriaId, maestria], index) =>
                    `${index + 1}️⃣ ${maestria.nombre || 'Maestría ' + maestriaId}`
                )
                .join('\n')

            await flowDynamic([
                `📚 *${facultad.nombre}*`,
                'Seleccione una maestría para ver más detalles:',
                opciones,
                '0️⃣ Volver al listado de facultades'
            ])

            return gotoFlow(flowSeleccionMaestria)
        } catch (error) {
            console.error('❌ Error al guardar estado:', error)
            await flowDynamic('❌ Error interno. Intente de nuevo más tarde.')
            return gotoFlow(flowFacultadMaestrias)
        }
    })

// ============= FLUJOS DE ESPECIALIDADES =============

const flowNuevaEspecialidad = addKeyword(utils.setEvent('NUEVA_ESPECIALIDAD'))
    .addAnswer(
        ['¿Necesita consultar otra especialidad?, digite el número de la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const entrada = quitarAcentos(ctx.body.trim().toLowerCase())

            if (RESP_SI.has(entrada)) {
                return gotoFlow(flowFacultadEspecialidades)
            }
            if (RESP_NO.has(entrada)) {
                return gotoFlow(flowExit)
            }

            await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
            return gotoFlow(flowNuevaEspecialidad)
        }
    )

const flowSeleccionEspecialidad = addKeyword(utils.setEvent('SELECCION_ESPECIALIDAD'))
    .addAnswer('📩 Seleccione una Especialidad:', { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            const usuarioId = ctx.from
            const input = ctx.body.trim()

            try {
                const currentState = await obtenerEstado(usuarioId)
                const facultadId = currentState?.facultadId

                if (!facultadId || !facultades[facultadId]) {
                    await flowDynamic('❌ Error: Información de facultad perdida. Regresando al menú.')
                    return gotoFlow(flowFacultadEspecialidades)
                }

                if (input === '0') {
                    await borrarEstado(usuarioId)
                    return gotoFlow(flowFacultadEspecialidades)
                }

                const facultad = facultades[facultadId]
                const especialidadKeys = Object.keys(facultad.especialidades || {})
                const selectedIndex = parseInt(input) - 1

                if (selectedIndex < 0 || selectedIndex >= especialidadKeys.length) {
                    await flowDynamic('❌ Opción inválida. Intente de nuevo.')
                    return gotoFlow(flowSeleccionEspecialidad)
                }

                const selectedKey = especialidadKeys[selectedIndex]
                const especialidad = facultad.especialidades[selectedKey]

                const descripcion = typeof especialidad.descripcion === 'function'
                    ? especialidad.descripcion()
                    : especialidad.descripcion

                await flowDynamic([
                    `🎓 *${especialidad.nombre || 'Especialidad'}*`,
                    descripcion || 'Descripción no disponible',
                    infoplus || ''
                ])

                if (especialidad.brochure) {
                    await enviarMediaSeguro(flowDynamic, '📄 Aquí tienes el brochure:', especialidad.brochure)
                } else {
                    await flowDynamic('📄 Brochure no disponible para esta especialidad.')
                }

                await borrarEstado(usuarioId)
                return gotoFlow(flowNuevaEspecialidad)

            } catch (error) {
                console.error('❌ Error en flowSeleccionEspecialidad:', error)
                await flowDynamic('❌ Ocurrió un error. Regresando al menú de facultades.')
                await borrarEstado(usuarioId)
                return gotoFlow(flowFacultadEspecialidades)
            }
        })

const flowFacultadEspecialidades = addKeyword(utils.setEvent('FACULTAD_ESPECIALIDADES'))
    .addAnswer('*ESPECIALIDADES DE LA UNIVERSIDAD NACIONAL DEL CALLAO*')
    .addAnswer('Estas son nuestras facultades con especialidades:', {
        media: 'https://posgrado.unac.edu.pe/img/escuela.jpg'
    })
    .addAnswer([
        '1️⃣ Facultad de Ciencias de la Salud',
        '0️⃣ Volver al menú principal'
    ], { capture: true }, async (ctx, { gotoFlow, flowDynamic }) => {
        const facultadId = ctx.body.trim()
        const usuarioId = ctx.from

        if (!['1', '0'].includes(facultadId)) {
            await flowDynamic('❌ Opción inválida. Intente de nuevo.')
            return gotoFlow(flowFacultadEspecialidades)
        }

        if (facultadId === '0') {
            return gotoFlow(programasFlow)
        }


        const facultad = facultades[facultadId]
        if (!facultad || !facultad.especialidades) {
            await flowDynamic('❌ Facultad no encontrada o sin especialidades.')
            return gotoFlow(flowFacultadEspecialidades)
        }

        try {
            await guardarEstado(usuarioId, { facultadId })

            const especialidadEntries = Object.entries(facultad.especialidades)
            const opciones = especialidadEntries
                .map(([especialidadId, especialidad], index) =>
                    `${index + 1}️⃣ ${especialidad.nombre || 'Especialidad ' + especialidadId}`
                )
                .join('\n')

            await flowDynamic([
                `📚 *${facultad.nombre}*`,
                'Seleccione una especialidad para ver más detalles:',
                opciones,
                '0️⃣ Volver al listado de facultades'
            ])

            return gotoFlow(flowSeleccionEspecialidad)
        } catch (error) {
            console.error('❌ Error al guardar estado:', error)
            await flowDynamic('❌ Error interno. Intente de nuevo más tarde.')
            return gotoFlow(flowFacultadEspecialidades)
        }
    })

// Flujo Programas
const programasFlow = addKeyword(utils.setEvent('PROGRAMAS_FLOW'))
    .addAnswer(
        [programas || '📚 *PROGRAMAS DE POSGRADO*\n1️⃣ Maestrías\n2️⃣ Doctorados\n3️⃣ Especialidades\n0️⃣ Volver al menú'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '3', '0'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(programasFlow)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowFacultadMaestrias)
                case '2':
                    return gotoFlow(flowFacultadDoctorados)
                case '3':
                    return gotoFlow(flowFacultadEspecialidades)
                case '0':
                    return gotoFlow(menuFlow)
            }
        }
    )

// ============= FLUJOS DE ADMISIÓN =============

const flowRequisitos = addKeyword(utils.setEvent('REQUISITOS_FLOW'))
    .addAnswer([requisitos || 'Requisitos no disponibles.'])
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowCostos = addKeyword(utils.setEvent('COSTOS_FLOW'))
    .addAnswer([costos || 'Costos no disponibles.'])
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowFechasAdmision = addKeyword(utils.setEvent('FECHAS_ADMISION_FLOW'))
    .addAnswer('Estas son nuestras fechas', {
        media: 'https://github.com/JeysonRG1804/brochure/raw/main/fechasadmision.png'
    })
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const flowGuia = addKeyword(utils.setEvent('GUIA_FLOW'))
    .addAnswer('Encuentra toda la información necesaria para postular con éxito:\n ✔️ Requisitos generales y específicos\n ✔️ Cronograma del proceso de admisión\n ✔️ Procedimiento de inscripción paso a paso\n✔️ Contactos y enlaces útiles')
    .addAnswer('Este es nuestra guía de admisión:',
        { media: 'https://posgrado.unac.edu.pe/CHATBOT/Guia_de_Postulante.pdf' },
    )
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

const masinfoadmision = addKeyword(utils.setEvent('MAS_INFO_ADMISION'))
    .addAnswer(
        ['¿Necesitas mayor información sobre admisión?, digite el número la acción a realizar', '1️⃣ *SI* 📜', '2️⃣ *NO*'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(masinfoadmision)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowAdmision)
                case '2':
                    return gotoFlow(flowExit)
            }
        }
    )

const flowAdmision = addKeyword(utils.setEvent('ADMISION_FLOW'))
    .addAnswer(
        [admision || '📝 *ADMISIÓN*\n1️⃣ Requisitos\n2️⃣ Fechas\n3️⃣ Guía del Postulante\n4️⃣ Costos\n0️⃣ Volver al menú'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '3', '4', '0'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(flowAdmision)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(flowRequisitos)
                case '2':
                    return gotoFlow(flowFechasAdmision)
                case '3':
                    return gotoFlow(flowGuia)
                case '4':
                    return gotoFlow(flowCostos)
                case '0':
                    return gotoFlow(menuFlow)
            }
        }
    )

// Flujo de Taller de Tesis
const flowTallerTesis = addKeyword(utils.setEvent('TALLER_TESIS_FLOW'))
    .addAnswer('*¡Bienvenido al Taller de Tesis!*')
    .addAnswer('Aquí encontrarás recursos y apoyo para tu proyecto de tesis, desde la formulación de la propuesta hasta la defensa final.')
    .addAnswer('Si tienes de 5 a más años de egresado, puedes participar en nuestro Taller de Tesis para mejorar tu proyecto y recibir orientación personalizada.',
        { media: 'https://github.com/JeysonRG1804/brochure/raw/main/tallertesis.png' },
    )
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(masinfoadmision)
    })

// Flujo Menú Principal
const menuFlow = addKeyword(utils.setEvent('MENU_FLOW'))
    .addAnswer(
        [menu || '📋 *MENÚ PRINCIPAL*\n1️⃣ Programas de Posgrado\n2️⃣ Admisión\n3️⃣ Calendario Académico\n4️⃣ Taller de Tesis\n5️⃣ Contacto'],
        { capture: true },
        async (ctx, { flowDynamic, gotoFlow }) => {
            if (!['1', '2', '3', '4', '5'].includes(ctx.body)) {
                await flowDynamic('❌ Respuesta no válida, selecciona una de las opciones.')
                return gotoFlow(menuFlow)
            }
            switch (ctx.body) {
                case '1':
                    return gotoFlow(programasFlow)
                case '2':
                    return gotoFlow(flowAdmision)
                case '3':
                    return gotoFlow(flowCalendario)
                case '4':
                    return gotoFlow(flowTallerTesis)
                case '5':
                    return gotoFlow(flowContacto)
            }
        }
    )

// Flujo Principal (Bienvenida) - Solo EVENTS.WELCOME
const flowPrincipal = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx) => {
        console.log('=== DEBUG: Mensaje recibido ===')
        console.log('De:', ctx.from)
        console.log('Mensaje:', ctx.body)
        console.log('Nombre:', ctx.pushName)
        console.log('Timestamp:', new Date().toISOString())
        console.log('================================')
    })
    .addAnswer([
        '🌟 *BIENVENIDO A LA ESCUELA DE POSGRADO DE LA UNIVERSIDAD NACIONAL DEL CALLAO* 🌟',
        'Aquí, la excelencia académica se combina con el compromiso y la vocación de servicio, formando líderes que impactan en la sociedad.',
        '*Una universidad con un rostro humano*, donde cada estudiante es parte de una comunidad que inspira, acompaña y fortalece.',
        '¡Es momento de crecer juntos!'
    ])
    .addAnswer('BIENVENIDOS', {
        media: 'https://github.com/JeysonRG1804/brochure/raw/main/entrada.png'
    })
    .addAction(async (ctx, { gotoFlow }) => {
        return gotoFlow(menuFlow)
    })

// ============= INICIALIZACIÓN DEL BOT =============

const main = async () => {
    const adapterFlow = createFlow([
        flowPrincipal,
        menuFlow,
        programasFlow,
        flowFacultadMaestrias,
        flowSeleccionMaestria,
        flowNuevaMaestria,
        flowFacultadDoctorados,
        flowSeleccionDoctorado,
        flowNuevoDoctorado,
        flowFacultadEspecialidades,
        flowSeleccionEspecialidad,
        flowNuevaEspecialidad,
        flowAdmision,
        flowRequisitos,
        flowCostos,
        flowFechasAdmision,
        flowGuia,
        masinfoadmision,
        flowTallerTesis,
        flowContacto,
        flowCalendario,
        flowExit
    ])

    const adapterProvider = createProvider(Provider, {
        protocolTimeout: 120000, // 120 segundos de timeout para operaciones de WhatsApp
    })
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    // Portal web para escanear QR
    QRPortalWeb({ port: 3001 })

    // ============= MIDDLEWARE CORS =============
    // Permitir peticiones desde cualquier origen (para pruebas)
    adapterProvider.server.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        // Manejar preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }
        next()
    })

    // ============= ENDPOINTS API =============

    // Enviar mensaje
    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    // Disparar flujo de registro personalizado
    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('CONTACTO_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    // Disparar flujo de programas
    adapterProvider.server.post(
        '/v1/programas',
        handleCtx(async (bot, req, res) => {
            const { number } = req.body
            await bot.dispatch('PROGRAMAS_FLOW', { from: number })
            return res.end('trigger')
        })
    )

    // Blacklist - Agregar/Quitar
    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    // Blacklist - Listar
    adapterProvider.server.get(
        '/v1/blacklist/list',
        handleCtx(async (bot, req, res) => {
            const blacklist = bot.blacklist.getList()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', blacklist }))
        })
    )

    // Enviar mensaje con brochure
    adapterProvider.server.post(
        '/v1/enviar-mensaje',
        handleCtx(async (bot, req, res) => {
            const { numero, mensaje, facultad, programa } = req.body || {}

            if (!numero || !mensaje || !facultad || !programa) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ error: 'Faltan datos' }))
            }

            try {
                // Texto inicial
                const texto = `👋 Felicidades ${mensaje}\n*Somos de la Escuela de Posgrado de la UNAC*\n🚀 Ya se encuentra registrado para nuestros programas de Posgrado!`
                await bot.sendMessage(numero, texto, {})
                await delayAleatorio(2000, 4000) // Delay aleatorio de 2-4 segundos

                // Determinar precio y duración
                let precio = ''
                let duracion = ''
                let cuenta = ''
                let cci = ''
                let costo = ''
                let enlace = 'https://chat.whatsapp.com/IKNzlJiO6El6Ns8k4bixjF'
                const p = programa.toLowerCase()

                if (p.includes('maestría') || p.includes('maestria')) {
                    precio = 'S/ 200'
                    duracion = '3 semestres académicos'
                    cuenta = '000-3747336'
                    cci = '009-100-000003747336-90'
                    costo = '~S/ 2500~ *S/ 2100*'
                } else if (p.includes('doctorado')) {
                    precio = 'S/ 250'
                    duracion = '6 semestres académicos'
                    cuenta = '000-3747336'
                    cci = '009-100-000003747336-90'
                    costo = '~S/ 2500~ *S/ 2100*'
                } else if (p.includes('especialidad')) {
                    precio = 'S/ 120'
                    duracion = '2 semestres académicos'
                    cuenta = '000-1797042'
                    cci = '009-100-000001797042-97'
                    costo = '~S/ 1500~ *S/ 1200*'
                }

                const texto2 = `💥 ¡Quiero contarte sobre nuestro programa de posgrado y los increíbles beneficios que puedes obtener! 🎓

📌 Costo de Inscripción:
Por solo ${precio} recibirás:
📂 Carpeta de Postulante
📝 Derecho de Inscripción

🏦 Medios de Pago:
CCI: ${cci}
N° Cta. Cte.: ${cuenta} (Scotiabank)

📅 Fechas importantes:
🖋 Inscripciones: Hasta el 18 de marzo del 2026
📹 Entrevista virtual: última semana de Marzo del 2026
📃 Resultados: 1-2 días después del examen
🎒 Inicio de clases: Primera semana de Abril

⏳ Duración del programa: ${duracion}
💵 Costo por semestre: ${costo}

📲 Contáctanos ahora:
📩 posgrado.admision@unac.edu.pe
📞 900969591`

                await bot.sendMessage(numero, texto2, {})
                await delayAleatorio(2000, 4000) // Delay aleatorio de 2-4 segundos

                // Función para normalizar texto (quitar acentos, caracteres especiales y espacios extra)
                const normalizarTexto = (txt) => {
                    if (!txt) return ''
                    // Primero quitar acentos usando NFD
                    let normalizado = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    // Reemplazar caracteres corruptos comunes (encoding issues)
                    normalizado = normalizado.replace(/[�]/g, '')
                    // Convertir a minúsculas
                    normalizado = normalizado.toLowerCase()
                    // Reemplazar múltiples espacios por uno solo
                    normalizado = normalizado.replace(/\s+/g, ' ').trim()
                    return normalizado
                }

                // Función para extraer palabras clave de un texto
                const extraerPalabrasClave = (txt) => {
                    const normalizado = normalizarTexto(txt)
                    // Palabras a ignorar
                    const stopWords = ['en', 'de', 'del', 'la', 'el', 'con', 'y', 'para', 'los', 'las', 'por', 'mencion', 'mención']
                    return normalizado.split(' ').filter(p => p.length > 2 && !stopWords.includes(p))
                }

                // Cargar programas.json para obtener el brochure específico del programa
                let brochurePrograma = null
                const programaNormalizado = normalizarTexto(programa)
                const palabrasClaveBusqueda = extraerPalabrasClave(programa)
                console.log(`🔍 Buscando programa: "${programa}"`)
                console.log(`🔍 Programa normalizado: "${programaNormalizado}"`)
                console.log(`🔍 Palabras clave: [${palabrasClaveBusqueda.join(', ')}]`)

                try {
                    const programasPath = join(__dirname, 'programas.json')

                    if (existsSync(programasPath)) {
                        const programasData = JSON.parse(readFileSync(programasPath, 'utf-8'))

                        // Buscar el programa en todas las facultades
                        if (programasData.facultades) {
                            let totalProgramasRevisados = 0
                            let mejorCoincidencia = null
                            let mejorPuntaje = 0

                            for (const codigoFacultad of Object.keys(programasData.facultades)) {
                                const fac = programasData.facultades[codigoFacultad]

                                if (fac.programas && Array.isArray(fac.programas)) {
                                    for (const prog of fac.programas) {
                                        totalProgramasRevisados++
                                        if (!prog.nombre) continue

                                        const nombreNormalizado = normalizarTexto(prog.nombre)
                                        const palabrasClavePrograma = extraerPalabrasClave(prog.nombre)

                                        // Verificar coincidencia exacta primero
                                        if (nombreNormalizado === programaNormalizado) {
                                            if (prog.brochure && prog.brochure.length > 0) {
                                                brochurePrograma = prog.brochure
                                                console.log(`✅ ¡Coincidencia exacta! Programa: "${prog.nombre}"`)
                                                console.log(`✅ Facultad: ${fac.nombre}`)
                                                console.log(`✅ Brochure: ${brochurePrograma}`)
                                                break
                                            }
                                        }

                                        // Búsqueda por palabras clave
                                        let puntaje = 0
                                        for (const palabra of palabrasClaveBusqueda) {
                                            if (palabrasClavePrograma.some(p => p.includes(palabra) || palabra.includes(p))) {
                                                puntaje++
                                            }
                                        }

                                        // Si encuentra suficientes palabras clave (al menos 2 o el 50%)
                                        const umbral = Math.max(2, Math.floor(palabrasClaveBusqueda.length * 0.5))
                                        if (puntaje >= umbral && puntaje > mejorPuntaje && prog.brochure && prog.brochure.length > 0) {
                                            mejorPuntaje = puntaje
                                            mejorCoincidencia = { prog, fac }
                                        }
                                    }

                                    if (brochurePrograma) break
                                }
                            }

                            // Si no hubo coincidencia exacta, usar la mejor por palabras clave
                            if (!brochurePrograma && mejorCoincidencia) {
                                brochurePrograma = mejorCoincidencia.prog.brochure
                                console.log(`✅ ¡Encontrado por palabras clave! Programa: "${mejorCoincidencia.prog.nombre}"`)
                                console.log(`✅ Facultad: ${mejorCoincidencia.fac.nombre}`)
                                console.log(`✅ Puntaje: ${mejorPuntaje}/${palabrasClaveBusqueda.length}`)
                                console.log(`✅ Brochure: ${brochurePrograma}`)
                            }

                            // Si no se encontró programa específico, buscar brochure de la facultad en programas.json
                            if (!brochurePrograma) {
                                console.log(`⚠️ Buscando brochure de facultad como fallback para: "${facultad}"`)
                                const facultadNorm = normalizarTexto(facultad)

                                for (const codigoFacultad of Object.keys(programasData.facultades)) {
                                    const fac = programasData.facultades[codigoFacultad]
                                    const facNombreNorm = normalizarTexto(fac.nombre || '')

                                    // Buscar la facultad por nombre normalizado
                                    if (facultadNorm.includes(facNombreNorm) || facNombreNorm.includes(facultadNorm)) {
                                        // Buscar el primer programa con brochure válido
                                        if (fac.programas && Array.isArray(fac.programas)) {
                                            for (const prog of fac.programas) {
                                                if (prog.brochure && prog.brochure.length > 0) {
                                                    brochurePrograma = prog.brochure
                                                    console.log(`✅ Brochure de facultad encontrado: ${fac.nombre}`)
                                                    console.log(`✅ Usando brochure de: ${prog.nombre}`)
                                                    console.log(`✅ URL: ${brochurePrograma}`)
                                                    break
                                                }
                                            }
                                        }
                                        break
                                    }
                                }
                            }

                            console.log(`📊 Total programas revisados: ${totalProgramasRevisados}`)
                        }

                        if (!brochurePrograma) {
                            console.log(`❌ No se encontró brochure para: "${programa}" ni para facultad "${facultad}"`)
                        }
                    } else {
                        console.error('❌ Archivo programas.json no existe')
                    }
                } catch (jsonError) {
                    console.error('⚠️ Error al leer programas.json:', jsonError.message)
                }

                // Enviar el brochure encontrado (programa específico o de facultad)
                if (brochurePrograma) {
                    const mensajeBrochure = `📄 Aquí está el brochure de *${programa}*:`
                    // Extraer nombre del archivo y especificarlo para que WhatsApp lo reconozca como PDF
                    const fileName = decodeURIComponent(brochurePrograma.split('/').pop())
                    await bot.sendMessage(numero, mensajeBrochure, { media: brochurePrograma, fileName: fileName })
                    await delayAleatorio(2000, 4000) // Delay aleatorio de 2-4 segundos
                } else {
                    console.warn(`⚠️ No se encontró ningún brochure para programa "${programa}" ni facultad "${facultad}"`)
                }

                // Links de grupos de WhatsApp por facultad (REEMPLAZAR CON LINKS REALES)
                const gruposWhatsApp = {
                    'Facultad de Ciencias Económicas': 'https://chat.whatsapp.com/GwqF5Qe5wGr5ueyI0k1Sxl',
                    'Facultad de Ingeniería Industrial y de Sistemas': 'https://chat.whatsapp.com/EwRf65gMmwe9zyCrsM1gks',
                    'Facultad de Ciencias Administrativas': 'https://chat.whatsapp.com/HNKqywmtrBLER8l8lvaoCM',
                    'Facultad de Ciencias Contables': 'https://chat.whatsapp.com/IKDHLVEa6bS0ZQ0319d17x',
                    'Facultad de Ingeniería Química': 'https://chat.whatsapp.com/C1cgM6wqzQrKZGPJiHYMvJ',
                    'Facultad de Ciencias Naturales y Matemática': 'https://chat.whatsapp.com/HW7YC2eFeEx6K7tFL9Kf04',
                    'Facultad de Ingeniería Pesquera y de Alimentos': 'https://chat.whatsapp.com/IKNzlJiO6El6Ns8k4bixjF',
                    'Facultad de Ingeniería Mecánica y Energía': 'https://chat.whatsapp.com/IAAsZWNRocL5pOv6tJQqZY',
                    'Facultad de Ingeniería Eléctrica y Electrónica': 'https://chat.whatsapp.com/DkrzEJ6uV6nBfYUvraebzC',
                    'Facultad de Ingeniería Ambiental y de Recursos Naturales': 'https://chat.whatsapp.com/BKySJFFEKNeK40LZ4tAxOv',
                    'Facultad de Ciencias de la Educación': 'https://chat.whatsapp.com/JAKU1zp1U6ZIuDLUAas7Xp'
                }


                // Links de grupos de WhatsApp por PROGRAMA para FIEE (REEMPLAZAR CON LINKS REALES)
                const gruposProgramasFIEE = {
                    // Maestrías
                    'Maestría en Ingeniería Eléctrica con Mención en Gestión de Sistemas de Energía Eléctrica': 'https://chat.whatsapp.com/EnAssprLnsW6AcLa6DkTu5',
                    'Maestría en Ingeniería Eléctrica con Mención en Gerencia de Proyectos de Ingeniería': 'https://chat.whatsapp.com/HCYIX2KS7MmIm0YxOWKwxK',
                    'Maestría en Ciencias de Electrónica con Mención en Telecomunicaciones': 'https://chat.whatsapp.com/BeiBgdH4c3PLNE2dgPj4jq',
                    'Maestría en Ciencias de Electrónica con Mención en Ingeniería Biomédica': 'https://chat.whatsapp.com/LDJglqpAxQ3HOZMMObnk8p',
                    'Maestría en Ciencias de Electrónica con Mención en Control y Automatización': 'https://chat.whatsapp.com/Cqq9GRvHIq8FWEMGz10coY',
                    // Doctorado
                    'Doctorado en Ingeniería Eléctrica': 'https://chat.whatsapp.com/LvTWe7G5F4hLZbFdgnPkRv'
                }

                // Determinar el link del grupo de WhatsApp (prioridad: programa FIEE > facultad > general)
                let grupoLink = null
                let grupoNombre = facultad

                // Links especiales para Facultad de Ciencias de la Salud (REEMPLAZAR CON LINKS REALES)
                const gruposFCS = {
                    especialidades: 'https://chat.whatsapp.com/Dq2jT7AzCsO660QtCbV0bG',
                    maestriasDoctorados: 'https://chat.whatsapp.com/KoTYdWaGPFu7Onzu1UlXmj'
                }

                // Si es Facultad de Ciencias de la Salud, diferenciar entre especialidades y maestrías/doctorados
                if (facultad === 'Facultad de Ciencias de la Salud') {
                    const programaLower = programa.toLowerCase()
                    if (programaLower.includes('especialidad') || programaLower.includes('especialización')) {
                        grupoLink = gruposFCS.especialidades
                        grupoNombre = 'Especialidades - Facultad de Ciencias de la Salud'
                        console.log('✅ Link de grupo FCS: Especialidades')
                    } else {
                        grupoLink = gruposFCS.maestriasDoctorados
                        grupoNombre = 'Maestrías y Doctorados - Facultad de Ciencias de la Salud'
                        console.log('✅ Link de grupo FCS: Maestrías y Doctorados')
                    }
                }
                // Si es FIEE, buscar primero el link específico del programa
                else if (facultad === 'Facultad de Ingeniería Eléctrica y Electrónica') {
                    // Buscar coincidencia por programa usando palabras clave
                    const programaNorm = normalizarTexto(programa)
                    console.log(`🔍 Buscando grupo FIEE para: "${programa}"`)
                    console.log(`🔍 Programa normalizado: "${programaNorm}"`)

                    let mejorCoincidenciaGrupo = null
                    let mejorPuntajeGrupo = 0

                    for (const [nombreProg, link] of Object.entries(gruposProgramasFIEE)) {
                        const nombreProgNorm = normalizarTexto(nombreProg)

                        // Coincidencia exacta
                        if (nombreProgNorm === programaNorm) {
                            grupoLink = link
                            grupoNombre = nombreProg
                            console.log(`✅ Coincidencia exacta de grupo FIEE: ${nombreProg}`)
                            break
                        }

                        // Búsqueda por palabras clave
                        const palabrasPrograma = programaNorm.split(' ').filter(p => p.length > 3)
                        const palabrasNombreProg = nombreProgNorm.split(' ').filter(p => p.length > 3)

                        let puntaje = 0
                        for (const palabra of palabrasPrograma) {
                            if (palabrasNombreProg.some(p => p.includes(palabra) || palabra.includes(p))) {
                                puntaje++
                            }
                        }

                        // Al menos 3 palabras en común o 50% de coincidencia
                        const umbral = Math.max(3, Math.floor(palabrasPrograma.length * 0.5))
                        if (puntaje >= umbral && puntaje > mejorPuntajeGrupo) {
                            mejorPuntajeGrupo = puntaje
                            mejorCoincidenciaGrupo = { nombre: nombreProg, link }
                        }
                    }

                    // Si no hubo coincidencia exacta, usar la mejor por palabras clave
                    if (!grupoLink && mejorCoincidenciaGrupo) {
                        grupoLink = mejorCoincidenciaGrupo.link
                        grupoNombre = mejorCoincidenciaGrupo.nombre
                        console.log(`✅ Grupo FIEE por palabras clave: ${grupoNombre} (puntaje: ${mejorPuntajeGrupo})`)
                    }

                    // Si aún no se encontró, usar el link general de FIEE
                    if (!grupoLink) {
                        grupoLink = gruposWhatsApp[facultad]
                        grupoNombre = facultad
                        console.log(`⚠️ Usando grupo general FIEE: ${grupoLink}`)
                    }
                }

                // Si no se encontró link de programa, usar el de facultad
                if (!grupoLink) {
                    grupoLink = gruposWhatsApp[facultad] || enlace
                }

                // Último mensaje
                const text4 = `📌 Estoy disponible para resolver cualquier duda y acompañarte en tu proceso de inscripción.
O puedes unirte al grupo de WhatsApp de *${grupoNombre}*:
${grupoLink}

📩 Correo: posgrado.admision@unac.edu.pe
📞 WhatsApp: 900969591

🚀 ¡Escríbeme ahora y asegura tu cupo en la maestría!`

                await bot.sendMessage(numero, text4, {})

                res.writeHead(200, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({
                    status: 'Mensaje y PDF enviados',
                    brochureEnviado: brochurePrograma ? 'programa' : 'ninguno'
                }))

            } catch (err) {
                console.error('❌ Error enviando mensaje:', err)
                res.writeHead(500, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({ error: 'Error interno al enviar mensaje' }))
            }
        })
    )

    httpServer(+PORT)
    console.log(`🚀 Bot iniciado en el puerto ${PORT}`)
}

console.log('⏳ Iniciando bot...')
main().catch((err) => {
    console.error('❌ Error en main():', err)
})

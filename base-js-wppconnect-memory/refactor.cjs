const fs = require('fs');

const path = 'src/app.js';
let content = fs.readFileSync(path, 'utf8');

const regexAPI = /\/\/ Enviar mensaje con brochure\s+adapterProvider\.server\.post\(\s+'\/v1\/enviar-mensaje',[\s\S]*?console\.error\('❌ Error enviando mensaje en cola:', err\)\s+\}\s+\}\)\s+\}\)\s+\)/;

const match = regexAPI.exec(content);
if (!match) {
    console.error("Could not find the /v1/enviar-mensaje API block");
    process.exit(1);
}

const apiBlock = match[0];

// Extract the inner logic of colaMensajesGlobal.agregar
const innerLogicMatch = apiBlock.match(/colaMensajesGlobal\.agregar\(async \(\) => \{[\s\S]*\}\)/);
if (!innerLogicMatch) {
    console.error("Could not find inner logic");
    process.exit(1);
}

let innerLogic = innerLogicMatch[0];

// We wrap it in a function
const functionDefinition = `// ============= LÓGICA DE ENVÍO AUTOMATIZADO =============
async function procesarEnvioMensaje(numero, mensaje, facultad, programa, bot) {
    ${innerLogic}
}
`;

// Remove the API from app.js
content = content.replace(apiBlock, '');

// Insert the function above flowPrincipal
content = content.replace('// Flujo Principal (Bienvenida) - Solo EVENTS.WELCOME', functionDefinition + '\n// Flujo Principal (Bienvenida) - Solo EVENTS.WELCOME');

// Modify flowPrincipal
const flowPrincipalRegex = /\/\/ Flujo Principal \(Bienvenida\) - Solo EVENTS\.WELCOME\s+const flowPrincipal = addKeyword\(EVENTS\.WELCOME\)[\s\S]*?\}\)/;

const newFlowPrincipal = `// Flujo Principal (Bienvenida) - Solo EVENTS.WELCOME
const flowPrincipal = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { endFlow, provider }) => {
        console.log('=== DEBUG: Mensaje recibido ===')
        console.log('De:', ctx.from)
        console.log('Mensaje:', ctx.body)
        console.log('Nombre:', ctx.pushName)
        console.log('Timestamp:', new Date().toISOString())
        console.log('================================')
        
        try {
            const numeroTel = ctx.from.replace('@c.us', '');
            const urlWebhook = \`https://script.google.com/macros/s/AKfycby8j15X23p-6Z9_A_iB0WuhIFwxZkp8KkaVFG_CYyIc_mn593v5KQRqWLZ5BoPAVwmDBw/exec?telefono=\${numeroTel}\`;
            
            console.log(\`🔍 Consultando Google Sheets para el número: \${numeroTel}\`);
            const response = await fetch(urlWebhook);
            const data = await response.json();
            
            if (data.encontrado) {
                const estadoLocal = await obtenerEstado(ctx.from) || {};
                
                // Verificar si ya se le envió info automatizada anteriormente
                if (estadoLocal.infoAutomatizadaEnviada) {
                    console.log(\`ℹ️ Usuario \${numeroTel} ya recibió la información anteriormente. Pasando a Bienvenida.\`);
                    return; // Sigue el flujo normal
                }
                
                // Verificar regla de 15 minutos
                if (data.fechaRegistro) {
                    const fechaReg = new Date(data.fechaRegistro);
                    const ahora = new Date();
                    const diffMs = ahora - fechaReg;
                    const diffMins = Math.floor(diffMs / 60000);
                    
                    console.log(\`🕒 Tiempo desde registro: \${diffMins} minutos.\`);
                    
                    if (diffMins <= 15) {
                        console.log(\`✅ Cumple regla de 15 mins. Enviando info automatizada a \${numeroTel}\`);
                        // Marcar como enviado en la bd local
                        await guardarEstado(ctx.from, { infoAutomatizadaEnviada: true });
                        
                        // Llamar a la lógica de envío
                        await procesarEnvioMensaje(ctx.from, data.nombre, data.facultad, data.programa, provider);
                        
                        return endFlow(); // Termina el flujo aquí para no mostrar Menú
                    } else {
                        console.log(\`⏳ Pasaron más de 15 minutos (\${diffMins} mins). Pasando a Bienvenida.\`);
                    }
                } else {
                     console.log(\`⚠️ Usuario encontrado pero sin Fecha de Registro válida. Pasando a Bienvenida.\`);
                }
            } else {
                console.log(\`❌ Número \${numeroTel} no encontrado en Google Sheets. Pasando a Bienvenida.\`);
            }
        } catch (error) {
           console.error(\`❌ Error al consultar Google Sheets:\`, error);
        }
    })`;

content = content.replace(flowPrincipalRegex, newFlowPrincipal);

fs.writeFileSync(path, content, 'utf8');
console.log("Refactoring complete");

# 🚀 Instalación en VPS - Chatbot WPPConnect

## Requisitos del VPS
- Ubuntu 20.04+ o Debian 10+
- Node.js 18+
- npm o yarn
- Git
- Al menos 1GB RAM

---

## Pasos de Instalación

### 1. Conectar al VPS
```bash
ssh usuario@tu-ip-vps
```

### 2. Instalar Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # Verificar: v18.x.x
```

### 3. Instalar dependencias del sistema (para Chromium/Puppeteer)
```bash
sudo apt update
sudo apt install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev
```

### 4. Clonar el repositorio
```bash
cd ~
git clone https://github.com/TU_USUARIO/CHATBOT-WPPCONECT.git
cd CHATBOT-WPPCONECT/base-js-wppconnect-memory
```

### 5. Instalar dependencias del proyecto
```bash
npm install
```

### 6. Ejecutar el bot (primera vez - para escanear QR)
```bash
npm start
```
> Escanea el QR que aparece en consola con tu WhatsApp

### 7. Instalar PM2 (para mantener el bot corriendo)
```bash
sudo npm install -g pm2
```

### 8. Ejecutar con PM2
```bash
pm2 start src/app.js --name "chatbot-wppconnect"
pm2 save
pm2 startup  # Seguir las instrucciones que aparezcan
```

---

## Comandos útiles de PM2

| Comando | Descripción |
|---------|-------------|
| `pm2 list` | Ver bots corriendo |
| `pm2 logs chatbot-wppconnect` | Ver logs |
| `pm2 restart chatbot-wppconnect` | Reiniciar |
| `pm2 stop chatbot-wppconnect` | Detener |
| `pm2 delete chatbot-wppconnect` | Eliminar |

---

## Escanear QR en VPS (sin interfaz gráfica)

El QR aparecerá en la terminal. Si necesitas el portal web:

1. Asegúrate de que el puerto 3001 esté abierto:
```bash
sudo ufw allow 3001
```

2. Accede desde tu navegador:
```
http://TU-IP-VPS:3001
```

---

## Solución de problemas

### Error: Chromium no inicia
```bash
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install puppeteer-core
```

### Error: Permisos
```bash
sudo chown -R $USER:$USER ~/.cache
```

### Ver logs de error
```bash
pm2 logs chatbot-wppconnect --lines 100
```

# Commerce StablePay — Crypto Payment Gateway

Gateway off-site para Drupal Commerce que permite pagos con USDC/USDT en StableChain y Celo usando direcciones HD wallet (BIP-44) y sidecar Node.js.

## Requisitos

- Drupal 10+ con Commerce 2.x
- Docker compose (Wodby o similar)
- Node.js 20+ para el sidecar (incluido en compose.yml como `stablepay-listener`)

## Instalación

1. Habilitar el módulo:
   ```sh
   make drush "en commerce_stablepay"
   ```

2. Configurar el gateway en Drupal:
   - Ir a `/admin/commerce/config/payment-gateways`
   - Agregar nuevo gateway → "StablePay Crypto"
   - Configurar RPC URLs y direcciones de contratos USDC/USDT

3. Configurar webhook secret para asegurar que solo el sidecar puede notificar pagos:
   ```sh
   openssl rand -hex 32
   ```
   Agregar el resultado en ambas ubicaciones:

   En `settings.php`:
   ```php
   putenv('STABLEPAY_WEBHOOK_SECRET=tu-secret-aqui');
   ```

   En el `.env` del sidecar (misma raíz de Drupal):
   ```env
   WEBHOOK_SECRET=tu-secret-aqui
   ```

   El sidecar envía este secret como header `X-Webhook-Secret` al notificar pagos.
   El módulo lo verifica antes de procesar cualquier notificación.

## Despliegue standalone (sin Docker)

Si el sidecor corre como servicio systemd en el mismo server:

1. Configurar la URL del sidecar en `settings.php`:
   ```php
   putenv('STABLEPAY_SIDECAR_URL=http://127.0.0.1:3002');
   ```

2. Configurar `.env` del sidecar (en la raíz de Drupal):
   ```env
   DRUPAL_BASE_URL=http://127.0.0.1
   STABLEPAY_MASTER_XPUB=xpub...
   STABLEPAY_DB_PATH=./pending.db
   PORT=3002
   ```

3. Instalar el servicio systemd (ver `node/stablepay-listener.service`):
   ```sh
   cp node/stablepay-listener.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now stablepay-listener
   ```

## Configuración de XPUB

El gateway usa **XPUB (watch-only)** para derivar direcciones. El sidecar deriva addresses desde el xpub sin tener acceso a la private key.

### Generar XPUB

```js
const { ethers } = require('ethers');
const mnemonic = ethers.Mnemonic.fromPhrase("tu mnemonic aqui");
const accountNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0");
console.log(accountNode.neuter().extendedKey);
```

### Configurar en `.env`

```env
STABLEPAY_MASTER_XPUB=xpub6DyUKdwoLWmUJ4Tn9Bbsdtx7B5Ws18mEN19e5HT52ikE53FiUheSQXrZUNPovqfyKmw4579A1Mm3GXXKM39N64uooBfJ4tNAzFsEbodRTx4
```

## Networks y Tokens

| Network | Chain ID | Gas Token | Tokens |
|---|---|---|---|
| StableChain | `988` | USDT | USDT |
| Celo | `42220` | CELO (CIP-64) | USDC, USDT |

### Direcciones de contratos

| Token | Network | Address |
|---|---|---|
| USDC | Celo | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| USDT | Celo | `0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e` |
| USDT | StableChain | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` |

## Sidecar Node.js

El sidecar (`node/index.js`) es un servidor Express que corre en el contenedor `stablepay-listener` y se encarga de monitorear la blockchain, gestionar direcciones HD wallet y notificar a Drupal.

### Inicio y configuración

Al arrancar, el sidecar:

1. **Inicializa la DB** — sql.js persistida en `/data/pending.db` (volumen Docker `stablepay_data`)
2. Lee `STABLEPAY_MASTER_XPUB` de `.env`
3. **Obtiene configuración** desde Drupal vía `GET /stablepay/payment/config` (networks, notify_url)
4. Si hay xpub configurado, **restaura direcciones pendientes** desde la DB y reanuda el monitoreo
5. **Inicia monitoreo** WebSocket + polling para las networks configuradas

### Modos de monitoreo

1. **WebSocket**: se suscribe a eventos `Transfer` del contrato ERC-20 en cada network.
2. **Polling (cada 15s)**: fallback universal. Verifica balance vía `eth_call`, busca logs para txHash, notifica a Drupal.

### Endpoints HTTP

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/derive` | Deriva address para una orden y la registra para monitoreo |
| `GET` | `/balance/:orderId` | Consulta balance on-chain (stateless) |
| `GET` | `/get-tx/:orderId` | Busca último txHash de `Transfer` hacia la address derivada |
| `GET` | `/health` | Estado del sidecar |

### Notificación a Drupal

Cuando el sidecar detecta un pago (WS o polling), hace un `POST` a `{notify_url}`:
```json
{ "order_id": 123, "tx_hash": "0x...", "amount": "12.50", "currency": "USDC" }
```

## Flujo de pago

1. Usuario selecciona StablePay en checkout → redirige a `/stablepay/payment/{order}`
2. `build()` deriva dirección HD única vía sidecar y la pasa al template + JS
3. JS llama a `deriveAddress()` para registrar monitoreo
4. Usuario envía USDC/USDT a la dirección desde su wallet
5. Sidecar detecta el pago (WS o polling) y notifica a Drupal vía webhook
6. `onNotify()` crea payment `completed` y transiciona orden

## Sweep de fondos

Los fondos se barran desde las addresses derivadas usando la CLI tool `tools/stablepay-sweep/`. El sidecar NO tiene acceso a la private key.

```sh
cd tools/stablepay-sweep

# Scan addresses por balance
node index.js scan --from 215 --to 230

# Sweep por order ID
node index.js sweep-api --id 228

# Sweep rango de orders
node index.js sweep-api --from 218 --to 228
```

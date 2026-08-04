# Arquitectura — StablePay (commerce_stablepay)

Gateway de pago cripto off-site para Drupal Commerce. Permite pagar con **USDC/USDT** en varias redes EVM (StableChain, Celo, Arbitrum, Polygon, Ethereum) usando una **HD Wallet en modo XPUB (watch-only)** y un **sidecar Node.js** que monitorea la blockchain (WebSocket con fallback a polling HTTP) y notifica a Drupal cuando se detecta el pago.

---

## 1. Arquitectura general

```mermaid
flowchart TB
    subgraph Cliente["Cliente (Browser)"]
        JS["commerce_stablepay.checkout.js<br/>SPA vanilla + jQuery"]
    end

    subgraph Drupal["Drupal 10 (PHP)"]
        PANE["StablePayPaymentProcess<br/>(checkout pane)"]
        CTRL["PaymentPageController"]
        GW["StablePayPaymentGateway<br/>(plugin offsite)"]
        TWIG["stablepay-payment-page.html.twig"]
    end

    subgraph Sidecar["Sidecar Node.js<br/>(container: stablepay-listener)"]
        API["Express API<br/>/derive /balance /get-tx /webhook /health"]
        MON["Monitor on-chain<br/>WS / polling"]
        DB[(SQLite pending.db)]
        XPUB["STABLEPAY_MASTER_XPUB"]
    end

    subgraph Blockchains["Blockchains EVM"]
        CELO["Celo (42220)"]
        ARB["Arbitrum (42161)"]
        POL["Polygon (137)"]
        ETH["Ethereum (1)"]
        STABLE["StableChain (988)"]
        TEST["Test / Anvil (31337)"]
    end

    Cliente -->|"checkout step: payment"| PANE
    PANE -->|"NeedsRedirectException"| TWIG
    TWIG -->|"carga JS"| JS
    JS -->|"GET /stablepay/payment/status/{order}"| CTRL
    JS -->|"GET /derive-address/{order}"| CTRL
    CTRL -->|"POST /derive"| API
    CTRL -->|"GET /config"| API
    API -->|"deriva address"| XPUB
    API -->|"persiste"| DB
    API -->|"registra monitoreo"| MON
    MON -->|"WS / RPC"| Blockchains
    MON -->|"POST notify_url (webhook)"| GW
    GW -->|"verifica tx on-chain"| API
```

---

## 2. Flujo de checkout completo (end-to-end)

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente (Browser)
    participant P as CheckoutPane (PHP)
    participant D as PaymentPageController
    participant S as Sidecar Node.js
    participant G as PaymentGateway (onNotify)
    participant B as Blockchain

    C->>P: Click "Pay and complete purchase"
    P->>P: Crea payment state=new → pending
    P->>D: throw NeedsRedirectException
    D->>D: Crea payment pending si no existe
    D->>S: POST /derive {order_id}
    S->>S: deriva address HD (XPUB + order_id)
    S-->>D: {address}
    D->>D: Arma networks[] según mode (test/live)
    D-->>C: Render stablepay-payment-page (data-address, data-networks)

    C->>D: GET /stablepay/payment/derive-address/{order}?rpc_url=&token_address=
    D->>S: POST /derive {order_id, rpc_url, token_address,...}
    S->>S: Registra en addressNetworkMap + SQLite + timer expiración
    S->>S: ensureNetworkSubscription() → abre WS
    S-->>D: {address, expiresAt}
    D->>D: Guarda stablepay_data en order + save
    D-->>C: {address, expiresAt, requiredConfirmations}

    C->>B: Envía ERC-20 transfer (wallet externa o MetaMask)
    Note over S,B: WS detecta evento Transfer o polling ve balance ≥ expected
    S->>G: POST notify_url {order_id, tx_hash, amount, currency}
    G->>S: GET /get-tx/{order_id}?rpc_url=&token_address=
    G->>G: Verifica tx_hash on-chain
    G->>G: Crea/actualiza payment completed + transiciona order
    G-->>S: HTTP 200

    C->>D: GET /status/{order} (polling JS cada 3s)
    D-->>C: {order_state: completed, payments[].state: completed}
    C->>C: state.status = 'confirmed' → stop polling
```

---

## 3. Selección de red y derivación de address

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente (JS)
    participant T as Twig (data-networks)
    participant D as PaymentPageController
    participant S as Sidecar Node.js

    Note over C,T: Usuario elige token → se listan las redes que lo soportan
    C->>C: renderNetworkSelection() con networks[] del DOM
    C->>C: Click en botón de red → createPayment(net)

    C->>C: state.payment = {tokenSymbol, tokenAddress, rpcUrl, network,...}
    C->>C: generateQR() + startPolling() (3s) + startTimer() (1s)

    C->>D: GET /derive-address/{order}?rpc_url=..&token_address=..&amount=..
    D->>D: checkAccess() + lee query params
    D->>S: POST /derive {order_id, rpc_url, token_address, token_symbol, amount}
    S->>S: deriveWallet(order_id) → address estable (HD, función solo de order_id)
    S->>S: ¿Cambió la red para esta address? → cleanup de la red vieja
    S->>S: addressNetworkMap.set(addr, info) + savePending (SQLite)
    S->>S: scheduleExpirationTimer(addr, info)
    S->>S: ensureNetworkSubscription(rpc_url, token_address) → WS
    S-->>D: {address}
    D->>D: Guarda stablepay_data en order + save
    D-->>C: {address, expiresAt, requiredConfirmations}
```

---

## 4. Monitoreo on-chain (WebSocket vs Polling fallback)

```mermaid
flowchart TD
    A["ensureNetworkSubscription(rpc_url, token_address)"] --> B{"networkConfig<br/>tiene match?"}
    B -->|"no"| B1["warn: No network config found<br/>queda en polling"]
    B -->|"sí"| C["subscribeNetwork(net)"]

    C --> D["httpToWs(rpc_url) → wsUrl"]
    D --> E{"WebSocket conecta?"}
    E -->|"sí"| F["WS activo<br/>contract.on('Transfer')"]
    E -->|"no / cae"| G["reconnect hasta 3 veces"]

    G --> H{"¿addresses activas<br/>en esa red?"}
    H -->|"sí"| E
    H -->|"no"| I["no reconecta"]

    E -->|"Transfer event<br/>to = addr vigilada"| J["notifyDrupal() + cleanup order"]

    F -.->|"WS no soportado / falla"| K["checkPollFallback()"]
    K --> L["startPolling() cada 15s"]
    L --> M["pollAllAddresses()<br/>eth_call balanceOf por addr"]
    M --> N{"balance ≥ expected?"}
    N -->|"sí"| O["eth_getLogs → txHash<br/>notifyDrupal() + cleanup"]
    N -->|"no"| M

    J --> P["cleanupEmptySubscriptions()"]
    O --> P
```

---

## 5. Notificación y confirmación de pago (onNotify)

```mermaid
sequenceDiagram
    autonumber
    participant S as Sidecar Node.js
    participant G as PaymentGateway (onNotify)
    participant D as PaymentPageController
    participant B as Blockchain

    S->>G: POST notify_url (header X-Webhook-Secret)
    G->>G: ¿secreto válido? → no → log warning + return

    alt payload con event: 'expired'
        G->>G: ¿order state != draft? → ignorar
        alt cancel_on_expire = TRUE
            G->>G: applyTransition('cancel') + unlock + void payments pending
            G-->>S: {status: 'canceled'}
        else cancel_on_expire = FALSE
            G-->>S: {status: 'ignored'}
        end
    else payload con order_id + tx_hash
        G->>G: ¿payment existente con remote_id = tx_hash? → duplicado, ignorar
        G->>S: GET /get-tx/{order_id}?rpc_url=&token_address=
        S-->>G: {tx_hash}
        G->>G: ¿tx_hash coincide (lowercase)? → no → rechazar
        G->>G: Crea/actualiza payment state='completed', remote_id=tx_hash
        G->>G: applyTransition(current($transitions)) → orden avanza
        G-->>S: HTTP 200 (void)
    end
```

---

## 6. Expiración y cleanup

```mermaid
sequenceDiagram
    autonumber
    participant T as scheduleExpirationTimer (Sidecar)
    participant S as Sidecar maps
    participant G as PaymentGateway (onNotify)
    participant D as PaymentPageController

    Note over T: delay = expires_at - Date.now()
    T->>T: ¿delay ≤ 0? → expiración restaurada (DB)
    T->>G: POST notify_url {order_id, event: 'expired'}
    G-->>T: {status: 'canceled' | 'ignored'}

    T->>S: addressNetworkMap.delete(addr)
    T->>S: addressOrderMap.delete(addr)
    T->>S: deletePending(addr) (SQLite)
    T->>S: cleanupEmptySubscriptions()
    S->>S: ¿quedan addresses en esa rpc_url+token? → no
    S->>S: close WS con intentionalClose=true (no reconecta)
```

---

## 7. Switch de red (misma order, sin expirar)

```mermaid
flowchart TD
    A["POST /derive (nueva red para order X)"] --> B["deriveWallet(order_id) → addr"]
    B --> C["addressNetworkMap.get(addr) → oldInfo?"]
    C -->|"no existe (primera vez)"| D["registrar nueva red"]
    C -->|"existe"| E{"oldInfo.rpc_url ≠ rpc_url<br/>O token ≠ token?"}
    E -->|"misma red y token"| D["sobrescribir info (sin cleanup)<br/>timer sigue igual"]
    E -->|"switch real"| F["log: switching net from A to B"]
    F --> G["addressNetworkMap.delete(addr)"]
    G --> H["deletePending(addr) (SQLite)"]
    G --> I["cancelExpirationTimer(addr)<br/>(evita closure con red vieja)"]
    G --> J["cleanupEmptySubscriptions()<br/>cierra WS de red vieja si quedó vacía"]
    D --> K["addressNetworkMap.set(addr, info_nuevo)"]
    K --> L["savePending(addr, info_nuevo)"]
    L --> M["scheduleExpirationTimer(addr, info_nuevo)"]
    M --> N["ensureNetworkSubscription(nueva red)"]
```

---

## 8. Estado del sidecar (state maps + persistencia)

```mermaid
flowchart LR
    subgraph Memoria["Maps en memoria (module-scope)"]
        AOM["addressOrderMap<br/>addr → order_id"]
        ANM["addressNetworkMap<br/>addr → {order_id, rpc_url, token_address,<br/>token_symbol, expected_amount, expires_at}"]
        SUB["subscriptions<br/>netKey → {name, provider, contract,<br/>rpc_url, token_address, subState}"]
        ET["expirationTimers<br/>addr → setTimeout"]
        RR["reconnectRetries<br/>netKey → contador"]
    end

    subgraph Disco["Persistencia SQLite (sql.js)"]
        SQL[("pending.db<br/>address PK, order_id, rpc_url,<br/>token_address, token_symbol,<br/>expected_amount, expires_at")]
    end

    API["POST /derive"] --> ANM
    API --> AOM
    API --> SQL
    API --> ET
    API --> SUB

    MON["monitor WS/polling"] --> ANM
    MON --> SUB

    ANM -->|"restore en initDb()"| SQL
    SQL -->|"restore a maps + re-suscribir"| ANM
```

---

## 9. Startup del sidecar

```mermaid
sequenceDiagram
    autonumber
    participant I as index.js (start)
    participant DB as SQLite
    participant D as Drupal (/stablepay/payment/config)
    participant S as Sidecar maps/WS

    I->>DB: initDb() → restaura orders pendientes no expiradas
    Note over I,DB: expiradas se borran de DB
    I->>I: ¿STABLEPAY_MASTER_XPUB seteada? → no → error y sale
    loop hasta 5 veces (3s de sleep)
        I->>D: GET /stablepay/payment/config (header Host)
        D-->>I: {mode, notify_url, networks[]}
    end
    I->>I: notifyUrl = config.notify_url
    I->>I: networkConfig = config.networks
    loop para cada addr restaurada
        I->>S: ensureNetworkSubscription(rpc_url, token_address)
    end
    I->>I: checkPollFallback() → polling si no hay WS
    I->>I: app.listen(PORT) → log "sidecar listening"
```

---

## 10. Tabla de endpoints

### Rutas Drupal (commerce_stablepay.routing.yml)

| Route | Path | Controller::method | Requisito | Propósito |
|---|---|---|---|---|
| `payment_page` | `/stablepay/payment/{order}` | `PaymentPageController::build` | `access checkout` + custom access | Render de la página de pago |
| `status` | `/stablepay/payment/status/{order}` | `PaymentPageController::status` | `access checkout` | Polling JS (3s): estado order + balance on-chain + auto-confirm |
| `config` | `/stablepay/payment/config` | `PaymentPageController::gatewayConfig` | público (`TRUE`) | Sidecar obtiene networks/notify_url al arrancar |
| `derive` | `/stablepay/payment/derive-address/{order}` | `PaymentPageController::deriveAddress` | `access checkout` | Registra monitoreo de red+token en sidecar |
| `gas_price` | `/stablepay/payment/gas-price` | `PaymentPageController::gasPrice` | público (`TRUE`) | Precio USD del token nativo por red (CoinGecko, cache 5min por `coin`) para el fee estimado |
| `gas_estimate` | `/stablepay/payment/gas-estimate` | `PaymentPageController::gasEstimate` | público (`TRUE`) | Proxy: JS → Drupal → sidecar `/gas-estimate` |

### Endpoints Sidecar (Express, puerto 3001)

| Método | Ruta | Params | Respuesta |
|---|---|---|---|
| `POST` | `/derive` | `{order_id, rpc_url?, token_address?, token_symbol?, expected_amount?, expiration_minutes?}` | `{address}` |
| `GET` | `/balance/:orderId` | query `rpc_url, token_address, token_symbol?, expected_amount?` | `{balance, expected, token_symbol, found}` |
| `GET` | `/get-tx/:orderId` | query `rpc_url, token_address` | `{tx_hash, address}` |
| `GET` | `/gas-estimate` | query `rpc_url, token_address, to?, amount?, decimals?` | `{gas_limit, gas_price, cost_native, cost_wei}` |
| `POST` | `/webhook` | `{order_id, tx_hash, amount, currency}` | `{status: 'ok'}` (testing) |
| `GET` | `/health` | — | `{status, xpub, ws, polling, subscriptions, addresses, networks}` |

### Webhook de notificación

| Método | URL | Origen |
|---|---|---|
| `POST` | `/payment/notify/{gateway}` (commerce_payment.notify) | Sidecar (`getNotifyUrl()`) con header `X-Webhook-Secret` |

---

## 11. Redes soportadas

| Red | chainId | Token | Contract address | RPC default | Gating |
|---|---|---|---|---|---|
| Test (Anvil) | 31337 | configurable | `getTestTokenAddress()` | `http://host.docker.internal:8545` | `mode = test` |
| StableChain | 988 | USDT | `0x779Ded0c9e1022225f8E0630b35a9b54bE713736` | `https://rpc.stable.xyz` | `mode = live` |
| Celo | 42220 | USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | `https://forno.celo.org` | `mode = live` |
| Celo | 42220 | USDT | `0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e` | `https://forno.celo.org` | `mode = live` |
| Arbitrum | 42161 | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `https://arbitrum.drpc.org` | `mode = live` |
| Arbitrum | 42161 | USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | `https://arbitrum.drpc.org` | `mode = live` |
| Polygon | 137 | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | `https://polygon-rpc.com` | `mode = live` |
| Polygon | 137 | USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | `https://polygon-rpc.com` | `mode = live` |
| Ethereum | 1 | USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `https://ethereum.drpc.org` | `mode = live` |
| Ethereum | 1 | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `https://ethereum.drpc.org` | `mode = live` |

> Nota: los RPC default de Polygon/Arbitrum/Ethereum pueden requerir un endpoint con API key. El sidecar solo carga `networkConfig` al arrancar (`/config`) — **cambios en la UI del gateway requieren reiniciar el sidecar**.

---

## 12. Configuración clave

| Clave | Default | Descripción |
|---|---|---|
| `mode` | `test` | Test (Anvil) o Live (redes reales) |
| `expiration_minutes` | `30` | Minutos antes de que expire la order |
| `confirmation_blocks` | `1` | Confirmaciones requeridas |
| `cancel_on_expire` | `FALSE` | Cancelar la order al expirar el pago |
| `fiat_currency` | `PYG` | Moneda fiat del store (para conversión a USD) |
| `sweep_address` | `''` | Address master para sweep (herramienta externa) |

### Variables de entorno del sidecar

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3001` | Puerto HTTP del sidecar |
| `DRUPAL_BASE_URL` | `http://nginx` | URL base de Drupal |
| `DRUPAL_HOST` | `store.localhost` | Header `Host` al llamar a Drupal |
| `STABLEPAY_MASTER_XPUB` | `''` | XPUB de la HD wallet (watch-only) |
| `STABLEPAY_DB_PATH` | `./pending.db` | Ruta del SQLite de pendientes |
| `WEBHOOK_SECRET` | `''` | Secreto para `X-Webhook-Secret` |

---

## 13. Glosario

| Término | Significado |
|---|---|
| **XPUB** | Clave pública extendida de una HD wallet. Permite derivar direcciones sin conocer la clave privada (watch-only). |
| **HD wallet / BIP-44** | Wallet determinista jerárquica. Las direcciones se derivan de un índice. Aquí el índice = derivado del `order_id`. |
| **ERC-20 Transfer event** | Evento log de los tokens ERC-20 con topic `0xddf252ad...`. El sidecar lo escucha por WebSocket para detectar pagos. |
| **EIP-681** | Esquema de URI `ethereum:token@chainId/transfer?address=..&uint256=..` para QR de pago. |
| **eth_call** | RPC JSON para leer estado de un contrato (balanceOf, decimals) sin minar. |
| **eth_getLogs** | RPC JSON para leer logs históricos (usado para obtener txHash tras detectar balance). |
| **NeedsRedirectException** | Excepción de Drupal Commerce que redirige el checkout a otra URL (la página de pago). |
| **Polling fallback** | Si WebSocket no está disponible, el sidecar consulta `balanceOf` cada 15s. |
| **Cleanup per-red** | Cierre selectivo de WebSockets: solo se cierra el WS de una red cuando no quedan addresses vigiladas en esa `rpc_url`+`token_address`. |

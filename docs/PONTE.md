# Telecomando da internet: il ponte su Cloudflare

Il telecomando dal telefono funziona subito sulla stessa rete Wi-Fi. Per usarlo
anche da fuori (telefono in 4G, un'altra sede) IGOR passa da un piccolo "ponte"
gratuito su Cloudflare Workers: IGOR si collega in uscita, quindi non serve
aprire porte sul router né installare altri programmi sul computer della regia.
Il ponte si mette online una volta sola e serve a tutte le copie di IGOR.

## Mettere online il ponte (una volta sola)

1. Crea un account gratuito su https://dash.cloudflare.com/sign-up.
2. In Cloudflare apri **Workers & Pages** e scegli un sottodominio
   `workers.dev` (es. `igor`): l'indirizzo del ponte sarà
   `https://igor-relay.<sottodominio>.workers.dev`.
3. Copia l'**Account ID** (pagina Workers & Pages, colonna a destra).
4. Crea un token: **My Profile → API Tokens → Create Token → modello
   "Edit Cloudflare Workers"**, poi copia il token.
5. Su GitHub, nel repository: **Settings → Secrets and variables → Actions →
   New repository secret**, crea `CLOUDFLARE_API_TOKEN` (il token) e
   `CLOUDFLARE_ACCOUNT_ID` (l'Account ID).
6. Su GitHub apri **Actions → Relay → Run workflow**. Alla fine il ponte è online.

Il piano gratuito di Cloudflare basta per l'uso normale.

## Usarlo in IGOR

Icona del telefono nella barra in basso → **Attiva il telecomando** →
**Anche da internet** → incolla l'indirizzo del ponte. Quando il collegamento è
pronto compare un secondo QR code che funziona da qualsiasi rete.

## Sicurezza

- L'indirizzo contiene un codice segreto: chi non lo conosce non entra.
  **Nuovo codice** lo cambia e i vecchi link smettono di funzionare.
- Ogni IGOR ha anche una sua chiave privata: un altro computer non può
  prendere il posto della regia con lo stesso codice.
- Dal telefono passano solo i comandi del telecomando, controllati da IGOR.

---

# Phone remote from the internet: the Cloudflare relay

On the same Wi-Fi the phone remote works right away. To use it from elsewhere
(phone on 4G, another venue) IGOR goes through a small free relay on Cloudflare
Workers: IGOR connects out, so no router ports and no extra software. Put the
relay online once (steps above: free Cloudflare account, workers.dev subdomain,
Account ID, "Edit Cloudflare Workers" API token, repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then Actions → Relay → Run
workflow). In IGOR: phone icon → Enable the remote → Also from the internet →
paste the relay address.

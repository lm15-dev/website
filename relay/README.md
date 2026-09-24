# The playground relay

A Cloudflare Worker (`worker.js`, ~90 lines) that forwards a browser's
request to a provider API that refuses browser origins, and adds the
CORS headers that API withholds. Today that is TypeSafe (`api.typesafe.ai`
answers `Disallowed CORS origin` to `https://lm15.dev`, checked
2026-09-17 and 2026-09-18).

## What it is, honestly

- The user's provider key and prompt pass through a server we control.
  Every other provider in the playground is called directly from the page
  and no key ever leaves the browser except to that provider; the relay is
  the exception, and the page says so before it is used (see
  `src/playground/relay.ts`: it is off until the user enables it for one
  provider, on one device).
- It keeps nothing: no log line is written by the code, and Cloudflare's
  Worker logs are disabled in `wrangler.toml`. Cloudflare still sees the
  traffic in transit, as any host would.
- It is not an open proxy: upstream hosts and page origins are allow-lists
  (`ALLOWED_UPSTREAMS`, `ALLOWED_ORIGINS`); loopback origins on any port
  are accepted for local development.

## Deploy

Automatic, from GitHub (`.github/workflows/relay.yml`), on every push
that touches `relay/`. One-time setup, by the account owner:

1. A Cloudflare account (free): https://dash.cloudflare.com/sign-up.
2. An API token from the "Edit Cloudflare Workers" template:
   https://dash.cloudflare.com/profile/api-tokens — and the account id
   (the dashboard's Workers page shows it).
3. `gh secret set CLOUDFLARE_API_TOKEN -R lm15-dev/website` and
   `gh secret set CLOUDFLARE_ACCOUNT_ID -R lm15-dev/website`.
4. `gh workflow run relay.yml -R lm15-dev/website`; the run log prints
   the address, `https://lm15-relay.<account>.workers.dev`.
5. Put that address in `RELAY_URL` (`src/playground/relay.ts`) and push.

By hand instead: `cd relay && npx wrangler login && npx wrangler deploy`.

Cloudflare's own edge logging is off for the Worker (`wrangler.toml`);
the free plan allows 100,000 requests a day. lm15.dev's DNS stays at
GoDaddy: a `relay.lm15.dev` name would need the zone moved to Cloudflare,
so the `workers.dev` address is used as is. To add a provider later, extend `ALLOWED_UPSTREAMS` in
`wrangler.toml` and redeploy; the page's `BROWSER_BLOCKED` list names the
providers the prompt is shown for.

## Test

```sh
node --test relay/worker.test.js
```

## Try relay changes before deploying them (the sign-in lab)

`relay/serve-local.mjs` runs `worker.js` on this machine with the allow-lists
from `wrangler.toml`. To use it from another of your machines (e.g. the laptop,
while the playground runs on lambda), publish both over Tailscale Serve. The
page must be HTTPS: sign-in needs Web Crypto, which browsers give only to
secure pages, and OpenRouter returns only to HTTPS or localhost.

```sh
node relay/serve-local.mjs --port 8787 --allow-origin https://lambda.tail69222b.ts.net:10443
LM15_DEV_RELAY_URL=https://lambda.tail69222b.ts.net:18787 npm run dev -- --port 4399 --allowed-hosts lambda.tail69222b.ts.net
tailscale serve --bg --https=10443 http://127.0.0.1:4399
tailscale serve --bg --https=18787 http://127.0.0.1:8787
```

Open `https://lambda.tail69222b.ts.net:10443/playground/`, then More → Open
the sign-in lab. `LM15_DEV_RELAY_URL` makes the lab use that relay; the relay
address field (shown only on private addresses) can change it. Undo with `tailscale serve --https=10443 off` and
`tailscale serve --https=18787 off`. Requests then leave from lambda, not from
Cloudflare; a provider that treats Cloudflare differently can answer
differently once deployed.

---
id: powerup-cloud-readme
title: PowerUp Cloud
type: project-readme
business: Power Up Sports and Wellness
created: 2026-10-30
updated: 2026-10-30
tags: [powerup-cloud, cloudflare, meal-prep, operations]
last_reviewed: 2026-10-30
source_basis: Owner-directed project scope in this session, workspace business reference, Cloudflare documentation, GitHub deployment run, and live endpoint checks
verification_status: Production Worker, D1, R2, custom domains, and first staff login deployed and checked on 2026-10-30
---

# PowerUp Cloud

PowerUp Cloud is the planned two-part management dashboard for Power Up Sports and Wellness. Its first module manages Power Up Grill meal prep orders. The second business module will use the same platform as its requirements are defined. The customer-facing Power Up website can later use this API for ordering; checkout and payment processing are outside the current scope.

## Domains

- [admin.powerupwv.com](https://admin.powerupwv.com/): live staff dashboard for the business management modules.
- `app.powerupwv.com`: reserved for a future customer-facing app.
- [api.powerupwv.com](https://api.powerupwv.com/health): live shared Worker API for the dashboards and future main-website integrations.
- [cdn.powerupwv.com](https://cdn.powerupwv.com/): live public R2 delivery domain for future assets such as menu photos. The bucket is currently empty.

The [production deploy action](https://github.com/Redshirt-Cloud/powerup-cloud/actions/runs/41127804805) completed on 2026-10-30. The [health endpoint](https://api.powerupwv.com/health) returned `200` with `{"status":"ok","database":"ok"}`; the [admin page](https://admin.powerupwv.com/) returned `200` over valid HTTPS; an unauthenticated staff endpoint returned `401`; and the initial staff login and authenticated session both returned `200`.

The Worker serves the staff dashboard as [static assets](https://developers.cloudflare.com/workers/static-assets/binding/) and the API. It binds `powerup-cloud-public` and `powerup-cloud-private` through the [R2 Workers API](https://developers.cloudflare.com/r2/get-started/workers-api/). The public bucket is connected to `cdn.powerupwv.com`; the private bucket has no public domain. Neither bucket is used by an upload endpoint yet. Files placed in the public bucket are reachable through the CDN domain, so private files belong only in the private bucket behind authenticated Worker routes. [Cloudflare R2 public bucket guidance](https://developers.cloudflare.com/r2/buckets/public-buckets/)

This repository is a new Cloudflare Worker and D1 application. The [original Kitchenasty project](https://github.com/mighty840/kitchenasty) remains a reference for features we may bring in selectively. The old fork's code has been removed from this repository.

## Current capabilities

- Staff login and a dashboard showing today's work and a five-week calendar.
- Manual order creation, editing, status updates, and payment tracking.
- Weekly and monthly subscriptions with editable future occurrences. The first date anchors the schedule; monthly dates at the end of a short month move to its last day. Subscription edits rebuild future orders still in `new` status. Orders already progressed keep their original details.
- Ingredients with serving size, calories, protein, carbs, fat, fiber, sugar, sodium, allergens, and notes.
- Individual products with ingredient quantities, plus combos containing products. Order items preserve prices and combo contents at order time.
- Order source tracking for staff, website, Facebook, phone, or other channels.
- Manual unpaid/paid/refunded state; no payment capture or customer checkout.
- GitHub pull request checks and deployment to Cloudflare on merge to `main`.

Staff routes accept the dashboard's secure session cookie or a secret bearer token for trusted service use. Do not put that token in the public website. A future customer order API needs separate authentication, abuse controls, and payment design.

## Local setup

Use Node 22 or newer.

```bash
npm ci
cp .dev.vars.example .dev.vars
# Replace both example secrets with separate random values of at least 32 characters.
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787`. Before the first login, create the initial staff user by calling `POST /api/v1/bootstrap/user` with the `STAFF_API_TOKEN` bearer credential and a JSON body containing `email`, `displayName`, and a password of at least 12 characters. This endpoint stops accepting users after the first account exists. Then sign in through the dashboard. Keep the setup token and `AUTH_PEPPER` out of frontend code and Git. `AUTH_PEPPER` must remain stable: changing it invalidates existing password hashes.

The checked-in D1 UUID is a local-development placeholder. The deployment job creates a separate ignored config containing the real UUID from a GitHub environment variable.

```bash
npm run check
curl http://localhost:8787/health
```

Staff routes are under `/api/v1/staff`. For example, the dashboard can create a product with `POST /api/v1/staff/products` using JSON `{"name":"Chicken bowl","priceCents":1299,"kind":"individual"}`. Create an order with `POST /api/v1/staff/orders` and:

```json
{
  "source": "phone",
  "customerName": "Example Customer",
  "customerPhone": "304-555-0100",
  "fulfillmentDate": "2026-11-06",
  "fulfillmentMethod": "pickup",
  "items": [{ "productId": "<created-product-id>", "quantity": 2 }]
}
```

Prices are read from products when the order is created and copied into order items. Product prices cannot be supplied by the caller. Kitchen dates use the `America/New_York` timezone.

## Deployment setup

1. Create a D1 database named `powerup-cloud` in the intended Cloudflare account and record its UUID.
2. Create a Cloudflare API token for the intended account with permission to create and edit this Worker, edit D1, and write zone Workers Routes so the workflow can deploy code, run migrations, and attach the two custom domains. [Cloudflare permissions guidance](https://developers.cloudflare.com/workers/authorization/)
3. Create R2 buckets `powerup-cloud-public` and `powerup-cloud-private`. Connect `cdn.powerupwv.com` to the public bucket only; leave the private bucket private.
4. Create a Worker named `powerup-cloud-api` in Cloudflare so its secrets can be set before the first code deployment. In its **Settings → Variables and Secrets**, add `STAFF_API_TOKEN` and `AUTH_PEPPER` as **Secret** values. Use separate random values of at least 32 characters, and keep the pepper safely recorded: changing it invalidates existing password hashes. [Cloudflare secret setup](https://developers.cloudflare.com/workers/configuration/secrets/)
5. Add GitHub `production` environment variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID`, and the environment secret `CLOUDFLARE_API_TOKEN` for CI authentication. The application secrets stay in Cloudflare and are preserved by later Wrangler deployments. [Cloudflare deployment behavior](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
6. Open a pull request from the feature branch. The `Check` workflow tests code and runs D1 migrations locally. Merging to `main` runs the `Deploy Worker` workflow, which applies migrations remotely before deploying the Worker, its dashboard assets, R2 bindings, and custom domains. Wrangler checks that both application secrets are already present.
7. Create the initial user through the bootstrap endpoint using the setup token, then sign in at `admin.powerupwv.com`.

The deployment workflow will fail safely if the database UUID, Cloudflare credentials, or Cloudflare-side application secrets are absent. Password hashing uses PBKDF2 at Cloudflare's [100,000-iteration runtime ceiling](https://github.com/cloudflare/workerd/issues/1346) plus a server-side secret; measure login CPU time in the target account, especially on the [Workers Free plan's 10 ms CPU limit](https://developers.cloudflare.com/workers/platform/limits/). Before handling real customer data, review data retention, backup, and staff access policies.

---
id: powerup-cloud-readme
title: PowerUp Cloud
type: project-readme
business: Power Up Sports and Wellness
created: 2026-10-30
updated: 2026-10-30
tags: [powerup-cloud, cloudflare, meal-prep, operations]
last_reviewed: 2026-10-30
source_basis: Owner-directed project scope in this session, workspace business reference, and Cloudflare R2 documentation
verification_status: Domain plan owner confirmed; local implementation verified; production deployment pending
---

# PowerUp Cloud

PowerUp Cloud is the planned two-part management dashboard for Power Up Sports and Wellness. Its first module manages Power Up Grill meal prep orders. The second business module will use the same platform as its requirements are defined. The customer-facing Power Up website can later use this API for ordering; checkout and payment processing are outside the current scope.

## Planned domains

- `admin.powerupwv.com`: staff dashboard for the business management modules.
- `app.powerupwv.com`: reserved for a future customer-facing app.
- `api.powerupwv.com`: shared Worker API for the dashboards and main Power Up website.
- `cdn.powerupwv.com`: public assets stored in an R2 bucket, such as menu photos.

The Worker in this repository currently serves only an API; none of these custom domains are configured yet. The Worker will use an [R2 bucket binding](https://developers.cloudflare.com/r2/get-started/workers-api/) for object writes and any private reads. Cloudflare can connect an R2 bucket directly to [`cdn.powerupwv.com` as a custom domain](https://developers.cloudflare.com/r2/buckets/public-buckets/) for public reads and caching. The domain is the delivery address; the bucket remains the storage. Private files should stay in a separate private bucket and be served through authenticated Worker routes, since a public R2 custom domain makes stored objects reachable by anyone with their URLs. [Cloudflare R2 public bucket guidance](https://developers.cloudflare.com/r2/buckets/public-buckets/)

R2 is not bound to the Worker yet; adding a binding before the bucket exists would block the current deployment workflow.

This repository is a new Cloudflare Worker and D1 application. The [original Kitchenasty project](https://github.com/mighty840/kitchenasty) remains a reference for features we may bring in selectively. The old fork's code has been removed from this branch.

## Current capabilities

- D1 schema for products, orders, and order item price snapshots.
- Staff API to create and list products and orders.
- Order source tracking for staff, website, Facebook, phone, or other channels.
- Unpaid order state; no payment capture or customer checkout.
- GitHub pull request checks and deployment to Cloudflare on merge to `main`.

All staff endpoints require a secret bearer token and are intended for server-side or trusted staff use. Do not put that token in the public website. A future customer order API needs its own authentication, abuse controls, and payment design.

## Local setup

Use Node 22 or newer.

```bash
npm ci
cp .dev.vars.example .dev.vars
# Replace the example STAFF_API_TOKEN with a random value of at least 32 characters.
npm run db:migrate:local
npm run dev
```

The checked-in D1 UUID is a local-development placeholder. The deployment job creates a separate ignored config containing the real UUID from a GitHub secret.

```bash
npm run check
curl http://localhost:8787/health
```

Staff routes are under `/api/v1/staff`. For example, create a product with `POST /api/v1/staff/products` using `Authorization: Bearer <STAFF_API_TOKEN>` and JSON `{"name":"Chicken bowl","priceCents":1299}`. Create an order with `POST /api/v1/staff/orders` and:

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

Prices are read from products when the order is created and copied into order items. Product prices cannot be supplied by the caller.

## Deployment setup

1. Create a D1 database named `powerup-cloud` in the intended Cloudflare account and record its UUID.
2. Create a Cloudflare API token with permission to deploy Workers and edit D1 databases for that account.
3. Add GitHub repository or `production` environment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_D1_DATABASE_ID`.
4. Set a Worker secret named `STAFF_API_TOKEN` with at least 32 random characters, using `wrangler secret put STAFF_API_TOKEN` against the production Worker. Keep it out of GitHub Actions and public frontend code.
5. Open a pull request from the feature branch. The `Check` workflow tests code and runs the D1 migration locally. Merging to `main` runs the `Deploy Worker` workflow, which applies migrations remotely before deploying the Worker.

The deployment workflow will fail safely if the database UUID or Cloudflare credentials are absent. Before production use, map the intended API domain, establish staff identity management, and review data retention and access requirements. The initial token is a temporary staff API gate for the backend prototype.

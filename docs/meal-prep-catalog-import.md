---
id: powerup-meal-prep-catalog-import-2026-10-30
title: Meal Prep Tech catalog import
type: import-record
business: Power Up Sports and Wellness
created: 2026-10-30
updated: 2026-10-30
tags: [meal-prep, catalog, import, powerup-cloud]
last_reviewed: 2026-10-30
source_basis: Owner-provided Meal Prep Tech product CSV and product-category screenshot in the PowerUp Cloud session; GitHub deployment and authenticated live API checks
verification_status: Production import verified on 2026-10-30 with 68 products, 55 weekly offerings, and 10 ordered categories; current menu prices not independently confirmed
---

# Meal Prep Tech catalog import

The owner provided a 77-row Meal Prep Tech product export and a screenshot listing the product-category order. The one-time [catalog migration](../migrations/0004_meal_prep_catalog.sql) adds ten categories in that order and 68 priced products. It preserves each exported one-time price and the presence and price of a weekly offering. The export did not state when its prices were last confirmed, so staff should review them before using them for live sales.

The [production deployment](https://github.com/Redshirt-Cloud/powerup-cloud/actions/runs/41132883188) applied the migration on 2026-10-30. An authenticated read of the live [catalog API](https://admin.powerupwv.com/api/v1/staff/products) returned 68 products, including 55 with weekly prices; the [categories API](https://admin.powerupwv.com/api/v1/staff/categories) returned all ten categories in the screenshot's order.

The import omits eight zero-price, one-ounce protein helper rows and the zero-price `TEMP Sauce Variation Base Product`. These appear to support options or variations in the old system; they are not treated as sellable catalog entries. `Organic Mustard` and `Yum Yum`, listed after those helpers in the export, are placed in Sauces based on their names and the screenshot's category list.

The export joins product names to short, often truncated description snippets. The migration uses clean product names from the export and leaves descriptions empty. It does not infer ingredients, nutrition, portions, or allergens.

The six exported items in the Combos category have configurable protein and side choices, but the CSV provides no option structure. They are imported as selectable individual records within the Combos category. Their components should be modeled after the owner confirms the protein and side options; until then, the kitchen can record the selection in order notes. The weekly price field records the export's offering and does not change the MVP's recurring-order pricing logic, which currently uses the one-time product price.

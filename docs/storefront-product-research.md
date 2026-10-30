---
id: powerup-storefront-product-research-2026-10-30
title: Power Up Grill storefront product research
type: research-and-import-record
business: Power Up Sports and Wellness
created: 2026-10-30
updated: 2026-10-30
tags: [powerup-cloud, meal-prep, storefront, product-variations, nutrition, images]
last_reviewed: 2026-10-30
source_basis: Public Power Up Grill ordering page and its browser-facing product feed; owner-provided Meal Prep Tech product screenshots and CSV
verification_status: Public storefront snapshot, local Worker behavior, production product API, variation groups, and CDN image checked on 2026-10-30
---

# Power Up Grill storefront product research

The [public ordering page](https://order.powerupsportsandwellness.com/order/) loads product data through a browser-facing Meal Prep Tech feed. On October 30, 2026, that feed returned 57 products. All 57 match names in the owner-provided 68-product CSV; their one-time and weekly prices match the CSV. Eleven CSV products did not appear in the storefront feed: nine sauces, EFX Karbolyn, and Life Extension Super Ubiquinol. Absence from this feed does not establish that those products are inactive in the back office. [Original import mapping](meal-prep-catalog-import.md)

The feed provided descriptions and SKUs where present, 58 photos across those products, and nutrition labels for eight products. The [storefront snapshot migration](../migrations/0006_storefront_product_snapshot.sql) fills only empty descriptions and adds these fields to matching catalog records. The images were copied from the storefront's signed, time-limited Azure URLs to the PowerUp public R2 bucket under `products/<product-id>/`. The public CDN now serves them from `cdn.powerupwv.com`. Nutrition values are website-reported labels; the source does not establish laboratory verification or whether a label includes selected options.

After [deployment run 41137539124](https://github.com/Redshirt-Cloud/powerup-cloud/actions/runs/41137539124) completed on October 30, 2026, the authenticated production API returned 68 products, 57 with a CDN photo, and 15 option groups. The Atlantic Salmon Combo returned six groups, one photo, and a nutrition label; its [CDN image](https://cdn.powerupwv.com/products/1146ffce-39ea-522c-8d72-9940b6627859/0.jpg) returned HTTP 200 with a JPEG content type. These checks establish availability of the imported data, not the accuracy of source nutrition claims.

## Variation model

The six combo products each expose the same six named variation groups: Protein Portion, Side 1, Side 2, Add More Carbs!, Add More Veggies!, and Add Sauce. The source reuses group IDs across products, while some available options and prices differ by product. For example, the 6 oz protein upcharge ranges from $3.00 to $5.50 across the six combos. Side 2 choices add $1.75; optional extra carbs add $1.99; optional extra vegetables add $2.50; and combo sauce additions vary by sauce. The imported feed as a whole contains 15 shared group IDs, 92 distinct group/label choices, and 573 product-specific option assignments. [Source storefront](https://order.powerupsportsandwellness.com/order/)

PowerUp Cloud stores groups and their base choices once, then stores each product's enabled choices, default selection, limits, and price overrides. An order snapshots its selected labels and option prices so later catalog edits cannot rewrite the historical order. A subscription retains its choices for future occurrences. The source feed models every observed group as a single-choice drop-down; the PowerUp model also permits multiple-choice groups for future products.

The owner-provided product screenshots show additional publication, tax, shipping, tags, backup product, preorder, and image fields. These are retained as product settings. The screenshots do not show actual values for most of those fields, so the import does not infer them. Combo nutrition and images were imported only where exposed by the storefront feed. Review product-level nutrition and all operational settings before publishing them to a future customer checkout.

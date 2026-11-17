# Money

Two projects:

1. **[PileQuote](pilequote/README.md)**: a $49/month web app for junk removal companies. Their customers snap a photo and get an instant price from the hauler's own rates. Includes the [call script](pilequote/CALL-SCRIPT.md) for selling it and a `render.yaml` for putting it online.
2. **Etsy spreadsheet shop** (below).

## Etsy spreadsheet shop

Two finished digital products, plus listing images and copy for selling them on Etsy.

- **Start here: [LAUNCH.md](LAUNCH.md)** covers why this beat dropshipping, the $150 budget and the steps to go live
- **Listing copy:** [listings/etsy-listings.md](listings/etsy-listings.md)
- **Files to sell:** `dist/` (blank + sample versions of each product)
- **Listing images:** `images/budget-planner`, `images/christmas-tracker`, `images/bundle`

## Rebuild

```bash
python3 src/build_budget_planner.py dist
python3 src/build_christmas_tracker.py dist
# recalc formulas (LibreOffice) so values show in all apps, then:
NODE_PATH=$(npm root -g) python3 src/make_images.py
```

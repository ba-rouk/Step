# Step Town — Catering, Barbecue & Wedding Cakes

A responsive, single-page website for Step Town Catering and Wedding Cakes in Rwanda. The project is plain HTML, CSS and JavaScript, so it has no package installation or build step and can be published directly by Netlify.

## Run locally

Open `index.html` in a browser, or run a small static server from the repository root:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy with Netlify

The repository includes `netlify.toml`. Connect the GitHub repository `ba-rouk/Step` to Netlify and use:

- **Build command:** leave blank
- **Publish directory:** `.`
- **Production branch:** `main`

After Git-based continuous deployment is connected, pushes to the production branch can trigger new deployments automatically. The `.netlify` folder is ignored by Git.

## Business details included

- Business name: Step Town Catering and Wedding Cakes
- Publicly listed location: Runda, Rwanda
- Publicly listed contact: +250 780 382 589
- WhatsApp enquiry link: `https://wa.me/250780382589`
- Map search: Step Town Catering and Wedding Cakes, Runda, Rwanda

The contact number and Runda listing were taken from the public business listing supplied during the project research. Confirm the exact street address, opening hours, service radius, and any additional branches with the business before publishing those details.

## Enquiry flow

The enquiry form does not store personal information or send it to a server. It validates the required fields and opens WhatsApp with a pre-filled message to the listed business number.

## Photography

The Instagram share link supplied for this project did not expose an Instagram profile or post, so this first version uses illustrative Unsplash photographs instead of claiming that stock images are Step Town's work. Replace these images with the business's original photos before presenting the gallery as a portfolio.

Current image sources (free to use under the Unsplash License; see each photo page for the photographer and license):

- Barbecue image: [Grilled meat platter — Ahmad](https://unsplash.com/photos/grilled-meat-platter-RbI-U-WRuLw)
- Barbecue / plated food image: [Grilled meat platter with salad and peppers — Gang Hao](https://unsplash.com/photos/grilled-meat-platter-with-salad-and-peppers-gM5Bdzp7LhY)
- Wedding cake image: [White wedding cake with fresh strawberries and flowers — Mads Eneqvist](https://unsplash.com/photos/a-white-wedding-cake-with-fresh-strawberries-and-flowers-Xb5c2x6wJPc)
- Buffet image: [People serving food from chafing dishes — Panashe Tarusenga](https://unsplash.com/photos/people-serving-food-from-chafing-dishes-at-a-buffet-gVyFFZo18ts)

## Before launch

1. Replace the illustrative gallery photos with Step Town's own licensed images.
2. Confirm the exact map pin / address and whether there are multiple branches.
3. Confirm the preferred Instagram profile URL, menu, package details, and opening hours.
4. Test WhatsApp on a phone and verify that the business number is correct.
5. Add the final custom domain to the Open Graph metadata and create a sitemap once the domain is known.

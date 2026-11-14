# Tabular Recipe Maker

A browser-only recipe editor that turns recipes into editable tables.

## Development

From the repository root (`RecipeApp`), run `cd recipe-app`, then
`pnpm install` and `pnpm dev`.
Run `node --test tests/*.test.mjs` to check recipe importing, editing, and exports.

## GitHub Pages on a custom subdomain

`pnpm build` generates the static site in `out/`. No application server is needed.
The repository-root `.github/workflows/deploy-pages.yml` builds from `recipe-app/`
and deploys `recipe-app/out/` on pushes to `master` or `main`. It can also be run
manually.

1. Push the `RecipeApp` repository, including its root `.github/` directory and
   the `recipe-app/` source directory, to GitHub.
2. Under Settings > Pages, select **GitHub Actions** as the build source.
3. Set the Pages custom domain to your chosen subdomain, such as `recipes.example.com`.
4. At your DNS provider, add a CNAME record for `recipes` pointing to
   `<github-username>.github.io` (without a repository path).
5. After GitHub verifies DNS and provisions the certificate, enable Enforce HTTPS.

The app is configured to serve from `/` on its custom subdomain. Your existing
base-domain site can stay in its own repository. The default GitHub project URL
(`/repository-name/`) would need a Next.js `basePath` configuration instead.

Recipe text is parsed locally. Link imports fetch directly from the recipe website;
sites that block browser requests require copying the recipe into the Text tab.
See [IMPORTING.md](IMPORTING.md) for details.

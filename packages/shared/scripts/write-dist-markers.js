// Writes the small per-directory package.json markers Node's module
// resolution algorithm needs to tell dist/cjs's .js files apart from
// dist/esm's: a directory with no package.json of its own inherits the
// nearest ancestor's "type" field, so without these, every .js file in
// this package (both builds) would be parsed as whatever the package
// root's package.json says — wrong for whichever build that isn't.
// Regenerated on every build since dist/ is gitignored and rebuilt from
// scratch (see tsconfig.cjs.json / tsconfig.esm.json's outDir).
const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(__dirname, "..", "dist");

function writeMarker(subdir, type) {
  const dir = path.join(distDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type }, null, 2) + "\n");
}

writeMarker("cjs", "commonjs");
writeMarker("esm", "module");

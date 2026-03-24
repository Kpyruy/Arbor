import fs from "fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = fs.existsSync("versions.json")
  ? JSON.parse(fs.readFileSync("versions.json", "utf8"))
  : {};

manifest.version = packageJson.version;
versions[packageJson.version] = manifest.minAppVersion;

fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

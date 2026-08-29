import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = pkg.version;

console.log(`Syncing NucleoPin version to ${version}...`);

// Update Tauri config
const tauriPath = "src-tauri/tauri.conf.json";
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));

tauri.version = version;

fs.writeFileSync(
  tauriPath,
  JSON.stringify(tauri, null, 2) + "\n"
);

// Update Cargo.toml package version
const cargoPath = "src-tauri/Cargo.toml";
let cargo = fs.readFileSync(cargoPath, "utf8");

cargo = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`
);

fs.writeFileSync(cargoPath, cargo);

console.log(`NucleoPin version synced: ${version}`);
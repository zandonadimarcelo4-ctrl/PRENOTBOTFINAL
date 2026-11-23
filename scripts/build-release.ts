import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR, DEFAULT_CONFIG } from "../server/core.ts";
import {
  buildChromiumInitialBookmarks,
  buildChromiumInitialPreferences,
  buildChromiumLauncherScript,
  buildChromiumPolicyJson,
} from "../server/chromiumBridge.ts";
import {
  RELEASE_DIR,
  RELEASE_ZIP_PATH,
  buildPortableStartScripts,
  createPortableReleaseZip,
} from "../server/releaseBuilder.ts";

function runLocalBin(binName: string, args: string[]) {
  const binPath = path.join(BASE_DIR, "node_modules", ".bin", binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Binário não encontrado: ${binPath}. Execute npm install.`);
  }
  execFileSync(binPath, args, { cwd: BASE_DIR, stdio: "inherit" });
}

console.log("[1/4] Compilando frontend (Vite build -> dist/)...");
runLocalBin("vite", ["build"]);

console.log("[2/4] Empacotando servidor Node standalone (esbuild -> dist-server/server.mjs)...");
fs.mkdirSync(path.join(BASE_DIR, "dist-server"), { recursive: true });
runLocalBin("esbuild", [
  "server.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:vite",
  '--banner:js=import { createRequire as __pbCR } from "node:module"; const require = __pbCR(import.meta.url);',
  "--outfile=dist-server/server.mjs",
]);

console.log("[3/4] Atualizando inicializadores raiz (INICIAR-AQUI.bat / iniciar-aqui.sh)...");
const sid = DEFAULT_CONFIG.servicos[0] ?? 5402;
const startScripts = buildPortableStartScripts(sid, DEFAULT_CONFIG.chromium);
fs.writeFileSync(path.join(BASE_DIR, "INICIAR-AQUI.bat"), startScripts.bat, "utf-8");
fs.writeFileSync(path.join(BASE_DIR, "iniciar-aqui.sh"), startScripts.sh, {
  encoding: "utf-8",
  mode: 0o755,
});

// Também deixa os auxiliares do Chromium atualizados para quem baixar o código-fonte do repo
fs.writeFileSync(
  path.join(BASE_DIR, "iniciar-prenotabot-chromium.bat"),
  buildChromiumLauncherScript("win", sid, DEFAULT_CONFIG.chromium),
  "utf-8"
);
fs.writeFileSync(
  path.join(BASE_DIR, "iniciar-prenotabot-chromium.sh"),
  buildChromiumLauncherScript("linux", sid, DEFAULT_CONFIG.chromium),
  { encoding: "utf-8", mode: 0o755 }
);
fs.mkdirSync(path.join(BASE_DIR, "chromium_seed"), { recursive: true });
fs.writeFileSync(
  path.join(BASE_DIR, "chromium_seed", "Preferences"),
  buildChromiumInitialPreferences(sid, DEFAULT_CONFIG.chromium),
  "utf-8"
);
fs.writeFileSync(
  path.join(BASE_DIR, "chromium_seed", "Bookmarks"),
  buildChromiumInitialBookmarks(sid, DEFAULT_CONFIG.chromium),
  "utf-8"
);
fs.mkdirSync(path.join(BASE_DIR, "chromium_politica"), { recursive: true });
fs.writeFileSync(
  path.join(BASE_DIR, "chromium_politica", "policies.json"),
  buildChromiumPolicyJson(sid, DEFAULT_CONFIG.chromium),
  "utf-8"
);

console.log("[4/4] Gerando ZIP portátil pré-instalado em release/PrenotaBot-Livre-Portatil.zip...");
fs.mkdirSync(RELEASE_DIR, { recursive: true });
const zipBuf = createPortableReleaseZip(DEFAULT_CONFIG, {
  sanitizeForPublicRelease: true,
});
fs.writeFileSync(RELEASE_ZIP_PATH, zipBuf);

const sizeMb = (zipBuf.length / (1024 * 1024)).toFixed(2);
console.log(`Release pronto: ${RELEASE_ZIP_PATH} (${sizeMb} MB)`);

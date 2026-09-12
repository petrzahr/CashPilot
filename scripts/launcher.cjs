const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

function isPortAvailable(port) {
  return new Promise((resolve) => {
    // 1. Zkusíme navázat spojení na localhost:port
    const socket = net.createConnection({ port, host: 'localhost' });
    socket.setTimeout(400);

    socket.once('connect', () => {
      // Úspěšně připojeno -> port je již obsazen
      socket.destroy();
      resolve(false);
    });

    const onErrorOrTimeout = () => {
      socket.destroy();
      // 2. Nepodařilo se připojit, zkusíme port obsadit serverem
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      try {
        server.listen(port);
      } catch {
        resolve(false);
      }
    };

    socket.once('timeout', onErrorOrTimeout);
    socket.once('error', onErrorOrTimeout);
  });
}

async function getAvailablePort(startPort = 3000) {
  let port = startPort;
  const isDefaultFree = await isPortAvailable(port);
  if (isDefaultFree) {
    console.log(`[INFO] Port ${port} je volný.`);
    return port;
  }

  console.log(`[UPOZORNĚNÍ] Výchozí port ${port} je již obsazen jinou aplikací.`);
  console.log('[INFO] Vyhledávám nejbližší volný alternativní port...');
  port++;
  while (port < 3100) {
    if (await isPortAvailable(port)) {
      console.log(`[INFO] Vybrán dostupný port: ${port}`);
      return port;
    }
    port++;
  }
  throw new Error('Nepodařilo se nalézt žádný volný port v rozsahu 3000-3100.');
}

function waitForServer(port, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          clearInterval(interval);
          resolve();
        }
      });

      req.on('error', () => {
        // Server dosud neodpovídá, čekáme dál
      });

      req.setTimeout(800, () => {
        req.destroy();
      });

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Časový limit pro spuštění serveru (${timeoutMs / 1000} s) vypršel.`));
      }
    }, 250);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`[UPOZORNĚNÍ] Nepodařilo se automaticky otevřít prohlížeč: ${err.message}`);
      console.log(`Otevřete prosím ručně adresu: ${url}`);
    }
  });
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

  if (!fs.existsSync(viteBin)) {
    throw new Error('Vite nebyl nalezen v node_modules. Spusťte nejprve npm install.');
  }

  const port = await getAvailablePort(3000);
  const appUrl = `http://localhost:${port}/`;

  console.log(`[INFO] Spouštím aplikační server Vite na portu ${port}...`);

  const viteProcess = spawn(process.execPath, [viteBin, '--port', port.toString(), '--strictPort'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  let isTerminating = false;
  const cleanup = () => {
    if (isTerminating) return;
    isTerminating = true;
    if (viteProcess && !viteProcess.killed) {
      if (process.platform === 'win32') {
        try {
          exec(`taskkill /pid ${viteProcess.pid} /T /F`);
        } catch {
          viteProcess.kill('SIGTERM');
        }
      } else {
        viteProcess.kill('SIGTERM');
      }
    }
  };

  process.on('SIGINT', () => {
    console.log('\n[INFO] Ukončuji server CashPilot...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.on('exit', () => {
    cleanup();
  });

  viteProcess.on('error', (err) => {
    console.error(`[CHYBA] Selhalo spuštění serveru: ${err.message}`);
    process.exit(1);
  });

  viteProcess.on('exit', (code) => {
    if (!isTerminating && code !== 0) {
      console.error(`[CHYBA] Server byl ukončen s kódem ${code}.`);
      process.exit(code || 1);
    }
  });

  console.log(`[INFO] Čekám na odezvu serveru...`);
  try {
    await waitForServer(port);
    console.log(`[INFO] Server je připraven a odpovídá (HTTP 200 OK).`);
    console.log(`[INFO] Otevírám aplikaci ve výchozím prohlížeči: ${appUrl}`);
    openBrowser(appUrl);

    console.log('\n======================================================================');
    console.log('  CashPilot – Správa osobního rozpočtu a 12měsíční forecast');
    console.log('======================================================================');
    console.log(`  Stav:        Běží (aktivní)`);
    console.log(`  Adresa:      ${appUrl}`);
    console.log(`  Prohlížeč:   Automaticky otevřen`);
    console.log('');
    console.log('  [TIPY]');
    console.log('  • Data se automaticky ukládají do lokálního úložiště vašeho prohlížeče.');
    console.log('  • V sekci Nastavení můžete kdykoliv exportovat zálohu do JSON souboru.');
    console.log('');
    console.log('  [UKONČENÍ]');
    console.log('  Pro ukončení aplikace stiskněte klávesovou zkratku Ctrl + C');
    console.log('  nebo jednoduše zavřete toto okno.');
    console.log('======================================================================\n');
  } catch (err) {
    console.error(`\n[CHYBA] ${err.message}`);
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n[CHYBA] ${err.message}`);
  process.exit(1);
});

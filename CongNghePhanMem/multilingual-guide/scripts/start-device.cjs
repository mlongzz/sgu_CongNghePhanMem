/* global __dirname */
// One local Expo server for Web and physical Android/iOS; no adb or cloud tunnel.
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');

function selectLanAddress(interfaces, override) {
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses ?? []).filter(address => address.family === 'IPv4' && !address.internal &&
      !address.address.startsWith('169.254.') &&
      !/vmware|virtual|vbox|docker|wsl|hyper-v|tailscale|vpn|loopback|\btun\b|\btap\b/i.test(name))
      .map(address => ({ name, address: address.address,
        score: /wi-?fi|wireless|wlan|^wl|^en0$/i.test(name) ? 2 : 1 })));
  if (override) {
    const found = candidates.find(candidate => candidate.address === override);
    if (net.isIP(override) !== 4 || !found) throw new Error('GUIDE_LAN_IP phải là IPv4 của card mạng đang kết nối trên máy tính.');
    return found;
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new Error('Chưa tìm thấy IPv4 LAN. Kết nối Wi-Fi trước khi chạy lại.');
  if (candidates.length > 1 && candidates[0].score === candidates[1].score)
    throw new Error('Có nhiều card mạng phù hợp. Đặt GUIDE_LAN_IP bằng IPv4 của mạng dùng chung với điện thoại.');
  return candidates[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => /^(--tunnel|--localhost|--host|--android|--ios|--dev-client)(=|$)/.test(arg)))
    throw new Error('Lệnh này dùng LAN và Expo Go. Quét QR trên điện thoại; không cần --android hoặc --ios.');
  const selected = selectLanAddress(os.networkInterfaces(), process.env.GUIDE_LAN_IP);
  const portIndex = args.indexOf('--port');
  const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8081;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Cổng Expo không hợp lệ.');
  const expoVersion = require('expo/package.json').version;
  const apiUrl = `http://${selected.address}:8000`;
  const info = { interface: selected.name, lanIp: selected.address, expoVersion,
    expoGoSdk: expoVersion.split('.')[0], apiUrl, webUrl: `http://localhost:${port}`,
    phoneWebUrl: `http://${selected.address}:${port}`, expoGoUrl: `exp://${selected.address}:${port}` };
  if (args.includes('--check')) {
    try { info.backendReachable = (await fetch(`${apiUrl}/health/live`, { signal: AbortSignal.timeout(3000) })).ok; }
    catch { info.backendReachable = false; }
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`Mạng: ${selected.name} — ${selected.address}`);
  console.log(`API: ${apiUrl}`);
  console.log(`Dùng Expo Go SDK ${info.expoGoSdk} trên cả Android và iPhone. Hai điện thoại cần cùng mạng với máy tính.`);
  const extraArgs = args.filter((arg, index) => portIndex < 0 || (index !== portIndex && index !== portIndex + 1));
  const child = spawn(process.execPath, [require.resolve('expo/bin/cli'), 'start', '--go', '--lan', '--web',
    '--port', String(port), '--clear', ...extraArgs.filter(arg => arg !== '--clear' && arg !== '--web')], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true,
    env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl, REACT_NATIVE_PACKAGER_HOSTNAME: selected.address },
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { selectLanAddress };

// Erzeugt die Zertifikate für den HTTPS-Test im WLAN (npm run wlan).
//
// Das iPad führt den Service Worker nur aus, wenn es dem Zertifikat wirklich vertraut.
// Dafür legen wir eine kleine eigene Zertifizierungsstelle (CA) an, die du einmal auf
// dem iPad installierst. Ihr geheimer Schlüssel wird sofort wieder verworfen: Sie kann
// also nur dieses eine Server-Zertifikat beglaubigen und später nichts anderes mehr.
// Nachteil: Ändert sich die IP-Adresse, muss das iPad die neue CA noch einmal installieren.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import forge from 'node-forge';

interface CertOptions {
  subjectName: string;
  issuerAttrs?: forge.pki.CertificateField[];
  publicKey: forge.pki.rsa.PublicKey;
  signingKey: forge.pki.rsa.PrivateKey;
  extensions: object[];
  serial: string;
}

const DIR = '.cert';
const DAY = 24 * 60 * 60 * 1000;
const VALID_DAYS = 800; // Apple akzeptiert höchstens 825 Tage

function getLocalIps(): string[] {
  return (Object.values(networkInterfaces()).flat() as NetworkInterfaceInfo[])
    .filter((net) => net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.'))
    .map((net) => net.address);
}

// Passt das vorhandene Zertifikat noch zu dieser Adresse und ist es noch gültig genug?
function currentCertIsFine(ips: string[]): boolean {
  if (!existsSync(`${DIR}/server.crt`) || !existsSync(`${DIR}/server.key`)) return false;
  if (!existsSync(`${DIR}/baumaengel-ca.crt`)) return false;
  const cert = forge.pki.certificateFromPem(readFileSync(`${DIR}/server.crt`, 'utf8'));
  const altNames = cert.getExtension('subjectAltName') as { altNames: { ip?: string }[] };
  const names = altNames.altNames.map((name) => name.ip);
  return cert.validity.notAfter.getTime() - Date.now() > 30 * DAY && ips.every((ip) => names.includes(ip));
}

function createCert({ subjectName, issuerAttrs, publicKey, signingKey, extensions, serial }: CertOptions) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + VALID_DAYS * DAY);
  cert.setSubject([{ name: 'commonName', value: subjectName }]);
  cert.setIssuer(issuerAttrs ?? [{ name: 'commonName', value: subjectName }]);
  cert.setExtensions(extensions);
  cert.sign(signingKey, forge.md.sha256.create());
  return cert;
}

function randomSerial() {
  // Beginnt mit 01, damit die Seriennummer nicht als negative Zahl gelesen wird
  return `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
}

const ips = getLocalIps();

if (currentCertIsFine(ips)) {
  console.log('Zertifikat ist aktuell.');
} else {
  console.log('Erzeuge neue Zertifikate …');
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const serverKeys = forge.pki.rsa.generateKeyPair(2048);

  const ca = createCert({
    subjectName: `Baumaengel Test-CA ${new Date().toISOString().slice(0, 10)}`,
    publicKey: caKeys.publicKey,
    signingKey: caKeys.privateKey,
    serial: randomSerial(),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ],
  });

  const server = createCert({
    subjectName: 'Baumaengel WLAN-Test',
    issuerAttrs: ca.subject.attributes,
    publicKey: serverKeys.publicKey,
    signingKey: caKeys.privateKey,
    serial: randomSerial(),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });

  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/baumaengel-ca.crt`, forge.pki.certificateToPem(ca));
  writeFileSync(`${DIR}/server.crt`, forge.pki.certificateToPem(server));
  writeFileSync(`${DIR}/server.key`, forge.pki.privateKeyToPem(serverKeys.privateKey));

  console.log('');
  console.log('*** NEUE Zertifizierungsstelle: Sie muss auf dem iPad (neu) installiert werden! ***');
}

console.log('');
for (const ip of ips) {
  console.log(`  1. Zertifikat fürs iPad (einmalig): https://${ip}:4173/baumaengel-ca.crt`);
  console.log(`  2. App:                             https://${ip}:4173/`);
}
console.log('');

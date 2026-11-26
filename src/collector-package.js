import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

// A self-contained npm tarball with two fixed public files, built without a
// registry request or package lifecycle scripts. No workspace data is included.
export function bundledCollectorPackage() {
  const blocks = [];
  for (const [name, mode] of [['package.json', 0o644], ['office-collector.mjs', 0o755]]) {
    const content = readFileSync(new URL('../collector/' + name, import.meta.url));
    const header = Buffer.alloc(512);
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
    header.write('package/' + name, 0, 100, 'utf8');
    octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(content.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

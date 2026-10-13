import { Buffer } from 'node:buffer'

// Escritor ZIP minimo (sin compresion, metodo "store") para exportar el dataset
// y los KMZ sin anadir dependencias. Cada fichero se escribe entero (se conoce su
// tamano y CRC), asi que no hacen falta descriptores de datos.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export class ZipWriter {
  // write(buffer) puede ser sincrona o devolver una promesa (p. ej. para respetar el backpressure de un stream).
  constructor(write) {
    this.write = write
    this.entries = []
    this.offset = 0
  }

  async addFile(name, data) {
    const content = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const { time, day } = dosDateTime(new Date())
    const crc = crc32(content)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6) // nombres en UTF-8
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(day, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(content.length, 18)
    header.writeUInt32LE(content.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)

    this.entries.push({ nameBuf, crc, size: content.length, offset: this.offset, time, day })
    await this.write(header)
    await this.write(nameBuf)
    await this.write(content)
    this.offset += header.length + nameBuf.length + content.length
  }

  async finish() {
    const start = this.offset
    let size = 0
    for (const e of this.entries) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4)
      h.writeUInt16LE(20, 6)
      h.writeUInt16LE(0x0800, 8)
      h.writeUInt16LE(0, 10)
      h.writeUInt16LE(e.time, 12)
      h.writeUInt16LE(e.day, 14)
      h.writeUInt32LE(e.crc, 16)
      h.writeUInt32LE(e.size, 20)
      h.writeUInt32LE(e.size, 24)
      h.writeUInt16LE(e.nameBuf.length, 28)
      h.writeUInt32LE(e.offset, 42)
      await this.write(h)
      await this.write(e.nameBuf)
      size += h.length + e.nameBuf.length
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(size, 12)
    end.writeUInt32LE(start, 16)
    await this.write(end)
  }
}

// Atajo: ZIP completo en memoria.
export async function zipToBuffer(files) {
  const chunks = []
  const zip = new ZipWriter((b) => chunks.push(Buffer.from(b)))
  for (const [name, data] of Object.entries(files)) await zip.addFile(name, data)
  await zip.finish()
  return Buffer.concat(chunks)
}

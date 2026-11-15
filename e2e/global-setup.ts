import fs from 'node:fs'
import path from 'node:path'

/** The fake microphone's input: a few seconds of a voice-like tone, loud enough to pass the server's quality gate.
 * Chrome loops it for as long as a recording lasts. */
export default function globalSetup() {
  const file = path.join(__dirname, '.fixtures', 'reading.wav')
  if (fs.existsSync(file)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const rate = 16000
  const seconds = 4
  const n = rate * seconds
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    // 180 Hz with harmonics, switched on and off like syllables (0.25 s on, 0.1 s off).
    const on = t % 0.35 < 0.25 ? 1 : 0
    const v = on * 0.5 * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t))
    data.writeInt16LE(Math.round(v * 12000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, data]))
}

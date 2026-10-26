/** Songs for the chart screen: the alphabet song (the public-domain "Twinkle, Twinkle" tune) over a–z, and a
 * sing-song for a row of the barakhadi / kagunita / uyirmei chart, so the group can chant along. */
import type { Step } from './sound'

const C4 = 60
const scale = (degree: number) => C4 + [0, 2, 4, 5, 7, 9, 11, 12][degree] // C major

const abc = (text: string, degree: number, beats = 1, point = true): Step => ({ text, note: scale(degree), beats, point })

/** A B C D E F G / H I J K LMNOP / Q R S, T U V / W X, Y and Z (eight beats a line), then the two closing lines,
 * which have no letter to point at. */
export const ALPHABET_SONG: Step[] = [
  abc('a', 0), abc('b', 0), abc('c', 4), abc('d', 4), abc('e', 5), abc('f', 5), abc('g', 4, 2),
  abc('h', 3), abc('i', 3), abc('j', 2), abc('k', 2), abc('l', 1, 0.5), abc('m', 1, 0.5), abc('n', 1, 0.5), abc('o', 1, 0.5), abc('p', 0, 2),
  abc('q', 4), abc('r', 4), abc('s', 3, 2), abc('t', 2), abc('u', 2), abc('v', 1, 2),
  abc('w', 4, 3), abc('x', 3), abc('y', 2), abc('and', 2, 1, false), abc('z', 1, 2),
  abc('Now', 0, 1, false), abc('I', 0, 1, false), abc('know', 4, 1, false), abc('my', 4, 1, false),
  abc('A', 5, 1, false), abc('B', 5, 1, false), abc('C', 4, 2, false),
  abc('Next', 3, 1, false), abc('time', 3, 1, false), abc("won't", 2, 1, false), abc('you', 2, 1, false),
  abc('sing', 1, 1, false), abc('with', 1, 1, false), abc('me', 0, 2, false),
]

/** A row of the chart as a chant: up the scale and down again, one cell a beat, ending on the home note. */
export function rowChant(cells: string[]): Step[] {
  const up = [0, 1, 2, 3, 4, 5, 6, 7]
  return cells.map((text, i) => {
    const last = i === cells.length - 1
    const pos = i % 14
    const degree = last ? 0 : pos < 8 ? up[pos] : up[14 - pos]
    return { text, note: scale(degree), beats: last ? 2 : 1 }
  })
}

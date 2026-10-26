/** What the child sees after a card, in the language of the test (the child's language, like the instruction). The
 * same cheer whether the card passed or not: the result is for the teacher. */
const CHEERS: Record<string, string[]> = {
  hi: ['शाबाश!', 'बहुत अच्छे!', 'वाह!'],
  en: ['Well done!', 'Great reading!', 'Super!'],
  mr: ['शाब्बास!', 'छान!', 'वा!'],
  ta: ['அருமை!', 'சபாஷ்!', 'நன்று!'],
  kn: ['ಭೇಷ್!', 'ಚೆನ್ನಾಗಿದೆ!', 'ಭಲೇ!'],
  bn: ['সাবাশ!', 'খুব ভালো!', 'বাহ!'],
}

export function cheer(lang: string, n: number): string {
  const list = CHEERS[lang] ?? CHEERS.en
  return list[Math.abs(n) % list.length]
}

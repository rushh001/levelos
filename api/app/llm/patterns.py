"""The fixed error-pattern vocabulary (diagnosis output must use it; anything else is rejected)."""

PATTERNS = [
    "letter_recognition",
    "matra_vowel_sign",
    "conjunct",
    "blending_scaffolding",
    "sight_word",
    "guessing_from_first_akshara",
    "fluency_only",
    "insufficient_audio",
]

# Patterns that describe a whole item rather than particular words, so they need no word-level evidence.
ITEM_LEVEL_PATTERNS = {"fluency_only", "insufficient_audio"}

LABELS = {
    "letter_recognition": {"hi": "अक्षर पहचान", "en": "Letter recognition"},
    "matra_vowel_sign": {"hi": "मात्रा", "en": "Vowel signs (matras) / vowel sounds"},
    "conjunct": {"hi": "संयुक्त अक्षर", "en": "Conjunct letters"},
    "blending_scaffolding": {"hi": "ध्वनियाँ जोड़कर पढ़ना", "en": "Blending sounds into words"},
    "sight_word": {"hi": "आम छोटे शब्द", "en": "Common sight words"},
    "guessing_from_first_akshara": {"hi": "पहला अक्षर देखकर अनुमान", "en": "Guessing from the first letter"},
    "fluency_only": {"hi": "सही पर रुक-रुककर पढ़ना", "en": "Accurate but slow or halting"},
    "insufficient_audio": {"hi": "आवाज़ से पूरी जाँच नहीं हो सकी", "en": "Not enough clear audio to tell"},
}

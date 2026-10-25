"""Rule-based diagnosis from the evidence features. Shown instantly, used offline and whenever Claude is
unavailable; Claude's diagnosis replaces it when it arrives. Same output shape as the validated Claude output."""

from __future__ import annotations

from ..levels.aser_rules import DEFAULT_THRESHOLDS
from .patterns import PATTERNS

LEVEL_LABELS = {
    "beginner": {"hi": "आरंभिक", "en": "Beginner"},
    "letter": {"hi": "अक्षर", "en": "Letter"},
    "word": {"hi": "शब्द", "en": "Word"},
    "paragraph": {"hi": "अनुच्छेद", "en": "Paragraph"},
    "story": {"hi": "कहानी", "en": "Story"},
}

# One finding sentence per pattern ({name}, {ex} = example words) and one action for the top pattern.
# Hindi uses "{name} को ..." constructions so the sentence does not assume the child's gender.
FINDING = {
    "letter_recognition": ("{name} को कुछ अक्षर पहचानने में कठिनाई है ({ex})।",
                           "{name} does not yet recognise some letters ({ex})."),
    "matra_vowel_sign": ("{name} को मात्राएँ पढ़ने में गलती हो रही है ({ex})।",
                         "{name} misreads vowel signs ({ex})."),
    "conjunct": ("{name} को संयुक्त अक्षरों वाले शब्दों में कठिनाई है ({ex})।",
                 "{name} has trouble with conjunct letters ({ex})."),
    "blending_scaffolding": ("{name} को अक्षर जोड़कर पूरा शब्द पढ़ने में कठिनाई है ({ex})।",
                             "{name} knows the letters but struggles to blend them into words ({ex})."),
    "sight_word": ("{name} को छोटे, आम शब्दों में गलती हो रही है ({ex})।",
                   "{name} misreads common short words ({ex})."),
    "guessing_from_first_akshara": ("पढ़ते समय पहले अक्षर से शब्द का अनुमान लगाया जा रहा है ({ex})।",
                                    "{name} guesses words from the first letter ({ex})."),
    "fluency_only": ("{name} को शब्द सही आते हैं, पर पढ़ना अभी रुक-रुककर है।",
                     "{name} reads the words correctly but slowly or haltingly."),
    "insufficient_audio": ("इस जाँच से गलतियों का प्रकार साफ़ नहीं हुआ।",
                           "This check did not show clearly what kind of errors these are."),
}
ACTION = {
    "letter_recognition": ("इस हफ़्ते रोज़ 5 मिनट अक्षर कार्ड से पहचान का अभ्यास कराएँ।",
                           "This week, practise letter cards for 5 minutes a day."),
    "matra_vowel_sign": ("बारहखड़ी चार्ट से एक व्यंजन के साथ सभी मात्राएँ पढ़वाएँ।",
                         "Use the barakhadi chart: read one consonant with every vowel sign."),
    "conjunct": ("संयुक्त अक्षर वाले शब्दों को तोड़कर पढ़वाएँ, फिर जोड़कर।",
                 "Break words with conjuncts into parts, read each part, then join them."),
    "blending_scaffolding": ("अक्षर जोड़कर शब्द बनाने का अभ्यास कराएँ (क-म-ल → कमल)।",
                             "Practise building words sound by sound (k-a-m-a-l → kamal)."),
    "sight_word": ("इन शब्दों के फ़्लैशकार्ड बनाकर रोज़ दोहराएँ।",
                   "Make flashcards of these words and revise them daily."),
    "guessing_from_first_akshara": ("हर शब्द पर उँगली रखकर पूरा शब्द पढ़ने को कहें।",
                                    "Ask the child to point at each word and read every letter in it."),
    "fluency_only": ("रोज़ एक छोटा अनुच्छेद दो-तीन बार दोहराकर पढ़वाएँ।",
                     "Have the child re-read one short paragraph two or three times a day."),
    "insufficient_audio": ("अगली बार शांत जगह पर दोबारा रिकॉर्ड करें।",
                           "Next time, record again somewhere quieter."),
}
# An English reading check: the same patterns in English-reading terms (letter sounds, short vowels, blends;
# no matras, conjuncts or barakhadi), in both languages of the summary.
FINDING_ENGLISH = {
    "letter_recognition": ("{name} को अंग्रेज़ी के कुछ अक्षरों के नाम या ध्वनियाँ अभी नहीं आतीं ({ex})।",
                           "{name} does not yet know some English letter names or sounds ({ex})."),
    "matra_vowel_sign": ("{name} को अंग्रेज़ी शब्दों की स्वर ध्वनियों (a, e, i, o, u) में गलती हो रही है ({ex})।",
                         "{name} mixes up vowel sounds ({ex})."),
    "conjunct": ("{name} को sh, ch, st जैसी जुड़ी ध्वनियों वाले शब्दों में कठिनाई है ({ex})।",
                 "{name} has trouble with blends and digraphs such as sh, ch, st ({ex})."),
    "blending_scaffolding": ("{name} को अक्षरों की ध्वनियाँ जोड़कर अंग्रेज़ी शब्द पढ़ने में कठिनाई है ({ex})।",
                             "{name} knows the letter sounds but struggles to blend them into words ({ex})."),
}
ACTION_ENGLISH = {
    "letter_recognition": ("इस हफ़्ते रोज़ 5 मिनट अक्षर-ध्वनि चार्ट (a – apple, b – ball) से अभ्यास कराएँ; b/d और p/q पर ध्यान दें।",
                           "This week, practise the letter-sound chart (a – apple, b – ball) for 5 minutes a day; "
                           "watch b/d and p/q."),
    "matra_vowel_sign": ("ऐसे शब्द-परिवार पढ़वाएँ जिनमें सिर्फ़ स्वर बदलता है (sat, sit, set)।",
                         "Practise word families that change only the vowel (sat, sit, set)."),
    "conjunct": ("sh, ch, st वाले शब्दों को ध्वनियों में तोड़कर पढ़वाएँ, फिर जोड़कर (sh-i-p → ship)।",
                 "Break words with sh, ch or st into sounds, read each, then join them (sh-i-p → ship)."),
    "blending_scaffolding": ("ध्वनि-दर-ध्वनि शब्द बनाने का अभ्यास कराएँ (c-a-t → cat)।",
                             "Practise building words sound by sound (c-a-t → cat)."),
}
# Other Indic languages (Marathi, Tamil, Kannada, Bengali, …): advice without Hindi-only terms or examples.
ACTION_INDIC = {
    "matra_vowel_sign": ("अक्षर-मात्रा चार्ट से एक व्यंजन के साथ सभी मात्राएँ पढ़वाएँ।",
                         "Use a letter–vowel-sign chart: read one consonant with every vowel sign."),
    "blending_scaffolding": ("अक्षर जोड़कर शब्द बनाने का अभ्यास कराएँ, फिर पूरा शब्द एक साथ बुलवाएँ।",
                             "Practise building words letter by letter, then saying the whole word in one go."),
}
# The teacher's language when it is not Hindi (the class's own language). "{name}: …" keeps every sentence free of
# gendered verb endings and of suffixes on a name written in another script. Drafts for native-speaking teachers
# to check, like the item banks.
LOCAL = {
    "mr": {
        "finding": {
            "letter_recognition": "{name}: काही अक्षरे अजून ओळखता येत नाहीत ({ex}).",
            "matra_vowel_sign": "{name}: मात्रा वाचताना चुका होतात ({ex}).",
            "conjunct": "{name}: जोडाक्षरे असलेले शब्द वाचायला अवघड जातात ({ex}).",
            "blending_scaffolding": "{name}: अक्षरे ओळखता येतात, पण ती जोडून शब्द वाचायला अवघड जाते ({ex}).",
            "sight_word": "{name}: नेहमीच्या छोट्या शब्दांत चुका होतात ({ex}).",
            "guessing_from_first_akshara": "{name}: पहिले अक्षर पाहून शब्दाचा अंदाज लावला जातो ({ex}).",
            "fluency_only": "{name}: शब्द बरोबर वाचले जातात, पण वाचन अजून हळू किंवा अडखळत आहे.",
            "insufficient_audio": "या तपासणीतून चुकांचा प्रकार स्पष्ट झाला नाही.",
        },
        "action": {
            "letter_recognition": "या आठवड्यात रोज 5 मिनिटे अक्षर कार्डांनी ओळखीचा सराव घ्या.",
            "matra_vowel_sign": "बाराखडी तक्त्यावर एका व्यंजनासोबत सर्व मात्रा वाचून घ्या.",
            "conjunct": "जोडाक्षरे असलेले शब्द तोडून वाचून घ्या, मग जोडून.",
            "blending_scaffolding": "अक्षरे जोडून शब्द बनवण्याचा सराव घ्या, मग पूर्ण शब्द एकत्र म्हणायला सांगा.",
            "sight_word": "या शब्दांची कार्डे बनवून रोज उजळणी घ्या.",
            "guessing_from_first_akshara": "प्रत्येक शब्दावर बोट ठेवून शब्दातील प्रत्येक अक्षर वाचायला सांगा.",
            "fluency_only": "रोज एक छोटा परिच्छेद दोन-तीन वेळा वाचून घ्या.",
            "insufficient_audio": "पुढच्या वेळी शांत जागी पुन्हा रेकॉर्ड करा.",
        },
        "finding_english": {
            "letter_recognition": "{name}: काही इंग्रजी अक्षरांची नावे किंवा उच्चार अजून येत नाहीत ({ex}).",
            "matra_vowel_sign": "{name}: इंग्रजी शब्दांतील स्वर उच्चारांत गोंधळ होतो ({ex}).",
            "conjunct": "{name}: sh, ch, st सारख्या जोड-उच्चारांच्या शब्दांत अडचण येते ({ex}).",
            "blending_scaffolding": "{name}: अक्षरांचे उच्चार येतात, पण ते जोडून इंग्रजी शब्द वाचायला अवघड जाते ({ex}).",
        },
        "action_english": {
            "letter_recognition": "या आठवड्यात रोज 5 मिनिटे अक्षर-उच्चार तक्त्यावर (a – apple, b – ball) सराव घ्या; b/d आणि p/q कडे लक्ष द्या.",
            "matra_vowel_sign": "फक्त स्वर बदलणारे शब्द-संच वाचून घ्या (sat, sit, set).",
            "conjunct": "sh, ch, st असलेले शब्द उच्चारांत तोडून वाचून घ्या, मग जोडून (sh-i-p → ship).",
            "blending_scaffolding": "उच्चार जोडून शब्द बनवण्याचा सराव घ्या (c-a-t → cat).",
        },
        "marks_only": "ही तपासणी टॅप करून केली: कोणते शब्द चुकले ते समजते, पण त्याऐवजी काय वाचले ते नाही. पुढची तपासणी रेकॉर्ड करा म्हणजे चुकांचा प्रकार दिसेल.",
        "no_errors": "{name}: {level} पातळीवरचे वाचन बरोबर आहे, खास चुका नाहीत. पुढच्या पातळीचे साहित्य द्या.",
        "levels": {"beginner": "प्रारंभिक", "letter": "अक्षर", "word": "शब्द", "paragraph": "परिच्छेद", "story": "गोष्ट"},
    },
    "kn": {
        "finding": {
            "letter_recognition": "{name}: ಕೆಲವು ಅಕ್ಷರಗಳನ್ನು ಇನ್ನೂ ಗುರುತಿಸಲು ಆಗುತ್ತಿಲ್ಲ ({ex}).",
            "matra_vowel_sign": "{name}: ಸ್ವರ ಚಿಹ್ನೆಗಳನ್ನು ಓದುವಾಗ ತಪ್ಪುಗಳಾಗುತ್ತಿವೆ ({ex}).",
            "conjunct": "{name}: ಒತ್ತಕ್ಷರವಿರುವ ಪದಗಳನ್ನು ಓದಲು ಕಷ್ಟವಾಗುತ್ತಿದೆ ({ex}).",
            "blending_scaffolding": "{name}: ಅಕ್ಷರಗಳು ಗೊತ್ತು, ಆದರೆ ಅವುಗಳನ್ನು ಸೇರಿಸಿ ಪದವಾಗಿ ಓದಲು ಕಷ್ಟವಾಗುತ್ತಿದೆ ({ex}).",
            "sight_word": "{name}: ಸಾಮಾನ್ಯ ಚಿಕ್ಕ ಪದಗಳಲ್ಲಿ ತಪ್ಪುಗಳಾಗುತ್ತಿವೆ ({ex}).",
            "guessing_from_first_akshara": "{name}: ಮೊದಲ ಅಕ್ಷರ ನೋಡಿ ಪದವನ್ನು ಊಹಿಸಲಾಗುತ್ತಿದೆ ({ex}).",
            "fluency_only": "{name}: ಪದಗಳು ಸರಿಯಾಗಿ ಓದಲ್ಪಡುತ್ತವೆ, ಆದರೆ ಓದು ಇನ್ನೂ ನಿಧಾನ ಅಥವಾ ನಿಂತು ನಿಂತು ಇದೆ.",
            "insufficient_audio": "ಈ ಪರೀಕ್ಷೆಯಿಂದ ತಪ್ಪುಗಳ ಪ್ರಕಾರ ಸ್ಪಷ್ಟವಾಗಲಿಲ್ಲ.",
        },
        "action": {
            "letter_recognition": "ಈ ವಾರ ಪ್ರತಿದಿನ 5 ನಿಮಿಷ ಅಕ್ಷರ ಕಾರ್ಡ್‌ಗಳಿಂದ ಗುರುತಿಸುವ ಅಭ್ಯಾಸ ಮಾಡಿಸಿ.",
            "matra_vowel_sign": "ಕಾಗುಣಿತ ಚಾರ್ಟ್ ಬಳಸಿ: ಒಂದು ವ್ಯಂಜನವನ್ನು ಎಲ್ಲಾ ಸ್ವರ ಚಿಹ್ನೆಗಳೊಂದಿಗೆ ಓದಿಸಿ.",
            "conjunct": "ಒತ್ತಕ್ಷರವಿರುವ ಪದಗಳನ್ನು ಭಾಗಗಳಾಗಿ ಒಡೆದು ಓದಿಸಿ, ನಂತರ ಸೇರಿಸಿ.",
            "blending_scaffolding": "ಅಕ್ಷರ ಅಕ್ಷರ ಸೇರಿಸಿ ಪದ ಕಟ್ಟುವ ಅಭ್ಯಾಸ ಮಾಡಿಸಿ, ನಂತರ ಪೂರ್ಣ ಪದವನ್ನು ಒಮ್ಮೆಲೇ ಹೇಳಿಸಿ.",
            "sight_word": "ಈ ಪದಗಳ ಕಾರ್ಡ್‌ಗಳನ್ನು ಮಾಡಿ ಪ್ರತಿದಿನ ಪುನರಾವರ್ತನೆ ಮಾಡಿಸಿ.",
            "guessing_from_first_akshara": "ಪ್ರತಿ ಪದದ ಮೇಲೆ ಬೆರಳಿಟ್ಟು ಪದದ ಪ್ರತಿಯೊಂದು ಅಕ್ಷರವನ್ನು ಓದಲು ಹೇಳಿ.",
            "fluency_only": "ಪ್ರತಿದಿನ ಒಂದು ಚಿಕ್ಕ ಕಂಡಿಕೆಯನ್ನು ಎರಡು-ಮೂರು ಬಾರಿ ಓದಿಸಿ.",
            "insufficient_audio": "ಮುಂದಿನ ಸಲ ಶಾಂತವಾದ ಜಾಗದಲ್ಲಿ ಮತ್ತೆ ರೆಕಾರ್ಡ್ ಮಾಡಿ.",
        },
        "finding_english": {
            "letter_recognition": "{name}: ಕೆಲವು ಇಂಗ್ಲಿಷ್ ಅಕ್ಷರಗಳ ಹೆಸರು ಅಥವಾ ಧ್ವನಿ ಇನ್ನೂ ಗೊತ್ತಿಲ್ಲ ({ex}).",
            "matra_vowel_sign": "{name}: ಇಂಗ್ಲಿಷ್ ಪದಗಳ ಸ್ವರ ಧ್ವನಿಗಳಲ್ಲಿ ಗೊಂದಲವಾಗುತ್ತಿದೆ ({ex}).",
            "conjunct": "{name}: sh, ch, st ನಂತಹ ಸೇರಿದ ಧ್ವನಿಗಳ ಪದಗಳಲ್ಲಿ ಕಷ್ಟವಾಗುತ್ತಿದೆ ({ex}).",
            "blending_scaffolding": "{name}: ಅಕ್ಷರಗಳ ಧ್ವನಿ ಗೊತ್ತು, ಆದರೆ ಅವನ್ನು ಸೇರಿಸಿ ಇಂಗ್ಲಿಷ್ ಪದ ಓದಲು ಕಷ್ಟವಾಗುತ್ತಿದೆ ({ex}).",
        },
        "action_english": {
            "letter_recognition": "ಈ ವಾರ ಪ್ರತಿದಿನ 5 ನಿಮಿಷ ಅಕ್ಷರ-ಧ್ವನಿ ಚಾರ್ಟ್‌ನಲ್ಲಿ (a – apple, b – ball) ಅಭ್ಯಾಸ ಮಾಡಿಸಿ; b/d ಮತ್ತು p/q ಗಮನಿಸಿ.",
            "matra_vowel_sign": "ಸ್ವರ ಮಾತ್ರ ಬದಲಾಗುವ ಪದ-ಕುಟುಂಬಗಳನ್ನು ಓದಿಸಿ (sat, sit, set).",
            "conjunct": "sh, ch, st ಇರುವ ಪದಗಳನ್ನು ಧ್ವನಿಗಳಾಗಿ ಒಡೆದು ಓದಿಸಿ, ನಂತರ ಸೇರಿಸಿ (sh-i-p → ship).",
            "blending_scaffolding": "ಧ್ವನಿ ಧ್ವನಿ ಸೇರಿಸಿ ಪದ ಕಟ್ಟುವ ಅಭ್ಯಾಸ ಮಾಡಿಸಿ (c-a-t → cat).",
        },
        "marks_only": "ಈ ಪರೀಕ್ಷೆಯನ್ನು ಟ್ಯಾಪ್ ಮಾಡಿ ಗುರುತಿಸಲಾಗಿದೆ: ಯಾವ ಪದಗಳು ತಪ್ಪಾದವು ಎಂಬುದು ಗೊತ್ತು, ಆದರೆ ಬದಲಿಗೆ ಏನು ಓದಲಾಯಿತು ಎಂಬುದು ಅಲ್ಲ. ತಪ್ಪಿನ ಪ್ರಕಾರ ತಿಳಿಯಲು ಮುಂದಿನ ಪರೀಕ್ಷೆಯನ್ನು ರೆಕಾರ್ಡ್ ಮಾಡಿ.",
        "no_errors": "{name}: {level} ಮಟ್ಟದ ಓದು ಸರಿಯಾಗಿದೆ, ವಿಶೇಷ ತಪ್ಪುಗಳಿಲ್ಲ. ಮುಂದಿನ ಮಟ್ಟದ ಸಾಮಗ್ರಿ ಕೊಡಿ.",
        "levels": {"beginner": "ಆರಂಭಿಕ", "letter": "ಅಕ್ಷರ", "word": "ಪದ", "paragraph": "ಕಂಡಿಕೆ", "story": "ಕಥೆ"},
    },
    "ta": {
        "finding": {
            "letter_recognition": "{name}: சில எழுத்துகளை இன்னும் அடையாளம் காண முடியவில்லை ({ex}).",
            "matra_vowel_sign": "{name}: உயிர்க் குறிகளைப் படிப்பதில் தவறுகள் வருகின்றன ({ex}).",
            "conjunct": "{name}: புள்ளி எழுத்துகள் உள்ள சொற்களைப் படிப்பது கடினமாக உள்ளது ({ex}).",
            "blending_scaffolding": "{name}: எழுத்துகள் தெரியும், ஆனால் அவற்றை இணைத்துச் சொல்லாகப் படிப்பது கடினமாக உள்ளது ({ex}).",
            "sight_word": "{name}: அடிக்கடி வரும் சிறு சொற்களில் தவறுகள் வருகின்றன ({ex}).",
            "guessing_from_first_akshara": "{name}: முதல் எழுத்தைப் பார்த்துச் சொல் ஊகிக்கப்படுகிறது ({ex}).",
            "fluency_only": "{name}: சொற்கள் சரியாகப் படிக்கப்படுகின்றன, ஆனால் வாசிப்பு இன்னும் மெதுவாக அல்லது நிறுத்தி நிறுத்தி உள்ளது.",
            "insufficient_audio": "இந்தச் சோதனையில் தவறுகளின் வகை தெளிவாகவில்லை.",
        },
        "action": {
            "letter_recognition": "இந்த வாரம் தினமும் 5 நிமிடம் எழுத்து அட்டைகளைக் கொண்டு அடையாளப் பயிற்சி கொடுங்கள்.",
            "matra_vowel_sign": "உயிர்மெய் அட்டவணையைப் பயன்படுத்துங்கள்: ஒரு மெய்யெழுத்தை எல்லா உயிர்க் குறிகளுடனும் படிக்கச் செய்யுங்கள்.",
            "conjunct": "புள்ளி எழுத்துகள் உள்ள சொற்களைப் பிரித்துப் படிக்கச் செய்து, பிறகு இணைக்கச் செய்யுங்கள்.",
            "blending_scaffolding": "எழுத்து எழுத்தாக இணைத்துச் சொல் உருவாக்கப் பயிற்சி கொடுங்கள், பிறகு முழுச் சொல்லையும் ஒரே மூச்சில் சொல்லச் செய்யுங்கள்.",
            "sight_word": "இந்தச் சொற்களுக்கு அட்டைகள் செய்து தினமும் மீண்டும் படிக்கச் செய்யுங்கள்.",
            "guessing_from_first_akshara": "ஒவ்வொரு சொல்லின் மீதும் விரல் வைத்து, அதன் ஒவ்வொரு எழுத்தையும் படிக்கச் சொல்லுங்கள்.",
            "fluency_only": "தினமும் ஒரு சிறு பத்தியை இரண்டு மூன்று முறை படிக்கச் செய்யுங்கள்.",
            "insufficient_audio": "அடுத்த முறை அமைதியான இடத்தில் மீண்டும் பதிவு செய்யுங்கள்.",
        },
        "finding_english": {
            "letter_recognition": "{name}: சில ஆங்கில எழுத்துகளின் பெயர் அல்லது ஒலி இன்னும் தெரியவில்லை ({ex}).",
            "matra_vowel_sign": "{name}: ஆங்கிலச் சொற்களின் உயிர் ஒலிகளில் குழப்பம் உள்ளது ({ex}).",
            "conjunct": "{name}: sh, ch, st போன்ற இணை ஒலிச் சொற்களில் சிரமம் உள்ளது ({ex}).",
            "blending_scaffolding": "{name}: எழுத்துகளின் ஒலிகள் தெரியும், ஆனால் அவற்றை இணைத்து ஆங்கிலச் சொல்லாகப் படிப்பது கடினமாக உள்ளது ({ex}).",
        },
        "action_english": {
            "letter_recognition": "இந்த வாரம் தினமும் 5 நிமிடம் எழுத்து-ஒலி அட்டவணையில் (a – apple, b – ball) பயிற்சி கொடுங்கள்; b/d, p/q கவனியுங்கள்.",
            "matra_vowel_sign": "உயிர் ஒலி மட்டும் மாறும் சொல் குடும்பங்களைப் படிக்கச் செய்யுங்கள் (sat, sit, set).",
            "conjunct": "sh, ch, st உள்ள சொற்களை ஒலிகளாகப் பிரித்துப் படித்து, பிறகு இணைக்கச் செய்யுங்கள் (sh-i-p → ship).",
            "blending_scaffolding": "ஒலி ஒலியாக இணைத்துச் சொல் உருவாக்கப் பயிற்சி கொடுங்கள் (c-a-t → cat).",
        },
        "marks_only": "இந்தச் சோதனை தட்டிக் குறியிடப்பட்டது: எந்தச் சொற்கள் தவறு என்று தெரியும், ஆனால் அதற்குப் பதில் என்ன படிக்கப்பட்டது என்று தெரியாது. தவறின் வகை தெரிய அடுத்த சோதனையைப் பதிவு செய்யுங்கள்.",
        "no_errors": "{name}: {level} நிலை வாசிப்பு சரியாக உள்ளது, குறிப்பிட்ட தவறுகள் இல்லை. அடுத்த நிலைப் பாடங்களைக் கொடுங்கள்.",
        "levels": {"beginner": "தொடக்கம்", "letter": "எழுத்து", "word": "சொல்", "paragraph": "பத்தி", "story": "கதை"},
    },
    "bn": {
        "finding": {
            "letter_recognition": "{name}: কিছু অক্ষর এখনও চিনতে পারছে না ({ex})।",
            "matra_vowel_sign": "{name}: কার-চিহ্ন পড়তে ভুল হচ্ছে ({ex})।",
            "conjunct": "{name}: যুক্তাক্ষরওয়ালা শব্দ পড়তে অসুবিধা হচ্ছে ({ex})।",
            "blending_scaffolding": "{name}: অক্ষর চেনে, কিন্তু সেগুলো জুড়ে শব্দ পড়তে অসুবিধা হচ্ছে ({ex})।",
            "sight_word": "{name}: চেনা ছোট শব্দে ভুল হচ্ছে ({ex})।",
            "guessing_from_first_akshara": "{name}: প্রথম অক্ষর দেখে শব্দ আন্দাজ করছে ({ex})।",
            "fluency_only": "{name}: শব্দ ঠিক পড়ছে, কিন্তু পড়া এখনও ধীর বা থেমে থেমে।",
            "insufficient_audio": "এই যাচাই থেকে ভুলের ধরন স্পষ্ট হয়নি।",
        },
        "action": {
            "letter_recognition": "এই সপ্তাহে রোজ 5 মিনিট অক্ষর-কার্ড দিয়ে চেনার অনুশীলন করান।",
            "matra_vowel_sign": "অক্ষর-কার-চিহ্নের চার্ট দিয়ে একটি ব্যঞ্জনবর্ণ সব কার-চিহ্নের সঙ্গে পড়ান।",
            "conjunct": "যুক্তাক্ষরওয়ালা শব্দ ভেঙে পড়ান, তারপর জুড়ে পড়ান।",
            "blending_scaffolding": "অক্ষর জুড়ে জুড়ে শব্দ গড়ার অনুশীলন করান, তারপর পুরো শব্দটা একবারে বলতে বলুন।",
            "sight_word": "এই শব্দগুলোর কার্ড বানিয়ে রোজ ঝালিয়ে নিন।",
            "guessing_from_first_akshara": "প্রতিটি শব্দে আঙুল রেখে শব্দের প্রতিটি অক্ষর পড়তে বলুন।",
            "fluency_only": "রোজ একটি ছোট অনুচ্ছেদ দু-তিনবার পড়ান।",
            "insufficient_audio": "পরের বার শান্ত জায়গায় আবার রেকর্ড করুন।",
        },
        "finding_english": {
            "letter_recognition": "{name}: কিছু ইংরেজি অক্ষরের নাম বা ধ্বনি এখনও জানে না ({ex})।",
            "matra_vowel_sign": "{name}: ইংরেজি শব্দের স্বরধ্বনিতে গুলিয়ে ফেলছে ({ex})।",
            "conjunct": "{name}: sh, ch, st-এর মতো যুক্ত ধ্বনির শব্দে অসুবিধা হচ্ছে ({ex})।",
            "blending_scaffolding": "{name}: অক্ষরের ধ্বনি জানে, কিন্তু সেগুলো জুড়ে ইংরেজি শব্দ পড়তে অসুবিধা হচ্ছে ({ex})।",
        },
        "action_english": {
            "letter_recognition": "এই সপ্তাহে রোজ 5 মিনিট অক্ষর-ধ্বনি চার্টে (a – apple, b – ball) অনুশীলন করান; b/d আর p/q খেয়াল রাখুন।",
            "matra_vowel_sign": "শুধু স্বর বদলায় এমন শব্দ-পরিবার পড়ান (sat, sit, set)।",
            "conjunct": "sh, ch, st-ওয়ালা শব্দ ধ্বনিতে ভেঙে পড়ান, তারপর জুড়ুন (sh-i-p → ship)।",
            "blending_scaffolding": "ধ্বনি জুড়ে জুড়ে শব্দ গড়ার অনুশীলন করান (c-a-t → cat)।",
        },
        "marks_only": "এই যাচাই ট্যাপ করে চিহ্ন দিয়ে করা: কোন শব্দ ভুল তা জানা যায়, কিন্তু তার বদলে কী পড়া হয়েছে তা নয়। ভুলের ধরন জানতে পরের যাচাই রেকর্ড করুন।",
        "no_errors": "{name}: {level} স্তরের পড়া ঠিক আছে, বিশেষ ভুল নেই। পরের স্তরের পাঠ দিন।",
        "levels": {"beginner": "প্রাথমিক", "letter": "অক্ষর", "word": "শব্দ", "paragraph": "অনুচ্ছেদ", "story": "গল্প"},
    },
}
# Tap-marked without a recording: the wrong words are known, not what the child said instead.
MARKS_ONLY = ("यह जाँच टैप करके की गई: कौन-से शब्द गलत थे यह पता है, पर बच्चे ने उनकी जगह क्या पढ़ा यह नहीं। "
              "अगली जाँच रिकॉर्ड करें ताकि गलती का प्रकार दिख सके।",
              "This check was marked by tapping: it shows which words were wrong, not what the child said instead. "
              "Record the next check so the kind of error shows.")


def classify(word: dict, level: str) -> str | None:
    """A specific decoding pattern wins; 'sight word' is for skipped common words, or common words misread in a
    way no decoding pattern explains (की -> कि is a matra error even though की is a common word)."""
    f = word["features"]
    if level == "letter":
        return "letter_recognition"
    if word["kind"] == "omission":
        return "sight_word" if f["sight_word"] else None
    if f.get("conjunct_changed"):
        return "conjunct"
    if f.get("vowel_sign_only"):
        return "matra_vowel_sign"
    if f["sight_word"]:
        return "sight_word"
    if f.get("overlap") == "scaffolding":
        return "blending_scaffolding"
    if f.get("overlap") == "initial":
        return "guessing_from_first_akshara"
    if f.get("overlap") in ("final", "some"):
        return "blending_scaffolding"
    return None


def _halting(item: dict) -> bool:
    t = DEFAULT_THRESHOLDS
    floor = t.passage_min_wcpm.get(item["level"])
    return ((item["pauses_over_3s"] or 0) > t.passage_max_hesitations
            or (item["wcpm"] is not None and floor is not None and item["wcpm"] < floor))


def diagnose(inp: dict, name: str) -> dict:
    found: dict[str, list[dict]] = {}
    unclear = marks_only = 0
    for item in inp["items"]:
        offline = item["source"] == "offline_marks"
        for w in item["error_words"]:
            if w["uncertain"]:
                unclear += 1
                continue
            if offline and item["level"] != "letter":
                marks_only += 1
                continue
            p = classify(w, item["level"])
            if p:
                found.setdefault(p, []).append({"item_id": item["item_id"], "i": w["i"], "ref": w["ref"],
                                                "heard": w["heard"]})
        if item["level"] in ("paragraph", "story") and item["errors"] is not None \
                and item["errors"] <= DEFAULT_THRESHOLDS.passage_max_errors and _halting(item):
            found.setdefault("fluency_only", []).append({"item_id": item["item_id"], "i": None, "ref": None,
                                                         "heard": None})
    if not found and (unclear or marks_only):
        found["insufficient_audio"] = [{"item_id": inp["items"][0]["item_id"], "i": None, "ref": None,
                                        "heard": None}]

    ranked = sorted(found, key=lambda p: (-len(found[p]), PATTERNS.index(p)))[:3]
    evidence = []
    for p in ranked:
        by_item: dict[str, list[dict]] = {}
        for e in found[p]:
            by_item.setdefault(e["item_id"], [])
            if e["i"] is not None:
                by_item[e["item_id"]].append({"i": e["i"], "ref": e["ref"], "heard": e["heard"]})
        evidence += [{"pattern": p, "item_id": iid, "words": ws, "note_en": "", "note_hi": ""}
                     for iid, ws in by_item.items()]
    return {
        "error_patterns": ranked,
        "evidence": evidence,
        "word_notes": [],
        "summary": summarize(ranked, found, inp, name, marks_only=bool(marks_only) and not unclear),
        "confidence": "low",
    }


def _examples(entries: list[dict]) -> str:
    out = []
    for e in entries:
        if e["ref"] is None:
            continue
        out.append(f"{e['ref']} → {e['heard']}" if e["heard"] else f"{e['ref']} → —")
        if len(out) == 2:
            break
    return ", ".join(out)


def summarize(ranked: list[str], found: dict[str, list[dict]], inp: dict, name: str, *,
              marks_only: bool = False) -> dict:
    """The teacher's summary in English and in the teacher's language (`teacher_language`: Hindi unless the class's
    own language has an interface)."""
    local = inp.get("teacher_language", {}).get("code", "hi")
    hi, en = _summary_hi_en(ranked, found, inp, name, marks_only)
    if local in LOCAL:
        return {"en": en, local: _summary_local(LOCAL[local], ranked, found, inp, name, marks_only)}
    return {"hi": hi, "en": en}


def _summary_local(t: dict, ranked: list[str], found: dict[str, list[dict]], inp: dict, name: str,
                   marks_only: bool) -> str:
    english = inp["language"] == "en"
    if not ranked:
        return t["no_errors"].format(name=name, level=t["levels"].get(inp.get("aser_level") or "", ""))
    if ranked == ["insufficient_audio"] and marks_only:
        return t["marks_only"]
    parts = []
    for p in ranked[:2]:
        finding = (t["finding_english"].get(p) if english else None) or t["finding"][p]
        parts.append(finding.format(name=name, ex=_examples(found[p])).replace(" ()", ""))
    action = (t["action_english"].get(ranked[0]) if english else None) or t["action"][ranked[0]]
    return " ".join(parts + [action])


def _summary_hi_en(ranked: list[str], found: dict[str, list[dict]], inp: dict, name: str,
                   marks_only: bool) -> tuple[str, str]:
    english = inp["language"] == "en"
    if not ranked:
        level = LEVEL_LABELS.get(inp.get("aser_level") or "", {"hi": "", "en": ""})
        return (f"{name} का {level['hi']} स्तर का पढ़ना ठीक है, कोई खास गलती नहीं। अगले स्तर की सामग्री दें।",
                f"{name} reads at {level['en']} level without notable errors. Move on to next-level material.")
    if ranked == ["insufficient_audio"] and marks_only:
        return MARKS_ONLY
    hi_parts, en_parts = [], []
    for p in ranked[:2]:
        ex = _examples(found[p])
        fh, fe = FINDING_ENGLISH[p] if english and p in FINDING_ENGLISH else FINDING[p]
        hi_parts.append(fh.format(name=name, ex=ex).replace(" ()", ""))
        en_parts.append(fe.format(name=name, ex=ex).replace(" ()", ""))
    if english:
        ah, ae = ACTION_ENGLISH.get(ranked[0], ACTION[ranked[0]])
    elif inp["language"] != "hi":
        ah, ae = ACTION_INDIC.get(ranked[0], ACTION[ranked[0]])
    else:
        ah, ae = ACTION[ranked[0]]
    return " ".join(hi_parts + [ah]), " ".join(en_parts + [ae])

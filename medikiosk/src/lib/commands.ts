/**
 * Voice-command navigation — "tap the mic and say a command" layer.
 *
 * Pure matching so it is unit-testable. Commands work in English, Hindi, and
 * the other eight Kiosk languages (Bengali, Tamil, Telugu, Marathi, Gujarati,
 * Kannada, Malayalam, Punjabi — native script + common romanised words) to
 * serve low-literacy users who cannot read menus.
 */

export type VoiceIntent = "next" | "back" | "skip" | "help" | "menu" | "print";

const COMMANDS: Record<VoiceIntent, string[]> = {
  next: [
    "next",
    "continue",
    "aage",
    "aage badho",
    "आगे",
    "आगे बढ़ो",
    "अगला",
    "अगला सवाल",
    // Bengali
    "পরের", "পরের ধাপ", "এগিয়ে যান", "আগে বাড়ুন", "পরের প্রশ্ন",
    // Tamil
    "அடுத்த", "அடுத்தது", "முன்னே செல்", "முன்னே செல்லுங்கள்",
    // Telugu
    "తర్వాత", "తరువాత", "ముందుకు వెళ్లు", "తర్వాత ప్రశ్న",
    // Marathi
    "पुढे", "पुढचा", "पुढील", "पुढे जा",
    // Gujarati
    "આગળ", "આગળ વધો", "પછીનું", "આગળ વધારો",
    // Kannada
    "ಮುಂದೆ", "ಮುಂದಿನ", "ಮುಂದುವರಿ", "ಮುಂದೆ ಹೋಗು",
    // Malayalam
    "അടുത്തത്", "മുന്നോട്ട്", "മുന്നോട്ട് പോകൂ", "അടുത്ത ചോദ്യം",
    // Punjabi
    "ਅੱਗੇ", "ਅਗਲਾ", "ਅੱਗੇ ਵਧੋ", "ਅਗਲਾ ਸਵਾਲ",
  ],
  back: [
    "back",
    "pichhe",
    "peeche",
    "वापस",
    "पीछे",
    "पिछला",
    // Bengali
    "পেছনে", "পেছন", "পেছনের প্রশ্ন",
    // Tamil
    "பின்னால்", "பின்", "திரும்பு", "முந்தையது",
    // Telugu
    "వెనుకకు", "వెనక్కి", "వెనుక ప్రశ్న",
    // Marathi
    "मागे", "मागचा", "मागील",
    // Gujarati
    "પાછળ", "પાછા જાઓ", "પહેલાનું",
    // Kannada
    "ಹಿಂದೆ", "ಹಿಂದಿರುಗು", "ಹಿಂದಿನದು",
    // Malayalam
    "പിന്നിലേക്ക്", "തിരികെ", "മുമ്പത്തെ ചോദ്യം",
    // Punjabi
    "ਪਿੱਛੇ", "ਵਾਪਸ", "ਪਿਛਲਾ",
  ],
  skip: [
    "skip",
    "is ko chhodo",
    "chhodo",
    "skip karo",
    "छोड़ो",
    "स्किप",
    // Bengali
    "বাদ দিন", "এড়িয়ে যান",
    // Tamil
    "தவிர்க்கவும்", "தாண்டு", "விட்டுவிடு",
    // Telugu
    "దాటవేయి", "వదిలేయి", "విడిచిపెట్టు",
    // Marathi
    "सोडून द्या", "वगळा",
    // Gujarati
    "છોડી દો", "સ્કિપ કરો",
    // Kannada
    "ಬಿಟ್ಟುಬಿಡು", "ಬಿಟ್ಟು",
    // Malayalam
    "ഒഴിവാക്കുക", "ഒഴിവാക്കൂ",
    // Punjabi
    "ਛੱਡ ਦਿਓ", "ਛੱਡੋ",
  ],
  help: [
    "help",
    "madad",
    "sahayata",
    "kya karna hai",
    "मदद",
    "सहायता",
    "क्या करना है",
    // Bengali
    "সাহায্য", "সাহায্য করুন",
    // Tamil
    "உதவி", "உதவி வேண்டும்",
    // Telugu
    "సహాయం", "సహాయం కావాలి",
    // Marathi
    "मदत", "मदत हवी",
    // Gujarati
    "મદદ", "મદદ કરો",
    // Kannada
    "ಸಹಾಯ", "ಸಹಾಯ ಬೇಕು",
    // Malayalam
    "സഹായം", "സഹായം വേണം",
    // Punjabi
    "ਮਦਦ", "ਮਦਦ ਚਾਹੀਦੀ ਹੈ",
  ],
  menu: [
    "menu",
    "main menu",
    "ghar",
    "home",
    "मेनू",
    "होम",
    "घर",
    // Bengali
    "মেনু", "প্রধান মেনু", "হোম",
    // Tamil
    "மெனு", "முகப்பு", "வீடு",
    // Telugu
    "మెనూ", "హోమ్", "ఇంటికి",
    // Marathi
    "मेनू", "घर", "मुख्य मेनू",
    // Gujarati
    "મેનુ", "ઘર", "મુખ્ય મેનુ",
    // Kannada
    "ಮೆನು", "ಮುಖಪುಟ", "ಹೋಮ್",
    // Malayalam
    "മെനു", "ഹോം", "തിരികെ മെനുവിലേക്ക്",
    // Punjabi
    "ਮੇਨੂ", "ਘਰ", "ਮੁੱਖ ਮੇਨੂ",
  ],
  print: [
    "print",
    "print karo",
    "प्रिंट",
    // Bengali
    "প্রিন্ট", "প্রিন্ট করুন",
    // Tamil
    "அச்சிடு", "பிரிண்ட்",
    // Telugu
    "ప్రింట్", "ప్రింట్ చేయి",
    // Marathi
    "प्रिंट", "छापा",
    // Gujarati
    "પ્રિન્ટ", "છાપો",
    // Kannada
    "ಪ್ರಿಂಟ್", "ಮುದ್ರಿಸು",
    // Malayalam
    "പ്രിന്റ്", "അച്ചടിക്കുക",
    // Punjabi
    "ਪ੍ਰਿੰਟ", "ਛਾਪੋ",
  ],
};

/** Normalise speech transcript for matching (keeps Latin + all Indic scripts). */
export function normalizeCommandText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\u0900-\u0D7F0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a spoken phrase to an intent, or null when no command matched. */
export function matchCommand(spoken: string): VoiceIntent | null {
  const norm = normalizeCommandText(spoken);
  if (!norm) return null;
  for (const intent of Object.keys(COMMANDS) as VoiceIntent[]) {
    if (
      COMMANDS[intent].some(
        (phrase) =>
          norm === phrase ||
          norm.startsWith(`${phrase} `) ||
          norm.includes(` ${phrase} `) ||
          norm.endsWith(` ${phrase}`)
      )
    ) {
      return intent;
    }
  }
  return null;
}

export const VOICE_COMMAND_HINT = "Say: Next · Back · Skip · Help";

const VOICE_COMMAND_HINTS: Record<string, string> = {
  en: "Say: Next · Back · Skip · Help",
  hi: "बोलें: आगे · पीछे · छोड़ें · मदद",
  bn: "বলুন: পরের · পেছনে · এড়িয়ে যান · সাহায্য",
  ta: "சொல்லுங்கள்: அடுத்து · பின் · தவிர் · உதவி",
  te: "చెప్పండి: తర్వాత · వెనుకకు · దాటవేయి · సహాయం",
  mr: "बोला: पुढे · मागे · वगळा · मदत",
  gu: "બોલો: આગળ · પાછળ · છોડો · મદદ",
  kn: "ಹೇಳಿ: ಮುಂದೆ · ಹಿಂದೆ · ಬಿಟ್ಟುಬಿಡಿ · ಸಹಾಯ",
  ml: "പറയൂ: അടുത്തത് · പിന്നിലേക്ക് · ഒഴിവാക്കുക · സഹായം",
  pa: "ਬੋਲੋ: ਅੱਗੇ · ਪਿੱਛੇ · ਛੱਡੋ · ਮਦਦ",
};

/** Voice-command hint in the kiosk language (matchCommand already accepts all 10). */
export function voiceCommandHint(langCode?: string | null): string {
  return (langCode && VOICE_COMMAND_HINTS[langCode]) || VOICE_COMMAND_HINTS.en;
}